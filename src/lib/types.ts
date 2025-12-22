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
  status?: 'processing' | 'ready' | 'error'; // 文档处理状态
  errorMessage?: string; // 处理失败时的错误信息
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
  metadata?: Record<string, any>; // 元数据，可存储 header 等信息
}
