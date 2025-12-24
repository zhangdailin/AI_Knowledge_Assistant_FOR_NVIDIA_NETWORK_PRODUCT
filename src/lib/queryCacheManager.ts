/**
 * 查询结果缓存管理器
 * 支持TTL的查询结果缓存，减少重复查询的延迟
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class QueryCacheManager {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5分钟

  /**
   * 生成缓存键
   */
  private generateKey(query: string, intent: string, params: Record<string, any>): string {
    const key = `${query}|${intent}|${JSON.stringify(params)}`;
    return Buffer.from(key).toString('base64');
  }

  /**
   * 获取缓存
   */
  get<T>(query: string, intent: string, params: Record<string, any>): T | null {
    const key = this.generateKey(query, intent, params);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // 检查TTL
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * 设置缓存
   */
  set<T>(query: string, intent: string, params: Record<string, any>, data: T, ttl?: number): void {
    const key = this.generateKey(query, intent, params);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.DEFAULT_TTL
    });
  }

  /**
   * 清除过期缓存
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计
   */
  getStats(): { size: number; entries: number } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.values()).reduce((sum, entry) => sum + 1, 0)
    };
  }
}

export const queryCacheManager = new QueryCacheManager();

// 定期清理过期缓存（每5分钟）
setInterval(() => {
  queryCacheManager.cleanup();
}, 5 * 60 * 1000);
