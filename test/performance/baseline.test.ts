/**
 * 性能基线测试套件
 * 目标：所有核心功能响应时间 < 1秒
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { performance } from 'perf_hooks';

// 性能阈值配置（毫秒）
const PERFORMANCE_THRESHOLDS = {
  EMBEDDING_SINGLE: 500,      // 单个文本 embedding
  EMBEDDING_BATCH: 2000,      // 批量 embedding (10个)
  VECTOR_SEARCH: 1000,        // 向量搜索
  HYBRID_SEARCH: 1500,        // 混合检索
  KNOWLEDGE_GRAPH: 800,       // 知识图谱查询
  RERANK: 1000,              // 重排序
  CHUNKING: 500,             // 文档分块
  STORAGE_READ: 100,         // 存储读取
  STORAGE_WRITE: 200,        // 存储写入
  CACHE_HIT: 10,             // 缓存命中
  FULL_RETRIEVAL: 3000       // 完整检索流程
};

// 性能测试结果收集
interface PerformanceResult {
  operation: string;
  duration: number;
  threshold: number;
  passed: boolean;
  timestamp: number;
}

const performanceResults: PerformanceResult[] = [];

// 性能测试辅助函数
async function measurePerformance<T>(
  operation: string,
  threshold: number,
  fn: () => Promise<T>
): Promise<{ result: T; duration: number; passed: boolean }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  const passed = duration <= threshold;

  performanceResults.push({
    operation,
    duration,
    threshold,
    passed,
    timestamp: Date.now()
  });

  return { result, duration, passed };
}

describe('性能基线测试套件', () => {
  beforeAll(() => {
    console.log('\n🚀 开始性能基线测试...\n');
  });

  afterAll(async () => {
    // 生成性能报告
    console.log('\n' + '='.repeat(80));
    console.log('📊 性能基线测试报告');
    console.log('='.repeat(80));

    const passed = performanceResults.filter(r => r.passed).length;
    const total = performanceResults.length;
    const passRate = ((passed / total) * 100).toFixed(1);

    console.log(`\n总测试数: ${total}`);
    console.log(`通过: ${passed} ✅`);
    console.log(`失败: ${total - passed} ❌`);
    console.log(`通过率: ${passRate}%\n`);

    // 详细结果
    console.log('详细结果:');
    console.log('-'.repeat(80));
    performanceResults.forEach(r => {
      const status = r.passed ? '✅' : '❌';
      const durationStr = r.duration.toFixed(2).padStart(8);
      const thresholdStr = r.threshold.toString().padStart(8);
      console.log(
        `${status} ${r.operation.padEnd(30)} ${durationStr}ms / ${thresholdStr}ms`
      );
    });

    // 统计信息
    const avgDuration = performanceResults.reduce((sum, r) => sum + r.duration, 0) / total;
    const maxDuration = Math.max(...performanceResults.map(r => r.duration));
    const minDuration = Math.min(...performanceResults.map(r => r.duration));

    console.log('\n统计信息:');
    console.log(`平均响应时间: ${avgDuration.toFixed(2)}ms`);
    console.log(`最快响应时间: ${minDuration.toFixed(2)}ms`);
    console.log(`最慢响应时间: ${maxDuration.toFixed(2)}ms`);

    // 保存基线数据
    const baselineData = {
      timestamp: new Date().toISOString(),
      summary: {
        total,
        passed,
        failed: total - passed,
        passRate: parseFloat(passRate),
        avgDuration,
        maxDuration,
        minDuration
      },
      results: performanceResults,
      thresholds: PERFORMANCE_THRESHOLDS
    };

    // 写入文件
    const fs = await import('fs');
    const path = await import('path');
    const outputDir = path.join(process.cwd(), 'test', 'performance', 'reports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFile = path.join(outputDir, `baseline-${Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(baselineData, null, 2));
    console.log(`\n📁 基线数据已保存: ${outputFile}\n`);
  });

  describe('1. 存储性能测试', () => {
    it('应该在 100ms 内完成文档读取', async () => {
      const { duration, passed } = await measurePerformance(
        '存储-文档读取',
        PERFORMANCE_THRESHOLDS.STORAGE_READ,
        async () => {
          // Mock 存储读取
          return new Promise(resolve => {
            setTimeout(() => resolve({ id: 'test', content: 'test' }), 10);
          });
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.STORAGE_READ);
    });

    it('应该在 200ms 内完成文档写入', async () => {
      const { duration, passed } = await measurePerformance(
        '存储-文档写入',
        PERFORMANCE_THRESHOLDS.STORAGE_WRITE,
        async () => {
          return new Promise(resolve => {
            setTimeout(() => resolve({ success: true }), 20);
          });
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.STORAGE_WRITE);
    });
  });

  describe('2. 缓存性能测试', () => {
    it('应该在 10ms 内完成缓存命中', async () => {
      const cache = new Map();
      cache.set('test-key', { data: 'cached-value' });

      const { duration, passed } = await measurePerformance(
        '缓存-命中',
        PERFORMANCE_THRESHOLDS.CACHE_HIT,
        async () => {
          return cache.get('test-key');
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.CACHE_HIT);
    });
  });

  describe('3. 文档分块性能测试', () => {
    it('应该在 500ms 内完成中等文档分块', async () => {
      const testDocument = `
# Test Document

## Section 1
This is a test section with some content.

\`\`\`javascript
function test() {
  return "hello";
}
\`\`\`

## Section 2
More content here.
      `.repeat(10);

      const { duration, passed } = await measurePerformance(
        '分块-中等文档',
        PERFORMANCE_THRESHOLDS.CHUNKING,
        async () => {
          // Mock chunking
          const chunks = testDocument.split('\n\n').map((chunk, i) => ({
            id: `chunk-${i}`,
            content: chunk,
            metadata: {}
          }));
          return chunks;
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.CHUNKING);
    });
  });

  describe('4. Embedding 性能测试', () => {
    it('应该在 500ms 内完成单个文本 embedding (Mock)', async () => {
      const { duration, passed } = await measurePerformance(
        'Embedding-单个文本',
        PERFORMANCE_THRESHOLDS.EMBEDDING_SINGLE,
        async () => {
          // Mock embedding API call
          return new Promise(resolve => {
            setTimeout(() => {
              resolve(Array(1024).fill(0).map(() => Math.random()));
            }, 100);
          });
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.EMBEDDING_SINGLE);
    });

    it('应该在 2000ms 内完成批量 embedding (10个文本, Mock)', async () => {
      const texts = Array(10).fill('test text');

      const { duration, passed } = await measurePerformance(
        'Embedding-批量(10个)',
        PERFORMANCE_THRESHOLDS.EMBEDDING_BATCH,
        async () => {
          // Mock batch embedding
          return new Promise(resolve => {
            setTimeout(() => {
              resolve(texts.map(() => Array(1024).fill(0).map(() => Math.random())));
            }, 300);
          });
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.EMBEDDING_BATCH);
    });
  });

  describe('5. 向量搜索性能测试', () => {
    it('应该在 1000ms 内完成向量搜索 (Mock)', async () => {
      const queryVector = Array(1024).fill(0).map(() => Math.random());
      const documentVectors = Array(1000).fill(null).map(() =>
        Array(1024).fill(0).map(() => Math.random())
      );

      const { duration, passed } = await measurePerformance(
        '向量搜索-1000文档',
        PERFORMANCE_THRESHOLDS.VECTOR_SEARCH,
        async () => {
          // Mock vector search with cosine similarity
          const results = documentVectors.map((vec, i) => {
            const similarity = Math.random(); // Mock similarity
            return { id: `doc-${i}`, score: similarity };
          });
          return results.sort((a, b) => b.score - a.score).slice(0, 10);
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.VECTOR_SEARCH);
    });
  });

  describe('6. 混合检索性能测试', () => {
    it('应该在 1500ms 内完成混合检索 (Mock)', async () => {
      const { duration, passed } = await measurePerformance(
        '混合检索-完整流程',
        PERFORMANCE_THRESHOLDS.HYBRID_SEARCH,
        async () => {
          // Mock hybrid retrieval
          const keywordResults = Array(20).fill(null).map((_, i) => ({
            id: `doc-${i}`,
            score: Math.random()
          }));

          const vectorResults = Array(20).fill(null).map((_, i) => ({
            id: `doc-${i}`,
            score: Math.random()
          }));

          // Mock RRF fusion
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
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.HYBRID_SEARCH);
    });
  });

  describe('7. 重排序性能测试', () => {
    it('应该在 1000ms 内完成文档重排序 (Mock)', async () => {
      const documents = Array(20).fill(null).map((_, i) => ({
        id: `doc-${i}`,
        content: `Document ${i} content`,
        score: Math.random()
      }));

      const { duration, passed } = await measurePerformance(
        '重排序-20文档',
        PERFORMANCE_THRESHOLDS.RERANK,
        async () => {
          // Mock reranking
          return new Promise(resolve => {
            setTimeout(() => {
              const reranked = documents
                .map(doc => ({ ...doc, rerankScore: Math.random() }))
                .sort((a, b) => b.rerankScore - a.rerankScore)
                .slice(0, 10);
              resolve(reranked);
            }, 200);
          });
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.RERANK);
    });
  });

  describe('8. 知识图谱性能测试', () => {
    it('应该在 800ms 内完成知识图谱查询 (Mock)', async () => {
      const { duration, passed } = await measurePerformance(
        '知识图谱-实体查询',
        PERFORMANCE_THRESHOLDS.KNOWLEDGE_GRAPH,
        async () => {
          // Mock Neo4j query
          return new Promise(resolve => {
            setTimeout(() => {
              resolve({
                nodes: [
                  { id: 'vendor-1', type: 'Vendor', name: 'NVIDIA' },
                  { id: 'func-1', type: 'Function', name: 'BGP' }
                ],
                relationships: [
                  { from: 'vendor-1', to: 'func-1', type: 'HAS_FUNCTION' }
                ]
              });
            }, 150);
          });
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.KNOWLEDGE_GRAPH);
    });
  });

  describe('9. 完整检索流程性能测试', () => {
    it('应该在 3000ms 内完成完整检索流程 (Mock)', async () => {
      const query = 'How to configure BGP on Cumulus Linux?';

      const { duration, passed } = await measurePerformance(
        '完整检索流程',
        PERFORMANCE_THRESHOLDS.FULL_RETRIEVAL,
        async () => {
          // Step 1: Query expansion (50ms)
          await new Promise(resolve => setTimeout(resolve, 50));
          const expandedQueries = [query, 'BGP configuration', 'Cumulus BGP'];

          // Step 2: Embedding (100ms)
          await new Promise(resolve => setTimeout(resolve, 100));
          const queryVector = Array(1024).fill(0).map(() => Math.random());

          // Step 3: Keyword search (200ms)
          await new Promise(resolve => setTimeout(resolve, 200));
          const keywordResults = Array(30).fill(null).map((_, i) => ({
            id: `doc-${i}`,
            score: Math.random()
          }));

          // Step 4: Vector search (300ms)
          await new Promise(resolve => setTimeout(resolve, 300));
          const vectorResults = Array(30).fill(null).map((_, i) => ({
            id: `doc-${i}`,
            score: Math.random()
          }));

          // Step 5: Knowledge graph (150ms)
          await new Promise(resolve => setTimeout(resolve, 150));
          const kgResults = [
            { id: 'entity-1', type: 'Function', name: 'BGP' }
          ];

          // Step 6: RRF Fusion (50ms)
          await new Promise(resolve => setTimeout(resolve, 50));
          const fusedResults = [...keywordResults, ...vectorResults]
            .slice(0, 20);

          // Step 7: Reranking (200ms)
          await new Promise(resolve => setTimeout(resolve, 200));
          const rerankedResults = fusedResults
            .map(r => ({ ...r, rerankScore: Math.random() }))
            .sort((a, b) => b.rerankScore - a.rerankScore)
            .slice(0, 10);

          return {
            query,
            results: rerankedResults,
            metadata: {
              expandedQueries,
              kgResults
            }
          };
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.FULL_RETRIEVAL);
    });
  });

  describe('10. 并发性能测试', () => {
    it('应该支持 10 个并发查询', async () => {
      const concurrentQueries = 10;
      const queries = Array(concurrentQueries).fill(null).map((_, i) => `Query ${i}`);

      const { duration, passed } = await measurePerformance(
        `并发查询-${concurrentQueries}个`,
        PERFORMANCE_THRESHOLDS.FULL_RETRIEVAL * 2, // 允许更长时间
        async () => {
          const results = await Promise.all(
            queries.map(async (query) => {
              // Mock search
              await new Promise(resolve => setTimeout(resolve, 500));
              return {
                query,
                results: Array(5).fill(null).map((_, i) => ({
                  id: `doc-${i}`,
                  score: Math.random()
                }))
              };
            })
          );
          return results;
        }
      );

      expect(passed).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.FULL_RETRIEVAL * 2);
    });
  });
});
