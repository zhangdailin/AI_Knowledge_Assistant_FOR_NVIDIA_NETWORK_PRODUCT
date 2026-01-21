/**
 * 搜索管道 - 将搜索流程分解为清晰的步骤
 */
import { LIMITS, CACHE, SCORING, COMMAND_CONTENT_PATTERNS, COMMAND_BOOST } from '../constants.mjs';
import { hybridRetrieval, determineRetrievalStrategyWithAB } from '../hybridRetrieval.mjs';
import { optimizeReferences } from './referenceOptimizer.mjs';

export class SearchPipeline {
  constructor(options = {}) {
    this.storage = options.storage;
    this.embedText = options.embedText;
    this.rerankDocuments = options.rerankDocuments;
    this.fuseResults = options.fuseResults;
    this.smartQueryRewrite = options.smartQueryRewrite;
    this.searchCache = options.searchCache;
    this.semanticCache = options.semanticCache;
    this.findSimilarCachedQuery = options.findSimilarCachedQuery;
    this.cosineSimilarity = options.cosineSimilarity;
    this.hybridRetrieval = options.hybridRetrieval || hybridRetrieval;
    this.determineRetrievalStrategy = options.determineRetrievalStrategy || determineRetrievalStrategyWithAB;
    this.optimizeReferences = options.optimizeReferences || optimizeReferences;
  }

  /**
   * 检查精确匹配缓存
   */
  checkExactCache(cacheKey) {
    const cached = this.searchCache?.get(cacheKey);
    if (cached) {
      console.log(`[SearchPipeline] 精确缓存命中: ${cacheKey}`);
      return { hit: true, results: cached, type: 'exact' };
    }
    return { hit: false };
  }

  /**
   * 检查语义缓存
   */
  async checkSemanticCache(query) {
    if (!this.embedText || !this.findSimilarCachedQuery) {
      return { hit: false };
    }

    try {
      const queryEmbedding = await this.embedText(query);
      if (!queryEmbedding) return { hit: false };

      const semanticMatch = this.findSimilarCachedQuery(
        queryEmbedding,
        CACHE.SEMANTIC_CACHE_THRESHOLD
      );

      if (semanticMatch) {
        console.log(`[SearchPipeline] 语义缓存命中: ${semanticMatch.query} (相似度: ${semanticMatch.similarity.toFixed(4)})`);
        return {
          hit: true,
          results: semanticMatch.results,
          type: 'semantic',
          originalQuery: semanticMatch.query,
          similarity: semanticMatch.similarity,
          queryEmbedding
        };
      }

      return { hit: false, queryEmbedding };
    } catch (error) {
      console.warn('[SearchPipeline] 语义缓存检查失���:', error.message);
      return { hit: false };
    }
  }

  /**
   * 查询扩展
   */
  expandQuery(query, config = {}) {
    const enableExpansion = config.enableQueryExpansion !== false;
    if (!enableExpansion || !this.smartQueryRewrite) {
      return [query];
    }

    try {
      const rewriteResult = this.smartQueryRewrite(query, {
        enableExpansion: true,
        enableContext: false
      });

      const variants = rewriteResult.variants.slice(0, LIMITS.SEARCH_VARIANTS_LIMIT);

      if (variants.length > 1) {
        console.log(`[SearchPipeline] 查询扩展: "${query}" -> ${variants.length} 个变体`);
        console.log(`[SearchPipeline] 变体: ${variants.slice(1).map(q => `"${q}"`).join(', ')}`);
      }

      return variants;
    } catch (error) {
      console.warn('[SearchPipeline] 查询扩展失败:', error.message);
      return [query];
    }
  }

  /**
   * 执行搜索（关键词 + 向量）
   */
  async executeSearch(queries, queryEmbedding, options = {}) {
    const {
      searchLimit = LIMITS.SEARCH_LIMIT,
      categoryIds = []
    } = options;

    const allKeywordResults = [];
    const allVectorResults = [];

    for (const sq of queries) {
      // 关键词搜索
      const kwResults = await this.storage.searchChunks(sq, searchLimit, categoryIds);
      allKeywordResults.push(...kwResults);

      // 向量搜索
      try {
        let embedding;
        // 只对原查询复用之前生成的embedding
        if (sq === queries[0] && queryEmbedding) {
          embedding = queryEmbedding;
        } else {
          embedding = await this.embedText(sq);
        }

        if (embedding) {
          const vecResults = await this.storage.vectorSearchChunks(embedding, searchLimit, categoryIds);
          allVectorResults.push(...vecResults);
        }
      } catch (error) {
        console.warn(`[SearchPipeline] 向量搜索失败 (query: "${sq}"):`, error.message);
      }
    }

    // 去重（基于chunk id）
    const keywordResultsMap = new Map();
    allKeywordResults.forEach(r => {
      const id = r.id;
      if (!keywordResultsMap.has(id) || r.score > keywordResultsMap.get(id).score) {
        keywordResultsMap.set(id, r);
      }
    });
    const keywordResults = Array.from(keywordResultsMap.values());

    const vectorResultsMap = new Map();
    allVectorResults.forEach(r => {
      const id = r.chunk.id;
      if (!vectorResultsMap.has(id) || r.score > vectorResultsMap.get(id).score) {
        vectorResultsMap.set(id, r);
      }
    });
    const vectorResults = Array.from(vectorResultsMap.values());

    console.log(`[SearchPipeline] 搜索完成: Keyword=${keywordResults.length}, Vector=${vectorResults.length}`);

    return { keywordResults, vectorResults };
  }

