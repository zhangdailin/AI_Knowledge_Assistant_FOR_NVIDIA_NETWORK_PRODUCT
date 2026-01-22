/**
 * Token 预算管理器
 * 动态分配和管理上下文窗口的 token 预算
 */

export interface TokenBudgetConfig {
  totalBudget: number;           // 总预算（默认 32000，留足够余量）
  systemPromptReserve: number;   // 系统提示词预留
  responseReserve: number;       // 回复预留
  historyRatio: number;          // 历史消息占比
  referenceRatio: number;        // 参考文档占比
}

export interface QueryIntent {
  isConfig: boolean;
  isTroubleshoot: boolean;
  isShow: boolean;
  isConcept: boolean;
  isComparison: boolean;
  isListRequest: boolean;
}

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  [key: string]: any;
}

export interface KnowledgeSearchResult {
  id?: string;
  documentId?: string;
  chunkIndex?: number;
  metadata?: {
    header?: string;
    summary?: string;
    breadcrumbs?: string[];
  };
  title: string;
  content: string;
  score: number;
  rrfScore?: number;
  rerankScore?: number;
  isTruncated?: boolean;
  [key: string]: any;
}

const DEFAULT_CONFIG: TokenBudgetConfig = {
  totalBudget: 28000,           // 保守估计，留余量
  systemPromptReserve: 1000,    // 系统提示词约 1000 tokens
  responseReserve: 4000,        // 预留回复空间
  historyRatio: 0.3,            // 历史占 30%
  referenceRatio: 0.7,          // 参考文档占 70%
};

export class TokenBudgetManager {
  private config: TokenBudgetConfig;

