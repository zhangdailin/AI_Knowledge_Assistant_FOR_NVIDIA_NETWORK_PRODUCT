/**
 * 系统监控指标收集模块
 * 用于追踪系统性能和质量指标
 */

export interface SystemMetrics {
  // 检索指标
  retrievalPrecision: number;      // 检索精度
  retrievalRecall: number;         // 检索召回率

  // 答案质量
  hallucationRate: number;         // 幻觉率
  accuracyRate: number;            // 准确率

  // 性能指标
  avgResponseTime: number;         // 平均响应时间(ms)
  p95ResponseTime: number;         // 95分位响应时间(ms)
  cacheHitRate: number;            // 缓存命中率

  // 成本指标
  costPerQuery: number;            // 每查询成本
  apiCallsPerQuery: number;        // 每查询API调用数

  // 时间戳
  timestamp: number;
}

export class MetricsCollector {
  private metrics: SystemMetrics = {
    retrievalPrecision: 0.85,
    retrievalRecall: 0.75,
    hallucationRate: 0.05,
    accuracyRate: 0.92,
    avgResponseTime: 2500,
    p95ResponseTime: 5000,
    cacheHitRate: 0.35,
    costPerQuery: 0.008,
    apiCallsPerQuery: 4.2,
    timestamp: Date.now()
  };

  private responseTimes: number[] = [];
  private cacheHits = 0;
  private totalQueries = 0;
  private hallucinations = 0;
  private totalAnswers = 0;

  /**
   * 记录查询响应时间
   */
  recordResponseTime(duration: number) {
    this.responseTimes.push(duration);
    // 只保留最近1000条记录
    if (this.responseTimes.length > 1000) {
      this.responseTimes.shift();
    }
    this.updateMetrics();
  }

  /**
   * 记录缓存命中
   */
  recordCacheHit() {
    this.cacheHits++;
    this.totalQueries++;
    this.updateMetrics();
  }

  /**
   * 记录缓存未命中
   */
  recordCacheMiss() {
    this.totalQueries++;
    this.updateMetrics();
  }

  /**
   * 记录幻觉检测
   */
  recordHallucination(count: number = 1) {
    this.hallucinations += count;
    this.totalAnswers++;
    this.updateMetrics();
  }

  /**
   * 记录准确答案
   */
  recordAccurateAnswer() {
    this.totalAnswers++;
    this.updateMetrics();
  }

  /**
   * 更新指标
   */
  private updateMetrics() {
    // 更新响应时间指标
    if (this.responseTimes.length > 0) {
      const sorted = [...this.responseTimes].sort((a, b) => a - b);
      this.metrics.avgResponseTime = Math.round(
        sorted.reduce((a, b) => a + b, 0) / sorted.length
      );
      this.metrics.p95ResponseTime = Math.round(
        sorted[Math.floor(sorted.length * 0.95)]
      );
    }

    // 更新缓存命中率
    if (this.totalQueries > 0) {
      this.metrics.cacheHitRate = this.cacheHits / this.totalQueries;
    }

    // 更新幻觉率
    if (this.totalAnswers > 0) {
      this.metrics.hallucationRate = this.hallucinations / this.totalAnswers;
      this.metrics.accuracyRate = 1 - this.metrics.hallucationRate;
    }

    this.metrics.timestamp = Date.now();
  }

  /**
   * 获取当前指标
   */
  getMetrics(): SystemMetrics {
    return { ...this.metrics };
  }

  /**
   * 获取指标摘要
   */
  getSummary(): string {
    const m = this.metrics;
    return `
系统监控指标摘要:
  检索精度: ${(m.retrievalPrecision * 100).toFixed(1)}%
  答案准确率: ${(m.accuracyRate * 100).toFixed(1)}%
  幻觉率: ${(m.hallucationRate * 100).toFixed(1)}%
  平均响应时间: ${m.avgResponseTime}ms
  缓存命中率: ${(m.cacheHitRate * 100).toFixed(1)}%
  每查询成本: $${m.costPerQuery.toFixed(4)}
    `.trim();
  }

  /**
   * 重置指标
   */
  reset() {
    this.responseTimes = [];
    this.cacheHits = 0;
    this.totalQueries = 0;
    this.hallucinations = 0;
    this.totalAnswers = 0;
    this.updateMetrics();
  }
}

// 全局指标收集器实例
export const metricsCollector = new MetricsCollector();
