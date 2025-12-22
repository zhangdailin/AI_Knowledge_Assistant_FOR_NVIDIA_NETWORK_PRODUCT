/**
 * 服务器端存储管理器
 * 替代 localStorage，将所有数据存储在服务器上，实现多用户共享
 */

import { Document, Chunk } from './localStorage';

function getApiServerUrl(): string {
  // 1. 优先使用用户在前端设置的自定义地址
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('custom_api_server_url');
    if (customUrl) return customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
  }

  // 2. 其次使用环境变量
  const envUrl = import.meta.env.VITE_API_SERVER_URL;
  if (envUrl) {
    return envUrl.endsWith('/') ? envUrl.slice(0, -1) : envUrl;
  }
  // 3. 如果没有环境变量，使用当前页面的 hostname 和默认端口
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = '8787'; // 默认服务器端口
    return `${protocol}//${hostname}:${port}`;
  }
  return 'http://localhost:8787';
}

class ServerStorageManager {
  private apiUrl: string;

  constructor() {
    this.apiUrl = getApiServerUrl();
  }

  // 文档管理
  async getDocuments(): Promise<Document[]> {
    try {
      const res = await fetch(`${this.apiUrl}/api/documents`);
      if (!res.ok) {
        throw new Error(`获取文档列表失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.documents || [];
    } catch (error) {
      console.error('获取文档列表失败:', error);
      return [];
    }
  }

  async getDocument(documentId: string): Promise<Document | null> {
    try {
      const res = await fetch(`${this.apiUrl}/api/documents/${documentId}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`获取文档失败: ${res.statusText}`);
      }
      const data = await res.json();
      return data.document || null;
    } catch (error) {
      console.error('获取文档失败:', error);
      return null;
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

  async uploadDocument(formData: FormData): Promise<Document> {
    const url = getApiServerUrl();
    const res = await fetch(`${url}/api/documents/upload`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error('上传失败');
    const data = await res.json();
    return data.document;
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
}

export const serverStorageManager = new ServerStorageManager();
