import { unifiedStorageManager, Chunk } from './localStorage';
import { optimizeTextForEmbedding } from './chunkingEnhancements';
import {
  detectQueryIntent,
  getRetrievalParamsForIntent,
  enhanceQueryWithHistory,
  extractCoreQueryEnhanced,
  deduplicateAndMergeChunks,
  calculateAdaptiveThreshold
} from './retrievalEnhancements';

const SILICONFLOW_EMBED_URL = 'https://api.siliconflow.cn/v1/embeddings';
const SILICONFLOW_RERANK_URL = 'https://api.siliconflow.cn/v1/rerank';
const BGE_MODEL = 'BAAI/bge-m3';
const QWEN_EMBEDDING = 'Qwen/Qwen3-Embedding-8B';
const QWEN_RERANKER = 'Qwen/Qwen3-reranker-8B';

async function embedText(text: string): Promise<number[] | null> {
  const apiKey = await unifiedStorageManager.getApiKey('siliconflow') || import.meta.env.VITE_SILICONFLOW_API_KEY;
  if (!apiKey) {
    return null;
  }
  try {
    const res = await fetch(SILICONFLOW_EMBED_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: QWEN_EMBEDDING,
        input: text
      })
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      const error = new Error(`Embeddings HTTP ${res.status}: ${errorText.substring(0, 200)}`);
      throw error;
    }
    const data = await res.json();
    const emb = data?.data?.[0]?.embedding || data?.embedding || null;
    return emb || null;
  } catch (e) {
    console.warn('embedText failed:', e);
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

export async function ensureEmbeddingsForDocument(documentId: string) {
  const chunks = await unifiedStorageManager.getChunks(documentId);
  const allDocs = await unifiedStorageManager.getAllDocumentsPublic();
  const doc = allDocs.find(d => d.id === documentId);
  const chunksWithoutEmbedding = chunks.filter(ch => !ch.embedding || !Array.isArray(ch.embedding) || ch.embedding.length === 0);
  
  
  if (chunksWithoutEmbedding.length === 0) {
    return; // 所有chunks都有embedding，直接返回
  }
  
  console.log(`为文档 ${documentId} 的 ${chunksWithoutEmbedding.length} 个chunks生成embedding...`);
  
  // 批量并行处理，但限制并发数
  // 对于大量chunks，使用更小的批次，并在每批后清理空间
  const batchSize = chunksWithoutEmbedding.length > 100 ? 3 : 5;
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ chunkId: string; error: string }> = [];
  
  // 对于大量chunks，先清理一些空间
  if (chunksWithoutEmbedding.length > 100) {
    try {
      // 对于超大文档（>500 chunks），清理其他文档的所有chunks（包括有embedding的）
      // 对于中等文档（100-500 chunks），只清理其他文档的没有embedding的chunks
      if (chunksWithoutEmbedding.length > 500) {
        // 清理其他文档的所有chunks，只保留当前文档的chunks
        const allChunks = await unifiedStorageManager.getAllChunksForSearch();
        const otherDocChunks = allChunks.filter(c => c.documentId !== documentId);
        const currentDocChunks = allChunks.filter(c => c.documentId === documentId);
        
        // 只保留当前文档的chunks
        try {
          localStorage.setItem('ai_assistant_chunks', JSON.stringify(currentDocChunks));
        } catch (e: any) {
          if (e.name === 'QuotaExceededError') {
            // 即使只保留当前文档的chunks，仍然空间不足
            // 尝试只保留当前文档的部分chunks（最新的）
            const sortedCurrent = currentDocChunks.sort((a, b) => 
              new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
            );
            // 只保留最新的 500 个chunks
            const keptChunks = sortedCurrent.slice(0, 500);
            localStorage.setItem('ai_assistant_chunks', JSON.stringify(keptChunks));
          } else {
            throw e;
          }
        }
      } else {
        // 清理其他文档的旧chunks，为当前文档腾出空间
        const removed = await unifiedStorageManager.cleanupOldChunksWithoutEmbedding(200, [documentId]);
      }
    } catch (e) {
      console.warn('预清理失败:', e);
    }
  }
  
  for (let i = 0; i < chunksWithoutEmbedding.length; i += batchSize) {
    const batch = chunksWithoutEmbedding.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (ch) => {
        try {
          // 优化文本用于embedding：智能截断，保留重要信息
          const optimizedText = optimizeTextForEmbedding(ch.content, 2000);
          const emb = await embedText(optimizedText);
      if (emb) {
            // updateChunkEmbedding 内部会保护当前文档的chunks
            await unifiedStorageManager.updateChunkEmbedding(ch.id, emb);
            successCount++;
          } else {
            failCount++;
            errors.push({ chunkId: ch.id, error: 'embedText returned null' });
          }
        } catch (error) {
          console.warn(`为chunk ${ch.id}生成embedding失败:`, error);
          failCount++;
          errors.push({ chunkId: ch.id, error: error instanceof Error ? error.message : String(error) });
        }
      })
    );
    
    // 对于大量chunks，每处理一定数量后清理一次空间
    if (chunksWithoutEmbedding.length > 100 && (i + batchSize) % 50 === 0) {
      try {
        const removed = await unifiedStorageManager.cleanupOldChunksWithoutEmbedding(300, [documentId]);
      } catch (e) {
        console.warn('定期清理失败:', e);
      }
    }
    
    // 每批之间稍作延迟，避免API限流
    if (i + batchSize < chunksWithoutEmbedding.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  console.log(`已完成文档 ${documentId} 的embedding生成，成功: ${successCount}, 失败: ${failCount}`);
}

