/**
 * 高级意图识别器
 * 支持多种查询意图，包括置信度评分和上下文感知
 */

export type QueryIntent =
  | 'command'              // 命令查询：如何执行某个操作
  | 'question'             // 概念问题：什么是、为什么
  | 'troubleshoot'         // 故障排查：问题诊断、错误解决
  | 'configuration'        // 配置指导：如何配置、设置参数
  | 'explanation'          // 概念解释：详细说明、原理讲解
  | 'comparison'           // 对比分析：对比、区别、优缺点
  | 'performance'          // 性能优化：性能调优、优化建议
  | 'best_practice'        // 最佳实践：推荐做法、标准流程
  | 'verification'         // 验证检查：验证配置、检查状态
  | 'general';             // 通用查询：其他

export interface IntentResult {
  intent: QueryIntent;
  confidence: number;        // 0-1 置信度
  reasons: string[];         // 识别原因
  subIntents?: QueryIntent[]; // 子意图（多步骤查询）
  context?: {
    hasError?: boolean;
    hasCommand?: boolean;
    hasParameter?: boolean;
    complexity?: 'simple' | 'medium' | 'complex';
  };
}

export class AdvancedIntentDetector {
  private patterns = {
    // 命令类：如何、怎么、执行某操作
    command: {
      keywords: ['执行', 'how to', 'how do', 'run', 'execute', '运行', 'nv show', 'show', 'display', 'list', 'get', '查询'],
      patterns: [/^(如何|怎么|怎样).*(查询|执行|运行|操作|显示|查看|配置|设置)/i, /^(nv show|show|display|list|get)\s/i],
      weight: 1.2
    },

    // 故障排查：问题、错误、不工作、失败
    troubleshoot: {
      keywords: ['问题', '错误', '失败', '不工作', '无法', '异常', 'error', 'fail', 'issue', 'problem', 'not working', 'debug', '调试', '排查', '诊断', '起不来', '启不动', '无法启动', '启动失败', '不能启动', '报错'],
      patterns: [/^(为什么|为啥).*(不|无法|失败|错误)/i, /^(.*)(出错|报错|异常|问题|故障|起不来|启不动|无法启动|启动失败)/i, /^(debug|troubleshoot|diagnose)/i, /(报错|出错|异常).*(如何|怎么|怎样|调试)/i],
      weight: 1.3
    },

    // 配置指导：配置、设置、启用、禁用
    configuration: {
      keywords: ['配置', '设置', '启用', '禁用', '修改', '更改', 'configure', 'setup', 'enable', 'disable', 'set', 'modify', 'nv set', 'nv config'],
      patterns: [/^(配置|设置|启用|禁用|修改|更改)\s+\w+/i, /^(nv set|nv config)/i, /^(enable|disable|configure)\s/i, /(启用|禁用).*(如何|怎么|怎样)/i, /(如何|怎么|怎样).*(启用|禁用|配置|设置)/i],
      weight: 1.0
    },

    // 概念解释：什么是、定义、说明、原理
    explanation: {
      keywords: ['什么是', '定义', '说明', '原理', '解释', '介绍', 'what is', 'definition', 'explain', 'describe', '详细', '详解'],
      patterns: [/^(什么是|什么叫|定义).*/i, /^(explain|describe|define)/i, /^(.*)(的原理|的概念|的含义)/i],
      weight: 0.9
    },

    // 对比分析：对比、区别、优缺点、vs
    comparison: {
      keywords: ['对比', '区别', '差异', '优缺点', '比较', 'vs', 'versus', 'difference', 'compare', '相比', '不同'],
      patterns: [/^(对比|比较|区别).*(和|与|vs)/i, /^(.*)(vs|versus|和.*的区别)/i],
      weight: 0.8
    },

    // 性能优化：优化、性能、调优、提升
    performance: {
      keywords: ['优化', '性能', '调优', '提升', '加速', '改进', 'optimize', 'performance', 'tune', 'improve', '效率'],
      patterns: [/^(如何|怎么|怎样).*(优化|提升|改进|加速)/i, /^(optimize|performance|tune)/i, /(提升|优化|改进|加速).*(如何|怎么|怎样)/i],
      weight: 0.9
    },

    // 最佳实践：推荐、建议、标准、最佳
    best_practice: {
      keywords: ['推荐', '建议', '标准', '最佳', '最好', 'best practice', 'recommend', 'suggest', '应该', '通常'],
      patterns: [/^(推荐|建议|最佳|标准).*/i, /^(best practice|recommended)/i],
      weight: 0.85
    },

    // 验证检查：检查、验证、查看、显示
    verification: {
      keywords: ['检查', '验证', '查看', '显示', '查询', 'check', 'verify', 'show', 'display', 'list', 'nv show'],
      patterns: [/^(检查|验证|查看|查询).*(状态|配置|结果|设置)/i, /^(nv show|show|display|list)/i, /^(查看|显示).*/i],
      weight: 0.95
    },

    // 问题类：为什么、是否、能否
    question: {
      keywords: ['为什么', '是否', '能否', '可以', '会不会', 'why', 'whether', 'can', 'could', '吗'],
      patterns: [/^(为什么|为啥).*/i, /^(是否|能否|可以).*/i, /.*[吗？\?]$/i],
      weight: 0.8
    }
  };

