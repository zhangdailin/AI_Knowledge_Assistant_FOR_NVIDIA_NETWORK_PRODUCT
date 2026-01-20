/**
 * 服务器端存储管理器
 * 替代 localStorage，将所有数据存储在服务器上，实现多用户共享
 */

import { Document, Chunk } from './localStorage';
import { getApiServerUrl } from '../utils/apiUtils';

// 自定义错误类型，用于区分网络错误和空结果
export class StorageError extends Error {
  constructor(message: string, public readonly isNetworkError: boolean = false) {
    super(message);
    this.name = 'StorageError';
  }
}


class ServerStorageManager {
  private get apiUrl(): string {
    return getApiServerUrl();
  }

  constructor() {
    // No initialization needed for dynamic property
  }

  // 文档管理
  async getDocuments(params?: {
    page?: number;
    limit?: number;
    category?: string;
    status?: string;
    search?: string;
  }): Promise<{ documents: Document[]; pagination?: { page: number; limit: number; total: number; totalPages: number } }> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.category) queryParams.append('category', params.category);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.search) queryParams.append('search', params.search);

      const url = `${this.apiUrl}/api/documents${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new StorageError(`获取文档列表失败: ${res.statusText}`, true);
      }
      const data = await res.json();
      return {
        documents: data.documents || [],
        pagination: data.pagination
      };
    } catch (error) {
      console.error('获取文档列表失败:', error);
      // 重新抛出错误，让调用者决定如何处理
      if (error instanceof StorageError) throw error;
      throw new StorageError(error instanceof Error ? error.message : '网络错误', true);
    }
  }

  async getDocument(documentId: string): Promise<Document | null> {
    try {
      const res = await fetch(`${this.apiUrl}/api/documents/${documentId}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new StorageError(`获取文档失败: ${res.statusText}`, true);
      }
      const data = await res.json();
      return data.document || null;
    } catch (error) {
      console.error('获取文档失败:', error);
      if (error instanceof StorageError) throw error;
      throw new StorageError(error instanceof Error ? error.message : '网络错误', true);
    }
  }

  async createDocument(documentData: Omit<Document, 'id' | 'uploadedAt'> | Partial<Omit<Document, 'id' | 'uploadedAt'>>): Promise<Document> {
    try {
      // 确保有 userId（如果没有提供，使用默认值）
      const docData = {
        userId: 'shared', // 服务器存储使用共享用户ID
        ...documentData
      };

      const res = await fetch(`${this.apiUrl}/api/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(docData)
      });
      if (!res.ok) {
        throw new Error(`创建文档失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.document;
    } catch (error) {
      console.error('创建文档失败:', error);
      throw error;
    }
  }

  async updateDocument(documentId: string, updates: Partial<Document>): Promise<Document | null> {
    try {
      const res = await fetch(`${this.apiUrl}/api/documents/${documentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`更新文档失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.document || null;
    } catch (error) {
      console.error('更新文档失败:', error);
      return null;
    }
  }

  async moveDocumentCategory(documentId: string, categoryId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/api/documents/${documentId}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId })
      });
      if (!res.ok) {
        throw new Error(`移动文档失败: ${res.statusText}`);
      }
      return true;
    } catch (error) {
      console.error('移动文档失败:', error);
      return false;
    }
  }

  async deleteDocument(documentId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/api/documents/${documentId}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`删除文档失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.deleted === true;
    } catch (error) {
      console.error('删除文档失败:', error);
      return false;
    }
  }

  // Chunks 管理
  async getChunks(documentId: string): Promise<Chunk[]> {
    try {
      const res = await fetch(`${this.apiUrl}/api/documents/${documentId}/chunks`);
      if (!res.ok) {
        throw new Error(`获取 chunks 失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.chunks || [];
    } catch (error) {
      console.error('获取 chunks 失败:', error);
      return [];
    }
  }

  async getChunk(documentId: string, chunkId: string): Promise<Chunk | null> {
    try {
      const res = await fetch(`${this.apiUrl}/api/documents/${documentId}/chunks/${chunkId}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`获取 chunk 失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.chunk || null;
    } catch (error) {
      console.error('获取 chunk 失败:', error);
      return null;
    }
  }

  async getAllChunks(): Promise<Chunk[]> {
    try {
      const res = await fetch(`${this.apiUrl}/api/chunks`);
      if (!res.ok) {
        throw new Error(`获取所有 chunks 失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.chunks || [];
    } catch (error) {
      console.error('获取所有 chunks 失败:', error);
      return [];
    }
  }

  async createChunks(documentId: string, chunks: Omit<Chunk, 'id' | 'documentId' | 'createdAt'>[]): Promise<Chunk[]> {
    try {
      const res = await fetch(`${this.apiUrl}/api/documents/${documentId}/chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunks })
      });
      if (!res.ok) {
        throw new Error(`创建 chunks 失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.chunks || [];
    } catch (error) {
      console.error('创建 chunks 失败:', error);
      throw error;
    }
  }

  // 知识图谱
  async getKnowledgeGraphStats(): Promise<{ knowledgeGraph: Record<string, number>; status: string; error?: string }> {
    try {
      const res = await fetch(`${this.apiUrl}/api/knowledge-graph/stats`);
      if (!res.ok) {
        throw new Error(`获取知识图谱状态失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data;
    } catch (error) {
      console.error('获取知识图谱状态失败:', error);
      throw error;
    }
  }

  async initKnowledgeGraph(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await fetch(`${this.apiUrl}/api/knowledge-graph/init`, {
        method: 'POST'
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `初始化知识图谱失败: ${res.statusText}`);
      }
      return await res.json();
    } catch (error) {
      console.error('初始化知识图谱失败:', error);
      throw error;
    }
  }

  async buildKnowledgeGraph(documentId?: string): Promise<{ ok: boolean; message?: string }> {
    const endpoint = documentId
      ? `/api/knowledge-graph/process/${documentId}`
      : '/api/knowledge-graph/build';
    try {
      const res = await fetch(`${this.apiUrl}${endpoint}`, {
        method: 'POST'
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `构建知识图谱失败: ${res.statusText}`);
      }
      return await res.json();
    } catch (error) {
      console.error('构建知识图谱失败:', error);
      throw error;
    }
  }

  async uploadDocument(formData: FormData): Promise<Document> {
    const url = getApiServerUrl();
    try {
      const controller = new AbortController();
      // 增加超时时间到5分钟，处理大文件
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 300秒 = 5分钟

      const res = await fetch(`${url}/api/documents/upload`, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `上传失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.document;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('上传超时（超过5分钟）。文件可能过大或网络连接不稳定。请尝试：\n1. 分割文件为更小的部分\n2. 检查网络连接\n3. 稍后重试');
        }
        if (error.message.includes('Failed to fetch')) {
          throw new Error('无法连接到服务器。请确保：\n1. 后端服务器运行在 http://localhost:8787\n2. 后端已配置 CORS 跨域支持\n3. 网络连接正常');
        }
      }
      console.error('上传文档失败:', error);
      throw error;
    }
  }

  async updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/api/chunks/${chunkId}/embedding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedding })
      });
      if (!res.ok) {
        if (res.status === 404) return false;
        throw new Error(`更新 embedding 失败: ${res.statusText}`);
      }
      return true;
    } catch (error) {
      console.error('更新 embedding 失败:', error);
      return false;
    }
  }

  async deleteChunksByDocument(documentId: string): Promise<number> {
    // 删除文档时会自动删除相关的 chunks，这里不需要单独实现
    return 0;
  }

  async searchChunks(query: string, limit: number = 30): Promise<Chunk[]> {
    try {
      const res = await fetch(`${this.apiUrl}/api/chunks/search?q=${encodeURIComponent(query)}&limit=${limit}`);
      if (!res.ok) {
        throw new Error(`搜索 chunks 失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.chunks || [];
    } catch (error) {
      console.error('搜索 chunks 失败:', error);
      return [];
    }
  }

  async vectorSearchChunks(embedding: number[], limit: number = 30): Promise<{ chunk: Chunk; score: number }[]> {
    try {
      const res = await fetch(`${this.apiUrl}/api/chunks/vector-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedding, limit })
      });
      if (!res.ok) {
        throw new Error(`向量搜索失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.results || [];
    } catch (error) {
      console.error('向量搜索失败:', error);
      return [];
    }
  }

  // 设置管理
  async getSettings(): Promise<any> {
    try {
      const res = await fetch(`${this.apiUrl}/api/settings`);
      if (!res.ok) {
        throw new Error(`获取设置失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.settings || {};
    } catch (error) {
      console.error('获取设置失败:', error);
      return {};
    }
  }

  async updateSettings(updates: any): Promise<any> {
    try {
      const res = await fetch(`${this.apiUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!res.ok) {
        throw new Error(`更新设置失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.settings || {};
    } catch (error) {
      console.error('更新设置失败:', error);
      throw error;
    }
  }

  async getApiKey(provider: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.apiUrl}/api/settings/api-key/${provider}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`获取 API Key 失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.apiKey || null;
    } catch (error) {
      console.error('获取 API Key 失败:', error);
      return null;
    }
  }

  // 任务管理
  async createEmbeddingTask(documentId: string): Promise<any> {
    try {
      console.log(`[前端] 创建 embedding 任务，文档 ID: ${documentId}`);
      const res = await fetch(`${this.apiUrl}/api/documents/${documentId}/generate-embeddings`, {
        method: 'POST'
      });
      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        console.error(`[前端] 创建任务失败: ${res.status} ${res.statusText}`, errorText);
        throw new Error(`创建任务失败: ${res.statusText}`);
      }
      const data = await res.json();
      console.log(`[前端] 任务创建成功: ${data.taskId}`, data.task);
      return data.task;
    } catch (error) {
      console.error('[前端] 创建 embedding 任务失败:', error);
      throw error;
    }
  }

  async getTask(taskId: string): Promise<any> {
    try {
      const res = await fetch(`${this.apiUrl}/api/tasks/${taskId}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`获取任务状态失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.task || null;
    } catch (error) {
      console.error('获取任务状态失败:', error);
      return null;
    }
  }

  async getDocumentTasks(documentId: string): Promise<any[]> {
    try {
      const res = await fetch(`${this.apiUrl}/api/documents/${documentId}/tasks`);
      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`获取文档任务失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.tasks || [];
    } catch (error) {
      console.error('获取文档任务失败:', error);
      return [];
    }
  }

  // 分类管理
  async getCategories(): Promise<any> {
    try {
      const res = await fetch(`${this.apiUrl}/api/categories`);
      if (!res.ok) throw new Error(`获取分类失败: ${res.statusText}`);
      const data = await res.json();
      return data.categories || { tree: [] };
    } catch (error) {
      console.error('获取分类失败:', error);
      return { tree: [] };
    }
  }

  async addCategory(parentId: string | null, name: string): Promise<any> {
    try {
      const res = await fetch(`${this.apiUrl}/api/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, name })
      });
      if (!res.ok) throw new Error(`添加分类失败: ${res.statusText}`);
      const data = await res.json();
      return data.category;
    } catch (error) {
      console.error('添加分类失败:', error);
      throw error;
    }
  }

  async updateCategory(categoryId: string, name: string): Promise<any> {
    try {
      const res = await fetch(`${this.apiUrl}/api/categories/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!res.ok) throw new Error(`更新分类失败: ${res.statusText}`);
      const data = await res.json();
      return data.categories;
    } catch (error) {
      console.error('更新分类失败:', error);
      throw error;
    }
  }

  async deleteCategory(categoryId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/api/categories/${categoryId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error(`删除分类失败: ${res.statusText}`);
      const data = await res.json();
      return data.deleted === true;
    } catch (error) {
      console.error('删除分类失败:', error);
      return false;
    }
  }

  // 重新切片文档
  async rechunkDocument(documentId: string): Promise<{ ok: boolean; message?: string; document?: Document }> {
    try {
      const res = await fetch(`${this.apiUrl}/api/documents/${documentId}/rechunk`, {
        method: 'POST'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `重新切片失败: ${res.statusText}`);
      }
      return await res.json();
    } catch (error) {
      console.error('重新切片文档失败:', error);
      throw error;
    }
  }
}

export const serverStorageManager = new ServerStorageManager();