/**
 * 提取查询中的核心命令和关键词
 */
/**
 * 自动提取查询中的关键词
 * 使用启发式规则识别重要词汇，不依赖硬编码列表
 */
function extractKeywords(query: string): string[] {
  const keywords: string[] = [];
  
  // 1. 提取连续大写字母的缩写（如BGP, OSPF, VLAN等）
  const acronyms = query.match(/\b[A-Z]{2,}\b/g);
  if (acronyms) {
    keywords.push(...acronyms.map(a => a.toLowerCase()));
  }
  
  // 2. 提取大写字母开头的专有名词（如Nvidia, Cumulus, Linux等）
  const properNouns = query.match(/\b[A-Z][a-z]+\b/g);
  if (properNouns) {
    keywords.push(...properNouns.map(n => n.toLowerCase()));
  }
  
  // 3. 提取技术术语模式（如IPv4, IPv6, L2VPN等）
  const techTerms = query.match(/\b(?:[A-Z]+[a-z]*|[a-z]+[A-Z]+)\d*\b/g);
  if (techTerms) {
    keywords.push(...techTerms.map(t => t.toLowerCase()));
  }
  
  
  // 5. 提取所有长度>=2的单词（过滤停用词），包括小写产品名称（如nvos, cumulus等）
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    '如何', '怎么', '怎样', '什么', '哪个', '哪些', '为什么', '是否', '能否', '可以', '应该',
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '些', '个', '只', '现在', '请', '问'
  ]);
  
  const words = query
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w)); // 降低长度要求到2，以捕获nvos等短产品名称
  
  keywords.push(...words);
  
  // 6. 去重并返回
  return Array.from(new Set(keywords));
}

function extractCoreQuery(originalQuery: string): string {
  // 使用自动关键词提取
  const keywords = extractKeywords(originalQuery);
  
  if (keywords.length > 0) {
    // 如果提取到关键词，使用关键词构建核心查询
    // 保留原始查询中的关键信息，但去除停用词和无关词汇
    return keywords.join(' ');
  }
  
  // 如果没有提取到关键词，返回原始查询
  return originalQuery;
}

/**
 * 多路召回检索：从多个知识库中检索知识，然后使用 rerank 模型重新排序
 * @param query 查询文本
 * @param limit top k 数量，默认 20
 * @returns 检索结果，按相关性排序
 */
