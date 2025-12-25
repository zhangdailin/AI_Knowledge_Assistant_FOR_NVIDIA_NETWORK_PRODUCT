import { unifiedStorageManager, Chunk } from './localStorage';
import {
  detectQueryIntentAdvanced,
  getRetrievalParamsForIntent,
  enhanceQueryWithHistory,
  extractCoreQueryEnhanced,
  deduplicateAndMergeChunks,
  calculateAdaptiveThreshold,
  calculateDynamicRRFWeight
} from './retrievalEnhancements';
import { enhancedNetworkKeywordExtractor } from './enhancedNetworkKeywordExtractor';
import { aiModelManager } from './aiModels';
import { queryCacheManager } from './queryCacheManager';

const SILICONFLOW_EMBED_URL = 'https://api.siliconflow.cn/v1/embeddings';
const SILICONFLOW_RERANK_URL = 'https://api.siliconflow.cn/v1/rerank';
// 确保查询Embedding模型与文档Embedding模型一致 (BAAI/bge-m3)
const EMBEDDING_MODEL = 'BAAI/bge-m3'; 
// Rerank模型配置：主模型与备用模型
const RERANK_MODEL_PRIMARY = 'BAAI/bge-reranker-v2-m3'; // 最新最强
const RERANK_MODEL_FALLBACK = 'BAAI/bge-reranker-large'; // 备用稳定版

function optimizeTextForEmbedding(text: string, maxLength: number = 2000): string {
  let optimized = text.trim();
  if (optimized.length > maxLength) {
    optimized = optimized.substring(0, maxLength);
  }
  return optimized.replace(/\n+/g, ' ');
}

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
        model: EMBEDDING_MODEL,
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
  console.log(`Requesting server to generate embeddings for document ${documentId}...`);
  try {
    await unifiedStorageManager.createEmbeddingTask(documentId);
    console.log(`Server embedding task created for document ${documentId}`);
  } catch (error) {
    console.error(`Failed to create server embedding task for document ${documentId}:`, error);
  }
}

/**
 * 自动提取查询中的关键词
 * 使用高级语义分析识别网络配置、IP地址、命令等复杂技术信息
 */
