import { advancedKeywordExtractor } from './advancedKeywordExtractor';
import { enhancedNetworkKeywordExtractor } from './enhancedNetworkKeywordExtractor';
import { advancedIntentDetector, type QueryIntent as AdvancedQueryIntent, type IntentResult } from './advancedIntentDetector';
import { Chunk } from './types';

// 向后兼容：保留旧的意图类型
export type QueryIntent = 'command' | 'question' | 'network_config' | 'general' | AdvancedQueryIntent;

// 检索参数接口
export interface RetrievalParams {
  limit: number;
  rerankCandidates: number;
  minScore: number;
}

/**
 * 获取完整的意图识别结果（包括置信度等）
 */
export function detectQueryIntentAdvanced(query: string, conversationHistory?: string[]): IntentResult {
  return advancedIntentDetector.detect(query, conversationHistory);
}

/**
 * 根据意图获取检索参数
 */
export function getRetrievalParamsForIntent(intent: QueryIntent): RetrievalParams {
  // 使用高级意图检测器的参数调整
  const params = advancedIntentDetector.getRetrievalParams(intent as AdvancedQueryIntent, 0.7);
  return {
    limit: params.limit,
    rerankCandidates: params.rerankCandidates,
    minScore: params.minScore
  };
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
                         queryLower.includes('bgp') || queryLower.includes('routing') ||
                         queryLower.includes('配置') || queryLower.includes('configure');
  
  if (isNetworkConfig) {
    // 使用专门的网络关键词提取器
    return enhancedNetworkKeywordExtractor.generateEnhancedQuery(query);
  } else {
    // 使用通用的高级关键词提取器
    return advancedKeywordExtractor.generateEnhancedQuery(query);
  }
}

/**
 * 去重和合并chunks
 */
export function deduplicateAndMergeChunks(
  results: Array<{ chunk: Chunk; score: number }>,
  similarityThreshold: number = 0.85
): Array<{ chunk: Chunk; score: number }> {
  const seen = new Set<string>();
  const deduplicated: Array<{ chunk: Chunk; score: number }> = [];
  
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
  results: Array<{ chunk: Chunk; score: number }>,
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

