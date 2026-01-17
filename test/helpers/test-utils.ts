/**
 * 测试工具函数
 */

import { expect } from 'vitest';

/**
 * 等待条件满足
 */
export const waitFor = async (
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await Promise.resolve(condition());
    if (result) {
      return;
    }
    await sleep(interval);
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
};

/**
 * 睡眠函数
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * 创建测试环境
 */
export const createTestEnvironment = () => {
  const cleanup: (() => void | Promise<void>)[] = [];

  return {
    /**
     * 注册清理函数
     */
    onCleanup: (fn: () => void | Promise<void>) => {
      cleanup.push(fn);
    },

    /**
     * 执行所有清理
     */
    cleanup: async () => {
      for (const fn of cleanup.reverse()) {
        await fn();
      }
      cleanup.length = 0;
    }
  };
};

/**
 * 断言：验证是否为有效的 Embedding
 */
export const expectToBeValidEmbedding = (embedding: any) => {
  expect(embedding).toBeInstanceOf(Array);
  expect(embedding.length).toBeGreaterThan(0);
  expect(embedding.every((n: any) => typeof n === 'number')).toBe(true);
  expect(embedding.every((n: number) => !isNaN(n))).toBe(true);
};

/**
 * 断言：验证是否为有效的文档
 */
export const expectToBeValidDocument = (doc: any) => {
  expect(doc).toBeDefined();
  expect(doc.id).toBeDefined();
  expect(typeof doc.id).toBe('string');
  expect(doc.name).toBeDefined();
  expect(typeof doc.name).toBe('string');
  expect(doc.uploadedAt).toBeDefined();
};

/**
 * 断言：验证是否为有效的 Chunk
 */
export const expectToBeValidChunk = (chunk: any) => {
  expect(chunk).toBeDefined();
  expect(chunk.id).toBeDefined();
  expect(typeof chunk.id).toBe('string');
  expect(chunk.documentId).toBeDefined();
  expect(chunk.content).toBeDefined();
  expect(typeof chunk.content).toBe('string');
  expect(chunk.chunkIndex).toBeDefined();
  expect(typeof chunk.chunkIndex).toBe('number');
};

/**
 * 断言：验证搜索结果
 */
export const expectToBeValidSearchResult = (result: any) => {
  expect(result).toBeDefined();
  expect(result.chunk).toBeDefined();
  expectToBeValidChunk(result.chunk);
  expect(result.score).toBeDefined();
  expect(typeof result.score).toBe('number');
  expect(result.score).toBeGreaterThanOrEqual(0);
  expect(result.score).toBeLessThanOrEqual(1);
};

/**
 * 断言：验证知识图谱实体
 */
export const expectToBeValidEntity = (entity: any, type: string) => {
  expect(entity).toBeDefined();
  expect(entity.name).toBeDefined();
  expect(typeof entity.name).toBe('string');
  expect(entity.source).toBeDefined();

  if (type === 'command') {
    expect(entity.category).toBeDefined();
  } else if (type === 'parameter') {
    expect(entity.type).toBeDefined();
  } else if (type === 'vendor' || type === 'function') {
    expect(entity.name.length).toBeGreaterThan(0);
  }
};

/**
 * 生成随机字符串
 */
export const randomString = (length: number = 10): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * 生成随机数字
 */
export const randomNumber = (min: number = 0, max: number = 100): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * 深度克隆对象
 */
export const deepClone = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

/**
 * 比较两个数组是否相等（忽略顺序）
 */
export const arrayEquals = (arr1: any[], arr2: any[]): boolean => {
  if (arr1.length !== arr2.length) return false;
  const sorted1 = [...arr1].sort();
  const sorted2 = [...arr2].sort();
  return sorted1.every((val, idx) => val === sorted2[idx]);
};

/**
 * 创建临时文件路径
 */
export const createTempPath = (prefix: string = 'test'): string => {
  return `/tmp/${prefix}-${Date.now()}-${randomString(8)}`;
};

/**
 * 模拟网络延迟
 */
export const simulateNetworkDelay = async (min: number = 100, max: number = 500): Promise<void> => {
  const delay = randomNumber(min, max);
  await sleep(delay);
};

/**
 * 捕获异步错误
 */
export const catchAsync = async <T>(
  fn: () => Promise<T>
): Promise<[Error | null, T | null]> => {
  try {
    const result = await fn();
    return [null, result];
  } catch (error) {
    return [error as Error, null];
  }
};

/**
 * 重试函数
 */
export const retry = async <T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delay: number = 1000
): Promise<T> => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await sleep(delay);
      }
    }
  }

  throw lastError;
};

/**
 * 测试性能
 */
export const measurePerformance = async <T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> => {
  const startTime = performance.now();
  const result = await fn();
  const duration = performance.now() - startTime;
  return { result, duration };
};

/**
 * 批量执行测试
 */
export const runInParallel = async <T>(
  tasks: (() => Promise<T>)[],
  concurrency: number = 5
): Promise<T[]> => {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const promise = task().then(result => {
      results.push(result);
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex(p => p === promise),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
};

/**
 * 创建 Mock 时间
 */
export const createMockTime = (timestamp: number = Date.now()) => {
  const original = Date.now;
  Date.now = () => timestamp;

  return {
    restore: () => {
      Date.now = original;
    },
    advance: (ms: number) => {
      timestamp += ms;
    },
    set: (newTimestamp: number) => {
      timestamp = newTimestamp;
    }
  };
};

/**
 * 验证 Mock 调用
 */
export const expectMockCalled = (mock: any, times?: number) => {
  if (times !== undefined) {
    expect(mock).toHaveBeenCalledTimes(times);
  } else {
    expect(mock).toHaveBeenCalled();
  }
};

/**
 * 验证 Mock 调用参数
 */
export const expectMockCalledWith = (mock: any, ...args: any[]) => {
  expect(mock).toHaveBeenCalledWith(...args);
};

/**
 * 清理测试数据
 */
export const cleanupTestData = async (paths: string[]) => {
  // 在实际实现中，这里会清理文件系统
  // 在测试中，我们使用 mock 文件系统，所以不需要实际清理
  return Promise.resolve();
};

/**
 * 创建测试上下文
 */
export const createTestContext = () => {
  const context: Record<string, any> = {};

  return {
    set: (key: string, value: any) => {
      context[key] = value;
    },
    get: (key: string) => {
      return context[key];
    },
    has: (key: string) => {
      return key in context;
    },
    clear: () => {
      Object.keys(context).forEach(key => delete context[key]);
    }
  };
};
