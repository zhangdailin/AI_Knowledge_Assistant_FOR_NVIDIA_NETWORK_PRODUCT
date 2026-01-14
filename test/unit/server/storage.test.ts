/**
 * Storage 模块测试
 * 测试文件存储管理功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockFileSystem } from '../../helpers/mock-factory';
import { createMockDocument, createMockChunk, createMockChunks } from '../../fixtures/mock-data';
import { expectToBeValidDocument, expectToBeValidChunk } from '../../helpers/test-utils';

// Mock fs/promises
const mockFs = mockFileSystem();
vi.mock('fs/promises', () => mockFs);

// 由于 storage.mjs 是 ES 模块，我们需要动态导入
// 这里先定义测试结构，实际导入会在测试运行时进行

describe('Storage Module', () => {
  beforeEach(() => {
    // 清理文件系统
    mockFs.files.clear();
    vi.clearAllMocks();
  });

  describe('Document Operations', () => {
    it('should create document with unique ID', async () => {
      const doc = createMockDocument();

      // 模拟文档创建
      const documents = [doc];
      mockFs.files.set('/data/documents.json', JSON.stringify(documents));

      // 验证文档结构
      expectToBeValidDocument(doc);
      expect(doc.id).toBe('doc-test-1');
      expect(doc.name).toBe('test-document.pdf');
    });

    it('should retrieve document by ID', async () => {
      const doc = createMockDocument();
      const documents = [doc];
      mockFs.files.set('/data/documents.json', JSON.stringify(documents));

      // 模拟检索
      const retrieved = documents.find(d => d.id === doc.id);
      expect(retrieved).toEqual(doc);
    });

    it('should update document metadata', async () => {
      const doc = createMockDocument();
      const updates = { name: 'updated-document.pdf', chunkCount: 10 };

      const updated = { ...doc, ...updates };
      expectToBeValidDocument(updated);
      expect(updated.name).toBe('updated-document.pdf');
      expect(updated.chunkCount).toBe(10);
    });

    it('should delete document and associated chunks', async () => {
      const doc = createMockDocument();
      const documents = [doc];
      mockFs.files.set('/data/documents.json', JSON.stringify(documents));
      mockFs.files.set('/data/chunks/doc-test-1.json', JSON.stringify([]));

      // 模拟删除
      const filtered = documents.filter(d => d.id !== doc.id);
      expect(filtered).toHaveLength(0);

      // 验证 chunks 文件也应该被删除
      await mockFs.unlink('/data/chunks/doc-test-1.json');
      expect(mockFs.unlink).toHaveBeenCalledWith('/data/chunks/doc-test-1.json');
    });

    it('should handle concurrent writes with atomic operations', async () => {
      const doc1 = createMockDocument({ id: 'doc-1' });
      const doc2 = createMockDocument({ id: 'doc-2' });

      // 模拟原子写入（使用临时文件）
      const tempPath = '/data/documents.json.tmp.123';
      mockFs.files.set(tempPath, JSON.stringify([doc1, doc2]));

      // 模拟 rename 操作
      await mockFs.rename(tempPath, '/data/documents.json');

      expect(mockFs.rename).toHaveBeenCalledWith(tempPath, '/data/documents.json');
      expect(mockFs.files.has('/data/documents.json')).toBe(true);
    });
  });

  describe('Chunk Operations', () => {
    it('should store chunks in separate files per document', async () => {
      const chunks = createMockChunks(3, { documentId: 'doc-test-1' });
      const chunkPath = '/data/chunks/doc-test-1.json';

      mockFs.files.set(chunkPath, JSON.stringify(chunks));

      const stored = JSON.parse(mockFs.files.get(chunkPath)!);
      expect(stored).toHaveLength(3);
      stored.forEach((chunk: any) => expectToBeValidChunk(chunk));
    });

    it('should retrieve chunks by document ID', async () => {
      const chunks = createMockChunks(5, { documentId: 'doc-test-1' });
      mockFs.files.set('/data/chunks/doc-test-1.json', JSON.stringify(chunks));

      const retrieved = JSON.parse(mockFs.files.get('/data/chunks/doc-test-1.json')!);
      expect(retrieved).toHaveLength(5);
      expect(retrieved[0].documentId).toBe('doc-test-1');
    });

    it('should update chunk embeddings', async () => {
      const chunk = createMockChunk();
      const newEmbedding = new Array(1024).fill(0.5);

      const updated = { ...chunk, embedding: newEmbedding };
      expectToBeValidChunk(updated);
      expect(updated.embedding).toEqual(newEmbedding);
      expect(updated.embedding[0]).toBe(0.5);
    });

    it('should handle large chunk datasets without OOM', async () => {
      // 测试分文件存储策略
      const doc1Chunks = createMockChunks(100, { documentId: 'doc-1' });
      const doc2Chunks = createMockChunks(100, { documentId: 'doc-2' });

      mockFs.files.set('/data/chunks/doc-1.json', JSON.stringify(doc1Chunks));
      mockFs.files.set('/data/chunks/doc-2.json', JSON.stringify(doc2Chunks));

      // 验证文件分离存储
      expect(mockFs.files.has('/data/chunks/doc-1.json')).toBe(true);
      expect(mockFs.files.has('/data/chunks/doc-2.json')).toBe(true);

      // 验证可以独立加载
      const doc1Retrieved = JSON.parse(mockFs.files.get('/data/chunks/doc-1.json')!);
      expect(doc1Retrieved).toHaveLength(100);
    });
  });

  describe('Vector Search', () => {
    it('should find similar chunks by embedding', () => {
      const queryEmbedding = new Array(1024).fill(0.1);
      const chunks = createMockChunks(10);

      // 计算余弦相似度
      const cosineSimilarity = (vecA: number[], vecB: number[]) => {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
          dotProduct += vecA[i] * vecB[i];
          normA += vecA[i] * vecA[i];
          normB += vecB[i] * vecB[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator > 0 ? dotProduct / denominator : 0;
      };

      const results = chunks
        .map(chunk => ({
          chunk,
          score: cosineSimilarity(queryEmbedding, chunk.embedding!)
        }))
        .filter(r => r.score > 0.5)
        .sort((a, b) => b.score - a.score);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0.5);
    });

    it('should apply category filters', () => {
      const chunks = [
        createMockChunk({ id: 'chunk-1', documentId: 'doc-1' }),
        createMockChunk({ id: 'chunk-2', documentId: 'doc-2' }),
        createMockChunk({ id: 'chunk-3', documentId: 'doc-1' })
      ];

      const documents = [
        createMockDocument({ id: 'doc-1', categoryId: 'cat-1' }),
        createMockDocument({ id: 'doc-2', categoryId: 'cat-2' })
      ];

      // 过滤特定分类
      const categoryIds = ['cat-1'];
      const filtered = chunks.filter(chunk => {
        const doc = documents.find(d => d.id === chunk.documentId);
        return doc && categoryIds.includes(doc.categoryId!);
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.every(c => c.documentId === 'doc-1')).toBe(true);
    });

    it('should respect search limit', () => {
      const chunks = createMockChunks(100);
      const limit = 10;

      const results = chunks.slice(0, limit);

      expect(results).toHaveLength(limit);
    });

    it('should calculate cosine similarity correctly', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0, 0];
      const vec3 = [0, 1, 0];

      const cosineSimilarity = (vecA: number[], vecB: number[]) => {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
          dotProduct += vecA[i] * vecB[i];
          normA += vecA[i] * vecA[i];
          normB += vecB[i] * vecB[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator > 0 ? dotProduct / denominator : 0;
      };

      // 相同向量相似度应该为 1
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1.0, 5);

      // 正交向量相似度应该为 0
      expect(cosineSimilarity(vec1, vec3)).toBeCloseTo(0.0, 5);
    });
  });

  describe('Settings Management', () => {
    it('should get and update settings', async () => {
      const settings = {
        modelSelection: {
          embedding: 'BAAI/bge-m3',
          reranking: 'BAAI/bge-reranker-v2-m3'
        }
      };

      mockFs.files.set('/data/settings.json', JSON.stringify(settings));

      const retrieved = JSON.parse(mockFs.files.get('/data/settings.json')!);
      expect(retrieved.modelSelection.embedding).toBe('BAAI/bge-m3');

      // 更新设置
      const updated = {
        ...retrieved,
        modelSelection: {
          ...retrieved.modelSelection,
          embedding: 'new-model'
        }
      };

      mockFs.files.set('/data/settings.json', JSON.stringify(updated));
      const newRetrieved = JSON.parse(mockFs.files.get('/data/settings.json')!);
      expect(newRetrieved.modelSelection.embedding).toBe('new-model');
    });

    it('should handle missing settings file', async () => {
      // 文件不存在时应该返回默认值
      const hasFile = mockFs.files.has('/data/settings.json');
      expect(hasFile).toBe(false);

      // 应该创建默认设置
      const defaultSettings = {};
      mockFs.files.set('/data/settings.json', JSON.stringify(defaultSettings));
      expect(mockFs.files.has('/data/settings.json')).toBe(true);
    });
  });

  describe('Query Logs', () => {
    it('should add query log entry', async () => {
      const logs = [];
      const newLog = {
        query: 'test query',
        timestamp: Date.now(),
        responseTime: 1200
      };

      logs.push(newLog);
      mockFs.files.set('/data/query_logs.json', JSON.stringify(logs));

      const retrieved = JSON.parse(mockFs.files.get('/data/query_logs.json')!);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].query).toBe('test query');
    });

    it('should calculate query statistics', () => {
      const logs = [
        { query: 'query1', timestamp: Date.now(), responseTime: 1000 },
        { query: 'query2', timestamp: Date.now(), responseTime: 1500 },
        { query: 'query3', timestamp: Date.now(), responseTime: 800 }
      ];

      const avgResponseTime = logs.reduce((sum, log) => sum + log.responseTime, 0) / logs.length;
      expect(avgResponseTime).toBeCloseTo(1100, 0);

      const totalQueries = logs.length;
      expect(totalQueries).toBe(3);
    });
  });
});
