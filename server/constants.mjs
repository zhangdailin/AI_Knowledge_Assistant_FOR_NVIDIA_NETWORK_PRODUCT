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
  SEARCH_CACHE_SIZE: 500,         // 增加搜索缓存以提高命中率
  SEMANTIC_CACHE_SIZE: 200,       // 增加语义缓存
  SEMANTIC_CACHE_THRESHOLD: 0.85, // 降低阈值以提高命中率
  STATS_CACHE_TTL: 60000,         // 统计缓存TTL (1分钟)
  CACHE_TTL: 3600000              // 通用缓存TTL (1小时)
};

// 向量和评分配置
export const SCORING = {
  RRF_K: 60,
  VECTOR_MIN_SCORE: 0.050,       // 提升阈值过滤低质量结果
  VECTOR_MIN_SCORE_MULTI: 0.040, // 多轮查询阈值同步提升
  RERANK_SCORE_THRESHOLD: 0.5,   // 降低rerank阈值保留更多候选
  RERANK_TOPN: 20,               // 扩大rerank处理数量
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

// 技术关键词（统一列表）
export const TECHNICAL_KEYWORDS = [
  // 网络协议
  'bgp', 'ospf', 'evpn', 'vxlan', 'mlag', 'vrrp', 'lacp', 'stp', 'rstp', 'mstp',
  'bfd', 'pim', 'igmp', 'ldp', 'mpls', 'isis',
  // 网络功能
  'vlan', 'vrf', 'acl', 'qos', 'ecmp', 'bond', 'bridge', 'tunnel',
  // 厂商特定
  'cumulus', 'nvidia', 'nvue', 'netq', 'switchd',
  // 技术概念
  'roce', 'rdma', 'pfc', 'ecn', 'dcb', 'lossless',
  // 其他
  'route', 'gateway', 'vrr', 'anycast',
  // 中文
  '路由', '网关', '接口', '链路', '隧道', '聚合', '冗余'
];

// 向后兼容别名
export const EXTENDED_TECHNICAL_KEYWORDS = TECHNICAL_KEYWORDS;

// 基础命令模式 - 用于命令检测（不含正则标志，各文件按需添加）
export const BASE_COMMAND_PATTERNS = [
  /nv\s+(set|show|config|unset|action)/,
  /netq\s+(show|check|trace)/,
  /ip\s+(route|link|addr|neighbor)/,
  /show\s+(\w+)/,
  /config\s+(\w+)/,
  /net\s+(add|del|show|commit)/,
  /(configure|enable|disable)\s+\w+/,
  /```[\s\S]*?```/  // 代码块
];

// 命令行开头模式 - 用于验证命令的合法性
export const COMMAND_LINE_PATTERNS = [
  /^nv\s+(show|set|unset|config|apply)/i,
  /^(nv-|netq|cumulus|show\s+|ip\s+|ping\s+|traceroute\s+|mtr\s+)/i,
  /^(conf\s+|config\s+|set\s+|delete\s+|remove\s+|enable\s+|disable\s+|shutdown|no\s+shutdown)/i,
  /^(sudo\s+|apt\s+|yum\s+|systemctl\s+|service\s+|docker\s+|kubectl\s+|git\s+)/i,
  /^(curl\s+|wget\s+|ssh\s+|scp\s+|rsync\s+|nc\s+|telnet\s+)/i,
  /^(cat\s+|grep\s+|awk\s+|sed\s+|find\s+|ls\s+|cd\s+|mkdir\s+|rm\s+|cp\s+|mv\s+)/i
];

// 命令排除模式 - 这些不是命令
export const COMMAND_EXCLUDE_PATTERNS = [
  /^(system|config|interface|router|switch|vlan|port|network|device|server|host|node|cluster|pod|namespace|service|deployment|container|image|volume|secret|configmap):?\s*$/i,
  /^(注意|说明|示例|例如|提示|警告|重要|备注|参考|步骤|方法|配置|设置|选项|参数|说明|描述)[:：]/i,
  /^\d+[\.\)]\s+/,  // 列表项编号
  /^[-*]\s+/        // 列表项标记
];

// 向后兼容别名
export const COMMAND_PATTERNS = BASE_COMMAND_PATTERNS;
export const COMMAND_CONTENT_PATTERNS = BASE_COMMAND_PATTERNS;

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

// ========== 检索策略优化配置（精简版）==========

// 策略类型配置 - 从7种精简为4种核心策略
export const STRATEGY_CONFIG = {
  // 1. 命令配置类（合并 vendor-focused, command-focused）
  'command-focused': {
    enableKnowledgeGraph: true,
    kgWeight: 0.32,           // 统一权重
    maxKgResults: 6,
    keywordBoost: 1.3,        // 平衡关键词和向量
    vectorBoost: 0.85,
    enableMultiHop: false
  },
  // 2. 概念理解类（合并 function-focused, concept-focused）
  'concept-focused': {
    enableKnowledgeGraph: false,  // 概念查询主要依赖向量语义
    kgWeight: 0.15,
    maxKgResults: 3,
    keywordBoost: 0.9,
    vectorBoost: 1.15,       // 更重视语义
    enableMultiHop: false
  },
  // 3. 故障排查类
  'troubleshoot-focused': {
    enableKnowledgeGraph: true,
    kgWeight: 0.30,
    maxKgResults: 6,
    keywordBoost: 1.2,
    vectorBoost: 0.95,
    enableMultiHop: true     // 需要关联分析
  },
  // 4. 平衡策略（合并 comparison-focused, balanced）
  'balanced': {
    enableKnowledgeGraph: false,
    kgWeight: 0.15,
    maxKgResults: 4,
    keywordBoost: 1.0,
    vectorBoost: 1.0,
    enableMultiHop: false
  }
};

// 动态权重计算配置
export const DYNAMIC_WEIGHT_CONFIG = {
  // 各因子权重分配
  factors: {
    kgConfidence: 0.20,       // KG 置信度贡献
    scoreVariance: 0.25,      // 向量分数方差贡献
    entityDensity: 0.20,      // 实体密度贡献
    queryComplexity: 0.15,    // 查询复杂度贡献
    documentTypeMatch: 0.15,  // 文档类型匹配贡献
    historicalBoost: 0.05     // 历史效果贡献
  },
  // 权重上下限
  minWeight: 0.1,
  maxWeight: 0.5,             // 降低最大权重
  maxWeightComplex: 0.55,     // 复杂查询的最大权重(降低)
  // 基础权重
  baseWeight: 0.25,
  // 方差上限
  varianceMax: 0.5,
  // 实体密度系数
  entityDensityCoeff: 0.1,
  entityDensityMax: 0.3
};

// 查询信号阈值
export const SIGNAL_THRESHOLDS = {
  strategyConfidence: 0.3,    // 策略选择的置信度阈值
  multiIntentThreshold: 0.4,  // 多意图检测阈值
  complexityThreshold: 0.6    // 复杂查询阈值
};