function extractKeywords(query: string): string[] {
  const extracted = enhancedNetworkKeywordExtractor.extractKeywords(query);
  return extracted.keywords;
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
  // 0. 检查缓存
  const cacheKey = { limit, historyLength: conversationHistory.length };
  const cachedResult = queryCacheManager.get<{ chunk: Chunk; score: number }[]>(
    query,
    'semantic',
    cacheKey
  );
  if (cachedResult) {
    console.log('[Cache] 命中查询缓存');
    return cachedResult;
  }

  // 1. 高级查询意图识别
  const intentResult = detectQueryIntentAdvanced(query, conversationHistory);
  const intent = intentResult.intent;

  // 2. 根据意图调整检索参数
  const retrievalParams = getRetrievalParamsForIntent(intent);
  const adjustedLimit = Math.max(limit, retrievalParams.limit);
  const rerankCandidatesMultiplier = retrievalParams.rerankCandidates / adjustedLimit;

  // 日志：记录识别的意图和置信度
  console.log(`[Intent] ${intent} (confidence: ${(intentResult.confidence * 100).toFixed(1)}%)`);
  
  // 3. 查询增强：基于历史对话
  const enhancedQuery = conversationHistory.length > 0 
    ? enhanceQueryWithHistory(query, conversationHistory)
    : query;
  
  // 4. 提取核心查询（增强版）
  const coreQuery = extractCoreQueryEnhanced(enhancedQuery, intent);
  
  // 简单的查询扩展（同义词）
  // 优化：使用 LLM 自适应生成关键词，替代硬编码
  // 并行执行：LLM 关键词生成 + 核心查询 Embedding 生成
  let adaptiveKeywords: string[] = [];
  let llmProductNames: string[] = [];
  let qEmb: number[] | null = null;
  
  try {
    // 使用 Promise.allSettled 防止关键词生成失败导致整个检索失败
    const results = await Promise.allSettled([
      embedText(coreQuery),
      // 只有当查询较长或包含复杂意图时才调用 LLM 生成关键词，避免简单查询的延迟
      coreQuery.length > 5 || coreQuery.split(' ').length > 2 
        ? aiModelManager.analyzeQueryForSearch(coreQuery)
        : Promise.resolve({ keywords: [] as string[], productNames: [] as string[] })
    ]);

    // 处理 Embedding 结果
    if (results[0].status === 'fulfilled') {
      qEmb = results[0].value;
    } else {
      console.warn('Embedding generation failed:', results[0].reason);
    }

    // 处理关键词生成结果
    if (results[1].status === 'fulfilled') {
      adaptiveKeywords = results[1].value.keywords;
      llmProductNames = results[1].value.productNames;
    } else {
      console.warn('Adaptive keyword generation failed (using fallback):', results[1].reason);
      // 失败时静默处理，使用空数组
    }
  } catch (e) {
    console.error('Parallel processing error:', e);
  }

  const expandedTerms: string[] = [...adaptiveKeywords];
  const lowerQuery = coreQuery.toLowerCase();
  
  // 保留部分核心硬编码作为兜底（因为 LLM 偶尔可能失败或超时）
  if (lowerQuery.includes('bgp')) expandedTerms.push('边界网关协议', 'peer', 'neighbor');
  // ... 其他硬编码可以逐步移除，或者作为快速路径保留
  
  // 将扩展词加入到关键词检索中
  const enhancedQueryForKeyword = expandedTerms.length > 0 
    ? `${coreQuery} ${expandedTerms.join(' ')}` 
    : coreQuery;

  // 使用核心查询进行嵌入（更聚焦于命令本身）
  // const qEmb = await embedText(coreQuery); // 已经在上面并行执行了
  // const all = await unifiedStorageManager.getAllChunksForSearch(); // REMOVED: Do not fetch all chunks
  const allDocs = await unifiedStorageManager.getAllDocumentsPublic();

  // 并行执行向量检索和关键词检索（在服务器端）
  const [vectorResults, keywordResults] = await Promise.all([
    qEmb ? unifiedStorageManager.vectorSearchChunks(qEmb, limit * 3) : Promise.resolve([]),
    unifiedStorageManager.searchSimilarChunks(enhancedQueryForKeyword, limit * 3)
  ]);

  console.log(`[Retrieval] 向量搜索: ${vectorResults.length} chunks, 关键词搜索: ${keywordResults.length} chunks`);
  
  // 转换 keyword results
  const keywordRecall = keywordResults.map(item => ({
    chunk: item.chunk,
    score: item.score, // 简单的关键词匹配分数
    source: 'keyword' as const
  }));
  
  // 转换 vector results
  const vectorRecall = vectorResults.map(item => ({
    chunk: item.chunk,
    score: item.score,
    source: 'vector' as const
  }));
  
  // 3. 文档标题匹配检索 (Doc Title Search)
  // ... (Keep existing logic but optimized) ...
  const docTitleRecall = [];
  // 优化：只检查 queryWords 是否匹配文档标题，如果匹配，则需要获取该文档的 chunks
  // 由于我们不想获取所有 chunks，这里只做简单的标题匹配记录，后续如果需要内容再 fetch
  // 或者，我们可以搜索该文档的 chunks
  // 简单起见，如果标题匹配，我们假设该文档非常相关，将其 ID 加入 allow list 或 boost score
  // 但为了兼容现有 RRF 逻辑，我们需要 chunks。
  // 妥协：如果文档标题匹配，我们调用 server search 搜索该文档的内容
  // 这可能比较慢。
  // 替代方案：在 searchSimilarChunks 中，server 已经考虑了全文。
  // 如果 server search 足够好，它应该能返回标题匹配文档的内容（如果内容也包含关键词）。
  // 暂时跳过显式的 docTitleRecall 循环 fetch chunks，依赖 server search。
  
  // ========== RRF (Reciprocal Rank Fusion) 融合 ==========
  // 使用动态RRF权重，根据查询意图调整向量和关键词的权重
  const dynamicRRFWeight = calculateDynamicRRFWeight(intent);
  const RRF_K = dynamicRRFWeight;  // 动态调整K值
  const rrfMap = new Map<string, { chunk: Chunk; rrfScore: number; sources: string[] }>();

  // 处理向量召回 - 语义查询权重更高
  const vectorWeight = intent === 'explanation' || intent === 'question' ? 1.2 : 1.0;
  vectorRecall.forEach((item, rank) => {
    const existing = rrfMap.get(item.chunk.id);
    const scoreToAdd = (1 / (RRF_K + rank + 1)) * vectorWeight;

    if (existing) {
      existing.rrfScore += scoreToAdd;
      if (!existing.sources.includes('vector')) existing.sources.push('vector');
    } else {
      rrfMap.set(item.chunk.id, {
        chunk: item.chunk,
        rrfScore: scoreToAdd,
        sources: ['vector']
      });
    }
  });

  // 处理关键词召回 - 命令查询权重更高
  const keywordWeight = intent === 'command' || intent === 'configuration' ? 1.2 : 1.0;
  keywordRecall.forEach((item, rank) => {
    const existing = rrfMap.get(item.chunk.id);
    const scoreToAdd = (1 / (RRF_K + rank + 1)) * keywordWeight;
    
    if (existing) {
      existing.rrfScore += scoreToAdd;
      if (!existing.sources.includes('keyword')) existing.sources.push('keyword');
    } else {
      rrfMap.set(item.chunk.id, {
        chunk: item.chunk,
        rrfScore: scoreToAdd,
        sources: ['keyword']
      });
    }
  });
  
  // 转换为数组并排序
  const mergedResults = Array.from(rrfMap.values())
    .map(item => ({
      chunk: item.chunk,
      score: item.rrfScore, // 使用 RRF 分数
      sources: item.sources
    }))
    .sort((a, b) => b.score - a.score);

  console.log(`[Retrieval] RRF融合后: ${mergedResults.length} chunks`);
  
  // 选择 Top K 候选进行重排
  const rerankCandidates = mergedResults.slice(0, Math.floor(adjustedLimit * rerankCandidatesMultiplier));
  
  
  // ========== 使用 Rerank 模型重新排序 ==========
  // 优化策略：批量Rerank而不是按文档分别处理
  // 限制到前3个文档以减少API调用

  // 1. 按文档 ID 分组候选 Chunks
  const candidatesByDoc = new Map<string, typeof rerankCandidates>();
  rerankCandidates.forEach(item => {
    if (!candidatesByDoc.has(item.chunk.documentId)) {
      candidatesByDoc.set(item.chunk.documentId, []);
    }
    candidatesByDoc.get(item.chunk.documentId)!.push(item);
  });

  const RERANK_CONTENT_MAX_LENGTH = 500;
  let allRerankedResults: Array<{ chunk: Chunk; score: number; sources?: string[] }> = [];

  // 2. 改进：扩展Rerank范围从3个文档到5个，提高检索精度
  const RERANK_DOC_LIMIT = 5;  // 从3扩展到5
  const RERANK_CHUNKS_PER_DOC = 15;  // 每个文档15个chunks
  const topDocIds = Array.from(candidatesByDoc.keys()).slice(0, RERANK_DOC_LIMIT);
  const docsToRerank = topDocIds.map(docId => ({
    docId,
    candidates: candidatesByDoc.get(docId)!.slice(0, RERANK_CHUNKS_PER_DOC)
  }));

  // 3. 批量Rerank：收集所有候选，一次API调用
  const allCandidatesForRerank: Array<{ docId: string; index: number; chunk: Chunk; content: string }> = [];

  docsToRerank.forEach(({ docId, candidates }) => {
    candidates.forEach((item, index) => {
      let content = item.chunk.content;
      if (content.length > RERANK_CONTENT_MAX_LENGTH) {
        content = content.substring(0, RERANK_CONTENT_MAX_LENGTH);
      }
      allCandidatesForRerank.push({ docId, index, chunk: item.chunk, content });
    });
  });

  try {
    // 单次API调用处理所有候选
    const reranked = await rerank(coreQuery, allCandidatesForRerank.map(c => c.content));

    // 映射回原始Chunk
    const rerankedMap = new Map<string, number>();
    reranked.forEach((item, idx) => {
      rerankedMap.set(item.text, item.score);
    });

    allCandidatesForRerank.forEach(({ chunk, content }) => {
      const score = rerankedMap.get(content) || 0;
      allRerankedResults.push({ chunk, score, sources: ['rerank'] });
    });
  } catch (e) {
    console.warn('Batch rerank failed, falling back to original scores:', e);
    allRerankedResults = allCandidatesForRerank.map(c => ({ chunk: c.chunk, score: 0.5, sources: ['fallback'] }));
  }

  // 4. 添加未Rerank的文档候选（其他文档）
  for (const [docId, candidates] of candidatesByDoc.entries()) {
    if (!topDocIds.includes(docId)) {
      allRerankedResults.push(...candidates.slice(0, 10));
    }
  }

  // 5. 全局排序并取 Top K
  const rerankedResults = allRerankedResults.sort((a, b) => b.score - a.score);

  console.log(`[Retrieval] Rerank前: ${mergedResults.slice(0, 5).map(r => r.score.toFixed(6)).join(', ')}`);
  console.log(`[Retrieval] Rerank后: ${rerankedResults.slice(0, 5).map(r => r.score.toFixed(6)).join(', ')}`);
  
  
  // 处理父子 chunk 关系：如果检索到子块，自动替换为其父块以提供完整上下文（Parent-Child Indexing）
  // 这样既利用了子块的高检索精度，又利用了父块的完整语义
  const enhancedResults: typeof rerankedResults = [];
  const addedChunkIds = new Set<string>();
  
  // 缓存父块，避免重复请求
  const parentCache = new Map<string, Chunk>();

  await Promise.all(rerankedResults.map(async (item) => {
    // 克隆 chunk 以避免修改原始引用
    let finalChunk = { ...item.chunk };
    let finalScore = item.score;

  // 1. Parent-Child Logic
    // 如果是子块，尝试替换为父块
    // 修改逻辑：优先返回父块作为上下文，但如果父块太长（超过2000字），则可能只返回子块+父块摘要
    if (item.chunk.chunkType === 'child' && item.chunk.parentId) {
      let parent = parentCache.get(item.chunk.parentId);
      if (!parent) {
        try {
          // 异步获取父块
          const p = await unifiedStorageManager.getChunk(item.chunk.documentId, item.chunk.parentId);
          if (p) {
            parent = p;
            parentCache.set(item.chunk.parentId, p);
          }
        } catch (e) {
          console.warn(`Failed to fetch parent chunk ${item.chunk.parentId}:`, e);
        }
      }

      if (parent) {
        // 找到了父块
        // 策略优化：
        // 1. 如果是 QA 子块，我们希望保留 QA 的精确匹配，同时附带父块的摘要信息（如果有）
        // 2. 如果是 Section 子块，通常父块是整个文档的摘要或上一级章节，包含父块有助于理解上下文
        
        // 组合内容：父块内容 + 子块内容
        // 注意：有些父块可能就是纯摘要，有些可能是章节标题。
        // 这里我们采用一种稳健的策略：返回 "父块上下文 \n---\n 子块详情"
        
        // 检查父块是否已经是子块内容的超集（避免重复）
        if (!parent.content.includes(item.chunk.content)) {
             // 智能截断父块内容：只保留前 1000 字符作为上下文，避免 Context Explosion
             // 如果父块有 Header 信息，也一并保留
             const header = item.chunk.metadata?.header || parent.metadata?.header || '';
             let parentContext = parent.content;
             
             if (parentContext.length > 1000) {
                 parentContext = parentContext.substring(0, 1000) + '...\n(上文已省略)';
             }
             
             const contextPrefix = header ? `[章节: ${header}]\n` : '';
             
             finalChunk = { 
                 ...item.chunk,
                 content: `${contextPrefix}[相关上下文]: ${parentContext}\n\n[详细内容]: ${item.chunk.content}`
             };
        } else {
            // 如果父块已经包含了子块（例如父块是全文，子块是切片），则直接返回父块可能更好，
            // 但为了精确性，我们还是聚焦在子块，但标记来源
            // 同样需要截断父块，防止过大
            let parentContext = parent.content;
            if (parentContext.length > 1500) { // 稍微放宽一点
                 // 尝试找到子块在父块中的位置，截取周围内容
                 const idx = parentContext.indexOf(item.chunk.content);
                 if (idx !== -1) {
                     const start = Math.max(0, idx - 500);
                     const end = Math.min(parentContext.length, idx + item.chunk.content.length + 500);
                     parentContext = (start > 0 ? '...' : '') + parentContext.substring(start, end) + (end < parentContext.length ? '...' : '');
                 } else {
                     parentContext = parentContext.substring(0, 1500) + '...';
                 }
            }
            
            finalChunk = { ...parent, content: parentContext };
        }
        
        // 稍微降低一点分数以区分直接命中的父块（可选）
        // finalScore = finalScore * 0.95;
      }
    }
    
    // 2. Sliding Window Context (上下文扩展) - DISABLED for server-side search to avoid complexity
    /*
    const docId = finalChunk.documentId;
    const idx = finalChunk.chunkIndex;
    
    // 获取同文档的 chunks (优先使用缓存)
    const docChunks = relevantChunksMap.get(docId);
    
    const findChunk = (targetIdx: number) => {
      if (docChunks) {
        return docChunks.find(c => c.chunkIndex === targetIdx);
      }
      return all.find(c => c.documentId === docId && c.chunkIndex === targetIdx);
    };
    
    const prevChunk = findChunk(idx - 1);
    const nextChunk = findChunk(idx + 1);
    
    let extendedContent = finalChunk.content;
    let extensionNote = "";
    
    if (prevChunk) {
      extendedContent = `${prevChunk.content}\n${extendedContent}`;
      extensionNote += " [已包含上文]";
    }
    
    if (nextChunk) {
      extendedContent = `${extendedContent}\n${nextChunk.content}`;
      extensionNote += " [已包含下文]";
    }
    
    if (prevChunk || nextChunk) {
      finalChunk.content = extendedContent;
      // 可选：在 metadata 中标记已扩展
      // finalChunk.metadata = { ...finalChunk.metadata, expanded: true };
    }
    */

    // 去重逻辑：如果父块（或已处理的块）已经在结果里了，保留分数最高的那个
    if (addedChunkIds.has(finalChunk.id)) {
      const existingItem = enhancedResults.find(r => r.chunk.id === finalChunk.id);
      if (existingItem && finalScore > existingItem.score) {
        existingItem.score = finalScore;
        // 更新内容（可能这次的扩展上下文不一样？一般 id 相同内容应该相同，除非 context window 动态变化）
        // 这里假设 id 唯一对应内容
      }
    } else {
      enhancedResults.push({ chunk: finalChunk, score: finalScore, sources: ['enhanced'] });
      addedChunkIds.add(finalChunk.id);
    }
  }));
  
  // 重新排序
  enhancedResults.sort((a, b) => b.score - a.score);
  
  // 6. Chunk去重和合并（在文档过滤之前）
  const deduplicatedResults = deduplicateAndMergeChunks(enhancedResults, 0.85);
  deduplicatedResults.sort((a, b) => b.score - a.score);
  
  // 7. 自适应阈值计算
  const adaptiveThreshold = calculateAdaptiveThreshold(deduplicatedResults, retrievalParams.minScore);
  
  // 确保结果中包含多个文档的chunks，但只从相关性高的文档中选择
  // 按文档分组，并计算每个文档的平均相关性分数
  const chunksByDoc = new Map<string, Array<{ chunk: Chunk; score: number; sources?: string[] }>>();
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
  // Note: We don't fetch all chunks to avoid OOM, so we can't populate this set
  // This means documents not in chunksByDoc won't be force-included based on embedding availability
  
  // 提取查询中的关键词（用于文档名称匹配）
  // 使用extractKeywords函数提取关键词，确保包含产品名称等关键信息
  const extractedKeywords = extractKeywords(coreQuery);
  const queryWords = extractedKeywords.length > 0 ? extractedKeywords : coreQuery.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  
  // 提取产品关键词（用于检查文档名称匹配）
  // 优化：直接使用 LLM 智能分析出的产品名称，替代之前的硬编码规则
  // 这使得代码能够自适应识别 "Cumulus", "NVIDIA", "Cisco" 等特定产品，而不会误判 "BGP", "Linux" 等通用术语
  const productKeywordsOnly = llmProductNames;
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
  const maxAvgScore = docAvgScores.size > 0 ? Math.max(...Array.from(docAvgScores.values())) : 0;
  
  // 相关性阈值：使用自适应阈值和固定阈值的组合
  // 降低基础阈值要求，避免过滤掉潜在有用的文档
  const baseRelevanceThreshold = maxAvgScore * 0.2; // 进一步降低到 0.2，更宽松
  const relevanceThreshold = Math.min(adaptiveThreshold, baseRelevanceThreshold); // 使用 min 而不是 max，更宽松
  
  // 过滤掉相关性低的文档，严格检查关键词匹配
  // 如果查询中包含明确的产品名称或关键词，必须要求文档包含这些关键词
  // productKeywordsOnly 和 hasProductKeywords 已经在上面定义过了，这里不需要重新定义
  
  
  const relevantDocs = new Set<string>();
  docAvgScores.forEach((avgScore, docId) => {
    const keywordScore = docKeywordScores.get(docId) || 0;
    const hasKeywords = docHasKeywords.get(docId) || false;

    // 简化逻辑：只要分数超过阈值，就认为是相关的
    // 避免过度过滤导致chunks丢失
    if (avgScore >= relevanceThreshold) {
      relevantDocs.add(docId);
    }
    // 如果关键词匹配度很高，直接认为是相关的
    else if (keywordScore >= 1.0) {
      relevantDocs.add(docId);
    }
    // 如果包含任何关键词且分数不是极低，也认为是相关的
    else if (hasKeywords && avgScore >= relevanceThreshold * 0.5) {
      relevantDocs.add(docId);
    }
  });

  // 只从相关性高的文档中选择chunks
  const relevantChunksByDoc = new Map<string, Array<{ chunk: Chunk; score: number; sources?: string[] }>>();
  chunksByDoc.forEach((docChunks, docId) => {
    if (relevantDocs.has(docId)) {
      relevantChunksByDoc.set(docId, docChunks);
    }
  });

  console.log(`[Retrieval] 相关文档: ${relevantDocs.size}, 相关chunks: ${relevantChunksByDoc.size}`);
  
  
  // 对于被标记为相关但没有出现在chunksByDoc中的文档（如文件名直接匹配产品关键词），
  // 从它的所有chunks中选择一些（按语义相似度排序）
  for (const docId of relevantDocs) {
    if (!relevantChunksByDoc.has(docId)) {
      // 这个文档被标记为相关，但没有出现在top chunks中
      // 由于我们不获取所有chunks以避免OOM，无法为这些文档选择chunks
      // 这些文档将不会出现在最终结果中
      continue;
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

  console.log(`[Retrieval] 最终结果: ${result.length} chunks`);

  // 优化的fallback：如果最终结果为空，返回增强结果或空数组
  if (result.length === 0) {
    console.warn('[Retrieval] 最终结果为空，使用优化fallback');

    // 尝试从enhancedResults中返回
    if (enhancedResults.length > 0) {
      console.warn(`[Retrieval] 从enhancedResults返回${Math.min(limit, enhancedResults.length)}个chunks`);
      const finalResult = enhancedResults.slice(0, limit);
      // 缓存结果
      queryCacheManager.set(query, 'semantic', cacheKey, finalResult);
      return finalResult;
    }

    // 如果enhancedResults也为空，返回空数组而不是扫描所有chunks
    console.warn('[Retrieval] 无法找到相关chunks，返回空结果');
  }

  // 缓存结果
  queryCacheManager.set(query, 'semantic', cacheKey, result);
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

  // 辅助函数：调用API
  const callRerankApi = async (model: string) => {
    const res = await fetch(SILICONFLOW_RERANK_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
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
    return items.map((it: any) => {
      const index = it?.index ?? it?.idx ?? -1;
      const score = it?.relevance_score ?? it?.score ?? it?.relevance ?? it?.rank ?? 0;
      const text = index >= 0 && index < candidates.length ? candidates[index] : (it?.document?.text || it?.text || '');
      return { text, score };
    }).filter((x: any) => x.text && x.text.length > 0);
  };

  try {
    // 尝试主模型
    return await callRerankApi(RERANK_MODEL_PRIMARY);
  } catch (e: any) {
    console.warn(`Rerank primary model (${RERANK_MODEL_PRIMARY}) failed:`, e.message);
    
    // 如果是 400 错误 (Model does not exist/Bad Request)，尝试备用模型
    if (e.message && (e.message.includes('400') || e.message.includes('Model does not exist'))) {
      try {
        console.warn(`Switching to fallback rerank model: ${RERANK_MODEL_FALLBACK}`);
        return await callRerankApi(RERANK_MODEL_FALLBACK);
      } catch (fallbackError) {
        console.warn(`Rerank fallback model (${RERANK_MODEL_FALLBACK}) also failed:`, fallbackError);
      }
    }
    
    // 如果都失败了，使用本地简单算法兜底
    console.warn('All rerank models failed, using simple local fallback');
    return candidates.map(t => ({ text: t, score: Math.min(t.length / 500, 1) }))
      .sort((a, b) => b.score - a.score);
  }
}

export const retrieval = { ensureEmbeddingsForDocument, semanticSearch };
