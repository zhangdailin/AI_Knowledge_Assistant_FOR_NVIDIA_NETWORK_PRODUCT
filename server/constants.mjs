/**
 * 全局配置常数
 */

// 文件和大小限制
export const LIMITS = {
  MAX_CHUNK_SIZE: 4000,
  MAX_TEXT_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_FILE_SIZE: 50 * 1024 * 1024,  // 50MB
  MAX_PAYLOAD_SIZE: '10mb',
  SEARCH_LIMIT: 30,
  SEARCH_TIMEOUT_MS: 30000,
  MAX_PENDING_SEARCHES: 1000,
  SEARCH_VARIANTS_LIMIT: 3
};

// 缓存配置
export const CACHE = {
  SEARCH_CACHE_SIZE: 200,
  SEMANTIC_CACHE_SIZE: 100,
  SEMANTIC_CACHE_THRESHOLD: 0.95,
  STATS_CACHE_TTL: 60000
};

// 向量和评分配置
export const SCORING = {
  RRF_K: 60,
  VECTOR_MIN_SCORE: 0.020,
  VECTOR_MIN_SCORE_MULTI: 0.015,
  RERANK_SCORE_THRESHOLD: 0.6,
  RERANK_TOPN: 10,
  HIGH_SCORE_BONUS: 0.05
};

// RRF 权重配置
export const RRF_WEIGHTS = {
  DEFAULT_KEYWORD_WEIGHT: 1.0,
  DEFAULT_VECTOR_WEIGHT: 1.0,
  COMMAND_QUERY_KEYWORD_MULTIPLIER: 1.5,
  COMMAND_QUERY_VECTOR_MULTIPLIER: 0.8,
  TECH_QUERY_KEYWORD_MULTIPLIER: 1.5,
  TECH_QUERY_VECTOR_MULTIPLIER: 0.8
};

// WebSocket 配置
export const WEBSOCKET = {
  HEARTBEAT_INTERVAL: 30000,
  HEARTBEAT_TIMEOUT: 60000,
  MAX_BACKOFF_DELAY: 5000
};

// 拓扑分析配置
export const TOPOLOGY = {
  MAX_DEVICES_PER_LAYER: 100,
  MAX_DEPTH: 10,
  CONNECTION_TIMEOUT: 5000,
  BATCH_SIZE: 50
};

// 日志和监控
export const MONITORING = {
  SLOW_QUERY_THRESHOLD_MS: 5000,
  VERY_SLOW_QUERY_THRESHOLD_MS: 10000,
  EXTREMELY_SLOW_QUERY_THRESHOLD_MS: 30000,
  STATS_UPDATE_INTERVAL: 60000
};

// 特定技术关键词
export const TECHNICAL_KEYWORDS = [
  'mlag', 'bgp', 'evpn', 'vxlan', 'ospf', 'lacp', 'bond',
  'cumulus', 'vrrp', 'vlan', 'route', 'gateway', '网关',
  '路由', 'vrr', 'anycast'
];

export const COMMAND_PATTERNS = [
  /nv\s+(set|show|config|unset)/,
  '配置', '命令', 'config', 'show', 'how to', '如何'
];

// 默认查询配置
export const DEFAULT_RETRIEVAL_CONFIG = {
  enableQueryExpansion: true,
  enableNegativeLearning: true,
  rrfK: SCORING.RRF_K,
  keywordWeight: RRF_WEIGHTS.DEFAULT_KEYWORD_WEIGHT,
  vectorWeight: RRF_WEIGHTS.DEFAULT_VECTOR_WEIGHT
};
