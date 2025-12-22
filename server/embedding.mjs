/**
 * Embedding 生成服务
 * 服务器端调用 SiliconFlow API 生成 embeddings
 */

import * as storage from './storage.mjs';

const SILICONFLOW_EMBED_URL = 'https://api.siliconflow.cn/v1/embeddings';
const BGE_MODEL = 'BAAI/bge-m3';

// 生成 embedding
export async function embedText(text) {
  if (!text || typeof text !== 'string') {
    console.warn('Invalid text type for embedding, skipping.');
    return null;
  }
  
  // 即使是空字符串或纯空格，为了保持索引一致性，我们也可以尝试生成一个“空向量”或者抛出明确错误
  // 但更好的做法是不要让空字符串进入到这里
  // 这里我们稍微放宽一点，如果 trim 后确实为空，则返回 null，由上层处理
  if (text.trim().length === 0) {
    console.warn('Empty text content for embedding (after trim), skipping.');
    return null;
  }

  // 截断文本，防止超过 API 限制
  // bge-m3 支持 8192 token，但为了安全和速度，限制在 2000 字符
  // 注意：不要过度清洗换行符，因为 bge-m3 对结构化文本（如 markdown）有理解能力
  const truncatedText = text.substring(0, 2000);

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
        input: truncatedText
      })
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      // 增加对 429 的特殊处理日志
      if (res.status === 429) {
          throw new Error(`Rate Limit Exceeded (429): ${errorText.substring(0, 100)}`);
      }
      throw new Error(`Embedding API 错误 ${res.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await res.json();
    const embedding = data?.data?.[0]?.embedding || data?.embedding || data?.data;
    
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      // 增加对空响应的详细调试信息
      console.error('Embedding API response structure:', JSON.stringify(data).substring(0, 200));
      throw new Error('API 返回的 embedding 格式不正确');
    }

    return embedding;
  } catch (error) {
    console.error('生成 embedding 失败:', error.message); // 简化日志，只输出 message
    throw error;
  }
}
