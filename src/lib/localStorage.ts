/**
 * 本地存储管理器
 * 用于替代Supabase，提供用户数据、对话历史、知识库文档的本地存储
 * chunks 数据使用 IndexedDB 存储（通过 hybridStorage），提供更大的存储容量
 */

import { hybridStorage } from './hybridStorage';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface Document {
  id: string;
  userId: string;
  filename: string;
  fileType: string;
  fileSize: number;
  category?: string;
  contentPreview: string;
  uploadedAt: string;
  maxChunks?: number; // 每个文档的最大chunks数量（rack配额），默认1000
}

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  embedding?: number[];
  chunkIndex: number;
  tokenCount: number;
  createdAt: string;
  parentId?: string; // 父 chunk 的 ID（用于父子文本切块）
  chunkType?: 'parent' | 'child'; // chunk 类型：parent 为父块（较大），child 为子块（较小）
}

class LocalStorageManager {
  private readonly PREFIX = 'ai_assistant_';

  // 用户相关
  private readonly USERS_KEY = this.PREFIX + 'users';
  private readonly CURRENT_USER_KEY = this.PREFIX + 'current_user';

  // 对话相关
  private readonly CONVERSATIONS_KEY = this.PREFIX + 'conversations';
  private readonly MESSAGES_KEY = this.PREFIX + 'messages';

  // 知识库相关
  private readonly DOCUMENTS_KEY = this.PREFIX + 'documents';
  private readonly CHUNKS_KEY = this.PREFIX + 'chunks';

  // 用户设置相关
  private readonly USER_SETTINGS_KEY = this.PREFIX + 'user_settings';

  // 初始化默认用户
  private initializeDefaultUsers() {
    if (!localStorage.getItem(this.USERS_KEY)) {
      const defaultUsers: User[] = [
        {
          id: 'admin-001',
          email: 'admin@example.com',
          name: '管理员',
          role: 'admin',
          createdAt: new Date().toISOString()
        },
        {
          id: 'user-001',
          email: 'user@example.com',
          name: '测试用户',
          role: 'user',
          createdAt: new Date().toISOString()
        }
      ];
      localStorage.setItem(this.USERS_KEY, JSON.stringify(defaultUsers));
    }
  }

  constructor() {
    this.initializeDefaultUsers();
  }

  // 用户管理（已移除未使用的方法）


  setCurrentUser(user: User | null) {
    if (user) {
      localStorage.setItem(this.CURRENT_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(this.CURRENT_USER_KEY);
    }
  }

  getCurrentUser(): User | null {
    const user = localStorage.getItem(this.CURRENT_USER_KEY);
    return user ? JSON.parse(user) : null;
  }

  // 对话管理
  getConversations(userId: string): Conversation[] {
    const conversations = localStorage.getItem(this.CONVERSATIONS_KEY);
    const allConversations = conversations ? JSON.parse(conversations) : [];
    return allConversations.filter((conv: Conversation) => conv.userId === userId);
  }

  createConversation(userId: string, title: string): Conversation {
    const conversations = this.getConversations(userId);
    const newConversation: Conversation = {
      id: `conv-${Date.now()}`,
      userId,
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    conversations.push(newConversation);
    
    try {
      localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(conversations));
    } catch (error: any) {
      // 如果存储空间不足，清理旧数据后重试
      if (error.name === 'QuotaExceededError') {
        console.warn('localStorage 空间不足，正在清理旧数据...');
        this.cleanupOldData(userId);
        // 重试
        try {
    localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(conversations));
        } catch (retryError) {
          // 如果还是失败，只保留最近的对话
          const recentConversations = conversations.slice(-10); // 只保留最近10个对话
          localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(recentConversations));
          console.warn('已清理旧对话，只保留最近10个');
        }
      } else {
        throw error;
      }
    }
    