export async function semanticSearch(
  query: string, 
  limit = 20,
  conversationHistory: string[] = []
): Promise<{ chunk: Chunk; score: number }[]> {
  // 1. 查询意图识别
  const intent = detectQueryIntent(query);
  
  // 2. 根据意图调整检索参数
  const retrievalParams = getRetrievalParamsForIntent(intent);
  const adjustedLimit = Math.max(limit, retrievalParams.limit);
  const rerankCandidatesMultiplier = retrievalParams.rerankCandidates / adjustedLimit;
  
  // 3. 查询增强：基于历史对话
  const enhancedQuery = conversationHistory.length > 0 
    ? enhanceQueryWithHistory(query, conversationHistory)
    : query;
  
  // 4. 提取核心查询（增强版）
  const coreQuery = extractCoreQueryEnhanced(enhancedQuery, intent);
  
  // 使用核心查询进行嵌入（更聚焦于命令本身）
  const qEmb = await embedText(coreQuery);
  const all = await unifiedStorageManager.getAllChunksForSearch();
  const allDocs = await unifiedStorageManager.getAllDocumentsPublic();
  
  
  let chunksWithEmbedding = all.filter((c: Chunk) => Array.isArray(c.embedding) && c.embedding.length > 0);
  
  if (!qEmb || all.length === 0) {
    return await unifiedStorageManager.searchSimilarChunks(query, limit);
  }
  
  // 检查是否有 chunks 没有 embedding，如果有则生成（优先处理最近的chunks）
  let chunksWithoutEmbedding = all.filter((c: Chunk) => !Array.isArray(c.embedding) || !c.embedding.length);
  if (chunksWithoutEmbedding.length > 0) {
    console.warn(`发现 ${chunksWithoutEmbedding.length} 个 chunks 没有 embedding，正在生成...`);
    
    // 如果有很多chunks没有embedding，先清理旧的没有embedding的chunks，释放空间
    // 但不要清理正在处理的文档的chunks（通过documentId判断）
    if (chunksWithoutEmbedding.length > 1000) {
      console.warn('chunks数量过多，先清理旧的没有embedding的chunks...');
      // 获取正在处理的文档ID（最新的chunks所属的文档）
      const processingDocIds = new Set<string>();
      const sortedChunks = chunksWithoutEmbedding.sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
      });
      // 保护最新的100个chunks所属的文档
      sortedChunks.slice(0, 100).forEach(chunk => {
        processingDocIds.add(chunk.documentId);
      });
      const removedCount = await unifiedStorageManager.cleanupOldChunksWithoutEmbedding(500, Array.from(processingDocIds));
      if (removedCount > 0) {
        // 重新获取chunks（清理后的）
        const updatedAll = await unifiedStorageManager.getAllChunksForSearch();
        all.length = 0;
        all.push(...updatedAll);
        // 重新计算chunksWithoutEmbedding（清理后的）
        chunksWithoutEmbedding = all.filter((c: Chunk) => !Array.isArray(c.embedding) || !c.embedding.length);
        console.warn(`清理完成，重新获取chunks，当前总数: ${all.length}，没有embedding的: ${chunksWithoutEmbedding.length}`);
      } else {
        console.warn('清理失败，可能localStorage空间已满，尝试更激进的清理...');
      }
    }
    
    // 按创建时间排序，优先处理最新的chunks（新上传的文件）
    const sortedChunks = chunksWithoutEmbedding.sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA; // 最新的在前
    });
    
    // 批量处理，优先处理最新的100个chunks（新上传的文件）
    const chunksToProcess = sortedChunks.slice(0, 100);
    console.log(`正在为 ${chunksToProcess.length} 个最新chunks生成embedding...`);
    
    // 并行处理，但限制并发数（避免API限流）
    const batchSize = 5; // 降低并发数，避免API限流
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < chunksToProcess.length; i += batchSize) {
      const batch = chunksToProcess.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (chunk) => {
          try {
            // 优化文本用于embedding：智能截断，保留重要信息
            const optimizedText = optimizeTextForEmbedding(chunk.content, 2000);
            const emb = await embedText(optimizedText);
            if (emb && Array.isArray(emb) && emb.length > 0) {
              try {
                await unifiedStorageManager.updateChunkEmbedding(chunk.id, emb);
                successCount++;
              } catch (updateError: any) {
                // updateChunkEmbedding内部已经处理了QuotaExceededError，但如果还是失败，记录日志
                console.warn(`保存chunk ${chunk.id}的embedding失败:`, updateError);
                failCount++;
              }
            } else {
              console.warn(`为chunk ${chunk.id}生成embedding返回空值，content长度: ${chunk.content.length}`);
              failCount++;
            }
          } catch (error) {
            console.warn(`为chunk ${chunk.id}生成embedding失败:`, error);
            failCount++;
          }
        })
      );
      // 每批之间稍作延迟，避免API限流
      if (i + batchSize < chunksToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    console.log(`已完成 ${chunksToProcess.length} 个chunks的embedding生成，成功: ${successCount}, 失败: ${failCount}`);
    
    // 重新获取所有chunks（包括新生成的embedding）
    const updatedAll = await unifiedStorageManager.getAllChunksForSearch();
    // 更新all变量，使用最新的chunks数据
    all.length = 0;
    all.push(...updatedAll);
    // 重新计算chunksWithEmbedding（因为all已经更新）
    chunksWithEmbedding = all.filter((c: Chunk) => Array.isArray(c.embedding) && c.embedding.length);
  } else {
    // 如果没有需要生成embedding的chunks，重新计算chunksWithEmbedding（确保使用最新的all）
    chunksWithEmbedding = all.filter((c: Chunk) => Array.isArray(c.embedding) && c.embedding.length);
  }
  
  if (chunksWithEmbedding.length === 0) {
    return await unifiedStorageManager.searchSimilarChunks(query, limit);
  }
  
  // ========== 多路召回机制 ==========
  const queryKeywords = extractKeywords(coreQuery);
  const queryWordsLower = queryKeywords.map(w => w.toLowerCase());
  
  // 路1：向量检索（语义相似度）- 召回更多候选
  const vectorRecall = chunksWithEmbedding
    .map((c: Chunk) => ({ 
      chunk: c, 
      score: cosine(qEmb, c.embedding as number[]),
      source: 'vector' as const
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 3); // 召回 3 倍候选
  
  // 路2：关键词检索（BM25 简化版）- 召回更多候选
  
  const keywordRecall = chunksWithEmbedding.map((c: Chunk) => {
    const contentLower = c.content.toLowerCase();
    let keywordScore = 0;
    let matchedKeywords = 0;
    
    queryWordsLower.forEach(keyword => {
      const keywordLower = keyword.toLowerCase();
      const matches = (contentLower.match(new RegExp(keywordLower, 'g')) || []).length;
      if (matches > 0) {
        keywordScore += Math.log(1 + matches);
        matchedKeywords++;
      }
    });
    
    const normalizedKeywordScore = matchedKeywords > 0 
      ? (keywordScore / queryWordsLower.length) * (matchedKeywords / queryWordsLower.length)
      : 0;
    
    return {
      chunk: c,
      score: normalizedKeywordScore,
      matchedKeywords,
      source: 'keyword' as const
    };
  })
  .filter(item => item.score > 0) // 只保留有匹配的
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 3); // 召回 3 倍候选
  
  
  // 路3：文档标题匹配检索
  
  const docTitleRecall = chunksWithEmbedding
    .map((c: Chunk) => {
      const doc = allDocs.find(d => d.id === c.documentId);
      if (!doc) return null;
      
      const filenameLower = doc.filename.toLowerCase();
      let titleScore = 0;
      
      queryWordsLower.forEach(keyword => {
        if (filenameLower.includes(keyword.toLowerCase())) {
          titleScore += 1.0; // 文档标题匹配给予高分
        }
      });
      
      return titleScore > 0 ? {
        chunk: c,
        score: titleScore,
        source: 'docTitle' as const
      } : null;
    })
    .filter((item): item is { chunk: Chunk; score: number; source: 'docTitle' } => item !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 2); // 召回 2 倍候选
  
  
  // 合并多路召回结果并去重
  const recallMap = new Map<string, { chunk: Chunk; scores: number[]; sources: string[] }>();
  
  // 合并向量召回
  vectorRecall.forEach(item => {
    const existing = recallMap.get(item.chunk.id);
    if (existing) {
      existing.scores.push(item.score);
      existing.sources.push(item.source);
    } else {
      recallMap.set(item.chunk.id, {
        chunk: item.chunk,
        scores: [item.score],
        sources: [item.source]
      });
    }
  });
  
  // 合并关键词召回
  keywordRecall.forEach(item => {
    const existing = recallMap.get(item.chunk.id);
    if (existing) {
      existing.scores.push(item.score);
      existing.sources.push(item.source);
    } else {
      recallMap.set(item.chunk.id, {
        chunk: item.chunk,
        scores: [item.score],
        sources: [item.source]
      });
    }
  });
  
  // 合并文档标题召回
  docTitleRecall.forEach(item => {
    const existing = recallMap.get(item.chunk.id);
    if (existing) {
      existing.scores.push(item.score);
      existing.sources.push(item.source);
    } else {
      recallMap.set(item.chunk.id, {
        chunk: item.chunk,
        scores: [item.score],
        sources: [item.source]
      });
    }
  });
  
  // 计算综合分数（多路召回加权平均）
  const mergedResults = Array.from(recallMap.values()).map(item => {
    // 对不同召回源进行加权：向量 0.5，关键词 0.3，文档标题 0.2
    let weightedScore = 0;
    let totalWeight = 0;
    
    item.sources.forEach((source, idx) => {
      const score = item.scores[idx];
      let weight = 0.33; // 默认权重
      
      if (source === 'vector') weight = 0.5;
      else if (source === 'keyword') weight = 0.3;
      else if (source === 'docTitle') weight = 0.2;
      
      weightedScore += score * weight;
      totalWeight += weight;
    });
    
    const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
    
    return {
      chunk: item.chunk,
      score: finalScore,
      sources: item.sources,
      scores: item.scores
    };
  });
  
  // 按综合分数排序，选择 top k * rerankCandidatesMultiplier 作为 rerank 候选
  mergedResults.sort((a, b) => b.score - a.score);
  const rerankCandidates = mergedResults.slice(0, Math.floor(adjustedLimit * rerankCandidatesMultiplier));
  
  
  // ========== 使用 Rerank 模型重新排序 ==========
  // 使用核心查询对所有召回候选进行重排
  
  const reranked = await rerank(coreQuery, rerankCandidates.map(t => t.chunk.content));
  
  // map reranked back to chunks
  const contentToChunk = new Map(rerankCandidates.map(t => [t.chunk.content, t.chunk]));
  const rerankedResults = reranked
    .map(item => ({ chunk: contentToChunk.get(item.text)!, score: item.score }))
    .filter(x => !!x.chunk)
    .sort((a, b) => b.score - a.score); // 按 rerank 分数排序
  
  
  // 处理父子 chunk 关系：如果检索到子块，也包含其父块以提供上下文
  const chunkIdMap = new Map(all.map(c => [c.id, c]));
  const enhancedResults: typeof rerankedResults = [];
  const addedChunkIds = new Set<string>();
  
  rerankedResults.forEach(item => {
    // 添加当前 chunk
    if (!addedChunkIds.has(item.chunk.id)) {
      enhancedResults.push(item);
      addedChunkIds.add(item.chunk.id);
    }
    
    // 如果是子块，添加其父块
    if (item.chunk.chunkType === 'child' && item.chunk.parentId) {
      const parentChunk = all.find(c => c.id === item.chunk.parentId || 
        (c.chunkType === 'parent' && c.documentId === item.chunk.documentId && 
         Math.abs(c.chunkIndex - item.chunk.chunkIndex) < 10));
      
      if (parentChunk && !addedChunkIds.has(parentChunk.id)) {
        // 父块的分数略低于子块，但保持相关性
        enhancedResults.push({
          chunk: parentChunk,
          score: item.score * 0.8
        });
        addedChunkIds.add(parentChunk.id);
      }
    }
  });
  
  // 重新排序
  enhancedResults.sort((a, b) => b.score - a.score);
  
  // 6. Chunk去重和合并（在文档过滤之前）
  const deduplicatedResults = deduplicateAndMergeChunks(enhancedResults, 0.85);
  deduplicatedResults.sort((a, b) => b.score - a.score);
  
  // 7. 自适应阈值计算
  const adaptiveThreshold = calculateAdaptiveThreshold(deduplicatedResults, retrievalParams.minScore);
  
  // 确保结果中包含多个文档的chunks，但只从相关性高的文档中选择
  // 按文档分组，并计算每个文档的平均相关性分数
  const chunksByDoc = new Map<string, typeof deduplicatedResults>();
  deduplicatedResults.forEach(item => {
    if (!chunksByDoc.has(item.chunk.documentId)) {
      chunksByDoc.set(item.chunk.documentId, []);
    }
    chunksByDoc.get(item.chunk.documentId)!.push(item);
  });
  
  // 计算每个文档的平均相关性分数，过滤掉相关性低的文档
  const docAvgScores = new Map<string, number>();
  // allDocs 已在函数开始处声明（第 270 行），这里直接使用
  chunksByDoc.forEach((docChunks, docId) => {
    const avgScore = docChunks.reduce((sum, item) => sum + item.score, 0) / docChunks.length;
    docAvgScores.set(docId, avgScore);
  });
  
  // 如果文档没有出现在chunksByDoc中，但它的chunks有embedding，也检查一下是否需要强制包含
  // 特别是当查询包含产品关键词，而文档名称直接包含该关键词时
  const allDocsWithChunks = new Set<string>();
  chunksWithEmbedding.forEach(c => {
    allDocsWithChunks.add(c.documentId);
  });
  
  // 提取查询中的关键词（用于文档名称匹配）
  // 使用extractKeywords函数提取关键词，确保包含产品名称等关键信息
  const extractedKeywords = extractKeywords(coreQuery);
  const queryWords = extractedKeywords.length > 0 ? extractedKeywords : coreQuery.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  
  // 提取产品关键词（用于检查文档名称匹配）
  const productKeywordsOnly = queryWords.filter(word => {
    const isEnglishWord = /^[a-zA-Z]+$/.test(word);
    const commonCommands = ['ip', 'set', 'get', 'show', 'config', 'configure', 'enable', 'disable', 'start', 'stop', 'restart', 'status'];
    return isEnglishWord && word.length >= 2 && !commonCommands.includes(word.toLowerCase());
  });
  const hasProductKeywords = productKeywordsOnly.length > 0;
  
  // 对于没有出现在chunksByDoc中的文档，如果它们有chunks且有embedding，也添加到docAvgScores中（分数设为0，后续通过关键词匹配来包含）
  // 或者，如果文档名称直接匹配产品关键词（即使没有chunks或chunks没有embedding），也强制添加到docAvgScores中
  allDocs.forEach(doc => {
    if (!docAvgScores.has(doc.id)) {
      let shouldAdd = false;
      const filenameLower = doc.filename.toLowerCase();
      
      // 检查1：文档有chunks且有embedding
      if (allDocsWithChunks.has(doc.id)) {
        shouldAdd = true;
      }
      // 检查2：文档名称直接匹配产品关键词（即使没有chunks或chunks没有embedding）
      else if (hasProductKeywords) {
        const matchesProductKeyword = productKeywordsOnly.some(keyword => {
          const keywordLower = keyword.toLowerCase();
          if (keywordLower === 'nvos' || keywordLower === 'nv') {
            const hasNvos = filenameLower.includes('nvos');
            const hasNvidia = filenameLower.includes('nvidia');
            const hasUfm = filenameLower.includes('ufm');
            return hasNvos || (hasNvidia && !hasUfm);
          } else if (filenameLower.includes(keywordLower)) {
            return true;
          }
          return false;
        });
        if (matchesProductKeyword) {
          shouldAdd = true;
        }
      }
      
      if (shouldAdd) {
        // 这个文档应该被包含，先设为0，后续如果文件名匹配产品关键词，会通过关键词匹配逻辑包含
        docAvgScores.set(doc.id, 0);
      }
    }
  });
  
  // 基于文档名称和内容的关键词匹配
  const docKeywordScores = new Map<string, number>();
  const docHasKeywords = new Map<string, boolean>(); // 文档是否包含任何关键词
  
  // 提取纯英文产品关键词（用于文档名称匹配）
  const productKeywords = queryWords.filter(word => /^[a-zA-Z]+$/.test(word) && word.length >= 2);
  
  chunksByDoc.forEach((docChunks, docId) => {
    const doc = allDocs.find(d => d.id === docId);
    if (!doc) return;
    
    const filenameLower = doc.filename.toLowerCase();
    let keywordScore = 0;
    let hasAnyKeyword = false;
    
    // 检查文档名称是否包含查询关键词（重要：产品名称匹配）
    // 对于产品关键词，也检查相关的变体（如nvos -> nvidia, ufm）
    queryWords.forEach(word => {
      const wordLower = word.toLowerCase();
      if (filenameLower.includes(wordLower)) {
        keywordScore += 1.0; // 文档名称匹配大幅加分
        hasAnyKeyword = true;
      }
    });
    
    // 对于产品关键词，检查文档名称中是否包含相关词汇
    // 例如：nvos -> 检查文件名是否直接包含nvos，或者包含nvidia, ufm, nv等
    productKeywords.forEach(keyword => {
      const keywordLower = keyword.toLowerCase();
      // 检查文档名称是否包含关键词或其相关词汇
      if (keywordLower === 'nvos' || keywordLower === 'nv') {
        const hasNvos = filenameLower.includes('nvos');
        const hasNvidia = filenameLower.includes('nvidia');
        const hasUfm = filenameLower.includes('ufm');
        // 优先检查直接匹配（如nvidia-nvos-user-manual）
        // 如果文件名直接包含nvos，或者包含nvidia（且不只有ufm），则匹配
        // 这样可以匹配nvidia-nvos文档，但避免匹配只包含ufm的文档
        if (hasNvos || (hasNvidia && !hasUfm)) {
          keywordScore += 1.0;
          hasAnyKeyword = true;
        }
      } else if (filenameLower.includes(keywordLower)) {
        keywordScore += 1.0;
        hasAnyKeyword = true;
      }
    });
    
    // 检查chunks内容中关键词的出现频率（不区分大小写）
    let keywordCount = 0;
    let chunksWithKeywords = 0;
    docChunks.forEach(item => {
      const contentLower = item.chunk.content.toLowerCase();
      let chunkHasKeyword = false;
      
      // 检查所有查询关键词
      queryWords.forEach(word => {
        const wordLower = word.toLowerCase();
        if (contentLower.includes(wordLower)) {
          keywordCount++;
          chunkHasKeyword = true;
        }
      });
      
      // 对于产品关键词，也检查相关变体
      productKeywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase();
        if (keywordLower === 'nvos' || keywordLower === 'nv') {
          // 检查nvos, nv, nvidia, ufm等变体
          if (contentLower.includes('nvos') || contentLower.includes(' nv ') || 
              contentLower.includes('nvidia') || contentLower.includes('ufm')) {
            keywordCount++;
            chunkHasKeyword = true;
          }
        } else if (contentLower.includes(keywordLower)) {
          keywordCount++;
          chunkHasKeyword = true;
        }
      });
      
      if (chunkHasKeyword) {
        chunksWithKeywords++;
      }
    });
    
    // 如果chunks中有关键词，标记为包含关键词
    if (chunksWithKeywords > 0) {
      hasAnyKeyword = true;
    }
    
    // 关键词出现频率加分（归一化）
    if (docChunks.length > 0) {
      keywordScore += Math.min(chunksWithKeywords / docChunks.length, 1.0) * 0.5;
    }
    
    docKeywordScores.set(docId, keywordScore);
    docHasKeywords.set(docId, hasAnyKeyword);
  });
  
  // 找出最高平均分数，用于计算相关性阈值
  const maxAvgScore = Math.max(...Array.from(docAvgScores.values()));
  // 相关性阈值：使用自适应阈值和固定阈值的组合
  const baseRelevanceThreshold = maxAvgScore * 0.7;
  const relevanceThreshold = Math.max(adaptiveThreshold, baseRelevanceThreshold);
  
  // 过滤掉相关性低的文档，严格检查关键词匹配
  // 如果查询中包含明确的产品名称或关键词，必须要求文档包含这些关键词
  // productKeywordsOnly 和 hasProductKeywords 已经在上面定义过了，这里不需要重新定义
  
  
  const relevantDocs = new Set<string>();
  docAvgScores.forEach((avgScore, docId) => {
    const keywordScore = docKeywordScores.get(docId) || 0;
    const hasKeywords = docHasKeywords.get(docId) || false;
    const doc = allDocs.find(d => d.id === docId);
    
    // 检查文档是否包含产品关键词（只检查英文产品关键词，不检查中文关键词）
    // 严格检查：只检查文档名称，不检查chunks内容（避免误判）
    const hasProductKeywordsInDoc = productKeywordsOnly.some(keyword => {
      const keywordLower = keyword.toLowerCase();
      const filenameLower = doc?.filename.toLowerCase() || '';
      // 只检查文档名称，不检查chunks内容
      // 这样可以避免文档内容中只是提到产品名称就被误判为相关文档
      if (keywordLower === 'nvos' || keywordLower === 'nv') {
        // nvos -> 优先检查文件名是否直接包含nvos，或者包含nvidia（但不包括只包含ufm的文档）
        // 如果文件名直接包含nvos，或者包含nvidia（通常nvidia-nvos文档会包含nvidia），则匹配
        // 但是，如果文件名只包含ufm而不包含nvos或nvidia，则不匹配（避免匹配nvidia-ufm文档）
        const hasNvos = filenameLower.includes('nvos');
        const hasNvidia = filenameLower.includes('nvidia');
        const hasUfm = filenameLower.includes('ufm');
        // 如果文件名直接包含nvos，或者包含nvidia（且不只有ufm），则匹配
        const matched = hasNvos || (hasNvidia && !hasUfm);
        if (matched) {
          return true;
        }
      } else if (filenameLower.includes(keywordLower)) {
        return true;
      }
      return false;
    });
    
    
    // 如果查询中包含产品关键词，但文档不包含产品关键词，需要进一步检查
    // 如果文档的chunks内容中包含关键词（hasKeywords），或者平均分数很高，仍然允许通过
    // 这样可以处理文件名是自动生成（如MinerU_markdown_xxx.md）但内容相关的情况
    if (hasProductKeywords && !hasProductKeywordsInDoc) {
      // 如果文档内容中包含关键词，或者平均分数很高（高于阈值的1.2倍），仍然允许通过
      if (!hasKeywords && avgScore < relevanceThreshold * 1.2) {
        return; // 严格排除：查询明确包含产品名称，但文档不包含产品关键词且分数不够高
      }
      // 否则继续处理（文档内容包含关键词或分数足够高）
    }
    
    // 如果文档名称或内容中不包含任何关键词，且平均分数不是特别高，直接排除
    if (!hasKeywords && avgScore < maxAvgScore * 0.95) {
      // 不包含关键词且分数不够高，排除（提高阈值到95%）
      return;
    }
    
    // 如果关键词匹配度很高（文档名称匹配），直接认为是相关的
    // 特别地，如果查询包含产品关键词（如nvos），而文档名称直接包含该关键词，强制包含
    if (keywordScore >= 1.0 || (hasProductKeywords && hasProductKeywordsInDoc)) {
      relevantDocs.add(docId);
    } 
    // 如果关键词匹配度中等，降低相关性阈值要求
    else if (keywordScore > 0.3) {
      const adjustedThreshold = relevanceThreshold * 0.8;
      if (avgScore >= adjustedThreshold) {
        relevantDocs.add(docId);
      }
    }
    // 如果关键词匹配度低，但平均分数很高，仍然考虑
    // 特别地，如果文档内容包含关键词（hasKeywords），即使文档名称不包含产品关键词，也允许通过
    else if (hasKeywords && avgScore >= relevanceThreshold * 1.2) {
      relevantDocs.add(docId);
    }
    // 如果没有产品关键词，且平均分数很高，也允许通过
    else if (!hasProductKeywords && avgScore >= relevanceThreshold * 1.2) {
      relevantDocs.add(docId);
    }
  });
  
  // 只从相关性高的文档中选择chunks
  const relevantChunksByDoc = new Map<string, typeof enhancedResults>();
  chunksByDoc.forEach((docChunks, docId) => {
    if (relevantDocs.has(docId)) {
      relevantChunksByDoc.set(docId, docChunks);
    }
  });
  
  
  // 对于被标记为相关但没有出现在chunksByDoc中的文档（如文件名直接匹配产品关键词），
  // 从它的所有chunks中选择一些（按语义相似度排序）
  for (const docId of relevantDocs) {
    if (!relevantChunksByDoc.has(docId)) {
      // 这个文档被标记为相关，但没有出现在top chunks中
      // 从它的所有chunks中选择一些（优先选择有embedding的，如果没有embedding，也选择一些）
      let docChunks = chunksWithEmbedding.filter(c => c.documentId === docId);
      
      // 如果文档的chunks没有embedding，也从all中获取这个文档的所有chunks
      if (docChunks.length === 0) {
        docChunks = all.filter(c => c.documentId === docId);
      }
      
      if (docChunks.length > 0) {
        let docScored: Array<{ chunk: Chunk; score: number }>;
        
        // 如果chunks有embedding，计算语义相似度分数
        if (docChunks[0].embedding && Array.isArray(docChunks[0].embedding) && docChunks[0].embedding.length > 0) {
          docScored = docChunks.map(c => ({
            chunk: c,
            score: cosine(qEmb, c.embedding as number[])
          }));
        } else {
          // 如果chunks没有embedding，使用简单的文本匹配分数
          const queryWordsLower = queryWords.map(w => w.toLowerCase());
          docScored = docChunks.map(c => {
            const contentLower = c.content.toLowerCase();
            let score = 0;
            queryWordsLower.forEach(word => {
              if (contentLower.includes(word)) {
                score += 0.1;
              }
            });
            return { chunk: c, score };
          });
        }
        
        docScored.sort((a, b) => b.score - a.score);
        // 选择前10个chunks（或更少，如果文档chunks数量较少）
        const selectedChunks = docScored.slice(0, Math.min(10, docScored.length));
        // 使用重排分数（如果没有重排，使用语义相似度分数）
        const rerankedForDoc = await rerank(coreQuery, selectedChunks.map(t => t.chunk.content));
        const contentToChunkMap = new Map(selectedChunks.map(t => [t.chunk.content, t.chunk]));
        const rerankedChunks = rerankedForDoc
          .map(item => ({ chunk: contentToChunkMap.get(item.text)!, score: item.score }))
          .filter(x => !!x.chunk);
        relevantChunksByDoc.set(docId, rerankedChunks);
      }
    }
  }
  
  // 计算每个相关文档应该选择的chunks数量
  const docCount = relevantChunksByDoc.size;
  const minPerDoc = docCount > 0 ? Math.max(1, Math.floor(limit / docCount / 2)) : 1; // 每个文档至少选择的数量（limit的一半除以文档数）
  const maxPerDoc = docCount > 0 ? Math.max(minPerDoc, Math.floor(limit / docCount * 1.5)) : limit; // 每个文档最多选择的数量
  
  // 第一步：从每个相关文档中选择至少 minPerDoc 个chunks（确保多样性，但只从相关文档中选择）
  const guaranteed: typeof enhancedResults = [];
  relevantChunksByDoc.forEach((docChunks, docId) => {
    const sorted = docChunks.sort((a, b) => b.score - a.score);
    const guaranteedFromDoc = sorted.slice(0, Math.min(minPerDoc, sorted.length));
    guaranteed.push(...guaranteedFromDoc);
  });
  
  // 第二步：从相关文档的剩余chunks中按分数选择，直到达到limit
  const remaining: typeof enhancedResults = [];
  relevantChunksByDoc.forEach((docChunks, docId) => {
    const sorted = docChunks.sort((a, b) => b.score - a.score);
    const alreadySelected = guaranteed.filter(g => g.chunk.documentId === docId);
    const alreadySelectedContents = new Set(alreadySelected.map(a => a.chunk.content));
    const remainingFromDoc = sorted
      .filter(item => !alreadySelectedContents.has(item.chunk.content))
      .slice(0, Math.max(0, maxPerDoc - alreadySelected.length));
    remaining.push(...remainingFromDoc);
  });
  
  // 合并并排序，但确保每个文档至少有一些chunks被保留
  const allCandidates = [...guaranteed, ...remaining];
  allCandidates.sort((a, b) => b.score - a.score);
  
  // 确保每个文档至少有一些chunks在最终结果中
  const finalByDoc = new Map<string, typeof enhancedResults>();
  const finalResult: typeof enhancedResults = [];
  
  // 第一步：确保每个文档至少有一些chunks（从guaranteed中选择）
  guaranteed.forEach(item => {
    if (!finalByDoc.has(item.chunk.documentId)) {
      finalByDoc.set(item.chunk.documentId, []);
    }
    finalByDoc.get(item.chunk.documentId)!.push(item);
  });
  
  // 从每个文档的guaranteed中选择至少1个chunk
  finalByDoc.forEach((docChunks, docId) => {
    const sorted = docChunks.sort((a, b) => b.score - a.score);
    const minFromDoc = Math.max(1, Math.min(sorted.length, Math.floor(limit / docCount)));
    finalResult.push(...sorted.slice(0, minFromDoc));
  });
  
  // 第二步：从剩余的chunks中按分数选择，但确保每个文档都有机会被选中
  const remainingCandidates = allCandidates.filter(item => {
    const docFinal = finalByDoc.get(item.chunk.documentId) || [];
    return !docFinal.some(f => f.chunk.content === item.chunk.content);
  });
  
  // 按文档分组剩余的chunks
  const remainingByDoc = new Map<string, typeof enhancedResults>();
  remainingCandidates.forEach(item => {
    if (!remainingByDoc.has(item.chunk.documentId)) {
      remainingByDoc.set(item.chunk.documentId, []);
    }
    remainingByDoc.get(item.chunk.documentId)!.push(item);
  });
  
  // 轮流从每个文档中选择，确保多样性
  const remainingSlots = limit - finalResult.length;
  if (remainingSlots > 0 && remainingByDoc.size > 0) {
    const docIds = Array.from(remainingByDoc.keys());
    let slotIndex = 0;
    
    // 先按分数排序每个文档的chunks
    remainingByDoc.forEach((docChunks, docId) => {
      docChunks.sort((a, b) => b.score - a.score);
    });
    
    // 轮流从每个文档中选择，直到填满所有slot
    while (finalResult.length < limit && slotIndex < remainingSlots * docIds.length) {
      const docIndex = slotIndex % docIds.length;
      const docId = docIds[docIndex];
      const docChunks = remainingByDoc.get(docId);
      
      if (docChunks && docChunks.length > 0) {
        const selected = docChunks.shift()!;
        finalResult.push(selected);
      }
      
      slotIndex++;
    }
  }
  
  // 最后按分数重新排序
  finalResult.sort((a, b) => b.score - a.score);
  const result = finalResult.slice(0, limit);
  return result;
}

