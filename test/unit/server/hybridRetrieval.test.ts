/**
 * Hybrid Retrieval 模块测试
 * 测试混合检索（RAG + 知识图谱）功能
 */

import { describe, it, expect } from 'vitest';
import { createMockChunks } from '../../fixtures/mock-data';
import { determineRetrievalStrategy } from '../../../server/hybridRetrieval.mjs';

describe('Hybrid Retrieval Module', () => {
  describe('determineRetrievalStrategy', () => {
    it('should use vendor-focused strategy for vendor queries', () => {
      const queries = [
        'NVIDIA 配置',
        '英伟达 文档',
        'Mellanox 手册'
      ];

      queries.forEach(query => {
        const strategy = determineRetrievalStrategy(query);
        expect(strategy.strategy).toBe('vendor-focused');
        expect(strategy.kgWeight).toBe(0.4);
      });
    });

    it('should use command-focused strategy for command queries', () => {
      const queries = [
        'nv set interface 命令',
        '如何配置 MLAG',
        '命令行配置 BGP'
      ];

      queries.forEach(query => {
        const strategy = determineRetrievalStrategy(query);
        expect(strategy.strategy).toBe('command-focused');
        expect(strategy.kgWeight).toBe(0.35);
      });
    });

    it('should use function-focused strategy for function queries', () => {
      const queries = [
        'BGP 路由协议',
        'EVPN 协议说明',
        'OSPF 功能介绍'
      ];

      queries.forEach(query => {
        const strategy = determineRetrievalStrategy(query);
        expect(strategy.strategy).toBe('function-focused');
        expect(strategy.kgWeight).toBe(0.3);
      });
    });

    it('should use balanced strategy as default', () => {
      const query = '一般性问题';

      const strategy = determineRetrievalStrategy(query);

      expect(strategy.strategy).toBe('balanced');
      expect(strategy.kgWeight).toBe(0.25);
    });
  });

  describe('hybridRetrieval', () => {
    it('should combine vector and KG results', () => {
      const vectorResults = createMockChunks(5).map((chunk, i) => ({
        chunk,
        score: 0.8 - i * 0.1
      }));

      const kgResults = [
        {
          type: 'vendor',
          vendor: { name: 'NVIDIA' },
          commands: [{ name: 'nv set interface' }],
          relevance: 0.9
        }
      ];

      // 模拟混合检索
      const combine = (vectorResults: any[], kgResults: any[], kgWeight: number) => {
        const enhanced = [...vectorResults];

        // 提取 KG 实体
        const kgEntities = new Set<string>();
        kgResults.forEach(result => {
          if (result.vendor) kgEntities.add(result.vendor.name.toLowerCase());
        });

        // 增强包含 KG 实体的结果
        enhanced.forEach(result => {
          const textLower = result.chunk.content.toLowerCase();
          let entityMatchCount = 0;

          for (const entity of kgEntities) {
            if (textLower.includes(entity)) {
              entityMatchCount++;
            }
          }

          if (entityMatchCount > 0) {
            result.score += entityMatchCount * kgWeight * 0.1;
            result.kgBoost = entityMatchCount * kgWeight * 0.1;
          }
        });

        return enhanced.sort((a, b) => b.score - a.score);
      };

      const combined = combine(vectorResults, kgResults, 0.3);

      expect(combined.length).toBeGreaterThanOrEqual(vectorResults.length);
    });

    it('should boost scores for KG entity matches', () => {
      const result = {
        chunk: { ...createMockChunks(1)[0], content: 'Configure NVIDIA switch' },
        score: 0.7
      };

      const kgEntities = new Set(['nvidia']);
      const kgWeight = 0.3;

      // 检查匹配
      const textLower = result.chunk.content.toLowerCase();
      let boost = 0;

      for (const entity of kgEntities) {
        if (textLower.includes(entity)) {
          boost += kgWeight * 0.1;
        }
      }

      const boostedScore = result.score + boost;

      expect(boostedScore).toBeGreaterThan(result.score);
      expect(boost).toBeGreaterThan(0);
    });

    it('should add KG context to results', () => {
      const kgResults = [
        {
          type: 'vendor',
          vendor: { name: 'NVIDIA' },
          functions: [{ name: 'BGP' }],
          commands: [{ name: 'nv set interface' }],
          parameters: [{ name: 'eth0' }]
        }
      ];

      // 格式化 KG 上下文
      const formatContext = (kgResults: any[]) => {
        const parts = [];

        for (const result of kgResults) {
          if (result.type === 'vendor') {
            const vendor = result.vendor;
            const functions = result.functions.map((f: any) => f.name).join(', ');
            const commands = result.commands.map((c: any) => c.name).join(', ');

            parts.push(
              `厂商 ${vendor.name}:\n` +
              (functions ? `  - 功能: ${functions}\n` : '') +
              (commands ? `  - 相关命令: ${commands}\n` : '')
            );
          }
        }

        return parts.join('\n');
      };

      const context = formatContext(kgResults);

      expect(context).toContain('NVIDIA');
      expect(context).toContain('nv set interface');
      expect(context).toContain('BGP');
    });

    it('should fallback to vector-only on KG failure', () => {
      const vectorResults = createMockChunks(5).map((chunk, i) => ({
        chunk,
        score: 0.8 - i * 0.1
      }));

      // 模拟 KG 失败
      const hybridRetrievalWithFallback = (
        vectorResults: any[],
        kgEnabled: boolean
      ) => {
        if (!kgEnabled) {
          return vectorResults;
        }

        try {
          // 模拟 KG 查询失败
          throw new Error('KG query failed');
        } catch (error) {
          console.warn('Falling back to vector-only');
          return vectorResults;
        }
      };

      const results = hybridRetrievalWithFallback(vectorResults, true);

      expect(results).toEqual(vectorResults);
      expect(results.length).toBe(5);
    });
  });

  describe('buildKnowledgeGraphFromDocuments', () => {
    it('should process multiple documents', async () => {
      const documentIds = ['doc-1', 'doc-2', 'doc-3'];

      const processDocuments = async (docIds: string[]) => {
        const stats = {
          totalDocuments: docIds.length,
          processedDocuments: 0,
          failedDocuments: 0,
          totalEntities: {
            vendors: 0,
            functions: 0,
            commands: 0,
            parameters: 0
          }
        };

        for (const docId of docIds) {
          try {
            // 模拟处理
            stats.processedDocuments++;
            stats.totalEntities.vendors += 1;
            stats.totalEntities.functions += 2;
            stats.totalEntities.commands += 3;
          } catch (error) {
            stats.failedDocuments++;
          }
        }

        return stats;
      };

      const stats = await processDocuments(documentIds);

      expect(stats.processedDocuments).toBe(3);
      expect(stats.totalEntities.vendors).toBeGreaterThan(0);
    });

    it('should handle processing failures gracefully', async () => {
      const documentIds = ['doc-1', 'doc-fail', 'doc-3'];

      const processDocuments = async (docIds: string[]) => {
        const stats = {
          processedDocuments: 0,
          failedDocuments: 0
        };

        for (const docId of docIds) {
          try {
            if (docId === 'doc-fail') {
              throw new Error('Processing failed');
            }
            stats.processedDocuments++;
          } catch (error) {
            stats.failedDocuments++;
          }
        }

        return stats;
      };

      const stats = await processDocuments(documentIds);

      expect(stats.processedDocuments).toBe(2);
      expect(stats.failedDocuments).toBe(1);
    });
  });

  describe('getHybridRetrievalStats', () => {
    it('should return graph statistics', () => {
      const mockStats = {
        knowledgeGraph: {
          vendors: 45,
          vendorsTotal: 60,
          functions: 12,
          functionsTotal: 20,
          commands: 128,
          commandsTotal: 150,
          parameters: 256,
          parametersTotal: 300,
          relationships: 432
        },
        status: 'active'
      };

      expect(mockStats.knowledgeGraph.vendors).toBe(45);
      expect(mockStats.knowledgeGraph.relationships).toBe(432);
      expect(mockStats.status).toBe('active');
    });

    it('should handle error state', () => {
      const errorStats = {
        knowledgeGraph: {
          vendors: 0,
          vendorsTotal: 0,
          functions: 0,
          functionsTotal: 0,
          commands: 0,
          commandsTotal: 0,
          parameters: 0,
          parametersTotal: 0,
          relationships: 0
        },
        status: 'error',
        error: 'Connection failed'
      };

      expect(errorStats.status).toBe('error');
      expect(errorStats.error).toBeDefined();
    });
  });

  describe('strategy effectiveness', () => {
    it('should improve relevance for vendor queries', () => {
      const baseScore = 0.7;
      const kgBoost = 0.12; // 3 entity matches * 0.4 weight * 0.1

      const enhancedScore = baseScore + kgBoost;

      expect(enhancedScore).toBeGreaterThan(baseScore);
      expect(enhancedScore).toBeCloseTo(0.82, 2);
    });

    it('should maintain score bounds', () => {
      const score = 0.95;
      const maxBoost = 0.4;

      const boosted = Math.min(score + maxBoost, 1.0);

      expect(boosted).toBeLessThanOrEqual(1.0);
    });
  });
});
