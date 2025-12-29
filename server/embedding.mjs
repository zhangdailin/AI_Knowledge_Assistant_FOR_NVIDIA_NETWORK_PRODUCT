/**
 * Embedding 生成服务
 * 服务器端调用 SiliconFlow API 生成 embeddings
 */

import * as storage from './storage.mjs';

const SILICONFLOW_EMBED_URL = 'https://api.siliconflow.cn/v1/embeddings';
const SILICONFLOW_RERANK_URL = 'https://api.siliconflow.cn/v1/rerank';
const DEFAULT_EMBEDDING_MODEL = 'BAAI/bge-m3';
const DEFAULT_RERANKING_MODEL = 'BAAI/bge-reranker-v2-m3';

// 获取当前配置的 embedding 模型
async function getEmbeddingModel() {
  try {
    const settings = await storage.getSettings();
    return settings?.modelSelection?.embedding || DEFAULT_EMBEDDING_MODEL;
  } catch (e) {
    return DEFAULT_EMBEDDING_MODEL;
  }
}

// 获取当前配置的 reranking 模型
async function getRerankingModel() {
  try {
    const settings = await storage.getSettings();
    return settings?.modelSelection?.reranking || DEFAULT_RERANKING_MODEL;
  } catch (e) {
    return DEFAULT_RERANKING_MODEL;
  }
}

// 生成单个 embedding (保持向后兼容)
export async function embedText(text) {
  const results = await embedTexts([text]);
  return results && results.length > 0 ? results[0] : null;
}

// 批量生成 embedding (更高效率)
export async function embedTexts(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  // 过滤和预处理
  const validTexts = texts.map(t => {
    if (!t || typeof t !== 'string' || t.trim().length === 0) return null;
    return t.substring(0, 2000); // 截断
  });

  // 记录有效的索引
  const validIndices = validTexts.map((t, i) => (t !== null ? i : -1)).filter(i => i !== -1);
  const textsToEmbed = validIndices.map(i => validTexts[i]);

  if (textsToEmbed.length === 0) {
    return texts.map(() => null);
  }

  // 获取 API key 和模型
  // 获取 API key 和模型
  const apiKey = await storage.getApiKey('siliconflow');
  if (!apiKey) throw new Error('SiliconFlow API key 未配置');

  const embeddingModel = await getEmbeddingModel();

  try {
    const res = await fetch(SILICONFLOW_EMBED_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: textsToEmbed
      })
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      if (res.status === 429) throw new Error(`Rate Limit Exceeded (429)`);
      throw new Error(`Embedding API 错误 ${res.status}: ${errorText.substring(0, 100)}`);
    }

    const data = await res.json();
    const results = new Array(texts.length).fill(null);

    // 解析返回结果 (SiliconFlow 通常在 data 数组中按顺序返回)
    const embeddings = data?.data;
    if (Array.isArray(embeddings)) {
      embeddings.forEach((item, idx) => {
        const originalIdx = validIndices[idx];
        results[originalIdx] = item.embedding || item;
      });
    }

    return results;
  } catch (error) {
    console.error('批量生成 embedding 失败:', error.message);
    throw error;
  }
}

// 重排序文档
export async function rerankDocuments(query, documents, topN = 10) {
  if (!query || !Array.isArray(documents) || documents.length === 0) {
    return documents;
  }

  // 获取 API key 和模型
  // 获取 API key 和模型
  const apiKey = await storage.getApiKey('siliconflow');
  if (!apiKey) {
    console.warn('Reranking skipped: SiliconFlow API key 未配置');
    return documents.slice(0, topN);
  }

  const rerankModel = await getRerankingModel();

  try {
    const res = await fetch(SILICONFLOW_RERANK_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: rerankModel,
        query: query,
        documents: documents.map(doc => doc.content || doc.text || String(doc)),
        top_n: Math.min(topN, documents.length),
        return_documents: false
      })
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.error(`Reranking API 错误 ${res.status}: ${errorText.substring(0, 100)}`);
      return documents.slice(0, topN);
    }

    const data = await res.json();
    const results = data?.results || [];

    if (results.length === 0) {
      return documents.slice(0, topN);
    }

    // 根据 rerank 结果重新排序
    const rerankedDocs = results.map(r => ({
      ...documents[r.index],
      rerank_score: r.relevance_score
    }));

    console.log(`[Rerank] Query: "${query.substring(0, 30)}..." | Reranked ${rerankedDocs.length} documents`);
    return rerankedDocs;
  } catch (error) {
    console.error('Reranking 失败:', error.message);
    return documents.slice(0, topN);
  }
}
