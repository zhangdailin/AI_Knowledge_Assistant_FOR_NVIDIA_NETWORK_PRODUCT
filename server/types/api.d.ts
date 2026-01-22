/**
 * API 类型定义
 * 为 AI Knowledge Assistant 的所有 API 端点提供 TypeScript 类型定义
 */

// ========== 通用类型 ==========

export interface ApiResponse<T = any> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ========== 文档相关类型 ==========

export interface Document {
  id: string;
  userId: string;
  filename: string;
  fileType: string;
  fileSize: number;
  category: string;
  categoryId: string;
  contentPreview: string;
  uploadedAt: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  chunkCount: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface DocumentUploadRequest {
  userId?: string;
  category?: string;
  file: File | Blob;
}

export interface DocumentUploadResponse extends ApiResponse {
  document?: Document;
}

export interface DocumentListRequest extends PaginationParams {
  category?: string;
  status?: string;
  search?: string;
}

export interface DocumentListResponse extends ApiResponse {
  documents?: Document[];
  pagination?: PaginationMeta;
}

export interface DocumentUpdateRequest {
  filename?: string;
  category?: string;
  categoryId?: string;
  status?: string;
  metadata?: Record<string, any>;
}

// ========== Chunk 相关类型 ==========

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  chunkType?: 'parent' | 'child' | 'normal';
  parentId?: string;
  startIndex?: number;
  endIndex?: number;
  sectionTitle?: string;
  embedding?: number[];
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface ChunkStats {
  total: number;
  parentCount: number;
  childCount: number;
  normalCount: number;
  withEmbedding: number;
  requiringEmbedding: number;
}

export interface ChunkSearchRequest {
  query: string;
  limit?: number;
  categoryIds?: string[];
}

export interface ChunkSearchResult {
  chunk: Chunk;
  score: number;
  matchType: 'fts' | 'hnsw' | 'linear' | 'like';
}

export interface ChunkSearchResponse extends ApiResponse {
  results?: ChunkSearchResult[];
  count?: number;
}

// ========== 搜索相关类型 ==========

export interface SearchRequest {
  query: string;
  limit?: number;
  categoryIds?: string[];
  enableKnowledgeGraph?: boolean;
  enableQueryExpansion?: boolean;
  enableNegativeLearning?: boolean;
}

export interface SearchResult {
  chunk: Chunk;
  document: Document;
  score: number;
  matchType: string;
  highlights?: string[];
}

export interface SearchResponse extends ApiResponse {
  results?: SearchResult[];
  query?: string;
  expandedQuery?: string;
  strategy?: string;
  cached?: boolean;
  responseTime?: number;
}

// ========== 设置相关类型 ==========

export interface ModelSelection {
  chat?: string;
  embedding?: string;
  reranking?: string;
}

export interface RetrievalConfig {
  enableQueryExpansion?: boolean;
  enableNegativeLearning?: boolean;
  searchCacheSize?: number;
  searchCacheTTL?: number;
  rrfK?: number;
  keywordWeight?: number;
  vectorWeight?: number;
}

export interface KnowledgeGraphConfig {
  enabled?: boolean;
  neo4jUri?: string;
  neo4jUsername?: string;
  neo4jPassword?: string;
}

export interface Settings {
  apiKeys?: Record<string, string>;
  modelSelection?: ModelSelection;
  retrieval?: RetrievalConfig;
  knowledgeGraph?: KnowledgeGraphConfig;
  [key: string]: any;
}

export interface SettingsResponse extends ApiResponse {
  settings?: Settings;
}

// ========== 统计相关类型 ==========

export interface CategoryStats {
  category: string;
  count: number;
}

export interface QueryStats {
  date: string;
  count: number;
}

export interface TopQuestion {
  question: string;
  count: number;
}

export interface Stats {
  totalDocuments: number;
  totalChunks: number;
  totalQueries: number;
  avgResponseTime: number;
  recentQueries: QueryStats[];
  topQuestions: TopQuestion[];
  documentsByCategory: CategoryStats[];
}

export interface StatsResponse extends ApiResponse {
  stats?: Stats;
}

// ========== 反馈相关类型 ==========

export interface FeedbackEntry {
  question: string;
  answer: string;
  verdict: 'up' | 'down';
  metadata?: {
    references?: any[];
    [key: string]: any;
  };
  createdAt?: string;
}

export interface FeedbackRequest {
  question: string;
  answer: string;
  verdict: 'up' | 'down';
  metadata?: Record<string, any>;
}

export interface FeedbackMetrics {
  total: number;
  positive: number;
  negative: number;
  positivityRate: number;
  recent: FeedbackEntry[];
}

export interface FeedbackResponse extends ApiResponse {
  metrics?: FeedbackMetrics;
}

// ========== 分类相关类型 ==========

export interface Category {
  id: string;
  name: string;
  icon?: string;
  children?: Category[];
}

export interface CategoriesResponse extends ApiResponse {
  tree?: Category[];
}

export interface CategoryCreateRequest {
  parentId?: string;
  name: string;
  icon?: string;
}

export interface CategoryUpdateRequest {
  name?: string;
  icon?: string;
}

// ========== A/B 测试相关类型 ==========

export interface ABExperiment {
  id: string;
  name: string;
  description?: string;
  variants: ABVariant[];
  status: 'draft' | 'running' | 'stopped';
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
}

export interface ABVariant {
  id: string;
  name: string;
  weight: number;
  config: Record<string, any>;
}

export interface ABExperimentCreateRequest {
  name: string;
  description?: string;
  variants: ABVariant[];
}

export interface ABExperimentResponse extends ApiResponse {
  experiment?: ABExperiment;
}

export interface ABVariantAssignment {
  experimentId: string;
  variantId: string;
  config: Record<string, any>;
}

// ========== 知识图谱相关类型 ==========

export interface KnowledgeGraphStats {
  nodeCount: number;
  relationshipCount: number;
  entityTypes: Record<string, number>;
}

export interface KnowledgeGraphQuery {
  query: string;
  limit?: number;
}

export interface KnowledgeGraphResult {
  nodes: any[];
  relationships: any[];
  score?: number;
}

export interface KnowledgeGraphResponse extends ApiResponse {
  stats?: KnowledgeGraphStats;
  results?: KnowledgeGraphResult[];
}

// ========== 拓扑相关类型 ==========

export interface TopologyNode {
  id: string;
  name: string;
  type: string;
  layer?: string;
  metadata?: Record<string, any>;
}

export interface TopologyLink {
  source: string;
  target: string;
  type?: string;
  metadata?: Record<string, any>;
}

export interface TopologyData {
  nodes: TopologyNode[];
  links: TopologyLink[];
  metadata?: Record<string, any>;
}

export interface TopologyResponse extends ApiResponse {
  topology?: TopologyData;
}

// ========== 文档质量相关类型 ==========

export interface DocumentQuality {
  documentId: string;
  filename: string;
  overallScore: number;
  scores: {
    structure: number;
    technicalDensity: number;
    feedback: number;
  };
  issues: string[];
  recommendations: string[];
}

export interface QualityReport {
  totalDocuments: number;
  averageScore: number;
  distribution: Record<string, number>;
  topDocuments: DocumentQuality[];
  bottomDocuments: DocumentQuality[];
}

export interface QualityResponse extends ApiResponse {
  quality?: DocumentQuality;
  report?: QualityReport;
}

// ========== 性能指标相关类型 ==========

export interface PerformanceMetrics {
  totalRequests: number;
  avgResponseTime: number;
  p50: number;
  p95: number;
  p99: number;
  cacheHitRate: number;
  errorRate: number;
}

export interface DetailedMetrics {
  searchMetrics: PerformanceMetrics;
  embeddingMetrics: PerformanceMetrics;
  rerankMetrics: PerformanceMetrics;
  knowledgeGraphMetrics: PerformanceMetrics;
}

export interface MetricsResponse extends ApiResponse {
  metrics?: PerformanceMetrics;
  detailed?: DetailedMetrics;
}

// ========== API 认证相关类型 ==========

export interface ApiKey {
  key: string;
  name: string;
  permissions: ('read' | 'write' | 'admin')[];
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}

export interface ApiKeyCreateRequest {
  name: string;
  permissions: ('read' | 'write' | 'admin')[];
  expiresAt?: string;
}

export interface ApiKeyResponse extends ApiResponse {
  apiKey?: ApiKey;
  apiKeys?: ApiKey[];
}

// ========== Webhook 相关类型 ==========

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
}

