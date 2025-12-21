// 查询意图类型
export type QueryIntent = 'command' | 'question' | 'general';

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
  // 移除常见的疑问词和停用词
  const stopWords = ['如何', '怎么', '怎样', '什么', '哪个', '哪些', '为什么', '是否', '能否', '可以', '应该',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
  
  const words = query
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.includes(w));
  
  return words.join(' ') || query;
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

