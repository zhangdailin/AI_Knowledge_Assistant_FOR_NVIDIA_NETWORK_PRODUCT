/**
 * 增强型意图分类器
 * 支持多意图识别、置信度评分和上下文加成
 */

export interface QueryIntent {
  isConfig: boolean;
  isTroubleshoot: boolean;
  isShow: boolean;
  isConcept: boolean;
  isComparison: boolean;
  isListRequest: boolean;
}

export interface IntentScore {
  type: keyof QueryIntent;
  score: number;
  signals: string[];
}

export interface IntentResult {
  primary: QueryIntent;
  secondary: QueryIntent | null;
  confidence: number;
  multiIntent: boolean;
  intents: IntentScore[];
  dominantType: keyof QueryIntent | null;
}

type IntentType = 'config' | 'troubleshoot' | 'show' | 'concept' | 'comparison' | 'listRequest';

const INTENT_PATTERNS: Record<IntentType, RegExp[]> = {
  config: [
    /配置|设置|安装|部署|步骤|how to|configure|configuration|setup/i,
    /如何.{0,6}(启用|禁用|开启|关闭|添加|删除|创建|修改)/i,
    /怎么.{0,6}(配置|设置|实现|搭建)/i,
    /请.{0,4}(配置|设置|启用)/i,
    /nv\s+set/i,
    /enable|disable|add|remove|create/i
  ],
  troubleshoot: [
    /故障|异常|错误|问题|排错|debug|troubleshoot|error|fail|issue/i,
    /不工作|无法|cannot|unable|doesn't work|does not work/i,
    /为什么.{0,6}不|why.{0,6}not/i,
    /报错|crash|hang|卡住|失败|超时/i,
    /排查|诊断|diagnose|investigate/i
  ],
  show: [
    /查看|查询|显示|状态|show|display|list|get|status|state/i,
    /nv\s+show/i,
    /当前.{0,4}是什么/i,
    /检查|verify|check|view/i,
    /确认|confirm/i
  ],
  concept: [
    /什么是|含义|定义|原理|概念|overview|introduction|what is|definition/i,
    /解释|explain|描述|describe/i,
    /有什么用|作用|purpose|功能是什么/i,
    /为什么要|why\s+(do|use|need)/i,
    /工作原理|how\s+(does|do)\s+\w+\s+work/i
  ],
  comparison: [
    /区别|差异|不同|对比|比较|vs|versus|compared to/i,
    /哪个更好|which is better|优缺点|pros and cons/i,
    /相同|相似|similar|same/i,
    /选择.{0,4}还是|should I use/i,
    /和.{1,10}(区别|对比|比较)/i
  ],
  listRequest: [
    /有哪些|列出|列举|所有|全部|list all/i,
    /支持哪些|都有什么|有多少/i,
    /多少种|how many|what are the/i,
    /所有.{0,6}(命令|选项|参数|功能)/i
  ]
};

const INTENT_WEIGHTS: Record<IntentType, number> = {
  config: 1.0,
  troubleshoot: 1.1,      // 故障优先级高
  show: 0.9,
  concept: 1.0,
  comparison: 0.95,
  listRequest: 0.85
};

const TYPE_TO_KEY: Record<IntentType, keyof QueryIntent> = {
  config: 'isConfig',
  troubleshoot: 'isTroubleshoot',
  show: 'isShow',
  concept: 'isConcept',
  comparison: 'isComparison',
  listRequest: 'isListRequest'
};

/**
 * 增强型意图分类器
 */
export class IntentClassifier {
  private patterns: Map<IntentType, RegExp[]>;
  private weights: Map<IntentType, number>;

  constructor() {
    this.patterns = new Map(Object.entries(INTENT_PATTERNS) as [IntentType, RegExp[]][]);
    this.weights = new Map(Object.entries(INTENT_WEIGHTS) as [IntentType, number][]);
  }

  /**
   * 分类查询意图
   */
  classify(query: string): IntentResult {
    const scores: IntentScore[] = [];
    const queryLower = query.toLowerCase();

    // 遍历所有意图类型
    for (const [type, patterns] of this.patterns) {
      const signals: string[] = [];
      let score = 0;

      // 检查每个模式
      for (const pattern of patterns) {
        const match = query.match(pattern);
        if (match) {
          signals.push(match[0]);
          score += 0.25; // 每个匹配加 0.25
        }
      }

      // 应用意图权重
      const weight = this.weights.get(type) || 1.0;
      score *= weight;

      // 添加上下文加成
      score += this.computeContextBonus(type, query, queryLower);

      if (score > 0) {
        scores.push({
          type: TYPE_TO_KEY[type],
          score: Math.min(score, 1.0),
          signals
        });
      }
    }

    // 按分数排序
    scores.sort((a, b) => b.score - a.score);

    // 构建结果
    const primary = this.buildIntent(scores[0]?.type);
    const secondary = scores[1]?.score > 0.3 ? this.buildIntent(scores[1]?.type) : null;
    const multiIntent = scores.filter(s => s.score > 0.4).length > 1;
    const dominantType = scores[0]?.type || null;

    return {
      primary,
      secondary,
      confidence: scores[0]?.score || 0,
      multiIntent,
      intents: scores,
      dominantType
    };
  }

