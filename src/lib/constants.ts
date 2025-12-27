/**
 * 应用常量定义
 */

// API 配置
export const API_CONFIG = {
  SILICONFLOW_EMBED_URL: 'https://api.siliconflow.cn/v1/embeddings',
  SILICONFLOW_RERANK_URL: 'https://api.siliconflow.cn/v1/rerank',
  SILICONFLOW_CHAT_URL: 'https://api.siliconflow.cn/v1/chat/completions',
  EMBEDDING_MODEL: 'BAAI/bge-m3',
  RERANK_MODEL_PRIMARY: 'BAAI/bge-reranker-v2-m3',
  RERANK_MODEL_FALLBACK: 'BAAI/bge-reranker-large',
} as const;

// 检索配置
export const RETRIEVAL_CONFIG = {
  DEFAULT_LIMIT: 20,
  DEFAULT_RERANK_CANDIDATES_MULTIPLIER: 3,
  RRF_K: 60,
  RERANK_CONTENT_MAX_LENGTH: 500,
  MAX_TOP_DOCS_FOR_RERANK: 3,
  MAX_CHUNKS_PER_DOC_FOR_RERANK: 20,
  MIN_CHUNKS_PER_DOC: 1,
  DEFAULT_SIMILARITY_THRESHOLD: 0.85,
  RELEVANCE_THRESHOLD: 0.01,
  BASE_RELEVANCE_THRESHOLD_MULTIPLIER: 0.2,
} as const;

// 文本处理配置
export const TEXT_CONFIG = {
  MAX_EMBEDDING_LENGTH: 2000,
  PARENT_CONTEXT_MAX_LENGTH: 1000,
  PARENT_CONTEXT_FALLBACK_LENGTH: 1500,
  SLIDING_WINDOW_CONTEXT: 500,
  MIN_CHUNK_LENGTH: 50,
  DEFAULT_MAX_CHUNK_SIZE: 3000,
} as const;

// 对话历史配置
export const CONVERSATION_CONFIG = {
  MAX_HISTORY_MESSAGES: 10,
  MAX_HISTORY_FOR_ENHANCEMENT: 3,
  MAX_RECENT_CONVERSATIONS: 10,
} as const;

// AI 模型配置
export const AI_MODEL_CONFIG = {
  DEFAULT_MODEL: 'qwen3-32b',
  FAST_MODEL: 'Qwen/Qwen2.5-7B-Instruct',
  QWEN_MODEL: 'Qwen/Qwen3-32B',
  FALLBACK_QWEN_MODEL: 'Qwen/Qwen2.5-32B-Instruct',
  MAX_RETRIES: 3,
  BASE_RETRY_DELAY: 1000,
  BASE_TIMEOUT: 60000,
  INDEXING_TASK_TIMEOUT: 120000,
  KEYWORD_TASK_TIMEOUT: 20000,
  TIMEOUT_INCREMENT_PER_RETRY: 10000,
  MAX_TOKENS: 8192,
  DEFAULT_TEMPERATURE: 0.7,
  DEEP_THINKING_TEMPERATURE: 0.5,
} as const;

// 存储配置
export const STORAGE_CONFIG = {
  DEFAULT_MAX_CHUNKS: 1000,
  CLEANUP_KEEP_COUNT: 500,
  LOCAL_STORAGE_PREFIX: 'ai_assistant_',
} as const;

// 网络关键词配置
export const NETWORK_KEYWORDS = {
  PFC: ['pfc', 'priority flow control', 'priority-based flow control'],
  ECN: ['ecn', 'explicit congestion notification', 'congestion control'],
  BGP: ['bgp', '边界网关协议', 'peer', 'neighbor'],
} as const;