async function rerank(query: string, candidates: string[]): Promise<Array<{ text: string; score: number }>> {
  const apiKey = await unifiedStorageManager.getApiKey('siliconflow') || import.meta.env.VITE_SILICONFLOW_API_KEY;
  if (!apiKey) {
    // simple fallback: length + keyword coverage
    const qWords = (query.match(/[\u4e00-\u9fa5]+|[a-zA-Z]+/g) || []).map(w => w.toLowerCase());
    return candidates.map(t => {
      const lower = t.toLowerCase();
      let score = Math.min(lower.length / 500, 1);
      qWords.forEach(w => { if (lower.includes(w)) score += 0.3; });
      return { text: t, score };
    }).sort((a, b) => b.score - a.score);
  }
  try {
    const res = await fetch(SILICONFLOW_RERANK_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: QWEN_RERANKER,
        query: query,
        documents: candidates
      })
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Rerank HTTP ${res.status}: ${errorText.substring(0, 200)}`);
    }
    const data = await res.json();
    const items = data?.data || data?.output || data?.results || [];
    // 根据API返回格式解析：results数组包含{index, relevance_score}
    // 需要根据index从candidates数组中获取对应的文本
    const rerankedResults = items.map((it: any) => {
      const index = it?.index ?? it?.idx ?? -1;
      const score = it?.relevance_score ?? it?.score ?? it?.relevance ?? it?.rank ?? 0;
      const text = index >= 0 && index < candidates.length ? candidates[index] : (it?.document?.text || it?.text || '');
      return { text, score };
    }).filter((x: any) => x.text && x.text.length > 0);
    
    return rerankedResults;
  } catch (e) {
    console.warn('rerank failed:', e);
    // fallback simple
    return candidates.map(t => ({ text: t, score: Math.min(t.length / 500, 1) }))
      .sort((a, b) => b.score - a.score);
  }
}

export const retrieval = { ensureEmbeddingsForDocument, semanticSearch };