  /**
   * 计算上下文加成
   */
  private computeContextBonus(type: IntentType, query: string, queryLower: string): number {
    let bonus = 0;

    // 技术术语存在时的加成
    const hasTechTerms = /\b(bgp|ospf|evpn|vxlan|mlag|vrrp|lacp|bond|vlan|acl)\b/i.test(query);
    if (hasTechTerms) {
      if (type === 'config' || type === 'troubleshoot') {
        bonus += 0.1;
      }
    }

    // 代码块存在时的加成
    if (/```/.test(query)) {
      if (type === 'config' || type === 'troubleshoot') {
        bonus += 0.15;
      }
    }

    // 命令语法存在时的加成
    if (/nv\s+(set|show|config|unset)/i.test(query)) {
      if (type === 'config' || type === 'show') {
        bonus += 0.2;
      }
    }

    // 问号存在时的加成
    if (/[?？]/.test(query)) {
      if (type === 'concept' || type === 'comparison') {
        bonus += 0.1;
      }
    }

    // 列表标记存在时的加成
    if (/^\d+\.|^[-*]|^[一二三四五六七八九十]/m.test(query)) {
      if (type === 'config') {
        bonus += 0.1;
      }
    }

    // 错误信息格式的加成
    if (/error:|failed:|exception:|错误[:：]/i.test(query)) {
      if (type === 'troubleshoot') {
        bonus += 0.2;
      }
    }

    return bonus;
  }

  /**
   * 构建意图对象
   */
  private buildIntent(type?: keyof QueryIntent): QueryIntent {
    return {
      isConfig: type === 'isConfig',
      isTroubleshoot: type === 'isTroubleshoot',
      isShow: type === 'isShow',
      isConcept: type === 'isConcept',
      isComparison: type === 'isComparison',
      isListRequest: type === 'isListRequest'
    };
  }

  /**
   * 快速检查是否为配置类查询
   */
  isConfigQuery(query: string): boolean {
    const result = this.classify(query);
    return result.primary.isConfig && result.confidence > 0.3;
  }

  /**
   * 快速检查是否为故障排查查询
   */
  isTroubleshootQuery(query: string): boolean {
    const result = this.classify(query);
    return result.primary.isTroubleshoot && result.confidence > 0.3;
  }

  /**
   * 快速检查是否为概念类查询
   */
  isConceptQuery(query: string): boolean {
    const result = this.classify(query);
    return result.primary.isConcept && result.confidence > 0.3;
  }

  /**
   * 获取查询的复杂度评分 (0-1)
   */
  getQueryComplexity(query: string): number {
    if (!query) return 0;

    let complexity = 0;

    // 1. 长度因子
    const lengthScore = Math.min(query.length / 100, 1) * 0.25;
    complexity += lengthScore;

    // 2. 技术术语密度
    const techTerms = query.match(/\b(bgp|ospf|evpn|vxlan|mlag|vrrp|lacp|bond|vlan|vrf|acl|qos|bfd|ecmp)\b/gi) || [];
    const techScore = Math.min(techTerms.length / 3, 1) * 0.25;
    complexity += techScore;

    // 3. 多实体检测
    const entities = new Set(techTerms.map(t => t.toLowerCase()));
    if (entities.size >= 2) {
      complexity += 0.2;
    }

    // 4. 多意图检测
    const intentResult = this.classify(query);
    if (intentResult.multiIntent) {
      complexity += 0.15;
    }

    // 5. 复合句检测
    if (/和|以及|同时|另外|还有|并且|而且/.test(query)) {
      complexity += 0.15;
    }

    return Math.min(complexity, 1);
  }
}

// 导出单例实例
export const intentClassifier = new IntentClassifier();

// 兼容旧版 inferQueryIntent 函数
export function inferQueryIntent(query: string): QueryIntent {
  return intentClassifier.classify(query).primary;
}

// 导出增强版分类函数
export function classifyQueryIntent(query: string): IntentResult {
  return intentClassifier.classify(query);
}
