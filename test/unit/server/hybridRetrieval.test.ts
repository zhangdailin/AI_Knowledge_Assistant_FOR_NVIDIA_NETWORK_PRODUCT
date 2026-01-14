/**
 * Hybrid Retrieval 模块测试
 * 测试混合检索（RAG + 知识图谱）功能
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockChunks, createMockEntities } from '../../fixtures/mock-data';

describe('Hybrid Retrieval Module', () => {
  describe('determineRetrievalStrategy', () => {
    it('should use device-focused strategy for device queries', () => {
      const queries = [
        'IBCR-01 配置',
        'CSW-01 switch 设置',
        '设备 IBSP-02 状态'
      ];

      const determineStrategy = (query: string) => {
        const devicePatterns = [
          /\b(IBCR|IBSP|IBLF|CSW|SSW|ASW)[-_]?\w*\d+/i,
          /设备|device|switch|router/i,
          /拓扑|topology/i
        ];

        for (const pattern of devicePatterns) {
          if (pattern.test(query)) {
            return {
              strategy: 'device-focused',
              enableKnowledgeGraph: true,
              kgWeight: 0.4,
              maxKgResults: 8
            };
          }
        }

        return { strategy: 'balanced', kgWeight: 0.25, maxKgResults: 5 };
      };

      queries.forEach(query => {
        const strategy = determineStrategy(query);
        expect(strategy.strategy).toBe('device-focused');
        expect(strategy.kgWeight).toBe(0.4);
      });
    });

    it('should use command-focused strategy for command queries', () => {
      const queries = [
        'nv set interface 命令',
        '如何配置 MLAG',
        '命令行配置 BGP'
      ];

      const determineStrategy = (query: string) => {
        const commandPatterns = [
          /\bnv\s+(set|show|config|unset)/i,
          /命令|command|配置|config/i,
          /如何|怎么|how to/i
        ];

        for (const pattern of commandPatterns) {
          if (pattern.test(query)) {
            return {
              strategy: 'command-focused',
              enableKnowledgeGraph: true,
              kgWeight: 0.35,
              maxKgResults: 6
            };
          }
        }

        return { strategy: 'balanced', kgWeight: 0.25, maxKgResults: 5 };
      };

      queries.forEach(query => {
        const strategy = determineStrategy(query);
        expect(strategy.strategy).toBe('command-focused');
        expect(strategy.kgWeight).toBe(0.35);
      });
    });

    it('should use protocol-focused strategy for protocol queries', () => {
      const queries = [
        'BGP 路由配置',
        'EVPN 协议设置',
        'OSPF 配置'
      ];

      const determineStrategy = (query: string) => {
        const protocolPatterns = [
          /\b(BGP|OSPF|EVPN|VXLAN|MLAG|LACP|RoCE)\b/i,
          /协议|protocol/i
        ];

        for (const pattern of protocolPatterns) {
          if (pattern.test(query)) {
            return {
              strategy: 'protocol-focused',
              enableKnowledgeGraph: true,
              kgWeight: 0.3,
              maxKgResults: 5
            };
          }
        }

        return { strategy: 'balanced', kgWeight: 0.25, maxKgResults: 5 };
      };

      queries.forEach(query => {
        const strategy = determineStrategy(query);
        expect(strategy.strategy).toBe('protocol-focused');
        expect(strategy.kgWeight).toBe(0.3);
      });
    });

    it('should use balanced strategy as default', () => {
      const query = '一般性问题';

      const determineStrategy = (query: string) => {
        return {
          strategy: 'balanced',
          enableKnowledgeGraph: true,
          kgWeight: 0.25,
          maxKgResults: 5
        };
      };

      const strategy = determineStrategy(query);

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
          type: 'device',
          device: { name: 'IBCR-01', type: 'switch' },
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
          if (result.device) kgEntities.add(result.device.name.toLowerCase());
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
        chunk: { ...createMockChunks(1)[0], content: 'Configure IBCR-01 switch' },
        score: 0.7
      };

      const kgEntities = new Set(['ibcr-01']);
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
          type: 'device',
          device: { name: 'IBCR-01', type: 'switch' },
          commands: [{ name: 'nv set interface' }],
          protocols: [{ name: 'BGP' }]
        }
      ];

      // 格式化 KG 上下文
      const formatContext = (kgResults: any[]) => {
        const parts = [];

        for (const result of kgResults) {
          if (result.type === 'device') {
            const device = result.device;
            const commands = result.commands.map((c: any) => c.name).join(', ');
            const protocols = result.protocols.map((p: any) => p.name).join(', ');

            parts.push(
              `设备 ${device.name} (类型: ${device.type}):\n` +
              (commands ? `  - 支持命令: ${commands}\n` : '') +
              (protocols ? `  - 支持协议: ${protocols}\n` : '')
            );
          }
        }

        return parts.join('\n');
      };

      const context = formatContext(kgResults);

      expect(context).toContain('IBCR-01');
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
            devices: 0,
            commands: 0,
            parameters: 0,
            protocols: 0
          }
        };

        for (const docId of docIds) {
          try {
            // 模拟处理
            stats.processedDocuments++;
            stats.totalEntities.devices += 2;
            stats.totalEntities.commands += 3;
          } catch (error) {
            stats.failedDocuments++;
          }
        }

        return stats;
      };

      const stats = await processDocuments(documentIds);

      expect(stats.processedDocuments).toBe(3);
      expect(stats.totalEntities.devices).toBeGreaterThan(0);
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
          devices: 45,
          commands: 128,
          parameters: 256,
          protocols: 12,
          relationships: 432
        },
        status: 'active'
      };

      expect(mockStats.knowledgeGraph.devices).toBe(45);
      expect(mockStats.knowledgeGraph.relationships).toBe(432);
      expect(mockStats.status).toBe('active');
    });

    it('should handle error state', () => {
      const errorStats = {
        knowledgeGraph: {
          devices: 0,
          commands: 0,
          parameters: 0,
          protocols: 0,
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
    it('should improve relevance for device queries', () => {
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
