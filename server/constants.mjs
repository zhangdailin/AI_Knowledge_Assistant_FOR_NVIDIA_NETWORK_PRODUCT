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
  COMMAND_QUERY_KEYWORD_MULTIPLIER: 1.8,    // 提高命令查询关键词权重
  COMMAND_QUERY_VECTOR_MULTIPLIER: 0.6,     // 降低命令查询向量权重（命令更依赖精确匹配）
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
  /nv\s+(set|show|config|unset)/i,
  /\b(show|display|list|get)\s+\w+/i,
  /\b(ip|ifconfig|netstat|route|arp)\s+\w+/i,
  /\b(configure|enable|disable|no)\s+\w+/i,
  /```[\s\S]*?(nv|show|config|set|ip)/i,  // 代码块中包含命令
  /^\s*(nv|net|sudo|#|\$)/m,               // 命令行开头特征
  '配置', '命令', 'config', 'show', 'how to', '如何',
  '怎么配置', '怎么设置', '如何启用', '如何禁用'
];

// 命令内容识别 - 用于在文档内容中检测命令
export const COMMAND_CONTENT_PATTERNS = [
  /```[\s\S]*?```/,                          // 代码块
  /nv\s+(set|show|config|unset|action)\s+\S+/gi,
  /\b(show|display)\s+(interface|route|bgp|evpn|mlag|vlan|vxlan|ip)/gi,
  /\bip\s+(route|address|link|neighbor)/gi,
  /\b(configure|no\s+\w+|exit|end)\b/gi,
  /^\s*cumulus@\S+:/m,                       // Cumulus 命令提示符
  /^\s*\$\s+\w+/m,                           // Shell 命令
  /^\s*#\s+\w+/m                             // Root 命令
];

// 命令查询增强权重
export const COMMAND_BOOST = {
  CODE_BLOCK_BOOST: 0.15,           // 包含代码块的结果额外加分
  COMMAND_SYNTAX_BOOST: 0.12,       // 包含命令语法的结果额外加分
  EXACT_COMMAND_BOOST: 0.2,         // 精确匹配命令的结果额外加分
  KG_COMMAND_BOOST: 0.25            // 知识图谱命令匹配额外加分
};

// 默认查询配置
export const DEFAULT_RETRIEVAL_CONFIG = {
  enableQueryExpansion: true,
  enableNegativeLearning: true,
  rrfK: SCORING.RRF_K,
  keywordWeight: RRF_WEIGHTS.DEFAULT_KEYWORD_WEIGHT,
  vectorWeight: RRF_WEIGHTS.DEFAULT_VECTOR_WEIGHT
};
