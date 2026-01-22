/**
 * 应用常量定义
 */

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

// Token 预算配置
export const TOKEN_BUDGET_CONFIG = {
  // 总预算（保守估计，留余量给模型）
  TOTAL_BUDGET: 28000,
  // 系统提示词预留
  SYSTEM_PROMPT_RESERVE: 800,
  // 回复预留（减少以留更多空间给参考文档）
  RESPONSE_RESERVE: 3000,
  // 默认比例分配（增加参考文档比例）
  DEFAULT_HISTORY_RATIO: 0.2,
  DEFAULT_REFERENCE_RATIO: 0.8,
  // 按意图类型的预算分配
  INTENT_BUDGETS: {
    config: { historyRatio: 0.15, referenceRatio: 0.85 },
    troubleshoot: { historyRatio: 0.3, referenceRatio: 0.7 },
    concept: { historyRatio: 0.25, referenceRatio: 0.75 },
    comparison: { historyRatio: 0.2, referenceRatio: 0.8 },
    listRequest: { historyRatio: 0.15, referenceRatio: 0.85 },
    show: { historyRatio: 0.2, referenceRatio: 0.8 },
    default: { historyRatio: 0.2, referenceRatio: 0.8 },
  },
  // 最小参考文档数量（增加）
  MIN_REFERENCES: 5,
  // 最大参考文档数量（减少以提速但保证质量）
  MAX_REFERENCES: 15,
} as const;

// MMR 算法配置
export const MMR_CONFIG = {
  // Lambda 参数：相关性 vs 多样性的平衡
  // 值越高越重相关性，值越低越重多样性
  DEFAULT_LAMBDA: 0.5,
  CONFIG_LAMBDA: 0.7,      // 配置类更重相关性
  CONCEPT_LAMBDA: 0.4,     // 概念类更重多样性
  TROUBLESHOOT_LAMBDA: 0.6,
} as const;

// 查询复杂度阈值
export const COMPLEXITY_CONFIG = {
  // 长度阈值
  SHORT_QUERY_LENGTH: 20,
  LONG_QUERY_LENGTH: 50,
  // 技术术语数量阈值
  TECH_TERMS_SIMPLE: 1,
  TECH_TERMS_COMPLEX: 3,
  // 复杂度分数阈值
  SIMPLE_THRESHOLD: 0.3,
  COMPLEX_THRESHOLD: 0.6,
} as const;


