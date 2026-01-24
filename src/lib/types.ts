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
  metadata?: MessageMetadata;
  createdAt: string;
}

export interface ReferenceMetadata {
  id?: string;
  documentId?: string;
  title: string;
  content: string;
  score: number;
  isTruncated?: boolean;
}

export interface ValidationCommandMatch {
  command: string;
  confidence?: number;
  referenceId?: string | null;
  referenceTitle?: string | null;
  referenceIndex?: number | null;
  excerpt?: string;
}

export interface ValidationReferenceMatch {
  referenceId?: string | null;
  referenceTitle?: string | null;
  referenceIndex?: number | null;
  commands: string[];
  excerpts?: string[];
}

export interface ValidationHallucination {
  command: string;
  reason?: string;
}

export interface MessageMetadata {
  model?: string;
  usage?: {
    tokens: number;
  };
  references?: ReferenceMetadata[];
  validation?: {
    isConsistent: boolean;
    confidenceScore: number;
    totalCommands?: number;
    verifiedCommands?: ValidationCommandMatch[];
    partialMatches?: ValidationCommandMatch[];
    hallucinations?: ValidationHallucination[];
    warnings?: string[];
    referenceSummaries?: Array<{ id?: string; title?: string; index?: number }>;
    referenceMatches?: ValidationReferenceMatch[];
    hasReferences?: boolean;
    validationMethod?: string;
    analyzedAt?: string;
  };
  deepThinking?: boolean;
  fallbackToQwen?: boolean;
  hint?: boolean;
  error?: boolean;
  errorMessage?: string;
  // 工具调用结果
  toolResults?: {
    snIblf?: {
      queriedSNs: string[];
      result: any;
    };
  };
  [key: string]: unknown; // 允许其他元数据字段
}

export interface Document {
  id: string;
  userId: string;
  filename: string;
  fileType: string;
  fileSize: number;
  category?: string;
  categoryId?: string;           // 分类ID
  categoryPath?: string[];       // 分类路径
  contentPreview: string;
  uploadedAt: string;
  maxChunks?: number; // 每个文档的最大chunks数量（rack配额），默认1000
  status?: 'processing' | 'ready' | 'error'; // 文档处理状态
  errorMessage?: string; // 处理失败时的错误信息
}

// 分类树节点
export interface Category {
  id: string;
  name: string;
  icon?: string;
  children?: Category[];
}

// 分类树结构
export interface CategoryTree {
  tree: Category[];
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
  chunkType?: 'parent' | 'child' | 'semantic'; // chunk 类型：parent 为父块（较大），child 为子块（较小），semantic 为语义块
  metadata?: ChunkMetadata; // 元数据，可存储 header 等信息
}

export interface ChunkMetadata {
  header?: string;
  [key: string]: unknown; // 允许其他元数据字段
}

// 设置相关类型
export interface Settings {
  theme?: string;
  language?: string;
  [key: string]: unknown;
}

// 任务相关类型
export interface EmbeddingTask {
  id: string;
  documentId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  error?: string;
}

// Chunk统计信息
export interface ChunkStats {
  total: number;
  withEmbedding: number;
  withoutEmbedding: number;
  processing: number;
}

// 用于创建chunk的数据结构
export interface ChunkData {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  parentId?: string;
  chunkType?: 'parent' | 'child' | 'semantic';
  metadata?: ChunkMetadata;
}
