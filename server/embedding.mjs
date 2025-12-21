/**
 * Embedding 生成服务
 * 服务器端调用 SiliconFlow API 生成 embeddings
 */

import * as storage from './storage.mjs';

const SILICONFLOW_EMBED_URL = 'https://api.siliconflow.cn/v1/embeddings';
const BGE_MODEL = 'BAAI/bge-m3';

// 生成 embedding
export async function embedText(text) {
  // 获取 API key
  const apiKey = await storage.getApiKey('siliconflow') || process.env.SILICONFLOW_API_KEY || process.env.VITE_SILICONFLOW_API_KEY;
  
  if (!apiKey) {
    throw new Error('SiliconFlow API key 未配置');
  }

  try {
    const res = await fetch(SILICONFLOW_EMBED_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: BGE_MODEL,
        input: text
      })
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Embedding API 错误 ${res.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await res.json();
    const embedding = data?.data?.[0]?.embedding || data?.embedding || data?.data;
    
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('API 返回的 embedding 格式不正确');
    }

    return embedding;
  } catch (error) {
    console.error('生成 embedding 失败:', error);
    throw error;
  }
}