export interface WebhookCreateRequest {
  url: string;
  events: string[];
  secret?: string;
}

export interface WebhookUpdateRequest {
  url?: string;
  events?: string[];
  enabled?: boolean;
}

export interface WebhookResponse extends ApiResponse {
  webhook?: Webhook;
  webhooks?: Webhook[];
}

// ========== 批量操作相关类型 ==========

export interface BatchOperation {
  id: string;
  type: 'upload' | 'delete' | 'update' | 'search' | 'export' | 'reprocess';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total: number;
  processed: number;
  failed: number;
  createdAt: string;
  completedAt?: string;
  results?: any[];
}

export interface BatchOperationResponse extends ApiResponse {
  operation?: BatchOperation;
}

// ========== 任务相关类型 ==========

export interface Task {
  id: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  result?: any;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface TaskResponse extends ApiResponse {
  task?: Task;
  tasks?: Task[];
}

// ========== WebSocket 消息类型 ==========

export interface WebSocketMessage {
  type: 'chat' | 'document_update' | 'task_update' | 'error' | 'ping' | 'pong';
  data?: any;
  error?: string;
  timestamp?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  metadata?: Record<string, any>;
}

export interface ChatRequest {
  query: string;
  conversationId?: string;
  categoryIds?: string[];
  config?: SearchRequest;
}

export interface ChatResponse {
  answer: string;
  references: SearchResult[];
  conversationId: string;
  metadata?: {
    strategy?: string;
    expandedQuery?: string;
    responseTime?: number;
    cached?: boolean;
  };
}

// ========== 查询日志相关类型 ==========

export interface QueryLog {
  query: string;
  responseTime: number;
  createdAt: string;
}

export interface QueryLogRequest {
  query: string;
  responseTime?: number;
}

// ========== 模型相关类型 ==========

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  type: 'chat' | 'embedding' | 'reranking';
  maxTokens?: number;
  contextWindow?: number;
}

export interface ModelsResponse extends ApiResponse {
  models?: ModelInfo[];
}

// ========== 类型守卫函数 ==========

export function isApiResponse<T>(obj: any): obj is ApiResponse<T> {
  return typeof obj === 'object' && obj !== null && 'ok' in obj;
}

export function isDocument(obj: any): obj is Document {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'filename' in obj &&
    'status' in obj
  );
}

export function isChunk(obj: any): obj is Chunk {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'documentId' in obj &&
    'content' in obj
  );
}

// ========== 常量类型 ==========

export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'error';
export type ChunkType = 'parent' | 'child' | 'normal';
export type FeedbackVerdict = 'up' | 'down';
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ExperimentStatus = 'draft' | 'running' | 'stopped';
export type ApiPermission = 'read' | 'write' | 'admin';
export type MessageRole = 'user' | 'assistant' | 'system';
export type WebSocketMessageType = 'chat' | 'document_update' | 'task_update' | 'error' | 'ping' | 'pong';
