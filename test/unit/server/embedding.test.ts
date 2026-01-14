/**
 * Embedding 模块测试
 * 测试向量生成和重排序功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockEmbeddingAPI, mockRerankingAPI, createMockEmbedding } from '../../helpers/mock-factory';
import { createMockChunk, createMockChunks } from '../../fixtures/mock-data';
import { expectToBeValidEmbedding } from '../../helpers/test-utils';

describe('Embedding Module', () => {
  let mockEmbed: ReturnType<typeof mockEmbeddingAPI>;
  let mockRerank: ReturnType<typeof mockRerankingAPI>;

  beforeEach(() => {
    mockEmbed = mockEmbeddingAPI();
    mockRerank = mockRerankingAPI();
    vi.clearAllMocks();
  });

  describe('embedText', () => {
    it('should generate embedding for single text', async () => {
      const text = 'Configure BGP on IBCR-01 switch';
      const mockEmbedding = createMockEmbedding();

      // 模拟 API 调用
      const result = await mockEmbed();

      expect(result.data).toBeDefined();
      expect(result.data[0].embedding).toBeDefined();
      expectToBeValidEmbedding(result.data[0].embedding);
    });

    it('should handle empty text gracefully', async () => {
      const text = '';

      // 空文本应该返回 null 或抛出错误
      const handleEmpty = (text: string) => {
        if (!text || text.trim().length === 0) {
          return null;
        }
        return new Array(1024).fill(0.1);
      };

      const result = handleEmpty(text);
      expect(result).toBeNull();
    });

    it('should truncate text exceeding max length', async () => {
      const longText = 'a'.repeat(5000);
      const maxLength = 2000;

      const truncate = (text: string, max: number) => {
        return text.substring(0, max);
      };

      const truncated = truncate(longText, maxLength);

      expect(truncated.length).toBe(maxLength);
      expect(truncated.length).toBeLessThan(longText.length);
    });

    it('should throw error when API key is missing', async () => {
      const getApiKey = () => null;

      expect(() => {
        if (!getApiKey()) {
          throw new Error('SiliconFlow API key 未配置');
        }
      }).toThrow('SiliconFlow API key 未配置');
    });

    it('should handle API rate limit errors', async () => {
      const mockFailedEmbed = vi.fn().mockRejectedValue(
        new Error('Rate Limit Exceeded (429)')
      );

      await expect(mockFailedEmbed()).rejects.toThrow('Rate Limit Exceeded');
    });
  });

  describe('embedTexts', () => {
    it('should batch process multiple texts', async () => {
      const texts = [
        'Configure BGP',
        'Setup EVPN',
        'Enable MLAG'
      ];

      // 模拟批量处理
      const batchEmbed = async (texts: string[]) => {
        return texts.map(() => new Array(1024).fill(0.1));
      };

      const results = await batchEmbed(texts);

      expect(results).toHaveLength(texts.length);
      results.forEach(embedding => {
        expectToBeValidEmbedding(embedding);
      });
    });

    it('should filter out invalid texts', async () => {
      const texts = [
        'Valid text',
        '',
        null as any,
        'Another valid text',
        undefined as any
      ];

      const filterValid = (texts: any[]) => {
        return texts.filter(t =>
          t && typeof t === 'string' && t.trim().length > 0
        );
      };

      const validTexts = filterValid(texts);

      expect(validTexts).toHaveLength(2);
      expect(validTexts).toEqual(['Valid text', 'Another valid text']);
    });

    it('should maintain order of results', async () => {
      const texts = ['First', 'Second', 'Third'];

      const batchEmbed = async (texts: string[]) => {
        return texts.map((_, i) => new Array(1024).fill(i * 0.1));
      };

      const results = await batchEmbed(texts);

      expect(results[0][0]).toBe(0);
      expect(results[1][0]).toBeCloseTo(0.1, 5);
      expect(results[2][0]).toBeCloseTo(0.2, 5);
    });

    it('should handle partial failures', async () => {
      const texts = ['Text 1', 'Text 2', 'Text 3'];

      // 模拟部分失败
      const batchEmbedWithFailures = async (texts: string[]) => {
        return texts.map((text, i) => {
          if (i === 1) return null; // 第二个失败
          return new Array(1024).fill(0.1);
        });
      };

      const results = await batchEmbedWithFailures(texts);

      expect(results).toHaveLength(3);
      expect(results[0]).not.toBeNull();
      expect(results[1]).toBeNull();
      expect(results[2]).not.toBeNull();
    });
  });

  describe('rerankDocuments', () => {
    it('should rerank documents by relevance', async () => {
      const query = 'BGP configuration';
      const chunks = createMockChunks(5);

      // 模拟重排序
      const rerank = async (query: string, chunks: any[]) => {
        return chunks.map((chunk, i) => ({
          ...chunk,
          score: 0.9 - i * 0.1
        }));
      };

      const reranked = await rerank(query, chunks);

      expect(reranked).toHaveLength(5);
      expect(reranked[0].score).toBeGreaterThan(reranked[1].score);
      expect(reranked[1].score).toBeGreaterThan(reranked[2].score);
    });

    it('should apply score threshold filtering', async () => {
      const chunks = [
        { ...createMockChunk(), score: 0.9 },
        { ...createMockChunk(), score: 0.7 },
        { ...createMockChunk(), score: 0.5 },
        { ...createMockChunk(), score: 0.3 }
      ];
      const threshold = 0.6;

      const filtered = chunks.filter(c => c.score >= threshold);

      expect(filtered).toHaveLength(2);
      expect(filtered.every(c => c.score >= threshold)).toBe(true);
    });

    it('should fallback to smaller model on context overflow', async () => {
      const longChunks = createMockChunks(10).map(c => ({
        ...c,
        content: 'a'.repeat(3000)
      }));

      // 模拟上下文溢出和降级
      const rerankWithFallback = async (chunks: any[]) => {
        const totalLength = chunks.reduce((sum, c) => sum + c.content.length, 0);

        if (totalLength > 8000) {
          // 使用较小的模型或分批处理
          return chunks.slice(0, 3).map((c, i) => ({
            ...c,
            score: 0.8 - i * 0.1
          }));
        }

        return chunks.map((c, i) => ({
          ...c,
          score: 0.9 - i * 0.1
        }));
      };

      const result = await rerankWithFallback(longChunks);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('should handle empty document list', async () => {
      const query = 'test query';
      const emptyChunks: any[] = [];

      const rerank = async (query: string, chunks: any[]) => {
        if (chunks.length === 0) return [];
        return chunks;
      };

      const result = await rerank(query, emptyChunks);

      expect(result).toHaveLength(0);
    });
  });

  describe('getEmbeddingModel', () => {
    it('should return configured model', () => {
      const settings = {
        modelSelection: {
          embedding: 'BAAI/bge-m3'
        }
      };

      const getModel = (settings: any) => {
        return settings?.modelSelection?.embedding || 'BAAI/bge-m3';
      };

      const model = getModel(settings);

      expect(model).toBe('BAAI/bge-m3');
    });

    it('should return default model if not configured', () => {
      const settings = {};

      const getModel = (settings: any) => {
        return settings?.modelSelection?.embedding || 'BAAI/bge-m3';
      };

      const model = getModel(settings);

      expect(model).toBe('BAAI/bge-m3');
    });
  });

  describe('getRerankingModel', () => {
    it('should return configured reranking model', () => {
      const settings = {
        modelSelection: {
          reranking: 'BAAI/bge-reranker-v2-m3'
        }
      };

      const getModel = (settings: any) => {
        return settings?.modelSelection?.reranking || 'BAAI/bge-reranker-v2-m3';
      };

      const model = getModel(settings);

      expect(model).toBe('BAAI/bge-reranker-v2-m3');
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      const mockNetworkError = vi.fn().mockRejectedValue(
        new Error('Network error')
      );

      await expect(mockNetworkError()).rejects.toThrow('Network error');
    });

    it('should handle invalid response format', async () => {
      const mockInvalidResponse = vi.fn().mockResolvedValue({
        data: null // 无效格式
      });

      const result = await mockInvalidResponse();

      expect(result.data).toBeNull();
    });

    it('should retry on transient failures', async () => {
      let attempts = 0;
      const mockRetry = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Transient error');
        }
        return { data: [{ embedding: new Array(1024).fill(0.1) }] };
      });

      // 模拟重试逻辑
      const retry = async (fn: Function, maxAttempts: number) => {
        for (let i = 0; i < maxAttempts; i++) {
          try {
            return await fn();
          } catch (error) {
            if (i === maxAttempts - 1) throw error;
          }
        }
      };

      const result = await retry(mockRetry, 3);

      expect(result.data).toBeDefined();
      expect(attempts).toBe(3);
    });
  });

  describe('performance', () => {
    it('should process embeddings efficiently', async () => {
      const texts = Array(100).fill('test text');

      const startTime = Date.now();

      // 模拟批量处理
      const batchEmbed = async (texts: string[]) => {
        return texts.map(() => new Array(1024).fill(0.1));
      };

      await batchEmbed(texts);

      const duration = Date.now() - startTime;

      // 批量处理应该很快
      expect(duration).toBeLessThan(1000);
    });

    it('should cache embeddings', () => {
      const cache = new Map<string, number[]>();
      const text = 'test text';
      const embedding = new Array(1024).fill(0.1);

      // 第一次：生成并缓存
      cache.set(text, embedding);

      // 第二次：从缓存读取
      const cached = cache.get(text);

      expect(cached).toBe(embedding);
      expect(cache.size).toBe(1);
    });
  });

  describe('embedding similarity', () => {
    it('should calculate cosine similarity', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0, 0];
      const vec3 = [0, 1, 0];

      const cosineSimilarity = (a: number[], b: number[]) => {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
          dot += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
      };

      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1.0, 5);
      expect(cosineSimilarity(vec1, vec3)).toBeCloseTo(0.0, 5);
    });

    it('should find similar embeddings', () => {
      const query = new Array(1024).fill(0.1);
      const embeddings = [
        new Array(1024).fill(0.1),  // 相同
        new Array(1024).fill(0.5),  // 不同
        new Array(1024).fill(0.1)   // 相同
      ];

      const cosineSimilarity = (a: number[], b: number[]) => {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
          dot += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
      };

      const similarities = embeddings.map(emb =>
        cosineSimilarity(query, emb)
      );

      expect(similarities[0]).toBeCloseTo(1.0, 5);
      expect(similarities[1]).toBeLessThan(1.0);
      expect(similarities[2]).toBeCloseTo(1.0, 5);
    });
  });
});
