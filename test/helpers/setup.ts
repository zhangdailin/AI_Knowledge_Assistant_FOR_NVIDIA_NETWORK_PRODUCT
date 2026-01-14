/**
 * 全局测试设置
 * 在所有测试运行前执行
 */

import { beforeAll, afterAll, afterEach } from 'vitest';
import { resetAllMocks } from './mock-factory';

// 全局设置
beforeAll(() => {
  // 设置测试环境变量
  process.env.NODE_ENV = 'test';

  // 禁用控制台输出（可选）
  if (process.env.SILENT_TESTS === 'true') {
    global.console = {
      ...console,
      log: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {}
    };
  }
});

// 每个测试后清理
afterEach(() => {
  // 重置所有 mocks
  resetAllMocks();
});

// 全局清理
afterAll(() => {
  // 清理测试数据
});

// 导出空对象以满足 TypeScript 模块要求
export {};