    return newConversation;
  }

  updateConversation(conversationId: string, updates: Partial<Conversation>) {
    const conversations = this.getAllConversations();
    const index = conversations.findIndex(conv => conv.id === conversationId);
    if (index !== -1) {
      conversations[index] = { ...conversations[index], ...updates, updatedAt: new Date().toISOString() };
      localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(conversations));
    }
  }

  deleteConversation(conversationId: string) {
    // 删除对话
    const conversations = this.getAllConversations();
    const filteredConversations = conversations.filter(conv => conv.id !== conversationId);
    localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(filteredConversations));
    
    // 删除该对话的所有消息
    const messages = this.getAllMessages();
    const filteredMessages = messages.filter((msg: Message) => msg.conversationId !== conversationId);
    localStorage.setItem(this.MESSAGES_KEY, JSON.stringify(filteredMessages));
  }

  private getAllConversations(): Conversation[] {
    const conversations = localStorage.getItem(this.CONVERSATIONS_KEY);
    return conversations ? JSON.parse(conversations) : [];
  }

  // 消息管理
  getMessages(conversationId: string): Message[] {
    const messages = localStorage.getItem(this.MESSAGES_KEY);
    const allMessages = messages ? JSON.parse(messages) : [];
    return allMessages.filter((msg: Message) => msg.conversationId === conversationId);
  }

  addMessage(message: Omit<Message, 'id' | 'createdAt'>): Message {
    const newMessage: Message = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString()
    };
    
    // 尝试添加消息，如果失败则清理后重试
    let messages = this.getAllMessages();
    messages.push(newMessage);
    
    try {
    localStorage.setItem(this.MESSAGES_KEY, JSON.stringify(messages));
    } catch (error: any) {
      // 如果存储空间不足，清理旧消息后重试
      if (error.name === 'QuotaExceededError') {
        console.warn('localStorage 空间不足，正在清理旧消息...');
        
        // 按时间排序，最新的在前
        const sortedMessages = messages.sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        
        // 尝试不同的保留数量，从大到小
        const keepCounts = [500, 200, 100, 50, 20, 10];
        let success = false;
        
        for (const keepCount of keepCounts) {
          try {
            const keptMessages = sortedMessages.slice(0, keepCount);
            // 确保新消息在列表中（如果不在前keepCount条中）
            if (!keptMessages.find(m => m.id === newMessage.id)) {
              keptMessages[keptMessages.length - 1] = newMessage;
            }
            localStorage.setItem(this.MESSAGES_KEY, JSON.stringify(keptMessages));
            console.warn(`已清理旧消息，只保留最近${keepCount}条，新消息已添加`);
            success = true;
            break;
          } catch (retryError: any) {
            // 继续尝试下一个数量
            continue;
          }
        }
        
        if (!success) {
          // 如果所有尝试都失败，只保存新消息
          try {
            localStorage.setItem(this.MESSAGES_KEY, JSON.stringify([newMessage]));
            console.warn('所有清理尝试都失败，只保留新消息');
          } catch (finalError: any) {
            // 如果连一条消息都存不下，抛出错误
            console.error('无法存储消息，localStorage 空间严重不足:', finalError);
            throw new Error('无法存储消息：localStorage 空间严重不足，请清理浏览器数据');
          }
        }
      } else {
        throw error;
      }
    }
    
    // 更新对话时间
    try {
    this.updateConversation(message.conversationId, { updatedAt: new Date().toISOString() });
    } catch (error) {
      // 如果更新对话时间失败，不影响消息添加
      console.warn('更新对话时间失败:', error);
    }
    
    return newMessage;
  }

  private getAllMessages(): Message[] {
    const messages = localStorage.getItem(this.MESSAGES_KEY);
    return messages ? JSON.parse(messages) : [];
  }

  // 文档管理
  getDocuments(userId: string): Document[] {
    const documents = localStorage.getItem(this.DOCUMENTS_KEY);
    const allDocuments = documents ? JSON.parse(documents) : [];
    return allDocuments.filter((doc: Document) => doc.userId === userId);
  }

  createDocument(userId: string, filename: string, fileType: string, fileSize: number, contentPreview: string, category?: string, maxChunks: number = 1000): Document {
    const documents = this.getDocuments(userId);
    const newDocument: Document = {
      id: `doc-${Date.now()}`,
      userId,
      filename,
      fileType,
      fileSize,
      category,
      contentPreview,
      uploadedAt: new Date().toISOString(),
      maxChunks // 每个文档的chunks配额（rack），默认1000
    };
    documents.push(newDocument);
    localStorage.setItem(this.DOCUMENTS_KEY, JSON.stringify(documents));
    return newDocument;
  }

  async deleteDocument(documentId: string): Promise<void> {
    const documents = this.getAllDocuments();
    const filteredDocuments = documents.filter(doc => doc.id !== documentId);
    localStorage.setItem(this.DOCUMENTS_KEY, JSON.stringify(filteredDocuments));
    
    // 同时删除相关的chunks
    await this.deleteChunksByDocument(documentId);
  }

  private getAllDocuments(): Document[] {
    const documents = localStorage.getItem(this.DOCUMENTS_KEY);
    return documents ? JSON.parse(documents) : [];
  }

  // 公共方法：获取所有文档（用于调试和统计）
  getAllDocumentsPublic(): Document[] {
    return this.getAllDocuments();
  }

  async addManualChunk(documentId: string, content: string): Promise<Chunk> {
    const newChunk: Chunk = {
      id: `chunk-manual-${Date.now()}`,
      documentId,
      content,
      chunkIndex: 0,
      tokenCount: Math.ceil(content.length / 4),
      createdAt: new Date().toISOString()
    };
    const all = await this.getAllChunks();
    all.push(newChunk);
    await hybridStorage.setItem(this.CHUNKS_KEY, JSON.stringify(all));
    return newChunk;
  }

  updateDocument(documentId: string, updates: Partial<Document>): Document | null {
    const all = this.getAllDocuments();
    const idx = all.findIndex(d => d.id === documentId);
    if (idx === -1) return null;
    const updated = { ...all[idx], ...updates } as Document;
    all[idx] = updated;
    localStorage.setItem(this.DOCUMENTS_KEY, JSON.stringify(all));
    return updated;
  }

  // 文档片段管理
  async getChunks(documentId: string): Promise<Chunk[]> {
    const chunks = await hybridStorage.getItem(this.CHUNKS_KEY);
    const allChunks = chunks ? JSON.parse(chunks) : [];
    return allChunks.filter((chunk: Chunk) => chunk.documentId === documentId);
  }

  async createChunks(documentId: string, chunks: Omit<Chunk, 'id' | 'documentId' | 'createdAt'>[]): Promise<Chunk[]> {
    // 检查文档的chunks配额（rack）
    const doc = this.getAllDocuments().find(d => d.id === documentId);
    const maxChunks = doc?.maxChunks || 1000; // 默认每个文档最多1000个chunks
    const existingChunksForDoc = await this.getChunks(documentId);
    
    // 如果已有chunks + 新chunks超过配额，只保留最新的chunks
    if (existingChunksForDoc.length + chunks.length > maxChunks) {
      const excess = existingChunksForDoc.length + chunks.length - maxChunks;
      console.warn(`文档 ${documentId} 的chunks数量将超过配额（${maxChunks}），将只保留最新的 ${maxChunks} 个chunks，丢弃 ${excess} 个chunks`);
      
      // 计算可以保留的existing chunks数量
      const availableForNew = Math.max(0, maxChunks - existingChunksForDoc.length);
      const chunksToCreate = Math.min(chunks.length, availableForNew);
      const chunksToDiscard = chunks.length - chunksToCreate;
      
      // 如果新chunks数量超过可用空间，只保留最新的existing chunks
      if (chunksToCreate < chunks.length) {
        const sortedExisting = existingChunksForDoc.sort((a, b) => 
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
        const keptExisting = sortedExisting.slice(0, Math.max(0, maxChunks - chunksToCreate));
        
        // 删除被丢弃的existing chunks
        const allChunks = await this.getAllChunks();
        const chunksToKeep = allChunks.filter(c => c.documentId !== documentId || keptExisting.some(k => k.id === c.id));
        await hybridStorage.setItem(this.CHUNKS_KEY, JSON.stringify(chunksToKeep));
        
        // 只创建允许数量的chunks
        chunks = chunks.slice(0, chunksToCreate);
      } else {
        // 新chunks可以全部创建，但需要删除一些existing chunks
        const sortedExisting = existingChunksForDoc.sort((a, b) => 
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
        const keptExisting = sortedExisting.slice(0, Math.max(0, maxChunks - chunks.length));
        
        // 删除被丢弃的existing chunks
        const allChunks = await this.getAllChunks();
        const chunksToKeep = allChunks.filter(c => c.documentId !== documentId || keptExisting.some(k => k.id === c.id));
        await hybridStorage.setItem(this.CHUNKS_KEY, JSON.stringify(chunksToKeep));
      }
    }
    
    const existingChunks = await this.getAllChunks();
    const parentIdMap = new Map<string, string>(); // 临时 parentId -> 实际 chunk ID 的映射
    const newChunks: Chunk[] = [];
    const now = new Date().toISOString();
    const timestamp = Date.now();
    
    // 先创建父块
    const parentChunks = chunks.filter(c => c.chunkType === 'parent' || !c.chunkType);
    parentChunks.forEach((chunk, index) => {
      const newChunk: Chunk = {
        ...chunk,
        id: `chunk-${timestamp}-${index}`,
        documentId,
        createdAt: now
      };
      newChunks.push(newChunk);
      // 如果 parentId 是临时 ID，建立映射
      if (chunk.parentId && chunk.parentId.startsWith('parent-')) {
        parentIdMap.set(chunk.parentId, newChunk.id);
      }
    });
    
    // 再创建子块，并更新 parentId
    const childChunks = chunks.filter(c => c.chunkType === 'child');
    childChunks.forEach((chunk, index) => {
      const newChunk: Chunk = {
      ...chunk,
        id: `chunk-${timestamp}-${parentChunks.length + index}`,
      documentId,
        createdAt: now
      };
      // 如果 parentId 是临时 ID，更新为实际的 chunk ID
      if (newChunk.parentId && newChunk.parentId.startsWith('parent-')) {
        const actualParentId = parentIdMap.get(newChunk.parentId);
        if (actualParentId) {
          newChunk.parentId = actualParentId;
        } else {
          // 如果找不到对应的父块，尝试通过 chunkIndex 匹配
          const parentChunk = newChunks.find(c => 
            c.chunkType === 'parent' && 
            c.documentId === documentId &&
            Math.abs(c.chunkIndex - newChunk.chunkIndex) < 10
          );
          if (parentChunk) {
            newChunk.parentId = parentChunk.id;
          } else {
            // 如果还是找不到，移除 parentId
            delete newChunk.parentId;
          }
        }
      }
      newChunks.push(newChunk);
    });
    
    existingChunks.push(...newChunks);
    try {
      await hybridStorage.setItem(this.CHUNKS_KEY, JSON.stringify(existingChunks));
    } catch (error: any) {
      if (error.name === 'QuotaExceededError') {
        console.error('localStorage空间不足，无法创建chunks');
        // 尝试清理后重试
        await this.cleanupOldChunksWithoutEmbedding(500, [documentId]);
        try {
          await hybridStorage.setItem(this.CHUNKS_KEY, JSON.stringify(existingChunks));
        } catch (retryError) {
          console.error('清理后仍然无法保存chunks:', retryError);
          throw retryError;
        }
      } else {
        throw error;
      }
    }
    return newChunks;
  }

  async deleteChunksByDocument(documentId: string): Promise<void> {
    const chunks = await this.getAllChunks();
    // 只删除指定文档的chunks，确保不影响其他文档
    const filteredChunks = chunks.filter(chunk => chunk.documentId !== documentId);
    
    try {
      await hybridStorage.setItem(this.CHUNKS_KEY, JSON.stringify(filteredChunks));
      const deletedCount = chunks.length - filteredChunks.length;
      if (deletedCount > 0) {
        console.log(`已删除文档 ${documentId} 的 ${deletedCount} 个chunks，保留其他文档的 ${filteredChunks.length} 个chunks`);
      }
    } catch (error: any) {
      console.error('删除chunks失败:', error);
      throw error;
    }
  }

  private async getAllChunks(): Promise<Chunk[]> {
    const chunks = await hybridStorage.getItem(this.CHUNKS_KEY);
    return chunks ? JSON.parse(chunks) : [];
  }

  // 公共方法：获取所有chunks（用于搜索）
  // 只返回存在的文档的chunks，自动过滤已删除文档的孤立chunks
  async getAllChunksForSearch(): Promise<Chunk[]> {
    const all = await this.getAllChunks();
    // 获取所有存在的文档ID
    const existingDocuments = this.getAllDocuments();
    const existingDocumentIds = new Set(existingDocuments.map(d => d.id));
    
    // 只返回存在的文档的chunks
    const validChunks = all.filter(c => existingDocumentIds.has(c.documentId));
    
    // 如果发现孤立chunks，自动清理（但不在搜索时清理，避免影响性能）
    const orphanedChunks = all.filter(c => !existingDocumentIds.has(c.documentId));
    if (orphanedChunks.length > 0) {
      console.warn(`发现 ${orphanedChunks.length} 个已删除文档的孤立chunks，将在下次清理时移除`);
    }
    
    
    return validChunks;
  }

  // 公共方法：清理旧的没有embedding的chunks（按文档分组，确保每个文档至少保留一些chunks）
  // protectedDocumentIds: 要保护的文档ID列表，这些文档的chunks不会被清理
  async cleanupOldChunksWithoutEmbedding(keepCount: number = 500, protectedDocumentIds: string[] = []): Promise<number> {
    const all = await this.getAllChunks();
    const chunksWithEmbedding = all.filter(c => Array.isArray(c.embedding) && c.embedding.length > 0);
    const chunksWithoutEmbedding = all.filter(c => !Array.isArray(c.embedding) || c.embedding.length === 0);
    
    if (chunksWithoutEmbedding.length <= keepCount) {
      return 0; // 不需要清理
    }
    
    // 按文档分组，确保每个文档的数据独立处理
    const chunksByDocument = new Map<string, typeof chunksWithoutEmbedding>();
    chunksWithoutEmbedding.forEach(chunk => {
      if (!chunksByDocument.has(chunk.documentId)) {
        chunksByDocument.set(chunk.documentId, []);
      }
      chunksByDocument.get(chunk.documentId)!.push(chunk);
    });
    
    // 获取所有存在的文档ID，确保只清理存在的文档的chunks
    const existingDocuments = this.getAllDocuments();
    const existingDocumentIds = new Set(existingDocuments.map(d => d.id));
    
    // 只处理存在的文档的chunks，已删除文档的chunks应该已经被清理了
    const validChunksWithoutEmbedding = chunksWithoutEmbedding.filter(c => existingDocumentIds.has(c.documentId));
    
    // 先清理已删除文档的chunks（这些不应该存在，但为了安全起见）
    const orphanedChunks = chunksWithoutEmbedding.filter(c => !existingDocumentIds.has(c.documentId));
    if (orphanedChunks.length > 0) {
      console.warn(`发现 ${orphanedChunks.length} 个已删除文档的chunks，正在清理...`);
    }
    
    // 分离受保护的文档和其他文档
    const protectedDocIds = new Set(protectedDocumentIds);
    const protectedChunks = validChunksWithoutEmbedding.filter(c => protectedDocIds.has(c.documentId));
    const unprotectedChunks = validChunksWithoutEmbedding.filter(c => !protectedDocIds.has(c.documentId));
    
    // 受保护的文档的chunks全部保留
    // 只清理未受保护的文档的chunks
    const unprotectedChunksByDocument = new Map<string, typeof unprotectedChunks>();
    unprotectedChunks.forEach(chunk => {
      if (!unprotectedChunksByDocument.has(chunk.documentId)) {
        unprotectedChunksByDocument.set(chunk.documentId, []);
      }
      unprotectedChunksByDocument.get(chunk.documentId)!.push(chunk);
    });
    
    // 按文档分组处理，确保每个文档的数据独立
    // 对每个未受保护的文档，按时间排序，保留最新的chunks
    const keptChunksByDocument = new Map<string, typeof validChunksWithoutEmbedding>();
    unprotectedChunksByDocument.forEach((docChunks, docId) => {
      if (!existingDocumentIds.has(docId)) {
        return; // 跳过已删除的文档
      }
      // 按时间排序，每个文档至少保留一些chunks
      const sorted = docChunks.sort((a, b) => 
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );
      // 每个文档至少保留最近的chunks（按比例分配keepCount，但排除受保护的文档）
      const unprotectedDocCount = Math.max(1, unprotectedChunksByDocument.size);
      const perDocumentKeep = Math.max(1, Math.floor(keepCount / unprotectedDocCount));
      keptChunksByDocument.set(docId, sorted.slice(0, perDocumentKeep));
    });
    
    // 合并所有未受保护文档保留的chunks
    const keptWithoutEmbedding: typeof validChunksWithoutEmbedding = [];
    keptChunksByDocument.forEach(chunks => {
      keptWithoutEmbedding.push(...chunks);
    });
    
    // 如果总数还是超过keepCount，按全局时间排序再截取（但不包括受保护的chunks）
    const finalKeptWithoutEmbedding = keptWithoutEmbedding
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, keepCount);
    
    // 合并：所有有embedding的chunks + 受保护的chunks（全部保留）+ 保留的未受保护文档的chunks
    const cleanedChunks = [...chunksWithEmbedding, ...protectedChunks, ...finalKeptWithoutEmbedding];
    
    // 如果还是太大，尝试更激进的清理策略（但保持按文档分组的原则）
    const cleanupStrategies = [
      { keepEmbedding: chunksWithEmbedding.length, keepWithout: keepCount },
      { keepEmbedding: Math.min(chunksWithEmbedding.length, 1000), keepWithout: 300 },
      { keepEmbedding: Math.min(chunksWithEmbedding.length, 500), keepWithout: 200 },
      { keepEmbedding: Math.min(chunksWithEmbedding.length, 200), keepWithout: 100 },
      { keepEmbedding: Math.min(chunksWithEmbedding.length, 100), keepWithout: 50 }
    ];
    
    for (const strategy of cleanupStrategies) {
      try {
        const sortedWithEmbedding = chunksWithEmbedding.sort((a, b) => 
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
        const keptWithEmbedding = sortedWithEmbedding.slice(0, strategy.keepEmbedding);
        
        // 按文档分组清理没有embedding的chunks（但不清理受保护的文档）
        const unprotectedDocCount = Math.max(1, unprotectedChunksByDocument.size);
        const perDocKeep = Math.max(1, Math.floor(strategy.keepWithout / unprotectedDocCount));
        const keptWithoutByDoc: typeof validChunksWithoutEmbedding = [];
        unprotectedChunksByDocument.forEach((docChunks, docId) => {
          if (!existingDocumentIds.has(docId)) return;
          const sorted = docChunks.sort((a, b) => 
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
          );
          keptWithoutByDoc.push(...sorted.slice(0, perDocKeep));
        });
        const finalKeptWithout = keptWithoutByDoc
          .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
          .slice(0, strategy.keepWithout);
        
        // 合并：所有有embedding的chunks + 受保护的chunks（全部保留）+ 保留的未受保护文档的chunks
        const finalChunks = [...keptWithEmbedding, ...protectedChunks, ...finalKeptWithout];
        
        await hybridStorage.setItem(this.CHUNKS_KEY, JSON.stringify(finalChunks));
        const removedCount = all.length - finalChunks.length;
        console.warn(`已清理 ${removedCount} 个旧的没有embedding的chunks（包括 ${orphanedChunks.length} 个已删除文档的chunks），保留 ${finalChunks.length} 个chunks（受保护: ${protectedChunks.length}，有embedding: ${keptWithEmbedding.length}，无embedding: ${finalKeptWithout.length}）`);
        return removedCount;
      } catch (error: any) {
        if (error.name === 'QuotaExceededError') {
          // 继续尝试下一个策略
          continue;
        } else {
          console.warn('清理chunks失败:', error);
          return 0;
        }
      }
    }
    
    // 所有策略都失败，返回0
    console.warn('所有清理策略都失败，无法清理chunks');
    return 0;
  }

  async updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    const all = await this.getAllChunks();
    const idx = all.findIndex(c => c.id === chunkId);
    if (idx === -1) {
      return; // chunk不存在，直接返回
    }
    
      all[idx] = { ...all[idx], embedding };
    
    try {
      await hybridStorage.setItem(this.CHUNKS_KEY, JSON.stringify(all));
    } catch (error: any) {
      // 如果存储空间不足，清理旧chunks后重试
      if (error.name === 'QuotaExceededError') {
        console.warn('localStorage 空间不足，正在清理旧的chunks...');
        
        // 获取所有存在的文档ID，确保只清理存在的文档的chunks
        const existingDocuments = this.getAllDocuments();
        const existingDocumentIds = new Set(existingDocuments.map(d => d.id));
        
        // 优先清理没有embedding的旧chunks（只清理存在的文档的chunks）
        const chunksWithEmbedding = all.filter(c => 
          Array.isArray(c.embedding) && c.embedding.length > 0 && existingDocumentIds.has(c.documentId)
        );
        const chunksWithoutEmbedding = all.filter(c => 
          (!Array.isArray(c.embedding) || c.embedding.length === 0) && existingDocumentIds.has(c.documentId)
        );
        
        // 清理已删除文档的chunks（这些不应该存在）
        const orphanedChunks = all.filter(c => !existingDocumentIds.has(c.documentId));
        if (orphanedChunks.length > 0) {
          console.warn(`发现 ${orphanedChunks.length} 个已删除文档的chunks，将在清理时移除`);
        }
        
        // 确保当前chunk在列表中
        const currentChunk = all[idx];
        const currentDocumentId = currentChunk.documentId;
        
        // 分离当前文档和其他文档的chunks
        const currentDocChunks = all.filter(c => c.documentId === currentDocumentId);
        const otherDocChunks = all.filter(c => c.documentId !== currentDocumentId && existingDocumentIds.has(c.documentId));
        
        // 按文档分组，确保每个文档的数据独立处理
        const chunksByDocument = new Map<string, typeof chunksWithoutEmbedding>();
        chunksWithoutEmbedding.forEach(chunk => {
          if (!chunksByDocument.has(chunk.documentId)) {
            chunksByDocument.set(chunk.documentId, []);
          }
          chunksByDocument.get(chunk.documentId)!.push(chunk);
        });
        
        // 按时间排序，保留最新的chunks
        const sortedWithEmbedding = chunksWithEmbedding.sort((a, b) => 
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
        
        // 尝试多个清理策略（优先保留当前文档的所有chunks）
        // 对于大量chunks的情况，使用更激进的清理策略
        const totalChunksNeeded = currentDocChunks.length;
        const cleanupStrategies = totalChunksNeeded > 500 ? [
          // 对于超大文档，更激进的清理
          { keepEmbedding: Math.min(chunksWithEmbedding.length, 200), keepWithout: 100 },
          { keepEmbedding: Math.min(chunksWithEmbedding.length, 100), keepWithout: 50 },
          { keepEmbedding: Math.min(chunksWithEmbedding.length, 50), keepWithout: 20 },
          { keepEmbedding: Math.min(chunksWithEmbedding.length, 20), keepWithout: 10 },
          { keepEmbedding: Math.min(chunksWithEmbedding.length, 10), keepWithout: 5 }
        ] : [
          { keepEmbedding: Math.min(chunksWithEmbedding.length, 1000), keepWithout: 500 },
          { keepEmbedding: Math.min(chunksWithEmbedding.length, 500), keepWithout: 300 },
          { keepEmbedding: Math.min(chunksWithEmbedding.length, 200), keepWithout: 100 },
          { keepEmbedding: Math.min(chunksWithEmbedding.length, 100), keepWithout: 50 },
          { keepEmbedding: Math.min(chunksWithEmbedding.length, 50), keepWithout: 20 }
        ];
        
        for (const strategy of cleanupStrategies) {
          try {
            // 保留所有有embedding的chunks（优先保留当前文档的）
            const currentDocWithEmbedding = chunksWithEmbedding.filter(c => c.documentId === currentDocumentId);
            const otherDocWithEmbedding = chunksWithEmbedding.filter(c => c.documentId !== currentDocumentId);
            const sortedOtherWithEmbedding = otherDocWithEmbedding.sort((a, b) => 
              new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
            );
            // 保留所有当前文档的有embedding的chunks，其他文档按策略保留
            const keptOtherWithEmbedding = sortedOtherWithEmbedding.slice(0, Math.max(0, strategy.keepEmbedding - currentDocWithEmbedding.length));
            const keptWithEmbedding = [...currentDocWithEmbedding, ...keptOtherWithEmbedding];
            
            // 处理没有embedding的chunks：当前文档的全部保留，其他文档按策略保留
            const currentDocWithoutEmbedding = chunksWithoutEmbedding.filter(c => c.documentId === currentDocumentId);
            const otherDocWithoutEmbedding = chunksWithoutEmbedding.filter(c => c.documentId !== currentDocumentId);
            const sortedOtherWithoutEmbedding = otherDocWithoutEmbedding.sort((a, b) => 
              new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
            );
            // 保留所有当前文档的没有embedding的chunks，其他文档按策略保留
            const keptOtherWithoutEmbedding = sortedOtherWithoutEmbedding.slice(0, Math.max(0, strategy.keepWithout - currentDocWithoutEmbedding.length));
            const keptWithoutEmbedding = [...currentDocWithoutEmbedding, ...keptOtherWithoutEmbedding];
            
            const keptChunks = [...keptWithEmbedding, ...keptWithoutEmbedding];
            
            // 确保当前chunk在列表中（如果不在，替换最后一个）
            if (!keptChunks.find(c => c.id === chunkId)) {
              if (keptChunks.length >= (keptWithEmbedding.length + keptWithoutEmbedding.length)) {
                keptChunks[keptChunks.length - 1] = currentChunk;
              } else {
                keptChunks.push(currentChunk);
              }
            } else {
              const chunkIdx = keptChunks.findIndex(c => c.id === chunkId);
              if (chunkIdx !== -1) {
                keptChunks[chunkIdx] = currentChunk;
              }
            }
            
            await hybridStorage.setItem(this.CHUNKS_KEY, JSON.stringify(keptChunks));
            console.warn(`已清理旧chunks（包括 ${orphanedChunks.length} 个已删除文档的chunks），保留 ${keptChunks.length} 个chunks（当前文档: ${keptChunks.filter(c => c.documentId === currentDocumentId).length}，其他文档: ${keptChunks.filter(c => c.documentId !== currentDocumentId).length}）`);
            return; // 成功保存，退出
          } catch (retryError: any) {
            if (retryError.name === 'QuotaExceededError') {
              // 继续尝试下一个策略
              continue;
            } else {
              throw retryError;
            }
          }
        }
        
        // 所有策略都失败，抛出错误
        throw new Error('所有清理策略都失败，无法保存embedding');
      } else {
        throw error;
      }
    }
  }

  // 向量搜索（增强版 - 智能关键词匹配和相关性评分）
  async searchSimilarChunks(query: string, limit: number = 5): Promise<{ chunk: Chunk; score: number }[]> {
    // 使用 getAllChunksForSearch 确保只搜索存在的文档的chunks
    const allChunks = await this.getAllChunksForSearch();
    const queryLower = query.toLowerCase().trim();
    
    if (!queryLower) {
      return [];
    }
    
    const queryWords = this.extractSearchKeywords(queryLower);
    
    const importantKeywords = queryWords.filter(word => word.length >= 4 || /[\u4e00-\u9fa5]/.test(word));
    
    const scoredChunks = allChunks.map(chunk => {
      const contentLower = chunk.content.toLowerCase();
      let score = 0;
      
      // 1. 完全匹配评分（最高优先级）
      if (contentLower.includes(queryLower)) {
        score += 2.0;
        // 如果是完全匹配，额外加分
        const exactMatchCount = (contentLower.match(new RegExp(queryLower, 'g')) || []).length;
        score += exactMatchCount * 0.5;
      }
      
      // 2. 关键词匹配评分（改进版：区分重要关键词和普通关键词）
      let keywordMatches = 0;
      let importantKeywordMatches = 0;
      let totalKeywordScore = 0;
      
      // 识别重要关键词（长度>=4的英文词，或所有中文词）
      const importantKeywords = queryWords.filter(word => word.length >= 4 || /[\u4e00-\u9fa5]/.test(word));
      const commonKeywords = queryWords.filter(word => word.length < 4 && !/[\u4e00-\u9fa5]/.test(word));
      
      queryWords.forEach(word => {
        if (contentLower.includes(word)) {
          keywordMatches++;
          const isImportant = importantKeywords.includes(word);
          if (isImportant) {
            importantKeywordMatches++;
          }
          
          // 重要关键词权重更高
          const baseWeight = isImportant ? 0.8 : 0.2;
          const lengthBonus = Math.min(word.length / 6, 1.0) * 0.4;
          const wordScore = (baseWeight + lengthBonus) * (isImportant ? 1.5 : 0.5);
          totalKeywordScore += wordScore;
          
          // 词频评分（重要关键词的频次权重更高）
          const wordCount = (contentLower.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
          if (wordCount > 0) {
            const freqWeight = isImportant ? 0.15 : 0.05;
            totalKeywordScore += Math.min(wordCount * freqWeight, isImportant ? 1.0 : 0.3);
          }
        }
      });
      
      // 关键词覆盖率评分（重要关键词覆盖率权重更高）
      if (queryWords.length > 0) {
        const coverageScore = (keywordMatches / queryWords.length) * 0.6;
        totalKeywordScore += coverageScore;
      }
      
      // 重要关键词覆盖率奖励
      if (importantKeywords.length > 0) {
        const importantCoverage = (importantKeywordMatches / importantKeywords.length) * 1.2;
        totalKeywordScore += importantCoverage;
      }
      
      // 多个重要关键词同时匹配的额外奖励
      if (importantKeywordMatches >= 2) {
        totalKeywordScore += (importantKeywordMatches - 1) * 0.5;
      }
      
      score += totalKeywordScore;
      
      // 3. 语义相似度评分（基于词序和距离）
      if (queryWords.length > 1) {
        const phraseScore = this.calculatePhraseSimilarity(queryWords, contentLower);
        score += phraseScore * 0.4;
      }
      
      // 4. 文档质量评分
      const qualityScore = this.calculateDocumentQuality(chunk);
      score += qualityScore * 0.2;
      
      return { chunk, score };
    });
    
    const filteredAndSorted = scoredChunks
      .filter(item => item.score > 0.3) // 提高过滤阈值
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    return filteredAndSorted;
  }
  
  private extractSearchKeywords(text: string): string[] {
    // 提取搜索关键词，过滤停用词
    const chineseStopWords = new Set(['的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '些', '个', '只', '现在', '可以', '请', '问', '什么', '怎么', '如何', '为什么', '吗', '呢', '吧', '啊', '中', '依据', '知识库', '回答', '使用', '命令', '去', '配置', '设置']);
    const englishStopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'there', 'here', 'where', 'when', 'what', 'which', 'who', 'how', 'why', 'if', 'then', 'else', 'than', 'more', 'most', 'some', 'any', 'all', 'each', 'every', 'both', 'few', 'many', 'much', 'other', 'another', 'such', 'only', 'just', 'also', 'very', 'too', 'so', 'not', 'no', 'yes', 'use', 'using', 'command', 'configure', 'config', 'set', 'setting']);
    const allStopWords = new Set([...chineseStopWords, ...englishStopWords]);
    
    const keywords: string[] = [];
    
    // 提取配置关键词（BGP, OSPF等）
    const configKeywords = text.match(/\b(BGP|OSPF|VLAN|VXLAN|VRF|ACL|QOS|PBR|NAT|VRRP|LACP|LLDP|PTP|NTP|SNMP|SYSLOG|DNS|DHCP|STP|MSTP|RIP|EIGRP|ISIS|MPLS|LDP|RSVP|TE|SR|EVPN|VPLS|L2VPN|L3VPN)\b/gi);
    if (configKeywords) {
      keywords.push(...configKeywords.map(k => k.trim().toLowerCase()));
    }
    
    // 中文分词和英文单词提取
    const words = text.match(/[\u4e00-\u9fa5]+|[a-zA-Z]+/g) || [];
    
    const additionalKeywords = words
      .map(word => word.toLowerCase())
      .filter(word => 
        word.length >= 2 && 
        !allStopWords.has(word) && 
        !/^\d+$/.test(word) &&
        !keywords.includes(word) // 避免重复
      );
    
    // 合并：命令和配置关键词优先，然后是其他关键词
    return [...keywords, ...additionalKeywords].slice(0, 15); // 增加到15个关键词
  }
  
  private calculatePhraseSimilarity(queryWords: string[], content: string): number {
    // 计算短语相似度（改进版：优先匹配重要关键词的短语）
    let score = 0;
    
    // 识别重要关键词（长度>=4的英文词）
    const importantWords = queryWords.filter(word => word.length >= 4 && !/[\u4e00-\u9fa5]/.test(word));
    
    // 检查重要关键词在内容中的相对位置
    const positions: Array<{ word: string; pos: number }> = [];
    importantWords.forEach(word => {
      const pos = content.indexOf(word);
      if (pos !== -1) {
        positions.push({ word, pos });
      }
    });
    
    if (positions.length >= 2) {
      // 如果重要关键词位置相近，增加分数
      positions.sort((a, b) => a.pos - b.pos);
      for (let i = 1; i < positions.length; i++) {
        const distance = positions[i].pos - positions[i - 1].pos;
        if (distance < 100) { // 关键词距离小于100字符
          const proximityBonus = (100 - distance) / 100 * 0.3;
          score += proximityBonus;
        }
      }
    }
    
    // 检查是否包含重要关键词的连续短语（如 "replacing standby node"）
    if (importantWords.length >= 2) {
      // 尝试匹配2-3个连续的重要关键词
      for (let i = 0; i < importantWords.length - 1; i++) {
        const phrase = `${importantWords[i]}\\s+\\w*\\s*${importantWords[i + 1]}`;
        const regex = new RegExp(phrase, 'i');
        if (regex.test(content)) {
          score += 0.5; // 匹配到重要短语，大幅加分
        }
      }
    }
    
    return Math.min(score, 1.5); // 提高上限
  }
  
  private calculateDocumentQuality(chunk: Chunk): number {
    // 计算文档质量分数
    let score = 0;
    
    // 内容长度评分
    const contentLength = chunk.content.length;
    if (contentLength >= 50 && contentLength <= 2000) {
      score += 0.3; // 适中的内容长度
    }
    
    // 句子完整性评分
    const sentences = chunk.content.split(/[。！？.!?]/).filter(s => s.trim().length > 0);
    if (sentences.length >= 2) {
      score += 0.2;
    }
    
    // 信息密度评分（避免过多重复内容）
    const uniqueWords = new Set(chunk.content.toLowerCase().split(/\s+/)).size;
    const totalWords = chunk.content.split(/\s+/).length;
    if (totalWords > 0) {
      const density = uniqueWords / totalWords;
      if (density > 0.5) {
        score += 0.2; // 良好的信息密度
      }
    }
    
    return Math.min(score, 0.8);
  }

  // 用户设置管理
  getUserSettings(userId: string): any {
    const settings = localStorage.getItem(this.USER_SETTINGS_KEY);
    const allSettings = settings ? JSON.parse(settings) : {};
    return allSettings[userId] || null;
  }

  saveUserSettings(userId: string, settings: any) {
    const existingSettings = localStorage.getItem(this.USER_SETTINGS_KEY);
    const allSettings = existingSettings ? JSON.parse(existingSettings) : {};
    allSettings[userId] = settings;
    localStorage.setItem(this.USER_SETTINGS_KEY, JSON.stringify(allSettings));
  }

  // 清理旧数据以释放存储空间
  private cleanupOldData(userId: string) {
    try {
      // 1. 清理旧的对话（保留最近20个）
      const allConversations = this.getAllConversations();
      const userConversations = allConversations.filter((conv: Conversation) => conv.userId === userId);
      const otherConversations = allConversations.filter((conv: Conversation) => conv.userId !== userId);
      
      // 按更新时间排序，保留最近20个
      userConversations.sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      const keptConversations = userConversations.slice(0, 20);
      const removedConversationIds = userConversations
        .slice(20)
        .map(conv => conv.id);
      
      // 2. 删除旧对话的消息
      if (removedConversationIds.length > 0) {
        const allMessages = this.getAllMessages();
        const filteredMessages = allMessages.filter(
          (msg: Message) => !removedConversationIds.includes(msg.conversationId)
        );
        localStorage.setItem(this.MESSAGES_KEY, JSON.stringify(filteredMessages));
      }
      
      // 3. 保存清理后的对话
      const finalConversations = [...otherConversations, ...keptConversations];
      localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(finalConversations));
      
      console.log(`已清理 ${removedConversationIds.length} 个旧对话`);
    } catch (error) {
      console.error('清理旧数据时出错:', error);
      // 如果清理失败，尝试更激进的清理：删除所有消息
      try {
        localStorage.removeItem(this.MESSAGES_KEY);
        console.warn('已删除所有消息以释放空间');
      } catch (e) {
        console.error('无法清理数据:', e);
      }
    }
  }

}

export const localStorageManager = new LocalStorageManager();

// 导出统一存储管理器（默认使用服务器存储，实现多用户共享）
export { unifiedStorageManager } from './unifiedStorage';