  constructor(config?: Partial<TokenBudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取可用预算
   */
  getAvailableBudget(): { history: number; references: number; total: number } {
    const total = this.config.totalBudget
      - this.config.systemPromptReserve
      - this.config.responseReserve;

    return {
      total,
      history: Math.floor(total * this.config.historyRatio),
      references: Math.floor(total * this.config.referenceRatio)
    };
  }

  /**
   * 根据查询意图动态调整预算分配
   */
  adjustBudgetByIntent(intent: QueryIntent): { history: number; references: number } {
    let historyRatio = this.config.historyRatio;
    let referenceRatio = this.config.referenceRatio;

    if (intent.isConfig) {
      // 配置类问题：更多参考文档，较少历史
      historyRatio = 0.2;
      referenceRatio = 0.8;
    } else if (intent.isTroubleshoot) {
      // 故障排查：平衡历史和参考（可能需要上下文）
      historyRatio = 0.4;
      referenceRatio = 0.6;
    } else if (intent.isConcept) {
      // 概念问题：少量精确参考，适中历史
      historyRatio = 0.35;
      referenceRatio = 0.65;
    } else if (intent.isComparison) {
      // 比较类问题：需要更多参考文档
      historyRatio = 0.25;
      referenceRatio = 0.75;
    } else if (intent.isListRequest) {
      // 列举类问题：需要更多参考文档
      historyRatio = 0.2;
      referenceRatio = 0.8;
    } else if (intent.isShow) {
      // 查看类问题：平衡
      historyRatio = 0.3;
      referenceRatio = 0.7;
    }

    const available = this.config.totalBudget
      - this.config.systemPromptReserve
      - this.config.responseReserve;

    return {
      history: Math.floor(available * historyRatio),
      references: Math.floor(available * referenceRatio)
    };
  }

  /**
   * 估算文本的 token 数
   * 中文约 1.5-2 字符/token，英文约 4 字符/token
   */
  estimateTokens(text: string): number {
    if (!text) return 0;

    // 统计中文字符
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    // 统计英文和其他字符
    const otherChars = text.length - chineseChars;

    // 中文约 1.5 字符/token，英文约 4 字符/token
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  /**
   * 在预算内选择历史消息
   * 从最新消息开始选择，保留对话连贯性
   */
  selectMessagesWithinBudget(
    messages: Message[],
    budget: number
  ): Message[] {
    if (messages.length === 0) return [];

    const selected: Message[] = [];
    let usedTokens = 0;

    // 从最新消息开始倒序选择
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = this.estimateTokens(msg.content);

      if (usedTokens + msgTokens <= budget) {
        selected.unshift(msg);
        usedTokens += msgTokens;
      } else {
        // 超出预算，停止选择
        break;
      }
    }

    return selected;
  }

  /**
   * 在预算内选择参考文档
   * 保证至少选择 minCount 条，必要时截断内容
   */
  selectReferencesWithinBudget(
    references: KnowledgeSearchResult[],
    budget: number,
    minCount: number = 3
  ): KnowledgeSearchResult[] {
    if (references.length === 0) return [];

    const selected: KnowledgeSearchResult[] = [];
    let usedTokens = 0;

    for (const ref of references) {
      const titleTokens = this.estimateTokens(ref.title || '');
      const contentTokens = this.estimateTokens(ref.content);
      const totalTokens = titleTokens + contentTokens + 20; // 20 tokens 用于格式化

      if (usedTokens + totalTokens <= budget) {
        // 完整添加
        selected.push(ref);
        usedTokens += totalTokens;
      } else if (selected.length < minCount) {
        // 未达到最小数量，尝试截断内容
        const remainingBudget = budget - usedTokens - titleTokens - 30;
        if (remainingBudget > 100) {
          const truncatedContent = this.truncateToTokens(ref.content, remainingBudget);
          selected.push({
            ...ref,
            content: truncatedContent,
            isTruncated: true
          });
          usedTokens = budget; // 用尽预算
        }
        break;
      } else {
        // 已达到最小数量，可以停止
        break;
      }
    }

    return selected;
  }

  /**
   * 截断文本到指定 token 数
   */
  truncateToTokens(text: string, targetTokens: number): string {
    if (!text || targetTokens <= 0) return '';

    // 保守估计：每个 token 约 2 个字符
    const estimatedChars = targetTokens * 2;

    if (text.length <= estimatedChars) {
      return text;
    }

    // 尝试在句子边界截断
    const truncated = text.substring(0, estimatedChars);
    const lastPeriod = Math.max(
      truncated.lastIndexOf('。'),
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('\n')
    );

    if (lastPeriod > estimatedChars * 0.7) {
      return truncated.substring(0, lastPeriod + 1) + '...';
    }

    return truncated + '...';
  }

  /**
   * 计算参考文档的最佳数量（基于平均文档长度）
   */
  calculateOptimalReferenceCount(
    references: KnowledgeSearchResult[],
    budget: number
  ): number {
    if (references.length === 0) return 0;

    // 计算平均文档 token 数
    const sampleSize = Math.min(5, references.length);
    let totalTokens = 0;
    for (let i = 0; i < sampleSize; i++) {
      totalTokens += this.estimateTokens(references[i].content + (references[i].title || ''));
    }
    const avgTokens = totalTokens / sampleSize + 20; // 加上格式化开销

    // 计算最佳数量
    const optimalCount = Math.floor(budget / avgTokens);

    // 限制在合理范围内
    return Math.max(3, Math.min(optimalCount, 20));
  }

  /**
   * 获取预算使用情况统计
   */
  getBudgetStats(
    systemPrompt: string,
    messages: Message[],
    references: KnowledgeSearchResult[]
  ): {
    systemTokens: number;
    historyTokens: number;
    referenceTokens: number;
    totalUsed: number;
    remaining: number;
    utilizationRate: number;
  } {
    const systemTokens = this.estimateTokens(systemPrompt);
    const historyTokens = messages.reduce(
      (sum, msg) => sum + this.estimateTokens(msg.content),
      0
    );
    const referenceTokens = references.reduce(
      (sum, ref) => sum + this.estimateTokens(ref.content + (ref.title || '')),
      0
    );

    const totalUsed = systemTokens + historyTokens + referenceTokens;
    const remaining = this.config.totalBudget - totalUsed - this.config.responseReserve;
    const utilizationRate = totalUsed / (this.config.totalBudget - this.config.responseReserve);

    return {
      systemTokens,
      historyTokens,
      referenceTokens,
      totalUsed,
      remaining,
      utilizationRate
    };
  }
}

// 导出单例实例
export const tokenBudgetManager = new TokenBudgetManager();

// 导出默认配置
export { DEFAULT_CONFIG as TOKEN_BUDGET_CONFIG };
