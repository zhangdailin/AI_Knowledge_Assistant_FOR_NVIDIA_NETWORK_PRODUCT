/**
 * Embedding 生成服务
 * 服务器端调用 SiliconFlow API 生成 embeddings
 */

import * as storage from './storage.mjs';

const SILICONFLOW_EMBED_URL = 'https://api.siliconflow.cn/v1/embeddings';
const BGE_MODEL = 'BAAI/bge-m3';

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

  // 获取 API key
  const apiKey = await storage.getApiKey('siliconflow') || process.env.SILICONFLOW_API_KEY || process.env.VITE_SILICONFLOW_API_KEY;
  if (!apiKey) throw new Error('SiliconFlow API key 未配置');

  try {
    const res = await fetch(SILICONFLOW_EMBED_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: BGE_MODEL,
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