  /**
   * 融合结果（RRF）
   */
  async fuse(keywordResults, vectorResults, query, options = {}) {
    const {
      searchLimit = LIMITS.SEARCH_LIMIT,
      config = {}
    } = options;

    return await this.fuseResults(keywordResults, vectorResults, query, searchLimit, config);
  }

  /**
   * Reranking
   */
  async rerank(results, query, options = {}) {
    const { rerankTopN = SCORING.RERANK_TOPN } = options;

    if (results.length === 0 || !this.rerankDocuments) {
      return results;
    }

    try {
      const rerankedResults = await this.rerankDocuments(query, results, rerankTopN);
      if (rerankedResults.length > 0) {
        console.log(`[SearchPipeline] Reranking 完成: ${results.length} -> ${rerankedResults.length}`);
        return rerankedResults;
      }
    } catch (error) {
      console.warn('[SearchPipeline] Reranking 失败:', error.message);
    }

    return results;
  }

  /**
   * 保存到缓存
   */
  saveToCache(cacheKey, query, results, queryEmbedding) {
    // 保存到精确匹配缓存
    if (this.searchCache) {
      this.searchCache.set(cacheKey, results);
    }

    // 保存到语义缓存
    if (this.semanticCache && queryEmbedding && results.length > 0) {
      const semanticCacheKey = `semantic_${Date.now()}_${Math.random()}`;
      this.semanticCache.set(semanticCacheKey, {
        queryEmbedding,
        query,
        results,
        timestamp: Date.now()
      });
      console.log(`[SearchPipeline] 已缓存查询: "${query}" (embedding维度: ${queryEmbedding.length})`);
    }
  }

  /**
   * 重新应用知识图谱增强
   * Reranker 返回的分数可能是 logits (e.g., -10 to 10) 或概率 (0 to 1)
   * 我们需要根据分数范围自适应调整 boost
   */
  reapplyKnowledgeGraphBoost(results) {
    if (!results || results.length === 0) return;

    // 1. 分析分数分布
    const scores = results.map(r => r.rerank_score !== undefined ? r.rerank_score : (r.score || 0));
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const scoreRange = maxScore - minScore;

    // 确定 Boost 缩放因子
    let boostScale = 0;

    if (scoreRange > 2) {
      // Logits 模式：使用 range 的 5%~10% 作为 boost 基准
      boostScale = scoreRange * 0.1;
    } else if (maxScore > 0.8 && minScore < 0.2) {
      // 概率模式 (Sigmoid)：Range ~ 1.0
      boostScale = 0.1;
    } else {
      // 默认回退
      boostScale = Math.max(0.1, Math.abs(maxScore) * 0.1);
    }

    // 确保最小 boost 可见且不过大
    boostScale = Math.max(0.05, boostScale); // 最小 0.05
    boostScale = Math.min(boostScale, 10.0); // 最大 10 (防止无限放大)

    let boostedCount = 0;

    for (const result of results) {
      // 检查是否有 KG 匹配标记 (由 hybridRetrieval 设置)
      const hasKgMatches = (result.kgMatches || 0) > 0;
      const hasChunkMatches = (result.kgChunkMatches?.length || 0) > 0;
      const hasMultiHopMatches = (result.multiHopMatches || 0) > 0;
      const hasCommandBoost = (result.commandContentBoost || 0) > 0 || result.hasCodeBlock || result.hasNvCommand;

      if (!hasKgMatches && !hasChunkMatches && !hasMultiHopMatches && !hasCommandBoost) continue;

      let totalBoost = 0;

      // 1. 实体匹配增强
      if (hasKgMatches) {
        // 每个匹配实体增加 0.2 * scale
        totalBoost += (result.kgMatches * 0.2 * boostScale);
      }

      // 2. Chunk 引用增强 (MENTIONS) - 权重更高
      if (hasChunkMatches) {
        totalBoost += (0.5 * boostScale); // 固定给予显著提升
      }

      // 3. 多跳实体增强 - 权重较低
      if (hasMultiHopMatches) {
        totalBoost += (result.multiHopMatches * 0.1 * boostScale);
      }

      // 4. 命令内容增强 - 新增
      if (hasCommandBoost) {
        // 代码块加分
        if (result.hasCodeBlock) {
          totalBoost += (COMMAND_BOOST.CODE_BLOCK_BOOST * boostScale);
        }
        // nv 命令加分
        if (result.hasNvCommand) {
          totalBoost += (COMMAND_BOOST.KG_COMMAND_BOOST * boostScale);
        }
        // 命令匹配数量加分
        if (result.commandMatchCount > 0) {
          const cmdBoost = Math.min(
            result.commandMatchCount * 0.05 * boostScale,
            COMMAND_BOOST.COMMAND_SYNTAX_BOOST * boostScale
          );
          totalBoost += cmdBoost;
        }
      }

      // 应用增强
      if (result.rerank_score !== undefined) {
        result.rerank_score += totalBoost;
        // 同步更新 score 以便后续排序正确
        result.score = result.rerank_score;
      } else {
        result.score = (result.score || 0) + totalBoost;
      }

      // 更新元数据以便前端/调试可见
      result.kgPostRerankBoost = totalBoost;
      boostedCount++;
    }

    if (boostedCount > 0) {
      // 重新排序
      results.sort((a, b) => {
        const scoreA = a.rerank_score !== undefined ? a.rerank_score : (a.score || 0);
        const scoreB = b.rerank_score !== undefined ? b.rerank_score : (b.score || 0);
        return scoreB - scoreA;
      });
      console.log(`[SearchPipeline] KG + 命令增强已重新应用: ${boostedCount} 个结果获得提升 (Scale=${boostScale.toFixed(3)})`);
    }
  }

