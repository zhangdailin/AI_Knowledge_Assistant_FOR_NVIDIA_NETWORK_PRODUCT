/**
 * 分级降级策略 - 当API失败时优雅降级
 * 根据失败次数和类型，自动选择合适的模型和响应策略
 */

export enum DegradationLevel {
  NORMAL = 'NORMAL',           // 正常：使用主力模型
  DEGRADED = 'DEGRADED',       // 降级：使用备用模型
  LIGHTWEIGHT = 'LIGHTWEIGHT', // 轻量：使用轻量级模型
  FALLBACK = 'FALLBACK'        // 回退：使用模拟回答
}

export interface DegradationState {
  level: DegradationLevel;
  failureCount: number;
  lastFailureTime: number;
  failureReason?: string;
}

export class DegradationStrategy {
  private failureThresholds = {
    [DegradationLevel.NORMAL]: 0,
    [DegradationLevel.DEGRADED]: 2,
    [DegradationLevel.LIGHTWEIGHT]: 4,
    [DegradationLevel.FALLBACK]: 6
  };

  private recoveryTimeout = 5 * 60 * 1000; // 5分钟后尝试恢复
  private state: DegradationState = {
    level: DegradationLevel.NORMAL,
    failureCount: 0,
    lastFailureTime: 0
  };

  /**
   * 记录失败并更新降级级别
   */
  recordFailure(reason?: string): void {
    this.state.failureCount++;
    this.state.lastFailureTime = Date.now();
    this.state.failureReason = reason;
    this.updateDegradationLevel();
  }

  /**
   * 记录成功并逐步恢复
   */
  recordSuccess(): void {
    if (this.state.failureCount > 0) {
      this.state.failureCount = Math.max(0, this.state.failureCount - 1);
    }
    this.updateDegradationLevel();
  }

  /**
   * 获取当前降级级别
   */
  getCurrentLevel(): DegradationLevel {
    // 检查是否可以恢复到更高级别
    if (this.state.level !== DegradationLevel.NORMAL) {
      const timeSinceFailure = Date.now() - this.state.lastFailureTime;
      if (timeSinceFailure > this.recoveryTimeout) {
        this.state.failureCount = Math.max(0, this.state.failureCount - 2);
        this.updateDegradationLevel();
      }
    }
    return this.state.level;
  }

  /**
   * 获取推荐的模型
   */
  getRecommendedModel(level: DegradationLevel): string {
    switch (level) {
      case DegradationLevel.NORMAL:
        return 'Qwen/Qwen3-32B';
      case DegradationLevel.DEGRADED:
        return 'Qwen/Qwen2.5-32B-Instruct';
      case DegradationLevel.LIGHTWEIGHT:
        return 'Qwen/Qwen2.5-7B-Instruct';
      case DegradationLevel.FALLBACK:
        return 'mock';
      default:
        return 'Qwen/Qwen3-32B';
    }
  }

  /**
   * 获取降级状态
   */
  getState(): DegradationState {
    return { ...this.state };
  }

  /**
   * 重置降级状态
   */
  reset(): void {
    this.state = {
      level: DegradationLevel.NORMAL,
      failureCount: 0,
      lastFailureTime: 0
    };
  }

  private updateDegradationLevel(): void {
    for (const [level, threshold] of Object.entries(this.failureThresholds)) {
      if (this.state.failureCount >= threshold) {
        this.state.level = level as DegradationLevel;
      }
    }
  }
}

export const degradationStrategy = new DegradationStrategy();
