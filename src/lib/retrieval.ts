import { unifiedStorageManager, Chunk } from './localStorage';
// import { optimizeTextForEmbedding } from './chunkingEnhancements';
import {
  detectQueryIntent,
  getRetrievalParamsForIntent,
  enhanceQueryWithHistory,
  extractCoreQueryEnhanced,
  deduplicateAndMergeChunks,
  calculateAdaptiveThreshold
} from './retrievalEnhancements';
import { enhancedNetworkKeywordExtractor } from './enhancedNetworkKeywordExtractor';
import { aiModelManager } from './aiModels';

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
 * 提取查询中的核心命令和关键词
 */
/**
 * 自动提取查询中的关键词
 * 使用高级语义分析识别网络配置、IP地址、命令等复杂技术信息
 */
function extractKeywords(query: string): string[] {
  // 使用增强的网络关键词提取器
  const extracted = enhancedNetworkKeywordExtractor.extractKeywords(query);
  
  // 返回所有提取的关键词，包括网络地址、命令等
  return extracted.keywords;
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
  
  // 简单的查询扩展（同义词）
  // 优化：使用 LLM 自适应生成关键词，替代硬编码
  // 并行执行：LLM 关键词生成 + 核心查询 Embedding 生成
  let adaptiveKeywords: string[] = [];
  let qEmb: number[] | null = null;
  
  try {
    // 使用 Promise.allSettled 防止关键词生成失败导致整个检索失败
    const results = await Promise.allSettled([
      embedText(coreQuery),
      // 只有当查询较长或包含复杂意图时才调用 LLM 生成关键词，避免简单查询的延迟
      coreQuery.length > 5 || coreQuery.split(' ').length > 2 
        ? aiModelManager.generateSearchKeywords(coreQuery)
        : Promise.resolve([] as string[])
    ]);

    // 处理 Embedding 结果
    if (results[0].status === 'fulfilled') {
      qEmb = results[0].value;
    } else {
      console.warn('Embedding generation failed:', results[0].reason);
    }

    // 处理关键词生成结果
    if (results[1].status === 'fulfilled') {
      adaptiveKeywords = results[1].value;
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
  
  let chunksWithEmbedding: Chunk[] = [];
  
  // 并行执行向量检索和关键词检索（在服务器端）
  const [vectorResults, keywordResults] = await Promise.all([
    qEmb ? unifiedStorageManager.vectorSearchChunks(qEmb, limit * 3) : Promise.resolve([]),
    unifiedStorageManager.searchSimilarChunks(enhancedQueryForKeyword, limit * 3)
  ]);
  
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
  // RRF score = sum(1 / (k + rank))
  const RRF_K = 60;
  const rrfMap = new Map<string, { chunk: Chunk; rrfScore: number; sources: string[] }>();
  
  // 处理向量召回
  vectorRecall.forEach((item, rank) => {
    const existing = rrfMap.get(item.chunk.id);
    const scoreToAdd = 1 / (RRF_K + rank + 1);
    
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
  
  // 处理关键词召回
  keywordRecall.forEach((item, rank) => {
    const existing = rrfMap.get(item.chunk.id);
    const scoreToAdd = 1 / (RRF_K + rank + 1);
    
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
  
  // 选择 Top K 候选进行重排
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
      enhancedResults.push({ chunk: finalChunk, score: finalScore });
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
  const baseRelevanceThreshold = maxAvgScore * 0.5;
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
    if (!hasKeywords && avgScore < maxAvgScore * 0.8) {
      // 不包含关键词且分数不够高，排除（提高阈值到80%）
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