  /**
   * 执行完整的搜索管道
   */
  async execute(query, options = {}) {
    const startTime = Date.now();
    const {
      cacheKey,
      searchLimit = LIMITS.SEARCH_LIMIT,
      categoryIds = [],
      rerankTopN = SCORING.RERANK_TOPN,
      config = {}
    } = options;

    // 1. 检查精确匹配缓存
    if (cacheKey) {
      const exactCache = this.checkExactCache(cacheKey);
      if (exactCache.hit) {
        return {
          results: exactCache.results,
          cached: true,
          cacheType: 'exact',
          duration: Date.now() - startTime
        };
      }
    }

    // 2. 检查语义缓存
    const semanticCache = await this.checkSemanticCache(query);
    if (semanticCache.hit) {
      return {
        results: semanticCache.results,
        cached: true,
        cacheType: 'semantic',
        originalQuery: semanticCache.originalQuery,
        similarity: semanticCache.similarity,
        duration: Date.now() - startTime
      };
    }

    const queryEmbedding = semanticCache.queryEmbedding;

    // 3. 查询扩展
    const queries = this.expandQuery(query, config);

    // 4. 执行搜索
    const { keywordResults, vectorResults } = await this.executeSearch(
      queries,
      queryEmbedding,
      { searchLimit, categoryIds }
    );

    // 5. 融合结果
    let fusedResults = await this.fuse(
      keywordResults,
      vectorResults,
      query,
      { searchLimit, config }
    );

    // 6. 知识图谱增强（新增）
    const enableKnowledgeGraph = config.enableKnowledgeGraph !== false; // 默认启用
    if (enableKnowledgeGraph && this.hybridRetrieval && this.determineRetrievalStrategy) {
      try {
        // 传入实验配置 (config.experimentConfig) 如果存在
        const strategy = this.determineRetrievalStrategy(query, config.experimentConfig);
        fusedResults = await this.hybridRetrieval(query, fusedResults, strategy);
        console.log(`[SearchPipeline] 知识图谱增强完成 (策略: ${strategy.strategy})`);
      } catch (error) {
        console.warn('[SearchPipeline] 知识图谱增强失败，使用原始结果:', error.message);
      }
    }

    // 7. Reranking
    let rankedResults = await this.rerank(fusedResults, query, { rerankTopN });

    // 7.5. 重新应用知识图谱增强 (适应 Rerank 分数体系)
    // Reranking 会重置分数，我们需要把 KG 的贡献加回去
    if (enableKnowledgeGraph && rankedResults.length > 0) {
      this.reapplyKnowledgeGraphBoost(rankedResults);
    }

    // 8. 引用显示优化 (去重、合并相邻)
    const finalResults = this.optimizeReferences
      ? this.optimizeReferences(rankedResults, { maxReferences: rerankTopN })
      : rankedResults;

    // 9. 保存到缓存
    if (cacheKey) {
      this.saveToCache(cacheKey, query, finalResults, queryEmbedding);
    }

    const duration = Date.now() - startTime;
    console.log(`[SearchPipeline] 管道执行完成: ${duration}ms, 结果数: ${finalResults.length}`);

    return {
      results: finalResults,
      cached: false,
      duration,
      variantCount: queries.length
    };
  }
}
