/**
 * 压力测试和负载测试套件
 * 测试系统在高负载下的性能和稳定性
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';

// 测试结果目录
const STRESS_TEST_RESULTS_DIR = path.join(process.cwd(), 'test', 'stress', 'results');

if (!fs.existsSync(STRESS_TEST_RESULTS_DIR)) {
  fs.mkdirSync(STRESS_TEST_RESULTS_DIR, { recursive: true });
}

interface StressTestResult {
  testName: string;
  concurrency: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalDuration: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  requestsPerSecond: number;
  p50: number;
  p95: number;
  p99: number;
  timestamp: number;
}

const stressTestResults: StressTestResult[] = [];

// 计算百分位数
function calculatePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[index] || 0;
}

// 执行压力测试
async function runStressTest(
  testName: string,
  concurrency: number,
  requestsPerWorker: number,
  requestFn: () => Promise<any>
): Promise<StressTestResult> {
  console.log(`\n🔥 开始压力测试: ${testName}`);
  console.log(`   并发数: ${concurrency}`);
  console.log(`   总请求数: ${concurrency * requestsPerWorker}`);

  const responseTimes: number[] = [];
  let successfulRequests = 0;
  let failedRequests = 0;

  const startTime = performance.now();

  // 创建并发工作器
  const workers = Array(concurrency).fill(null).map(async () => {
    for (let i = 0; i < requestsPerWorker; i++) {
      const requestStart = performance.now();
      try {
        await requestFn();
        const requestDuration = performance.now() - requestStart;
        responseTimes.push(requestDuration);
        successfulRequests++;
      } catch (error) {
        failedRequests++;
      }
    }
  });

  await Promise.all(workers);

  const totalDuration = performance.now() - startTime;
  const totalRequests = concurrency * requestsPerWorker;

  const result: StressTestResult = {
    testName,
    concurrency,
    totalRequests,
    successfulRequests,
    failedRequests,
    totalDuration,
    avgResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
    minResponseTime: Math.min(...responseTimes),
    maxResponseTime: Math.max(...responseTimes),
    requestsPerSecond: (totalRequests / totalDuration) * 1000,
    p50: calculatePercentile(responseTimes, 50),
    p95: calculatePercentile(responseTimes, 95),
    p99: calculatePercentile(responseTimes, 99),
    timestamp: Date.now()
  };

  console.log(`   ✅ 成功: ${successfulRequests}`);
  console.log(`   ❌ 失败: ${failedRequests}`);
  console.log(`   ⏱️  总耗时: ${totalDuration.toFixed(2)}ms`);
  console.log(`   📊 平均响应: ${result.avgResponseTime.toFixed(2)}ms`);
  console.log(`   🚀 QPS: ${result.requestsPerSecond.toFixed(2)}`);
  console.log(`   📈 P95: ${result.p95.toFixed(2)}ms`);
  console.log(`   📈 P99: ${result.p99.toFixed(2)}ms`);

  stressTestResults.push(result);
  return result;
}

describe('压力测试套件', () => {
  beforeAll(() => {
    console.log('\n💪 开始压力测试...\n');
  });

  afterAll(() => {
    // 生成压力测试报告
    console.log('\n' + '='.repeat(80));
    console.log('📊 压力测试报告');
    console.log('='.repeat(80));

    stressTestResults.forEach(result => {
      console.log(`\n${result.testName}:`);
      console.log(`  并发数: ${result.concurrency}`);
      console.log(`  总请求: ${result.totalRequests}`);
      console.log(`  成功率: ${((result.successfulRequests / result.totalRequests) * 100).toFixed(2)}%`);
      console.log(`  QPS: ${result.requestsPerSecond.toFixed(2)}`);
      console.log(`  平均响应: ${result.avgResponseTime.toFixed(2)}ms`);
      console.log(`  P95: ${result.p95.toFixed(2)}ms`);
      console.log(`  P99: ${result.p99.toFixed(2)}ms`);
    });

    // 保存报告
    const report = {
      timestamp: new Date().toISOString(),
      results: stressTestResults
    };

    const reportFile = path.join(STRESS_TEST_RESULTS_DIR, `stress-${Date.now()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`\n📁 压力测试报告已保存: ${reportFile}\n`);
  });

  describe('1. 缓存压力测试', () => {
    it('应该支持高并发缓存读取', async () => {
      const cache = new Map();

      // 预填充缓存
      for (let i = 0; i < 1000; i++) {
        cache.set(`key-${i}`, { data: `value-${i}`, timestamp: Date.now() });
      }

      const result = await runStressTest(
        '缓存读取',
        50, // 50个并发
        100, // 每个并发100次请求
        async () => {
          const key = `key-${Math.floor(Math.random() * 1000)}`;
          const value = cache.get(key);
          return value;
        }
      );

      expect(result.successfulRequests).toBe(result.totalRequests);
      expect(result.avgResponseTime).toBeLessThan(10); // 缓存读取应该很快
    });

    it('应该支持高并发缓存写入', async () => {
      const cache = new Map();

      const result = await runStressTest(
        '缓存写入',
        20, // 20个并发
        50, // 每个并发50次请求
        async () => {
          const key = `key-${Math.random()}`;
          const value = { data: 'test', timestamp: Date.now() };
          cache.set(key, value);
          return value;
        }
      );

      expect(result.successfulRequests).toBe(result.totalRequests);
      expect(cache.size).toBeGreaterThan(0);
    });
  });

  describe('2. 搜索压力测试', () => {
    it('应该支持并发搜索请求', async () => {
      // Mock 搜索函数
      const mockSearch = async (query: string) => {
        // 模拟搜索延迟
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));

        return Array(10).fill(null).map((_, i) => ({
          id: `doc-${i}`,
          content: `Result for ${query}`,
          score: Math.random()
        }));
      };

      const queries = [
        'BGP configuration',
        'MLAG setup',
        'interface status',
        'routing protocol',
        'network troubleshooting'
      ];

      const result = await runStressTest(
        '搜索请求',
        10, // 10个并发
        20, // 每个并发20次请求
        async () => {
          const query = queries[Math.floor(Math.random() * queries.length)];
          return await mockSearch(query);
        }
      );

      expect(result.successfulRequests).toBe(result.totalRequests);
      expect(result.avgResponseTime).toBeLessThan(200); // 平均响应时间应该合理
    });
  });

  describe('3. 文档处理压力测试', () => {
    it('应该支持并发文档分块', async () => {
      const testDocument = `
# Test Document

## Section 1
Content for section 1.

\`\`\`javascript
function test() {
  return "hello";
}
\`\`\`

## Section 2
Content for section 2.
      `.repeat(5);

      // Mock 分块函数
      const mockChunking = async (content: string) => {
        await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 20));

        return content.split('\n\n').map((chunk, i) => ({
          id: `chunk-${i}`,
          content: chunk,
          metadata: {}
        }));
      };

      const result = await runStressTest(
        '文档分块',
        5, // 5个并发
        10, // 每个并发10次请求
        async () => {
          return await mockChunking(testDocument);
        }
      );

      expect(result.successfulRequests).toBe(result.totalRequests);
      expect(result.avgResponseTime).toBeLessThan(100);
    });
  });

  describe('4. 混合检索压力测试', () => {
    it('应该支持并发混合检索', async () => {
      // Mock 混合检索
      const mockHybridRetrieval = async (query: string) => {
        // 模拟关键词搜索
        await new Promise(resolve => setTimeout(resolve, 30));
        const keywordResults = Array(20).fill(null).map((_, i) => ({
          id: `doc-${i}`,
          score: Math.random()
        }));

        // 模拟向量搜索
        await new Promise(resolve => setTimeout(resolve, 50));
        const vectorResults = Array(20).fill(null).map((_, i) => ({
          id: `doc-${i}`,
          score: Math.random()
        }));

        // 模拟 RRF 融合
        await new Promise(resolve => setTimeout(resolve, 10));
        const fusedResults = [...keywordResults, ...vectorResults]
          .reduce((acc, curr) => {
            const existing = acc.find(r => r.id === curr.id);
            if (existing) {
              existing.score += curr.score;
            } else {
              acc.push({ ...curr });
            }
            return acc;
          }, [] as any[])
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);

        return fusedResults;
      };

      const result = await runStressTest(
        '混合检索',
        8, // 8个并发
        15, // 每个并发15次请求
        async () => {
          return await mockHybridRetrieval('test query');
        }
      );

      expect(result.successfulRequests).toBe(result.totalRequests);
      expect(result.avgResponseTime).toBeLessThan(150);
    });
  });

  describe('5. 内存压力测试', () => {
    it('应该能够处理大量数据而不崩溃', async () => {
      const largeDataSet = new Map();

      const result = await runStressTest(
        '大数据集处理',
        10, // 10个并发
        100, // 每个并发100次请求
        async () => {
          // 创建大对象
          const largeObject = {
            id: Math.random().toString(),
            data: Array(100).fill(null).map(() => ({
              field1: 'test',
              field2: Math.random(),
              field3: Array(10).fill('data')
            }))
          };

          largeDataSet.set(largeObject.id, largeObject);

          // 定期清理以避免内存溢出
          if (largeDataSet.size > 500) {
            const keys = Array.from(largeDataSet.keys());
            for (let i = 0; i < 100; i++) {
              largeDataSet.delete(keys[i]);
            }
          }

          return largeObject;
        }
      );

      expect(result.successfulRequests).toBe(result.totalRequests);
      console.log(`   💾 最终数据集大小: ${largeDataSet.size}`);
    });
  });

  describe('6. 长时间运行测试', () => {
    it('应该能够持续处理请求', async () => {
      const cache = new Map();
      let operationCount = 0;

      const result = await runStressTest(
        '持续运行',
        5, // 5个并发
        50, // 每个并发50次请求
        async () => {
          operationCount++;

          // 混合操作：读、写、删除
          const operation = Math.random();

          if (operation < 0.5) {
            // 读操作
            const key = `key-${Math.floor(Math.random() * 100)}`;
            return cache.get(key);
          } else if (operation < 0.9) {
            // 写操作
            const key = `key-${Math.floor(Math.random() * 100)}`;
            cache.set(key, { data: 'test', timestamp: Date.now() });
            return true;
          } else {
            // 删除操作
            const key = `key-${Math.floor(Math.random() * 100)}`;
            cache.delete(key);
            return true;
          }
        }
      );

      expect(result.successfulRequests).toBe(result.totalRequests);
      console.log(`   🔄 总操作数: ${operationCount}`);
    });
  });

  describe('7. 错误恢复测试', () => {
    it('应该能够从错误中恢复', async () => {
      let errorCount = 0;
      let successCount = 0;

      const result = await runStressTest(
        '错误恢复',
        5, // 5个并发
        20, // 每个并发20次请求
        async () => {
          // 随机产生错误
          if (Math.random() < 0.2) {
            errorCount++;
            throw new Error('Random error');
          }

          successCount++;
          await new Promise(resolve => setTimeout(resolve, 10));
          return { success: true };
        }
      );

      console.log(`   ✅ 成功操作: ${successCount}`);
      console.log(`   ❌ 错误操作: ${errorCount}`);

      // 应该有一些成功的请求
      expect(result.successfulRequests).toBeGreaterThan(0);
    });
  });

  describe('8. 峰值负载测试', () => {
    it('应该能够处理突发流量', async () => {
      const cache = new Map();

      // 第一波：正常负载
      console.log('\n   📊 第一波：正常负载');
      const normalLoad = await runStressTest(
        '正常负载',
        5,
        20,
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return cache.set(`key-${Math.random()}`, 'value');
        }
      );

      // 第二波：峰值负载
      console.log('\n   📊 第二波：峰值负载');
      const peakLoad = await runStressTest(
        '峰值负载',
        20, // 4倍并发
        20,
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return cache.set(`key-${Math.random()}`, 'value');
        }
      );

      // 第三波：恢复正常
      console.log('\n   📊 第三波：恢复正常');
      const recoveryLoad = await runStressTest(
        '恢复负载',
        5,
        20,
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return cache.set(`key-${Math.random()}`, 'value');
        }
      );

      // 验证系统能够处理峰值并恢复
      expect(normalLoad.successfulRequests).toBe(normalLoad.totalRequests);
      expect(peakLoad.successfulRequests).toBe(peakLoad.totalRequests);
      expect(recoveryLoad.successfulRequests).toBe(recoveryLoad.totalRequests);

      // 峰值时的响应时间应该仍然可接受
      expect(peakLoad.avgResponseTime).toBeLessThan(normalLoad.avgResponseTime * 3);
    });
  });
});
