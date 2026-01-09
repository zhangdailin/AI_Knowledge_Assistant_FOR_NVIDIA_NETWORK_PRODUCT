/**
 * Embedding 生成服务
 * 服务器端调用 SiliconFlow API 生成 embeddings
 */

import * as storage from './storage.mjs';

const SILICONFLOW_EMBED_URL = 'https://api.siliconflow.cn/v1/embeddings';
const SILICONFLOW_RERANK_URL = 'https://api.siliconflow.cn/v1/rerank';
const DEFAULT_EMBEDDING_MODEL = 'BAAI/bge-m3';
const DEFAULT_RERANKING_MODEL = 'BAAI/bge-reranker-v2-m3';

// Reranking 模型配置（按上下文大小排序）
const RERANKING_MODELS = [
  { name: 'BAAI/bge-reranker-v2-m3', maxTokens: 8192, maxCharsPerDoc: 2000 },
  { name: 'BAAI/bge-reranker-v2-gemma', maxTokens: 8192, maxCharsPerDoc: 2000 },
  { name: 'BAAI/bge-reranker-v2-minicpm-layerwise', maxTokens: 8192, maxCharsPerDoc: 2000 },
  // 如果有更大上下文的模型，可以添加在这里
];

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

// 估算文本的 token 数量（粗略估算：中文 ~1.5 字符/token，英文 ~4 字符/token）
function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

// 截断文档内容以适应模型上下文限制
function truncateDocuments(documents, maxCharsPerDoc) {
  return documents.map(doc => {
    const content = doc.content || doc.text || String(doc);
    if (content.length <= maxCharsPerDoc) {
      return content;
    }
    return content.substring(0, maxCharsPerDoc) + '...';
  });
}

// 检查是否为上下文超限错误
function isContextLengthError(errorText) {
  return errorText.includes('maximum context length') ||
         errorText.includes('context_length_exceeded') ||
         errorText.includes('tokens');
}

// 使用指定模型进行 rerank
async function rerankWithModel(apiKey, modelName, query, documents, topN, maxCharsPerDoc) {
  const truncatedDocs = truncateDocuments(documents, maxCharsPerDoc);

  const res = await fetch(SILICONFLOW_RERANK_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: modelName,
      query: query,
      documents: truncatedDocs,
      top_n: Math.min(topN, documents.length),
      return_documents: false
    })
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw { status: res.status, message: errorText };
  }

  const data = await res.json();
  return data?.results || [];
}

// 重排序文档（支持自动切换模型和智能截断）
export async function rerankDocuments(query, documents, topN = 10) {
  if (!query || !Array.isArray(documents) || documents.length === 0) {
    return documents;
  }

  // 获取 API key
  const apiKey = await storage.getApiKey('siliconflow');
  if (!apiKey) {
    console.warn('Reranking skipped: SiliconFlow API key 未配置');
    return documents.slice(0, topN);
  }

  // 获取配置的模型
  const configuredModel = await getRerankingModel();

  // 查找配置的模型信息
  let currentModelConfig = RERANKING_MODELS.find(m => m.name === configuredModel);
  if (!currentModelConfig) {
    currentModelConfig = { name: configuredModel, maxTokens: 8192, maxCharsPerDoc: 2000 };
  }

  // 估算总 token 数
  const totalTokens = estimateTokens(query) +
    documents.reduce((sum, doc) => sum + estimateTokens(doc.content || doc.text || String(doc)), 0);

  console.log(`[Rerank] 估算总 tokens: ${totalTokens}, 文档数: ${documents.length}, 模型: ${currentModelConfig.name}`);

  // 尝试使用当前模型
  try {
    const results = await rerankWithModel(
      apiKey,
      currentModelConfig.name,
      query,
      documents,
      topN,
      currentModelConfig.maxCharsPerDoc
    );

    if (results.length === 0) {
      return documents.slice(0, topN);
    }

    // 根据 rerank 结果重新排序
    const rerankedDocs = results.map(r => ({
      ...documents[r.index],
      rerank_score: r.relevance_score
    }));

    console.log(`[Rerank] 成功使用模型 ${currentModelConfig.name} 重排序 ${rerankedDocs.length} 个文档`);
    return rerankedDocs;

  } catch (error) {
    const errorText = error.message || String(error);
    console.error(`[Rerank] 模型 ${currentModelConfig.name} 失败 (${error.status}): ${errorText.substring(0, 200)}`);

    // 检查是否为上下文超限错误
    if (error.status === 400 && isContextLengthError(errorText)) {
      console.warn(`[Rerank] 检测到上下文超限错误，尝试降级策略...`);

      // 策略 1: 减少文档数量（只保留前 topN 个）
      if (documents.length > topN) {
        console.log(`[Rerank] 策略 1: 减少文档数量从 ${documents.length} 到 ${topN}`);
        try {
          const results = await rerankWithModel(
            apiKey,
            currentModelConfig.name,
            query,
            documents.slice(0, topN),
            topN,
            currentModelConfig.maxCharsPerDoc
          );

          if (results.length > 0) {
            const rerankedDocs = results.map(r => ({
              ...documents[r.index],
              rerank_score: r.relevance_score
            }));
            console.log(`[Rerank] 策略 1 成功，重排序 ${rerankedDocs.length} 个文档`);
            return rerankedDocs;
          }
        } catch (retryError) {
          console.error(`[Rerank] 策略 1 失败: ${retryError.message?.substring(0, 100)}`);
        }
      }

      // 策略 2: 更激进地截断文档内容
      const reducedCharsPerDoc = Math.floor(currentModelConfig.maxCharsPerDoc / 2);
      console.log(`[Rerank] 策略 2: 截断文档内容到 ${reducedCharsPerDoc} 字符`);
      try {
        const results = await rerankWithModel(
          apiKey,
          currentModelConfig.name,
          query,
          documents.slice(0, topN),
          topN,
          reducedCharsPerDoc
        );

        if (results.length > 0) {
          const rerankedDocs = results.map(r => ({
            ...documents[r.index],
            rerank_score: r.relevance_score
          }));
          console.log(`[Rerank] 策略 2 成功，重排序 ${rerankedDocs.length} 个文档`);
          return rerankedDocs;
        }
      } catch (retryError) {
        console.error(`[Rerank] 策略 2 失败: ${retryError.message?.substring(0, 100)}`);
      }

      // 策略 3: 尝试其他可用的 reranking 模型
      for (const modelConfig of RERANKING_MODELS) {
        if (modelConfig.name === currentModelConfig.name) continue;

        console.log(`[Rerank] 策略 3: 尝试切换到模型 ${modelConfig.name}`);
        try {
          const results = await rerankWithModel(
            apiKey,
            modelConfig.name,
            query,
            documents.slice(0, topN),
            topN,
            modelConfig.maxCharsPerDoc
          );

          if (results.length > 0) {
            const rerankedDocs = results.map(r => ({
              ...documents[r.index],
              rerank_score: r.relevance_score
            }));
            console.log(`[Rerank] 策略 3 成功，使用模型 ${modelConfig.name} 重排序 ${rerankedDocs.length} 个文档`);
            return rerankedDocs;
          }
        } catch (retryError) {
          console.error(`[Rerank] 模型 ${modelConfig.name} 也失败: ${retryError.message?.substring(0, 100)}`);
        }
      }
    }

    // 所有策略都失败，返回原始文档的前 topN 个
    console.warn(`[Rerank] 所有重试策略均失败，返回原始文档的前 ${topN} 个`);
    return documents.slice(0, topN);
  }
}
