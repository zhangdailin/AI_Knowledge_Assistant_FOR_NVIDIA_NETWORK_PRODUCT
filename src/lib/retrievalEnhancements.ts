import { advancedKeywordExtractor } from './advancedKeywordExtractor';
import { enhancedNetworkKeywordExtractor } from './enhancedNetworkKeywordExtractor';

// 查询意图类型
export type QueryIntent = 'command' | 'question' | 'network_config' | 'general';

// 检索参数接口
export interface RetrievalParams {
  limit: number;
  rerankCandidates: number;
  minScore: number;
}

/**
 * 检测查询意图
 */
export function detectQueryIntent(query: string): QueryIntent {
  const queryLower = query.toLowerCase();
  
  // 检测网络配置意图（包含网络技术术语）
  const networkTechTerms = ['pfc', 'ecn', 'roce', 'qos', 'priority flow control', 'explicit congestion notification', 
                           'rdma', 'traffic control', 'congestion control', 'flow control'];
  const hasNetworkTerms = networkTechTerms.some(term => queryLower.includes(term.toLowerCase()));
  
  // 检测网络配置命令
  const networkConfigKeywords = ['配置', 'configure', '设置', 'setup', 'enable', 'disable'];
  const hasNetworkConfig = networkConfigKeywords.some(keyword => queryLower.includes(keyword));
  
  if (hasNetworkTerms && hasNetworkConfig) {
    return 'network_config';
  }
  
  // 检测命令意图（包含命令关键词）
  const commandKeywords = ['如何', '怎么', '怎样', '命令', '配置', '设置', 'show', 'config', 'how to', 'how do'];
  if (commandKeywords.some(keyword => queryLower.includes(keyword))) {
    return 'command';
  }
  
  // 检测问题意图（包含疑问词）
  const questionKeywords = ['什么', '哪个', '哪些', '为什么', '是否', '能否', 'what', 'which', 'why', 'when', 'where'];
  if (questionKeywords.some(keyword => queryLower.includes(keyword))) {
    return 'question';
  }
  
  return 'general';
}

/**
 * 根据意图获取检索参数
 */
export function getRetrievalParamsForIntent(intent: QueryIntent): RetrievalParams {
  switch (intent) {
    case 'command':
      return {
        limit: 20,
        rerankCandidates: 60,
        minScore: 0.3
      };
    case 'question':
      return {
        limit: 20,
        rerankCandidates: 60,
        minScore: 0.4
      };
    case 'network_config':
      return {
        limit: 20,
        rerankCandidates: 60,
        minScore: 0.25  // 降低网络配置的阈值，确保能找到技术文档
      };
    default:
      return {
        limit: 20,
        rerankCandidates: 60,
        minScore: 0.35
      };
  }
}

/**
 * 基于历史对话增强查询
 */
export function enhanceQueryWithHistory(query: string, conversationHistory: string[]): string {
  if (conversationHistory.length === 0) {
    return query;
  }
  
  // 提取最近的历史对话中的关键词
  const recentHistory = conversationHistory.slice(-3).join(' ');
  
  // 简单增强：将查询与历史上下文结合
  return `${query} ${recentHistory}`.trim();
}

/**
 * 提取核心查询（增强版）
 */
export function extractCoreQueryEnhanced(query: string, intent: QueryIntent): string {
  // 检测是否为网络配置相关查询
  const queryLower = query.toLowerCase();
  const isNetworkConfig = queryLower.includes('pfc') || queryLower.includes('ecn') || 
                         queryLower.includes('roce') || queryLower.includes('qos') ||
                         queryLower.includes('配置') || queryLower.includes('configure');
  
  if (isNetworkConfig) {
    // 使用专门的网络关键词提取器
    return enhancedNetworkKeywordExtractor.generateEnhancedQuery(query);
  } else {
    // 使用通用的高级关键词提取器
    const extracted = advancedKeywordExtractor.extractKeywords(query);
    return advancedKeywordExtractor.generateEnhancedQuery(query);
  }
}

/**
 * 去重和合并chunks
 */
export function deduplicateAndMergeChunks(
  results: Array<{ chunk: any; score: number }>,
  similarityThreshold: number = 0.85
): Array<{ chunk: any; score: number }> {
  const seen = new Set<string>();
  const deduplicated: Array<{ chunk: any; score: number }> = [];
  
  for (const result of results) {
    const chunkId = result.chunk.id;
    if (!seen.has(chunkId)) {
      seen.add(chunkId);
      deduplicated.push(result);
    }
  }
  
  return deduplicated;
}

/**
 * 计算自适应阈值
 */
export function calculateAdaptiveThreshold(
  results: Array<{ chunk: any; score: number }>,
  baseThreshold: number
): number {
  if (results.length === 0) {
    return baseThreshold;
  }
  
  // 计算分数的统计信息
  const scores = results.map(r => r.score);
  const maxScore = Math.max(...scores);
  const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  
  // 自适应阈值：基于最高分数和平均分数
  const adaptiveThreshold = Math.max(
    baseThreshold,
    Math.min(maxScore * 0.7, avgScore * 1.2)
  );
  
  return adaptiveThreshold;
}

