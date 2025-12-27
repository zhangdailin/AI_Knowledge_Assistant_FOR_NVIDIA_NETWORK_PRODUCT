/**
 * 统一存储管理器
 * 直接使用服务器存储，实现多用户共享
 */

import { Document, Chunk } from './localStorage';
import { serverStorageManager } from './serverStorage';

class UnifiedStorageManager {
  // 文档管理
  async getDocuments(userId?: string): Promise<Document[]> {
    return await serverStorageManager.getDocuments();
  }

  async createDocument(
    userId: string,
    filename: string,
    fileType: string,
    fileSize: number,
    contentPreview: string,
    category?: string,
    maxChunks: number = 1000
  ): Promise<Document> {
    // 服务器存储不需要 userId，所有用户共享，但为了类型兼容性保留 userId
    return await serverStorageManager.createDocument({
      userId, // 虽然服务器端不使用，但保留以保持类型兼容
      filename,
      fileType,
      fileSize,
      category,
      contentPreview,
      maxChunks
    });
  }

  async deleteDocument(documentId: string): Promise<boolean> {
    return await serverStorageManager.deleteDocument(documentId);
  }

  // Chunks 管理
  async getChunks(documentId: string): Promise<Chunk[]> {
    return await serverStorageManager.getChunks(documentId);
  }

  async getChunk(documentId: string, chunkId: string): Promise<Chunk | null> {
    return await serverStorageManager.getChunk(documentId, chunkId);
  }

  async getChunkStats(documentId: string): Promise<any> {
    try {
      const res = await fetch(`${serverStorageManager['apiUrl']}/api/documents/${documentId}/chunk-stats`);
      if (!res.ok) throw new Error('获取统计失败');
      const data = await res.json();
      return data.stats;
    } catch (e) {
      console.error('获取 chunk 统计失败:', e);
      return null;
    }
  }

  async getAllChunks(): Promise<Chunk[]> {
    return await serverStorageManager.getAllChunks();
  }

  async createChunks(docId: string, chunks: any[]): Promise<any[]> {
    // 确保每个 chunk 都有 documentId
    // serverStorageManager.createChunks 需要两个参数: documentId 和 chunks
    // 且 chunks 不需要包含 documentId (因为是作为参数传递的)
    const chunksData = chunks.map(({ documentId, ...rest }) => rest);
    return await serverStorageManager.createChunks(docId, chunksData);
  }

  async uploadDocument(file: File, userId: string, category: string): Promise<Document> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', userId);
    formData.append('category', category);
    return await serverStorageManager.uploadDocument(formData);
  }

  async updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    await serverStorageManager.updateChunkEmbedding(chunkId, embedding);
  }

  async deleteChunksByDocument(documentId: string): Promise<void> {
    await serverStorageManager.deleteChunksByDocument(documentId);
  }

  async cleanupOldChunksWithoutEmbedding(keepCount: number = 500, protectedDocumentIds: string[] = []): Promise<number> {
    // 服务器存储不需要清理（有足够的存储空间）
    return 0;
  }

  async searchSimilarChunks(query: string, limit: number = 5): Promise<{ chunk: Chunk; score: number }[]> {
    const chunks = await serverStorageManager.searchChunks(query, limit);
    // 转换为相同的返回格式
    return chunks.map(chunk => ({ chunk, score: 1.0 }));
  }

  async vectorSearchChunks(embedding: number[], limit: number = 30): Promise<{ chunk: Chunk; score: number }[]> {
    return await serverStorageManager.vectorSearchChunks(embedding, limit);
  }

  async addManualChunk(documentId: string, content: string): Promise<Chunk> {
    const chunks = await serverStorageManager.createChunks(documentId, [{
      content,
      chunkIndex: 0,
      tokenCount: Math.ceil(content.length / 4)
    }]);
    return chunks[0];
  }

  // 获取所有文档（用于调试和统计）
  async getAllDocumentsPublic(): Promise<Document[]> {
    return await serverStorageManager.getDocuments();
  }

  // 更新文档
  async updateDocument(documentId: string, updates: Partial<Document>): Promise<Document | null> {
    return await serverStorageManager.updateDocument(documentId, updates);
  }

  // 设置管理
  async getSettings(): Promise<any> {
    return await serverStorageManager.getSettings();
  }

  async updateSettings(updates: any): Promise<any> {
    return await serverStorageManager.updateSettings(updates);
  }

  async getApiKey(provider: string): Promise<string | null> {
    return await serverStorageManager.getApiKey(provider);
  }

  // 任务管理
  async createEmbeddingTask(documentId: string): Promise<any> {
    return await serverStorageManager.createEmbeddingTask(documentId);
  }

  async getTask(taskId: string): Promise<any> {
    return await serverStorageManager.getTask(taskId);
  }

  async getDocumentTasks(documentId: string): Promise<any[]> {
    return await serverStorageManager.getDocumentTasks(documentId);
  }
}

export const unifiedStorageManager = new UnifiedStorageManager();
