/**
 * 检索功能单元测试
 * 测试向量检索、混合检索、重排序等核心功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('向量检索单元测试', () => {
  describe('1. 余弦相似度计算', () => {
    it('应该正确计算余弦相似度', () => {
      const cosineSimilarity = (a: number[], b: number[]): number => {
        if (a.length !== b.length) throw new Error('Vectors must have same length');

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
          dotProduct += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      };

      // 相同向量
      const vec1 = [1, 2, 3];
      expect(cosineSimilarity(vec1, vec1)).toBeCloseTo(1.0, 5);

      // 正交向量
      const vec2 = [1, 0, 0];
      const vec3 = [0, 1, 0];
      expect(cosineSimilarity(vec2, vec3)).toBeCloseTo(0.0, 5);

      // 相反向量
      const vec4 = [1, 1, 1];
      const vec5 = [-1, -1, -1];
      expect(cosineSimilarity(vec4, vec5)).toBeCloseTo(-1.0, 5);
    });

    it('应该处理零向量', () => {
      const cosineSimilarity = (a: number[], b: number[]): number => {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
          dotProduct += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }

        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      };

      const zeroVec = [0, 0, 0];
      const normalVec = [1, 2, 3];

      expect(cosineSimilarity(zeroVec, normalVec)).toBe(0);
    });
  });

  describe('2. 向量搜索', () => {
    it('应该返回最相似的文档', () => {
      const queryVector = [1, 0, 0];
      const documents = [
        { id: 'doc1', vector: [0.9, 0.1, 0], content: 'Doc 1' },
        { id: 'doc2', vector: [0, 1, 0], content: 'Doc 2' },
        { id: 'doc3', vector: [1, 0, 0], content: 'Doc 3' }
      ];

      const cosineSimilarity = (a: number[], b: number[]): number => {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
          dotProduct += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      };

      const results = documents
        .map(doc => ({
          ...doc,
          score: cosineSimilarity(queryVector, doc.vector)
        }))
        .sort((a, b) => b.score - a.score);

      expect(results[0].id).toBe('doc3'); // 完全匹配
      expect(results[0].score).toBeCloseTo(1.0, 5);
      expect(results[1].id).toBe('doc1'); // 次优匹配
    });

    it('应该支持 Top-K 检索', () => {
      const queryVector = [1, 0, 0];
      const documents = Array(100).fill(null).map((_, i) => ({
        id: `doc${i}`,
        vector: [Math.random(), Math.random(), Math.random()],
        content: `Document ${i}`
      }));

      const cosineSimilarity = (a: number[], b: number[]): number => {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
          dotProduct += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      };

      const k = 10;
      const results = documents
        .map(doc => ({
          ...doc,
          score: cosineSimilarity(queryVector, doc.vector)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

      expect(results.length).toBe(k);

      // 验证结果是按分数降序排列的
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });
  });

  describe('3. 最小分数过滤', () => {
    it('应该过滤低分文档', () => {
      const results = [
        { id: 'doc1', score: 0.9 },
        { id: 'doc2', score: 0.5 },
        { id: 'doc3', score: 0.1 }
      ];

      const minScore = 0.3;
      const filtered = results.filter(r => r.score >= minScore);

      expect(filtered.length).toBe(2);
      expect(filtered.every(r => r.score >= minScore)).toBe(true);
    });
  });
});

describe('混合检索单元测试', () => {
  describe('1. RRF (Reciprocal Rank Fusion)', () => {
    it('应该正确计算 RRF 分数', () => {
      const calculateRRF = (rank: number, k: number = 60): number => {
        return 1 / (k + rank);
      };

      expect(calculateRRF(1, 60)).toBeCloseTo(1 / 61, 5);
      expect(calculateRRF(10, 60)).toBeCloseTo(1 / 70, 5);
      expect(calculateRRF(100, 60)).toBeCloseTo(1 / 160, 5);
    });

    it('应该融合多个排序列表', () => {
      const keywordResults = [
        { id: 'doc1', rank: 1 },
        { id: 'doc2', rank: 2 },
        { id: 'doc3', rank: 3 }
      ];

      const vectorResults = [
        { id: 'doc2', rank: 1 },
        { id: 'doc1', rank: 2 },
        { id: 'doc4', rank: 3 }
      ];

      const k = 60;
      const calculateRRF = (rank: number): number => 1 / (k + rank);

      // 计算融合分数
      const fusedScores = new Map<string, number>();

      keywordResults.forEach(r => {
        fusedScores.set(r.id, (fusedScores.get(r.id) || 0) + calculateRRF(r.rank));
      });

      vectorResults.forEach(r => {
        fusedScores.set(r.id, (fusedScores.get(r.id) || 0) + calculateRRF(r.rank));
      });

      const fusedResults = Array.from(fusedScores.entries())
        .map(([id, score]) => ({ id, score }))
        .sort((a, b) => b.score - a.score);

      // doc1 和 doc2 应该排在前面（都出现在两个列表中）
      expect(['doc1', 'doc2']).toContain(fusedResults[0].id);
      expect(['doc1', 'doc2']).toContain(fusedResults[1].id);
    });

    it('应该支持加权 RRF', () => {
      const keywordResults = [
        { id: 'doc1', rank: 1 },
        { id: 'doc2', rank: 2 }
      ];

      const vectorResults = [
        { id: 'doc2', rank: 1 },
        { id: 'doc3', rank: 2 }
      ];

      const k = 60;
      const keywordWeight = 1.0;
      const vectorWeight = 2.0; // 向量权重更高

      const calculateRRF = (rank: number): number => 1 / (k + rank);

      const fusedScores = new Map<string, number>();

      keywordResults.forEach(r => {
        fusedScores.set(r.id, (fusedScores.get(r.id) || 0) + calculateRRF(r.rank) * keywordWeight);
      });

      vectorResults.forEach(r => {
        fusedScores.set(r.id, (fusedScores.get(r.id) || 0) + calculateRRF(r.rank) * vectorWeight);
      });

      const fusedResults = Array.from(fusedScores.entries())
        .map(([id, score]) => ({ id, score }))
        .sort((a, b) => b.score - a.score);

      // doc2 应该排第一（在两个列表中都靠前，且向量权重高）
      expect(fusedResults[0].id).toBe('doc2');
    });
  });

  describe('2. 查询扩展', () => {
    it('应该生成查询变体', () => {
      const expandQuery = (query: string): string[] => {
        const variants = [query];

        // 添加同义词
        const synonyms: Record<string, string[]> = {
          'interface': ['port', 'link'],
          'status': ['state', 'condition'],
          'configure': ['setup', 'set']
        };

        const words = query.toLowerCase().split(' ');
        words.forEach(word => {
          if (synonyms[word]) {
            synonyms[word].forEach(syn => {
              const variant = query.toLowerCase().replace(word, syn);
              if (!variants.includes(variant)) {
                variants.push(variant);
              }
            });
          }
        });

        return variants;
      };

      const query = 'configure interface status';
      const variants = expandQuery(query);

      expect(variants.length).toBeGreaterThan(1);
      expect(variants).toContain(query);
    });
  });

  describe('3. 结果去重', () => {
    it('应该移除重复文档', () => {
      const results = [
        { id: 'doc1', score: 0.9 },
        { id: 'doc2', score: 0.8 },
        { id: 'doc1', score: 0.7 }, // 重复
        { id: 'doc3', score: 0.6 }
      ];

      const deduped = results.reduce((acc, curr) => {
        if (!acc.find(r => r.id === curr.id)) {
          acc.push(curr);
        }
        return acc;
      }, [] as typeof results);

      expect(deduped.length).toBe(3);
      expect(deduped.filter(r => r.id === 'doc1').length).toBe(1);
    });

    it('应该保留最高分的重复项', () => {
      const results = [
        { id: 'doc1', score: 0.7 },
        { id: 'doc2', score: 0.8 },
        { id: 'doc1', score: 0.9 }, // 更高分
        { id: 'doc3', score: 0.6 }
      ];

      const deduped = results.reduce((acc, curr) => {
        const existing = acc.find(r => r.id === curr.id);
        if (!existing) {
          acc.push(curr);
        } else if (curr.score > existing.score) {
          existing.score = curr.score;
        }
        return acc;
      }, [] as typeof results);

      const doc1 = deduped.find(r => r.id === 'doc1');
      expect(doc1?.score).toBe(0.9);
    });
  });
});

describe('重排序单元测试', () => {
  describe('1. 基于相关性的重排序', () => {
    it('应该根据查询相关性重新排序', () => {
      const query = 'BGP configuration';
      const documents = [
        { id: 'doc1', content: 'OSPF routing protocol', score: 0.8 },
        { id: 'doc2', content: 'BGP configuration guide', score: 0.7 },
        { id: 'doc3', content: 'BGP neighbor setup', score: 0.6 }
      ];

      // 简单的关键词匹配重排序
      const rerank = (query: string, docs: typeof documents) => {
        const queryWords = query.toLowerCase().split(' ');

        return docs.map(doc => {
          const contentWords = doc.content.toLowerCase().split(' ');
          const matchCount = queryWords.filter(qw =>
            contentWords.some(cw => cw.includes(qw))
          ).length;

          return {
            ...doc,
            rerankScore: doc.score + (matchCount * 0.1)
          };
        }).sort((a, b) => b.rerankScore - a.rerankScore);
      };

      const reranked = rerank(query, documents);

      // doc2 和 doc3 应该排在前面（包含 BGP）
      expect(reranked[0].id).toBe('doc2');
      // doc3 或 doc1 可能排第二（取决于初始分数）
      expect(['doc1', 'doc3']).toContain(reranked[1].id);
    });
  });

  describe('2. 多样性重排序', () => {
    it('应该增加结果多样性', () => {
      const documents = [
        { id: 'doc1', content: 'BGP config', category: 'routing', score: 0.9 },
        { id: 'doc2', content: 'BGP setup', category: 'routing', score: 0.85 },
        { id: 'doc3', content: 'Interface config', category: 'interface', score: 0.8 },
        { id: 'doc4', content: 'BGP troubleshoot', category: 'routing', score: 0.75 }
      ];

      // 多样性重排序：惩罚相同类别的连续文档
      const diversityRerank = (docs: typeof documents) => {
        const result: typeof documents = [];
        const remaining = [...docs];
        const categoryCount = new Map<string, number>();

        while (remaining.length > 0) {
          // 选择类别出现次数最少的文档
          remaining.sort((a, b) => {
            const countA = categoryCount.get(a.category) || 0;
            const countB = categoryCount.get(b.category) || 0;
            if (countA !== countB) return countA - countB;
            return b.score - a.score; // 相同类别则按分数排序
          });

          const selected = remaining.shift()!;
          result.push(selected);
          categoryCount.set(selected.category, (categoryCount.get(selected.category) || 0) + 1);
        }

        return result;
      };

      const reranked = diversityRerank(documents);

      // 验证类别分布更均匀
      expect(reranked[0].category).not.toBe(reranked[1].category);
    });
  });
});

describe('缓存机制单元测试', () => {
  describe('1. LRU 缓存', () => {
    it('应该实现 LRU 淘汰策略', () => {
      class LRUCache<K, V> {
        private cache = new Map<K, V>();
        private maxSize: number;

        constructor(maxSize: number) {
          this.maxSize = maxSize;
        }

        get(key: K): V | undefined {
          if (!this.cache.has(key)) return undefined;

          // 移到最后（最近使用）
          const value = this.cache.get(key)!;
          this.cache.delete(key);
          this.cache.set(key, value);
          return value;
        }

        set(key: K, value: V): void {
          if (this.cache.has(key)) {
            this.cache.delete(key);
          } else if (this.cache.size >= this.maxSize) {
            // 删除最旧的（第一个）
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
          }
          this.cache.set(key, value);
        }

        size(): number {
          return this.cache.size;
        }
      }

      const cache = new LRUCache<string, string>(3);

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      expect(cache.size()).toBe(3);

      cache.set('d', '4'); // 应该淘汰 'a'
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('d')).toBe('4');

      cache.get('b'); // 访问 'b'，使其成为最近使用
      cache.set('e', '5'); // 应该淘汰 'c'（最久未使用）
      expect(cache.get('c')).toBeUndefined();
      expect(cache.get('b')).toBe('2');
    });
  });

  describe('2. 语义缓存', () => {
    it('应该基于相似度匹配缓存', () => {
      interface CacheEntry {
        query: string;
        queryVector: number[];
        results: any[];
      }

      class SemanticCache {
        private cache: CacheEntry[] = [];
        private similarityThreshold = 0.85;

        private cosineSimilarity(a: number[], b: number[]): number {
          let dotProduct = 0;
          let normA = 0;
          let normB = 0;

          for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
          }

          return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        }

        set(query: string, queryVector: number[], results: any[]): void {
          this.cache.push({ query, queryVector, results });
        }

        get(queryVector: number[]): any[] | null {
          for (const entry of this.cache) {
            const similarity = this.cosineSimilarity(queryVector, entry.queryVector);
            if (similarity >= this.similarityThreshold) {
              return entry.results;
            }
          }
          return null;
        }
      }

      const cache = new SemanticCache();
      const query1Vector = [1, 0, 0];
      const query2Vector = [0.95, 0.1, 0]; // 相似
      const query3Vector = [0, 1, 0]; // 不相似

      const results = [{ id: 'doc1', content: 'test' }];

      cache.set('query1', query1Vector, results);

      // 相似查询应该命中缓存
      expect(cache.get(query2Vector)).toEqual(results);

      // 不相似查询应该未命中
      expect(cache.get(query3Vector)).toBeNull();
    });
  });
});

describe('性能优化单元测试', () => {
  describe('1. 批处理', () => {
    it('应该支持批量 embedding', async () => {
      const batchEmbed = async (texts: string[]): Promise<number[][]> => {
        // Mock 批量 embedding
        return texts.map(() => Array(128).fill(0).map(() => Math.random()));
      };

      const texts = Array(10).fill('test text');
      const embeddings = await batchEmbed(texts);

      expect(embeddings.length).toBe(texts.length);
      expect(embeddings[0].length).toBe(128);
    });
  });

  describe('2. 并行处理', () => {
    it('应该支持并行搜索', async () => {
      const search = async (query: string): Promise<any[]> => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return [{ id: 'doc1', content: query }];
      };

      const queries = ['query1', 'query2', 'query3'];
      const results = await Promise.all(queries.map(q => search(q)));

      expect(results.length).toBe(queries.length);
    });
  });
});