  private stopWords = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '些', '个', '只', '现在', '请', '问', '给出', '完整', '详细', '具体'
  ]);

  detect(query: string, conversationHistory?: string[]): IntentResult {
    const queryLower = query.toLowerCase();
    const scores: { [key in QueryIntent]?: number } = {};
    const reasons: { [key in QueryIntent]?: string[] } = {};

    // 1. 基于关键词和模式匹配计算分数
    Object.entries(this.patterns).forEach(([intentType, pattern]) => {
      let score = 0;
      const intentReasons: string[] = [];

      // 关键词匹配
      const matchedKeywords = pattern.keywords.filter(kw => queryLower.includes(kw.toLowerCase()));
      if (matchedKeywords.length > 0) {
        score += matchedKeywords.length * 0.3;
        intentReasons.push(`包含关键词: ${matchedKeywords.join(', ')}`);
      }

      // 模式匹配
      const matchedPatterns = pattern.patterns.filter(p => p.test(queryLower));
      if (matchedPatterns.length > 0) {
        score += matchedPatterns.length * 0.5;
        intentReasons.push(`匹配模式: ${matchedPatterns.length}个`);
      }

      // 应用权重
      score *= pattern.weight;

      if (score > 0) {
        scores[intentType as QueryIntent] = score;
        reasons[intentType as QueryIntent] = intentReasons;
      }
    });

    // 2. 上下文感知（基于对话历史）
    if (conversationHistory && conversationHistory.length > 0) {
      const contextIntent = this.detectContextIntent(conversationHistory);
      if (contextIntent && scores[contextIntent]) {
        scores[contextIntent]! += 0.2; // 上下文加分
        reasons[contextIntent]?.push('上下文相关');
      }
    }

    // 3. 复杂性分析
    const complexity = this.analyzeComplexity(query);
    const context = {
      hasError: /error|fail|problem|issue|异常|错误|问题/.test(queryLower),
      hasCommand: /show|set|config|enable|disable|nv|command/.test(queryLower),
      hasParameter: /\d+|[a-f0-9]{2}:[a-f0-9]{2}|\/\d+/.test(query),
      complexity
    };

    // 4. 选择最高分的意图
    const sortedIntents = Object.entries(scores)
      .sort(([, a], [, b]) => (b || 0) - (a || 0));

    if (sortedIntents.length === 0) {
      return {
        intent: 'general',
        confidence: 0.5,
        reasons: ['无法识别具体意图'],
        context
      };
    }

    const [topIntent, topScore] = sortedIntents[0];
    const maxScore = Math.max(...Object.values(scores).filter(s => s !== undefined) as number[]);
    const confidence = Math.min(1, (topScore || 0) / Math.max(maxScore, 1));

    // 5. 检测多步骤查询（子意图）
    const subIntents = this.detectSubIntents(query, topIntent as QueryIntent, sortedIntents);

    return {
      intent: topIntent as QueryIntent,
      confidence,
      reasons: reasons[topIntent as QueryIntent] || [],
      subIntents: subIntents.length > 0 ? subIntents : undefined,
      context
    };
  }

  /**
   * 基于对话历史检测上下文意图
   */
  private detectContextIntent(history: string[]): QueryIntent | null {
    if (history.length === 0) return null;

    const recentContext = history.slice(-2).join(' ').toLowerCase();

    if (/error|fail|problem|issue|错误|问题|失败/.test(recentContext)) return 'troubleshoot';
    if (/configure|setup|enable|disable|配置|设置|启用|禁用/.test(recentContext)) return 'configuration';
    if (/why|reason|explain|为什么|原因|解释/.test(recentContext)) return 'explanation';
    if (/performance|optimize|improve|性能|优化|提升/.test(recentContext)) return 'performance';

    return null;
  }

  /**
   * 分析查询复杂性
   */
  private analyzeComplexity(query: string): 'simple' | 'medium' | 'complex' {
    const length = query.length;
    const wordCount = query.split(/\s+/).length;
    const hasMultipleConditions = /和|或|同时|另外|此外/.test(query);
    const hasParameters = /\d+|[a-f0-9]{2}:[a-f0-9]{2}|\/\d+/.test(query);

    let complexity = 0;
    if (length > 50) complexity++;
    if (wordCount > 10) complexity++;
    if (hasMultipleConditions) complexity++;
    if (hasParameters) complexity++;

    if (complexity >= 3) return 'complex';
    if (complexity >= 1) return 'medium';
    return 'simple';
  }

  /**
   * 检测多步骤查询（子意图）
   */
  private detectSubIntents(
    query: string,
    mainIntent: QueryIntent,
    sortedIntents: Array<[string, number | undefined]>
  ): QueryIntent[] {
    const subIntents: QueryIntent[] = [];

    // 如果有多个高分意图，可能是多步骤查询
    const topThree = sortedIntents.slice(0, 3);
    const maxScore = topThree[0][1] || 0;

    for (let i = 1; i < topThree.length; i++) {
      const [intent, score] = topThree[i];
      // 如果第二、三个意图的分数在最高分的60%以上，认为是子意图
      if ((score || 0) > maxScore * 0.6) {
        subIntents.push(intent as QueryIntent);
      }
    }

    return subIntents;
  }

  /**
   * 获取意图的检索参数
   */
  getRetrievalParams(intent: QueryIntent, confidence: number) {
    const baseParams = {
      limit: 20,
      rerankCandidates: 60,
      minScore: 0.3
    };

    // 根据意图调整参数
    const adjustments: { [key in QueryIntent]?: Partial<typeof baseParams> } = {
      command: { minScore: 0.25 },           // 命令查询降低阈值
      troubleshoot: { limit: 25, minScore: 0.2 }, // 故障排查需要更多结果
      configuration: { minScore: 0.28 },    // 配置查询
      explanation: { limit: 15, minScore: 0.35 }, // 概念解释需要高相关性
      comparison: { limit: 25, minScore: 0.3 },   // 对比需要更多结果
      performance: { minScore: 0.3 },       // 性能优化
      best_practice: { minScore: 0.32 },    // 最佳实践
      verification: { minScore: 0.25 },     // 验证检查
      question: { minScore: 0.35 },         // 问题查询
      general: { minScore: 0.35 }           // 通用查询
    };

    const adjustment = adjustments[intent] || {};

    // 根据置信度进一步调整
    if (confidence < 0.5) {
      adjustment.minScore = (adjustment.minScore || baseParams.minScore) - 0.05;
    } else if (confidence > 0.8) {
      adjustment.minScore = (adjustment.minScore || baseParams.minScore) + 0.05;
    }

    return { ...baseParams, ...adjustment };
  }

  /**
   * 生成意图描述（用于调试）
   */
  describeIntent(result: IntentResult): string {
    const lines = [
      `意图: ${result.intent}`,
      `置信度: ${(result.confidence * 100).toFixed(1)}%`,
      `原因: ${result.reasons.join('; ')}`
    ];

    if (result.subIntents && result.subIntents.length > 0) {
      lines.push(`子意图: ${result.subIntents.join(', ')}`);
    }

    if (result.context) {
      const ctx = result.context;
      const ctxItems = [];
      if (ctx.hasError) ctxItems.push('包含错误信息');
      if (ctx.hasCommand) ctxItems.push('包含命令');
      if (ctx.hasParameter) ctxItems.push('包含参数');
      if (ctx.complexity) ctxItems.push(`复杂度: ${ctx.complexity}`);
      if (ctxItems.length > 0) {
        lines.push(`上下文: ${ctxItems.join(', ')}`);
      }
    }

    return lines.join('\n');
  }
}

export const advancedIntentDetector = new AdvancedIntentDetector();
