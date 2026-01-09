/**
 * 搜索管道 - 将搜索流程分解为清晰的步骤
 */
import { LIMITS, CACHE, SCORING } from '../constants.mjs';

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

    // 6. Reranking
    const finalResults = await this.rerank(fusedResults, query, { rerankTopN });

    // 7. 保存到缓存
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
