import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createRequire } from 'node:module';
import * as storage from './storage.mjs';
import * as taskQueue from './taskQueue.mjs';
import { embedText, rerankDocuments } from './embedding.mjs';
import { validateFileType, getFileCategory } from './fileValidation.mjs';
import { asyncHandler, SimpleLRUCache } from './utils.mjs';
import XLSX from 'xlsx';

// 直接使用 createRequire 加载 pdf-parse
const require = createRequire(import.meta.url);

// 安全加载 pdf-parse
let pdfParseModule;
try {
  pdfParseModule = require('pdf-parse');
} catch (e) {
  console.warn('[Server] Failed to load pdf-parse:', e.message);
  pdfParseModule = null;
}

import mammoth from 'mammoth';
import { setTimeout as sleep } from 'node:timers/promises';
import * as chunking from './chunking.mjs';
import { validateAnswerConsistency } from './answerValidation.mjs';
import * as topology from './topology.mjs';
import { analyzeRoCETopology } from './roce-topology.mjs';
import { inferLayersFromTopology } from './topology-inference.mjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { addFeedbackEntry, getFeedbackMetrics } from './storage.mjs';

// 搜索结果缓存
const searchCache = new SimpleLRUCache(200);
// 请求合并 Map，防止缓存踩踏
const pendingSearches = new Map();

function applySearchCacheSize(size) {
  const parsed = Number(size);
  if (Number.isFinite(parsed) && parsed > 0 && parsed !== searchCache.maxSize) {
    searchCache.setMaxSize(parsed);
  }
}

function applySearchCacheTTL(ttlMs) {
  const parsed = Number(ttlMs);
  searchCache.setTTL(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
}

function clearSearchCache() {
  searchCache.clear();
}

storage.setSearchCacheInvalidator(clearSearchCache);


// RRF 融合算法 (参数可配置)
function fuseResults(keywordResults, vectorResults, query, maxResults, config = {}) {
  const queryLower = query.toLowerCase();
  const isCommandQuery = /nv\s+(set|show|config|unset)/.test(queryLower) ||
    ['配置', '命令', 'config', 'show', 'how to', '如何'].some(k => queryLower.includes(k));
  const isTechQuery = ['mlag', 'bgp', 'evpn', 'vxlan', 'ospf', 'lacp', 'bond', 'cumulus'].some(k => queryLower.includes(k));

  const combinedResults = new Map();
  // 从配置读取 RRF K 值，默认 60
  const k = config.rrfK ?? 60;
  // 从配置读取基础权重
  const baseKeywordWeight = config.keywordWeight ?? 1.0;
  const baseVectorWeight = config.vectorWeight ?? 1.0;
  // 根据查询类型动态调整
  const keywordWeight = (isCommandQuery || isTechQuery) ? baseKeywordWeight * 1.5 : baseKeywordWeight;
  const vectorWeight = (isCommandQuery || isTechQuery) ? baseVectorWeight * 0.8 : baseVectorWeight;

  keywordResults.forEach((chunk, index) => {
    const id = chunk.id;
    if (!combinedResults.has(id)) combinedResults.set(id, { chunk, score: 0, sources: [] });
    const item = combinedResults.get(id);
    item.score += (1 / (k + index + 1)) * keywordWeight;
    if (chunk.score > 10) item.score += 0.05;
    if (isCommandQuery && chunk.content) {
      const contentLower = chunk.content.toLowerCase();
      if (contentLower.includes('nv set') || contentLower.includes('nv show') || contentLower.includes('```')) item.score += 0.08;
      if (queryLower.includes('mlag') && (contentLower.includes('mlag') || contentLower.includes('bond mlag'))) item.score += 0.1;
    }
    item.sources.push('keyword');
    item.keywordScore = chunk.score;
  });

  vectorResults.forEach((item, index) => {
    const chunk = item.chunk;
    const id = chunk.id;
    if (!combinedResults.has(id)) combinedResults.set(id, { chunk, score: 0, sources: [] });
    const entry = combinedResults.get(id);
    entry.score += (1 / (k + index + 1)) * vectorWeight;
    if (item.score > 0.85) entry.score += 0.05;
    entry.sources.push('vector');
    entry.vectorScore = item.score;
  });

  return Array.from(combinedResults.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(entry => ({
      ...entry.chunk,
      _score: entry.score,
      _sources: entry.sources,
      _debug: { keywordScore: entry.keywordScore, vectorScore: entry.vectorScore }
    }));
}

const app = express();

// CORS 白名单配置
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // 允许无 origin 的请求（如服务器间调用）
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
}));

// 合理的 payload 限制
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// 修复中文文件名编码问题
function fixFilename(filename) {
  if (!filename) return filename;
  try {
    // 尝试修复 ISO-8859-1 编码的中文文件名
    // 当浏览器发送中文文件名时，可能被错误编码为 ISO-8859-1
    // 需要转换回 UTF-8
    const buffer = Buffer.from(filename, 'latin1');
    const decoded = buffer.toString('utf8');
    // 验证是否成功解码（检查是否包含有效的 UTF-8 字符）
    if (decoded !== filename && /[\u4e00-\u9fff]/.test(decoded)) {
      console.log(`[fixFilename] 修复文件名: ${filename} -> ${decoded}`);
      return decoded;
    }
  } catch (e) {
    // 如果转换失败，返回原始文件名
    console.warn(`[fixFilename] 转换失败，使用原始文件名: ${filename}`, e.message);
  }
  return filename;
}

function findCategoryById(nodes, categoryId) {
  for (const node of nodes) {
    if (node.id === categoryId) return node;
    if (node.children) {
      const found = findCategoryById(node.children, categoryId);
      if (found) return found;
    }
  }
  return null;
}

function findCategoryByName(nodes, name) {
  for (const node of nodes) {
    if (node.name === name) return node;
    if (node.children) {
      const found = findCategoryByName(node.children, name);
      if (found) return found;
    }
  }
  return null;
}

function resolveCategoryInfo(categoryValue, categoryTree) {
  const nodes = Array.isArray(categoryTree) ? categoryTree : [];
  const defaultNode = findCategoryById(nodes, 'default');
  const defaultName = defaultNode?.name || '默认分类';

  if (!categoryValue) {
    return { id: 'default', name: defaultName };
  }

  const byId = findCategoryById(nodes, categoryValue);
  if (byId) return { id: byId.id, name: byId.name };

  const byName = findCategoryByName(nodes, categoryValue);
  if (byName) return { id: byName.id, name: byName.name };

  return { id: 'default', name: defaultName };
}

// 异步处理文件上传
async function processUploadedFile(documentId, file) {
  try {
    const fixedFilename = fixFilename(file.originalname);
    console.log(`[Async] 开始处理文档: ${documentId}, 文件: ${fixedFilename}`);

    // 1. 解析文本
    let text = '';
    const mime = file.mimetype || '';
    const fileCategory = getFileCategory(fixedFilename, mime);

    if (fileCategory === 'pdf') {
      const PdfParseClass = pdfParseModule?.PDFParse || pdfParseModule?.default?.PDFParse || pdfParseModule;
      const parser = new PdfParseClass({ data: file.buffer });
      const result = await parser.getText({});
      text = result?.text || '';
    } else if (fileCategory === 'word') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
    } else if (fileCategory === 'excel') {
      const workbook = XLSX.read(file.buffer, { type: 'buffer', cellFormula: false, cellStyles: false });
      const sheets = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        return `【${name}】\n${csv}`;
      });
      text = sheets.join('\n\n');
    } else if (fileCategory === 'text') {
      text = file.buffer.toString('utf-8');
    } else {
      console.warn(`[Async] 未知文件类型: ${mime}, 尝试作为文本处理`);
      text = file.buffer.toString('utf-8');
    }

    text = (text || '').trim();
    if (!text) throw new Error('提取文本为空，请确保文件包含可读取的文本内容');

    const textSizeKB = Math.round(text.length / 1024);
    console.log(`[Async] 文本提取完成，长度: ${text.length} 字符 (${textSizeKB} KB)`);

    // 更新预览
    await storage.updateDocument(documentId, {
      contentPreview: text.substring(0, 500)
    });

    // 2. 分块
    // 根据文件大小调整最大块大小
    let maxChunkSize = 4000;

    if (text.length > 500 * 1024) {
      // 大文件：使用更大的块，减少块数量
      maxChunkSize = 6000;
      console.log(`[Async] 大文件检测，使用优化参数: maxChunkSize=${maxChunkSize}`);
    }

    const chunkStartTime = Date.now();
    const chunks = chunking.enhancedParentChildChunking(text, maxChunkSize, null, null, {
      documentType: document?.category || document?.categoryId || 'general'
    });
    const chunkTime = Date.now() - chunkStartTime;

    // 详细统计
    const parentChunks = chunks.filter(c => c.chunkType === 'parent');
    const childChunks = chunks.filter(c => c.chunkType === 'child');
    const normalChunks = chunks.filter(c => c.chunkType !== 'parent' && c.chunkType !== 'child');

    console.log(`[Async] 分块完成，耗时: ${chunkTime}ms`);
    console.log(`[Async] 块数统计: 总计 ${chunks.length} 个`);
    console.log(`[Async]   - 父块: ${parentChunks.length} 个`);
    console.log(`[Async]   - 子块: ${childChunks.length} 个`);
    console.log(`[Async]   - 普通块: ${normalChunks.length} 个`);

    // 检查内容长度
    const chunksWithContent = chunks.filter(c => c.content && c.content.trim().length > 0);
    const emptyChunks = chunks.length - chunksWithContent.length;
    if (emptyChunks > 0) {
      console.warn(`[Async] 警告: 有 ${emptyChunks} 个空 chunks`);
    }

    // 显示前几个 chunks 的内容长度
    if (chunks.length > 0) {
      const sampleChunks = chunks.slice(0, 5);
      console.log(`[Async] 前 ${Math.min(5, chunks.length)} 个 chunks 内容长度:`);
      sampleChunks.forEach((c, idx) => {
        const contentLen = c.content ? c.content.length : 0;
        console.log(`[Async]   [${idx + 1}] ${c.chunkType || 'normal'}: ${contentLen} 字符`);
      });
    }

    if (chunks.length === 0) {
      throw new Error('分块失败：未生成任何 chunks');
    }

    // 3. 保存 chunks
    const chunksWithDocId = chunks.map(c => ({ ...c, documentId }));
    await storage.createChunks(chunksWithDocId);
    console.log(`[Async] chunks 已保存到存储`);

    // 4. 生成 Embedding (复用 taskQueue)
    // 注意：taskQueue.processEmbeddingTask 需要手动触发
    // 或者我们直接创建任务并调用它
    const task = taskQueue.createTask('generate_embeddings', documentId);
    await taskQueue.processEmbeddingTask(task.id, documentId);

    // 5. 更新状态
    await storage.updateDocument(documentId, { status: 'ready' });
    console.log(`[Async] 文档处理完成: ${documentId}`);

  } catch (error) {
    console.error(`[Async] 处理文档失败: ${documentId}`, error);
    await storage.updateDocument(documentId, {
      status: 'error',
      errorMessage: error.message
    });
  }
}

app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no_file' });
    const { userId, category } = req.body;

    // 检查文件类型（在创建文档之前）
    const fixedFilename = fixFilename(file.originalname);
    const mime = file.mimetype || '';

    const validation = validateFileType(fixedFilename, mime);
    if (!validation.valid) {
      return res.status(400).json({ ok: false, error: validation.error });
    }

    // 1. 创建文档记录 (status: processing)
    const categoriesData = await storage.getCategories();
    const resolvedCategory = resolveCategoryInfo(category, categoriesData.tree || []);

    const docData = {
      userId,
      filename: fixedFilename,
      fileType: file.mimetype,
      fileSize: file.size,
      categoryId: resolvedCategory.id,
      category: resolvedCategory.name,
      contentPreview: '处理中...', // 初始预览
      uploadedAt: new Date().toISOString(),
      status: 'processing'
    };

    const document = await storage.createDocument(docData);
    console.log(`[Upload] 文档创建成功: ${document.id}, 文件: ${fixedFilename}, 大小: ${file.size} 字节`);

    // 2. 立即响应前端
    res.json({ ok: true, document });

    // 3. 异步处理
    // 注意：这里没有 await，故意让它在后台运行
    processUploadedFile(document.id, file).catch(err => {
      console.error(`[Upload] 后台处理失败: ${document.id}`, err);
    });

  } catch (error) {
    console.error('上传处理失败:', error);
    res.status(500).json({ ok: false, error: '上传失败' });
  }
});

app.post('/api/extract', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no_file' });
    const fixedFilename = fixFilename(file.originalname);
    const mime = file.mimetype || '';
    const fileCategory = getFileCategory(fixedFilename, mime);
    let text = '';

    if (fileCategory === 'pdf') {
      try {
        const PdfParseClass = pdfParseModule?.PDFParse || pdfParseModule?.default?.PDFParse || pdfParseModule;
        if (typeof PdfParseClass !== 'function') {
          throw new Error(`PdfParseClass not callable, type: ${typeof PdfParseClass}`);
        }
        if (typeof PdfParseClass.setWorker === 'function') {
          PdfParseClass.setWorker(PdfParseClass.setWorker());
        }
        const parser = new PdfParseClass({ data: file.buffer });
        if (typeof parser.getText !== 'function') {
          throw new Error('PdfParse instance has no getText');
        }
        const result = await parser.getText({});
        const data = { text: result?.text || '', numpages: result?.total || result?.pages?.length || 0, info: result?.info || {} };
        if (typeof parser.destroy === 'function') {
          await parser.destroy();
        }
        text = (data.text || '').trim();
        if (text.length === 0) {
          return res.status(500).json({ ok: false, error: 'extract_empty', detail: 'PDF解析成功但未提取到文本内容，可能是扫描件或受保护文档' });
        }
        return res.json({ ok: true, text, meta: { pages: data.numpages, info: data.info } });
      } catch (callError) {
        console.error('extract error', callError);
        return res.status(500).json({ ok: false, error: 'extract_failed', detail: String(callError) });
      }
    } else if (fileCategory === 'word') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = (result.value || '').trim();
      return res.json({ ok: true, text, meta: {} });
    } else if (fileCategory === 'excel') {
      const workbook = XLSX.read(file.buffer, { type: 'buffer', cellFormula: false, cellStyles: false });
      const sheets = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        return `【${name}】\n${csv}`;
      });
      text = sheets.join('\n\n').trim();
      return res.json({ ok: true, text, meta: { sheets: workbook.SheetNames.length } });
    } else {
      text = Buffer.from(file.buffer).toString('utf-8');
      return res.json({ ok: true, text, meta: {} });
    }
  } catch (e) {
    console.error('extract error', e);
    return res.status(500).json({ ok: false, error: 'extract_failed' });
  }
});



// ========== 知识库 API ==========

// 获取所有文档
app.get('/api/documents', asyncHandler(async (req, res) => {
  const documents = await storage.getAllDocuments();
  res.json({ ok: true, documents });
}, '获取文档列表'));

// 获取单个文档
app.get('/api/documents/:id', asyncHandler(async (req, res) => {
  const document = await storage.getDocument(req.params.id);
  if (!document) {
    return res.status(404).json({ ok: false, error: '文档不存在' });
  }
  res.json({ ok: true, document });
}, '获取文档'));

// 创建文档
app.post('/api/documents', asyncHandler(async (req, res) => {
  const categoriesData = await storage.getCategories();
  const resolvedCategory = resolveCategoryInfo(req.body?.categoryId || req.body?.category, categoriesData.tree || []);
  const document = await storage.createDocument({
    ...req.body,
    categoryId: resolvedCategory.id,
    category: resolvedCategory.name
  });
  res.json({ ok: true, document });
}, '创建文档'));

// 更新文档
app.put('/api/documents/:id', asyncHandler(async (req, res) => {
  const updates = { ...req.body };
  if ('categoryId' in updates || 'category' in updates) {
    const categoriesData = await storage.getCategories();
    const resolvedCategory = resolveCategoryInfo(updates.categoryId || updates.category, categoriesData.tree || []);
    updates.categoryId = resolvedCategory.id;
    updates.category = resolvedCategory.name;
  }
  const document = await storage.updateDocument(req.params.id, updates);
  if (!document) {
    return res.status(404).json({ ok: false, error: '文档不存在' });
  }
  res.json({ ok: true, document });
}, '更新文档'));

// 移动文档到指定分类
app.put('/api/documents/:id/category', asyncHandler(async (req, res) => {
  const { categoryId } = req.body;
  if (!categoryId) {
    return res.status(400).json({ ok: false, error: '缺少 categoryId' });
  }
  const categoriesData = await storage.getCategories();
  const resolvedCategory = resolveCategoryInfo(categoryId, categoriesData.tree || []);
  const document = await storage.updateDocument(req.params.id, {
    categoryId: resolvedCategory.id,
    category: resolvedCategory.name
  });
  if (!document) {
    return res.status(404).json({ ok: false, error: '文档不存在' });
  }
  console.log(`[API] 文档 ${req.params.id} 移动到分类 ${resolvedCategory.id}`);
  res.json({ ok: true, document });
}, '移动文档'));

// 删除文档
app.delete('/api/documents/:id', asyncHandler(async (req, res) => {
  console.log(`[API] 删除文档请求: ${req.params.id}`);
  const deleted = await storage.deleteDocument(req.params.id);
  console.log(`[API] 删除文档成功: ${req.params.id}, deleted=${deleted}`);
  res.json({ ok: true, deleted });
}, '删除文档'));

// 获取文档的 chunks
app.get('/api/documents/:id/chunks', asyncHandler(async (req, res) => {
  const chunks = await storage.getChunks(req.params.id);
  res.json({ ok: true, chunks });
}, '获取文档 chunks'));

// 获取单个 chunk
app.get('/api/documents/:docId/chunks/:chunkId', asyncHandler(async (req, res) => {
  const chunk = await storage.getChunk(req.params.docId, req.params.chunkId);
  if (!chunk) {
    return res.status(404).json({ ok: false, error: 'chunk 不存在' });
  }
  res.json({ ok: true, chunk });
}, '获取 chunk'));

// 获取文档的 chunks 统计信息 (轻量级)
app.get('/api/documents/:id/chunk-stats', asyncHandler(async (req, res) => {
  const stats = await storage.getChunkStats(req.params.id);
  res.json({ ok: true, stats });
}, '获取 chunks 统计'));

// 创建 chunks
app.post('/api/documents/:id/chunks', asyncHandler(async (req, res) => {
  const { chunks: chunksData } = req.body;
  if (!Array.isArray(chunksData)) {
    return res.status(400).json({ ok: false, error: 'chunks 必须是数组' });
  }

  // 为每个 chunk 添加 documentId
  const chunksWithDocId = chunksData.map(chunk => ({
    ...chunk,
    documentId: req.params.id
  }));

  const newChunks = await storage.createChunks(chunksWithDocId);
  res.json({ ok: true, chunks: newChunks });
}, '创建 chunks'));

// 更新 chunk 的 embedding
app.put('/api/chunks/:id/embedding', asyncHandler(async (req, res) => {
  const { embedding } = req.body;
  if (!Array.isArray(embedding)) {
    return res.status(400).json({ ok: false, error: 'embedding 必须是数组' });
  }

  const updated = await storage.updateChunkEmbedding(req.params.id, embedding);
  if (!updated) {
    return res.status(404).json({ ok: false, error: 'chunk 不存在' });
  }
  res.json({ ok: true });
}, '更新 embedding'));

// 搜索 chunks (混合检索：关键词 + 向量)
app.get('/api/chunks/search', async (req, res) => {
  try {
    const { q, limit, categoryId } = req.query;
    const query = typeof q === 'string' ? q.trim() : '';
    if (!query) return res.status(400).json({ ok: false, error: '缺少查询参数 q' });

    // 从配置读取检索参数
    const settings = await storage.getSettings();
    const retrievalConfig = settings.retrieval || {};
    const searchLimit = parseInt(limit) || retrievalConfig.searchLimit || 30;
    const rerankTopN = retrievalConfig.rerankTopN || 10;
    const searchCacheTTL = retrievalConfig.searchCacheTTL ?? 30000;
    applySearchCacheSize(retrievalConfig.searchCacheSize);
    applySearchCacheTTL(searchCacheTTL);

    // 展开分类：如果指定了 categoryId，获取该分类及其子分类的所有 ID
    let categoryIds = null;
    if (categoryId) {
      const categoriesData = await storage.getCategories();
      const categoryTree = categoriesData.tree || [];
      categoryIds = storage.getCategoryAndChildrenIds(categoryId, categoryTree);
    }


    const cacheKey = JSON.stringify({
      q: query,
      limit: searchLimit,
      categoryId: categoryId || 'all',
      embeddingModel: settings?.modelSelection?.embedding || 'default',
      rerankModel: settings?.modelSelection?.reranking || 'default',
      searchCacheTTL,
      rrfK: retrievalConfig.rrfK ?? 'default',
      keywordWeight: retrievalConfig.keywordWeight ?? 'default',
      vectorWeight: retrievalConfig.vectorWeight ?? 'default',
      vectorMinScore: retrievalConfig.vectorMinScore ?? 'default',
      rerankTopN
    });
    const cached = searchCache.get(cacheKey);
    if (cached) return res.json({ ok: true, chunks: cached, _cached: true });

    // 请求合并：如果相同查询正在进行，等待其完成
    if (pendingSearches.has(cacheKey)) {
      try {
        const result = await pendingSearches.get(cacheKey);
        return res.json({ ok: true, chunks: result, _cached: true });
      } catch (e) {
        // 原请求失败，继续执行新请求
      }
    }

    const startTime = Date.now();

    // 创建搜索 Promise 并注册到 pendingSearches
    const searchPromise = (async () => {
      // 1. 并行执行：关键词搜索 + 向量生成（带分类优先加分）
      const keywordSearchPromise = storage.searchChunks(query, searchLimit, categoryIds);
      const vectorSearchPromise = (async () => {
        try {
          const embedding = await embedText(query);
          if (embedding) return await storage.vectorSearchChunks(embedding, searchLimit, categoryIds);
        } catch (e) { }
        return [];
      })();

      const [keywordResults, vectorResults] = await Promise.all([
        keywordSearchPromise,
        vectorSearchPromise
      ]);

      console.log(`[Search] Query: "${query}" | Category=${categoryId || 'all'} | Keyword=${keywordResults.length}, Vector=${vectorResults.length} | ${Date.now() - startTime}ms`);

      // 2. 结果融合 (传入配置参数)
      let finalResults = fuseResults(keywordResults, vectorResults, query, searchLimit, retrievalConfig);

      // 3. Reranking (使用配置的 topN)
      if (finalResults.length > 0) {
        const rerankedResults = await rerankDocuments(query, finalResults, rerankTopN);
        finalResults = rerankedResults.length > 0 ? rerankedResults : finalResults;
      }

      return finalResults;
    })();

    pendingSearches.set(cacheKey, searchPromise);

    try {
      const finalResults = await searchPromise;
      // 4. 写入缓存
      searchCache.set(cacheKey, finalResults);
      res.json({ ok: true, chunks: finalResults });
    } finally {
      pendingSearches.delete(cacheKey);
    }
  } catch (error) {
    console.error('搜索 chunks 失败:', error);
    res.status(500).json({ ok: false, error: '搜索 chunks 失败' });
  }
});

// 向量搜索 chunks
app.post('/api/chunks/vector-search', async (req, res) => {
  try {
    const { embedding, limit = 30 } = req.body;
    if (!Array.isArray(embedding)) {
      return res.status(400).json({ ok: false, error: 'embedding 必须是数组' });
    }

    const results = await storage.vectorSearchChunks(embedding, parseInt(limit));
    res.json({ ok: true, results });
  } catch (error) {
    console.error('向量搜索失败:', error);
    res.status(500).json({ ok: false, error: '向量搜索失败' });
  }
});

// 获取所有 chunks（用于语义搜索）
app.get('/api/chunks', async (req, res) => {
  try {
    const chunks = await storage.getAllChunks();
    res.json({ ok: true, chunks });
  } catch (error) {
    console.error('获取所有 chunks 失败:', error);
    res.status(500).json({ ok: false, error: '获取所有 chunks 失败' });
  }
});

// ========== 设置 API ==========

// 获取设置
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await storage.getSettings();
    res.json({ ok: true, settings });
  } catch (error) {
    console.error('获取设置失败:', error);
    res.status(500).json({ ok: false, error: '获取设置失败' });
  }
});

// 获取统计数据 - 仪表盘使用
app.get('/api/stats', async (req, res) => {
  try {
    const documents = await storage.getAllDocuments();
    let totalChunks = 0;

    // 统计所有文档的chunks数量
    for (const doc of documents) {
      try {
        const chunks = await storage.getChunks(doc.id);
        totalChunks += chunks.length;
      } catch (e) {
        // 忽略单个文档的错误
      }
    }

    // 获取分类树，用于显示分类名称
    const categoriesData = await storage.getCategories();
    const categoryTree = categoriesData.tree || [];

    // 构建分类 ID 到名称的映射
    const categoryNameMap = { 'default': '默认分类' };
    const buildNameMap = (nodes) => {
      for (const node of nodes) {
        categoryNameMap[node.id] = node.name;
        if (node.children) buildNameMap(node.children);
      }
    };
    buildNameMap(categoryTree);

    // 按分类统计文档 - 使用 categoryId 字段
    const categoryMap = {};
    documents.forEach(doc => {
      const catId = doc.categoryId || doc.category || 'default';
      categoryMap[catId] = (categoryMap[catId] || 0) + 1;
    });
    const documentsByCategory = Object.entries(categoryMap).map(([catId, count]) => ({
      category: categoryNameMap[catId] || catId,
      count
    }));

    // 从查询日志获取真实统计数据
    const queryStats = await storage.getQueryStats();

    res.json({
      totalDocuments: documents.length,
      totalChunks,
      totalQueries: queryStats.totalQueries,
      avgResponseTime: queryStats.avgResponseTime,
      recentQueries: queryStats.recentQueries,
      topQuestions: queryStats.topQuestions,
      documentsByCategory
    });
  } catch (error) {
    console.error('获取统计数据失败:', error);
    res.status(500).json({ ok: false, error: '获取统计数据失败' });
  }
});

// 更新设置
app.put('/api/settings', async (req, res) => {
  try {
    const settings = await storage.updateSettings(req.body);
    await storage.reloadCacheConfig();
    applySearchCacheSize(settings?.retrieval?.searchCacheSize);
    applySearchCacheTTL(settings?.retrieval?.searchCacheTTL ?? 30000);
    res.json({ ok: true, settings });
  } catch (error) {
    console.error('更新设置失败:', error);
    res.status(500).json({ ok: false, error: '更新设置失败' });
  }
});

// 记录查询日志
app.post('/api/query-log', async (req, res) => {
  try {
    const { query, responseTime } = req.body;
    if (!query) {
      return res.status(400).json({ ok: false, error: '缺少查询内容' });
    }
    await storage.addQueryLog(query, responseTime || 0);
    res.json({ ok: true });
  } catch (error) {
    console.error('记录查询日志失败:', error);
    res.status(500).json({ ok: false, error: '记录查询日志失败' });
  }
});

// ========== 分类 API ==========

// 获取分类树
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await storage.getCategories();
    res.json({ ok: true, categories });
  } catch (error) {
    console.error('获取分类失败:', error);
    res.status(500).json({ ok: false, error: '获取分类失败' });
  }
});

// 添加分类
app.post('/api/categories', async (req, res) => {
  try {
    const { parentId, name, icon } = req.body;
    if (!name) {
      return res.status(400).json({ ok: false, error: '分类名称不能为空' });
    }
    const category = await storage.addCategory(parentId, { name, icon });
    res.json({ ok: true, category });
  } catch (error) {
    console.error('添加分类失败:', error);
    res.status(500).json({ ok: false, error: '添加分类失败' });
  }
});

// 更新分类
app.put('/api/categories/:id', async (req, res) => {
  try {
    const { name, icon } = req.body;
    const categories = await storage.updateCategory(req.params.id, { name, icon });
    res.json({ ok: true, categories });
  } catch (error) {
    console.error('更新分类失败:', error);
    res.status(500).json({ ok: false, error: '更新分类失败' });
  }
});

// 删除分类
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const deleted = await storage.deleteCategory(req.params.id);
    res.json({ ok: true, deleted });
  } catch (error) {
    console.error('删除分类失败:', error);
    res.status(500).json({ ok: false, error: '删除分类失败' });
  }
});

// 获取 API Key
app.get('/api/settings/api-key/:provider', async (req, res) => {
  try {
    const apiKey = await storage.getApiKey(req.params.provider);
    if (!apiKey) {
      return res.status(404).json({ ok: false, error: 'API Key 未配置' });
    }
    res.json({ ok: true, apiKey });
  } catch (error) {
    console.error('获取 API Key 失败:', error);
    res.status(500).json({ ok: false, error: '获取 API Key 失败' });
  }
});

// ========== 任务队列 API ==========

// 创建 embedding 生成任务
app.post('/api/documents/:id/generate-embeddings', async (req, res) => {
  try {
    const documentId = req.params.id;
    console.log(`[API] 创建 embedding 任务，文档 ID: ${documentId}`);

    const task = taskQueue.createTask('generate_embeddings', documentId);
    console.log(`[API] 任务已创建: ${task.id}, status=${task.status}`);

    // 异步处理任务（不阻塞响应）
    taskQueue.processEmbeddingTask(task.id, documentId).catch(error => {
      console.error(`[API] 处理 embedding 任务 ${task.id} 失败:`, error);
    });

    console.log(`[API] 任务 ${task.id} 已提交异步处理`);
    res.json({ ok: true, taskId: task.id, task });
  } catch (error) {
    console.error('[API] 创建任务失败:', error);
    res.status(500).json({ ok: false, error: '创建任务失败', detail: error.message });
  }
});


// 获取任务状态
app.get('/api/tasks/:taskId', async (req, res) => {
  try {
    const task = taskQueue.getTask(req.params.taskId);
    if (!task) {
      return res.status(404).json({ ok: false, error: '任务不存在' });
    }
    res.json({ ok: true, task });
  } catch (error) {
    console.error('获取任务状态失败:', error);
    res.status(500).json({ ok: false, error: '获取任务状态失败' });
  }
});

// 获取文档的所有任务
app.get('/api/documents/:id/tasks', async (req, res) => {
  try {
    const documentId = req.params.id; // 修复：使用 id 而不是 documentId
    console.log(`[API] 获取文档任务，文档 ID: ${documentId}`);
    const documentTasks = taskQueue.getDocumentTasks(documentId);
    console.log(`[API] 找到 ${documentTasks.length} 个任务`);
    res.json({ ok: true, tasks: documentTasks });
  } catch (error) {
    console.error('[API] 获取文档任务失败:', error);
    res.status(500).json({ ok: false, error: '获取文档任务失败' });
  }
});

// ========== SN to IBLF 查询 API ==========

app.post('/api/sn-to-iblf', async (req, res) => {
  try {
    const { snList } = req.body;
    if (!snList || !Array.isArray(snList) || snList.length === 0) {
      return res.status(400).json({ ok: false, error: '请提供 SN 列表' });
    }

    const results = [];
    const notFound = [];
    const snMap = new Map(); // SN -> Hostname
    const connectionMap = new Map(); // Hostname -> [{iblf, gpuPort, iblfPort}]
    const allConnections = []; // 所有连接关系

    // 预处理查询列表
    const pendingSNs = snList.map(sn => sn.trim().toUpperCase()).filter(Boolean);
    if (pendingSNs.length === 0) return res.json({ ok: true, groups: [], notFound: [] });

    // 扫描所有 Chunks
    await storage.scanChunks(chunk => {
      const content = chunk.content;

      // 1. 匹配 SN -> Hostname
      for (const sn of pendingSNs) {
        if (!snMap.has(sn) && content.includes(sn)) {
          // 匹配格式: SN,SN,SN,SN,SN,hostname
          const snPattern = new RegExp(`${sn}[,\\s]+${sn}[,\\s]+${sn}[,\\s]+${sn}[,\\s]+${sn}[,\\s]*(MDC-[A-Z0-9-]+-GPU-\\d+)`, 'i');
          let match = content.match(snPattern);
          if (match) {
            snMap.set(sn, match[1]);
          } else {
            // 备选匹配
            const altPattern = new RegExp(`${sn}[^\\n]*?(MDC-[A-Z0-9-]+-GPU-\\d+)`, 'i');
            match = content.match(altPattern);
            if (match) snMap.set(sn, match[1]);
          }
        }
      }

      // 2. 解析 CSV 格式的连接关系
      // 格式: ...,MDC-DH1E-A07-POD1-GPU-001,1,MMS4X00,1E,1E-G-22,17,MDC-DH1E-G22-17U-POD1-RAIL1-IBLF-001,1/1,...
      if (content.includes('IBLF') && content.includes('GPU')) {
        const lines = content.split('\n');
        for (const line of lines) {
          // 提取 GPU 主机名和 IBLF 名称
          const gpuMatch = line.match(/(MDC-[A-Z0-9-]+-GPU-\d+)/gi);
          const iblfMatch = line.match(/(MDC-[A-Z0-9-]+-IBLF-\d+)/gi);

          if (gpuMatch && iblfMatch) {
            const gpu = gpuMatch[0].toUpperCase();
            const iblf = iblfMatch[0].toUpperCase();

            // 尝试提取端口信息
            // GPU 端口: 在 GPU 名称后面的单个数字
            const gpuPortMatch = line.match(new RegExp(`${gpu.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,\\s]+(\\d+)`, 'i'));
            // IBLF 端口: 在 IBLF 名称后面的 x/x 格式
            const iblfPortMatch = line.match(new RegExp(`${iblf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,\\s]+(\\d+/\\d+)`, 'i'));

            const conn = {
              gpu,
              iblf,
              gpuPort: gpuPortMatch ? gpuPortMatch[1] : null,
              iblfPort: iblfPortMatch ? iblfPortMatch[1] : null
            };

            if (!connectionMap.has(gpu)) connectionMap.set(gpu, []);
            // 避免重复
            const existing = connectionMap.get(gpu);
            if (!existing.some(c => c.iblf === iblf && c.gpuPort === conn.gpuPort)) {
              existing.push(conn);
              allConnections.push(conn);
            }
          }
        }
      }
      return true;
    });

    // 构建结果
    for (const sn of pendingSNs) {
      const hostname = snMap.get(sn);
      if (!hostname) {
        notFound.push(sn);
        continue;
      }

      const connections = connectionMap.get(hostname.toUpperCase()) || [];
      const iblfs = [...new Set(connections.map(c => c.iblf))].sort();

      results.push({
        sn,
        hostname,
        iblfs,
        connections: connections.map(c => ({
          iblf: c.iblf,
          gpuPort: c.gpuPort,
          iblfPort: c.iblfPort
        }))
      });
    }

    // 按 IBLF 组合分组
    const groups = new Map();
    for (const result of results) {
      const key = result.iblfs.join('|');
      if (!groups.has(key)) {
        groups.set(key, {
          iblfs: result.iblfs,
          servers: []
        });
      }
      groups.get(key).servers.push({
        sn: result.sn,
        hostname: result.hostname,
        connections: result.connections
      });
    }

    // 构建拓扑图数据
    const topology = {
      nodes: [],
      edges: []
    };

    const nodeSet = new Set();
    for (const result of results) {
      // 添加 GPU 节点
      if (!nodeSet.has(result.hostname)) {
        nodeSet.add(result.hostname);
        topology.nodes.push({
          id: result.hostname,
          type: 'gpu',
          label: result.hostname,
          sn: result.sn
        });
      }

      // 添加 IBLF 节点和边
      for (const conn of result.connections) {
        if (!nodeSet.has(conn.iblf)) {
          nodeSet.add(conn.iblf);
          topology.nodes.push({
            id: conn.iblf,
            type: 'iblf',
            label: conn.iblf
          });
        }

        topology.edges.push({
          source: result.hostname,
          target: conn.iblf,
          sourcePort: conn.gpuPort,
          targetPort: conn.iblfPort
        });
      }
    }

    const groupedResults = Array.from(groups.values())
      .sort((a, b) => b.servers.length - a.servers.length);

    res.json({
      ok: true,
      summary: {
        total: snList.length,
        found: results.length,
        notFound: notFound.length,
        groups: groupedResults.length,
        totalConnections: allConnections.length
      },
      groups: groupedResults,
      notFound,
      details: results,
      topology
    });
  } catch (error) {
    console.error('[SN-IBLF] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========== SN to Address 查询 API ==========

app.post('/api/sn-to-address', async (req, res) => {
  try {
    const { snList } = req.body;
    if (!snList || !Array.isArray(snList) || snList.length === 0) {
      return res.status(400).json({ ok: false, error: '请提供 SN 列表' });
    }

    const pendingSNs = snList.map(sn => sn.trim().toUpperCase()).filter(Boolean);
    const results = [];
    const notFound = new Set(pendingSNs);
    const snResultMap = new Map();

    // 单次扫描所有 Chunks，提取 IP 地址信息
    await storage.scanChunks(chunk => {
      const content = chunk.content;

      // 优化匹配：只在内容包含待查 SN 时进行正则处理
      for (const sn of notFound) {
        if (content.includes(sn)) {
          // 尝试匹配完整行：SN重复,主机名,别名,带外IP,带内IP
          const linePattern = new RegExp(
            `${sn}[^\\r\\n]*?(MDC-[A-Z0-9-]+-GPU-\\d+)[^,]*,([^,]*),(\\d+\\.\\d+\\.\\d+\\.\\d+),(\\d+\\.\\d+\\.\\d+\\.\\d+)`,
            'i'
          );
          const match = content.match(linePattern);
          if (match) {
            snResultMap.set(sn, {
              sn,
              hostname: match[1],
              outband: match[3],
              inband: match[4]
            });
            notFound.delete(sn);
            continue;
          }

          // 备用匹配：仅提取主机名
          const snPattern = new RegExp(`${sn}[^\\r\\n]*?(MDC-[A-Z0-9-]+-GPU-\\d+)`, 'i');
          const snMatch = content.match(snPattern);
          if (snMatch) {
            const hostname = snMatch[1];
            // 尝试在当前块提取 IP
            const ipMatches = content.match(/\d+\.\d+\.\d+\.\d+/g) || [];
            let inband = '', outband = '';
            for (const ip of ipMatches) {
              if (ip.startsWith('10.240.8.') || ip.startsWith('10.240.9.')) outband = ip;
              else if (ip.startsWith('10.240.0.') || ip.startsWith('10.240.1.')) inband = ip;
            }

            snResultMap.set(sn, { sn, hostname, inband, outband });
            notFound.delete(sn);
          }
        }
      }
      return notFound.size > 0; // 如果所有 SN 都找到了，提前结束扫描
    });

    res.json({
      ok: true,
      summary: {
        total: pendingSNs.length,
        found: snResultMap.size,
        notFound: notFound.size
      },
      results: Array.from(snResultMap.values()),
      notFound: Array.from(notFound)
    });
  } catch (error) {
    console.error('[SN-Address] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========== SN to Topology 查询 API ==========
// 通过知识库中的连线表数据，还原 IB 网络 (GPU → IBLF → IBSP → IBCR) 和 RoCE 网络 (GPU → ASW → SSW → CSW 等) 的完整链路

// 识别设备类型
function getDeviceType(deviceName) {
  if (!deviceName) return null;
  const upper = deviceName.toUpperCase();
  // IB 网络设备
  // Core 层级 (Highest Priority)
  if (upper.includes('IBCR')) return 'ibcr';
  // Spine 层级
  if (upper.includes('IBSP')) return 'ibsp';
  // Leaf 层级
  if (upper.includes('IBLF')) return 'iblf';
  // RoCE 网络设备
  if (upper.includes('SOOB')) return 'soob';
  if (upper.includes('OOB') && !upper.includes('SOOB')) return 'oob';
  if (upper.includes('LSW')) return 'lsw';
  if (upper.includes('CSW')) return 'csw';
  if (upper.includes('SSW')) return 'ssw';
  if (upper.includes('ASW')) return 'asw';
  // GPU 服务器
  if (upper.includes('GPU')) return 'gpu';
  return null;
}

// 检查是否是网络设备
function isNetworkDevice(deviceName) {
  return getDeviceType(deviceName) !== null;
}

app.post('/api/sn-to-topology', async (req, res) => {
  try {
    const { sn } = req.body;
    if (!sn) return res.status(400).json({ ok: false, error: '请提供 SN' });

    const snTrimmed = sn.trim().toUpperCase();
    let hostname = '';
    let rack = '';

    // IB 网络设备
    const ibDevices = { iblf: new Set(), ibsp: new Set(), ibcr: new Set() };
    // RoCE 网络设备
    const roceDevices = { asw: new Set(), ssw: new Set(), csw: new Set(), lsw: new Set(), soob: new Set(), oob: new Set() };

    const relevantConnections = [];
    const connSet = new Set();

    // 构建全局连接映射表
    const portMap = new Map(); // "device|port" -> { peer, peerPort }

    console.log(`[SN-Topology] 开始查询 SN: ${snTrimmed}`);

    // ============ 第一步：扫描知识库，构建连接映射 + 查找 SN 对应的主机名 ============
    await storage.scanChunks(chunk => {
      const content = chunk.content;

      // 1. 查找 SN 对应的主机名
      if (!hostname && content.includes(snTrimmed)) {
        const patterns = [
          new RegExp(`${snTrimmed}[^\\r\\n]*?(MDC-[A-Z0-9-]+-GPU-\\d+)`, 'i'),
          new RegExp(`(MDC-[A-Z0-9-]+-GPU-\\d+)[^\\r\\n]*?${snTrimmed}`, 'i')
        ];
        for (const p of patterns) {
          const m = content.match(p);
          if (m) {
            hostname = m[1].toUpperCase();  // 规范化主机名为大写
            const rackMatch = hostname.match(/([A-Z]\d{2})/i);
            if (rackMatch) rack = rackMatch[1];
            break;
          }
        }
      }

      // 2. 解析连接数据 - 支持多种 CSV 格式
      const lines = content.split('\n');
      let headerIdx = { system: -1, port: -1, peer: -1, peerPort: -1 };

      for (const line of lines) {
        const cols = line.split(',').map(c => c.trim());

        // 检测表头行
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('system') || lowerLine.includes('hostname')) {
          cols.forEach((col, idx) => {
            const lc = col.toLowerCase();
            if (lc === 'system' || lc === 'hostname') headerIdx.system = idx;
            else if (lc === 'port' || lc === 'ifname') headerIdx.port = idx;
            else if (lc.includes('peer') && lc.includes('node')) headerIdx.peer = idx;
            else if (lc.includes('peer') && lc.includes('port')) headerIdx.peerPort = idx;
          });
          continue;
        }

        // 如果有表头，按表头解析
        if (headerIdx.system >= 0 && headerIdx.peer >= 0) {
          const sys = cols[headerIdx.system].toUpperCase();  // 规范化为大写
          const port = headerIdx.port >= 0 ? cols[headerIdx.port] : '';
          const peer = cols[headerIdx.peer].toUpperCase();  // 规范化为大写
          const peerPort = headerIdx.peerPort >= 0 ? cols[headerIdx.peerPort] : '';

          if (sys && peer && isNetworkDevice(sys) && isNetworkDevice(peer)) {
            const key = `${sys}|${port}`;
            if (!portMap.has(key)) portMap.set(key, { peer, peerPort });
            const reverseKey = `${peer}|${peerPort}`;
            if (!portMap.has(reverseKey)) portMap.set(reverseKey, { peer: sys, peerPort: port });
          }
        } else if (cols.length >= 4) {
          // 无表头时，尝试自动识别设备名列
          for (let i = 0; i < cols.length - 1; i++) {
            const sys = cols[i].toUpperCase();  // 规范化为大写
            if (!isNetworkDevice(sys)) continue;
            // 找下一个设备名列
            for (let j = i + 1; j < cols.length; j++) {
              const peer = cols[j].toUpperCase();  // 规范化为大写
              if (!isNetworkDevice(peer)) continue;
              // sys 和 peer 之间可能有端口
              const port = (j > i + 1) ? cols[i + 1] : '';
              const peerPort = (j + 1 < cols.length) ? cols[j + 1] : '';
              const key = `${sys}|${port}`;
              if (!portMap.has(key)) portMap.set(key, { peer, peerPort });
              const reverseKey = `${peer}|${peerPort}`;
              if (!portMap.has(reverseKey)) portMap.set(reverseKey, { peer: sys, peerPort: port });
              break;
            }
            break;
          }
        }
      }
      return true;
    });

    console.log(`[SN-Topology] 构建连接映射完成: ${portMap.size} 条记录`);

    if (!hostname) {
      return res.status(404).json({ ok: false, error: '未找到该 SN 对应的服务器' });
    }

    const podMatch = hostname.match(/POD(\d+)/i);
    const podNum = podMatch ? podMatch[1] : '1';
    console.log(`[SN-Topology] SN ${snTrimmed} -> Server ${hostname}`);

    // ============ 辅助函数：添加连接 ============
    const addConnection = (layer, src, srcPort, dst, dstPort) => {
      const connKey = [src, srcPort, dst, dstPort].sort().join('|');
      if (connSet.has(connKey)) return;
      connSet.add(connKey);
      relevantConnections.push({ layer, sourceDevice: src, sourcePort: srcPort, destDevice: dst, destPort: dstPort });
    };

    // ============ IB 网络追溯 (Strict Layered Traversal) ============
    // Logic: GPU -> IBLF -> IBSP -> IBCR
    // 1. Find GPU
    // 2. GPU peers -> Filter ONLY 'IBLF' -> IBLF Set
    // 3. IBLF peers -> Filter ONLY 'IBSP' -> IBSP Set
    // 4. IBSP peers -> Filter ONLY 'IBCR' -> IBCR Set

    // Helper: Valid patterns
    const isValidIBLF = (name) => name && name.toUpperCase().includes('IBLF') && !name.toUpperCase().includes('IBSP') && !name.toUpperCase().includes('IBCR');
    const isValidIBSP = (name) => name && name.toUpperCase().includes('IBSP');
    const isValidIBCR = (name) => name && name.toUpperCase().includes('IBCR');

    // Helper: Find next layer peers
    const findNextLayer = (currentLayerDevices, validatorFn, currentLayerName) => {
      const nextLayerDevices = new Set();
      const currentList = Array.from(currentLayerDevices);

      for (const srcDevice of currentList) {
        // Iterate ALL connections in portMap to find edges starting from srcDevice
        // (Since portMap keys are 'device|port', we need to check all entries or optimize. 
        // Optimization: We iterate portMap once? No, iterate portMap is fast enough if size < 100k, 
        // but better: iterate known devices and construct keys? We don't know ports.
        // So we scan portMap.
        for (const [key, value] of portMap) {
          const [sys, port] = key.split('|');

          // Check forward connection: sys == srcDevice
          if (sys.toUpperCase() === srcDevice.toUpperCase()) {
            const { peer, peerPort } = value;
            if (validatorFn(peer)) {
              addConnection(currentLayerName, sys, port, peer, peerPort);
              nextLayerDevices.add(peer);
            }
          }
          // Check reverse connection: peer == srcDevice
          const { peer } = value;
          if (peer && peer.toUpperCase() === srcDevice.toUpperCase()) {
            // value is {peer, peerPort}, but here 'peer' is the OTHER end. 
            // Wait, portMap value is {peer, peerPort}.
            // If entry is Key: "A|1" -> Val: {peer: "B", peerPort: "2"}
            // If srcDevice is B. We need to find A.
            // sys (A) is the candidate next layer? No, existing logic handles bidirectional map population?
            // Line 1293: portMap.set(reverseKey, { peer: sys, peerPort: port });
            // YES, portMap is fully bidirectional. So we ONLY need to check keys.
          }
        }
      }
      return nextLayerDevices;
    };

    // Optimization: findNextLayer by scanning portMap is O(N_map * N_current).
    // Better: Build an adjacency list first?
    // Yes. Let's build adjacency list from portMap ONCE.
    // 重要：规范化所有设备名为大写，确保前后端ID一致
    const adjacencyList = new Map(); // Device -> Array<{port, peer, peerPort}>
    for (const [key, val] of portMap) {
      const [sys, port] = key.split('|');
      const normalizedSys = sys.toUpperCase();
      const normalizedPeer = val.peer.toUpperCase();  // 规范化 peer
      if (!adjacencyList.has(normalizedSys)) adjacencyList.set(normalizedSys, []);
      adjacencyList.get(normalizedSys).push({ port, peer: normalizedPeer, peerPort: val.peerPort });
    }

    const findNextLayerOptimized = (currentLayerDevices, validatorFn, layerName) => {
      const nextSet = new Set();
      for (const dev of currentLayerDevices) {
        const neighbors = adjacencyList.get(dev.toUpperCase()) || [];
        for (const conn of neighbors) {
          if (validatorFn(conn.peer)) {
            addConnection(layerName, dev, conn.port, conn.peer, conn.peerPort);
            nextSet.add(conn.peer);
          }
        }
      }
      return nextSet;
    };

    // Step 1: GPU -> IBLF
    const gpuSet = new Set([hostname]);
    const iblfSet = findNextLayerOptimized(gpuSet, isValidIBLF, 'gpu-iblf');
    iblfSet.forEach(d => ibDevices.iblf.add(d));
    console.log(`[SN-Topology] IB Step 1: GPU -> Found ${ibDevices.iblf.size} IBLF`);

    // Step 1: GPU -> ASW (简化版：只显示GPU直接连接的ASW)
    const isValidASW = (n) => n && n.toUpperCase().includes('ASW');
    const aswSet = findNextLayerOptimized(gpuSet, isValidASW, 'gpu-asw');
    aswSet.forEach(d => roceDevices.asw.add(d));
    console.log(`[SN-Topology] RoCE Step 1: GPU -> Found ${roceDevices.asw.size} ASW`);

    console.log(`[SN-Topology] Final Summary: GPU connects to ${ibDevices.iblf.size} IBLF + ${roceDevices.asw.size} ASW`);



    console.log(`[SN-Topology] Total: ${relevantConnections.length} connections`);

    // 调试信息：检查设备名和连接的一致性
    const iblfInDevices = Array.from(ibDevices.iblf);
    const iblfInConnections = new Set(
      relevantConnections
        .filter(c => c.layer.includes('iblf'))
        .flatMap(c => [c.sourceDevice, c.destDevice])
        .filter(d => d && d.toUpperCase().includes('IBLF'))
    );

    const missingInConnections = iblfInDevices.filter(d => !iblfInConnections.has(d));
    if (missingInConnections.length > 0) {
      console.warn(`[SN-Topology] WARNING: 以下IBLF设备在connections中没有连接: ${missingInConnections.join(', ')}`);
    }

    res.json({
      ok: true,
      _version: 'strict_v1_refactored_20251228_fix_normalization', // Updated version tag
      server: { sn: snTrimmed, hostname, rack, pod: `POD${podNum}` },
      connections: relevantConnections,
      devices: {
        // IB 网络
        iblf: iblfInDevices,
        spine: Array.from(ibDevices.ibsp),
        core: Array.from(ibDevices.ibcr),
        // RoCE 网络
        asw: Array.from(roceDevices.asw),
        ssw: Array.from(roceDevices.ssw),
        csw: Array.from(roceDevices.csw),
        lsw: Array.from(roceDevices.lsw),
        soob: Array.from(roceDevices.soob),
        oob: Array.from(roceDevices.oob)
      },
      totalConnections: relevantConnections.length,
      _debug: {
        // 调试信息，帮助排查问题
        devicesSummary: {
          iblf: iblfInDevices.length,
          ibsp: ibDevices.ibsp.size,
          ibcr: ibDevices.ibcr.size
        },
        connectionsByLayer: {},
        portMapSize: portMap.size,
        adjacencyListSize: adjacencyList.size
      }
    });
  } catch (error) {
    console.error('[SN-Topology] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========== Chat API (代理 SiliconFlow / Gemini) ==========

// 获取提供商配置
async function getProviderConfig(provider) {
  const settings = await storage.getSettings();
  const providers = settings?.providers || {};
  const config = providers[provider];

  // 默认配置
  const defaults = {
    siliconflow: { baseUrl: 'https://api.siliconflow.cn', apiKey: '' },
    gemini: { baseUrl: 'https://gemini.chinablog.xyz', apiKey: 'Zhang1996' }
  };

  return {
    baseUrl: config?.baseUrl || defaults[provider]?.baseUrl || '',
    apiKey: config?.apiKey || defaults[provider]?.apiKey || ''
  };
}

// 获取当前配置的 LLM 模型
async function getLLMModel() {
  try {
    const settings = await storage.getSettings();
    return settings?.modelSelection?.llm || 'Qwen/Qwen3-32B';
  } catch (e) {
    return 'Qwen/Qwen3-32B';
  }
}

// ========== NVIDIA 文档转 PDF ==========
const NVIDIA_PDF_CSS = `
@page { size: A4; margin: 12mm 12mm 20mm 12mm; }
@media print {
  header, footer, .site-header, .site-footer, .breadcrumbs,
  .page-header, .doc-footer, .page-footer {
    display: none !important;
  }
  *[style*="position:sticky"], *[style*="position: sticky"],
  *[style*="position:fixed"], *[style*="position: fixed"],
  .sticky, .fixed, [class*="sticky"], [class*="fixed"] {
    display: none !important;
  }
  img, svg, video, table { max-width: 100% !important; height: auto !important; }
  pre, code { white-space: pre-wrap !important; word-break: break-word; }
  table, figure { break-inside: avoid; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
body { color: #111827; font-size: 12pt; line-height: 1.5; }
`;

const fetchWithTimeout = async (targetUrl, timeoutMs = 30_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(targetUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchPdf = async (targetUrl) => {
  const pdfRes = await fetchWithTimeout(targetUrl, 45_000);
  if (!pdfRes.ok) return null;
  const contentType = pdfRes.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/pdf')) return null;
  const arrayBuffer = await pdfRes.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
};

const guessPdfUrlFromHtml = (html) => {
  const matches = html.match(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/i);
  if (matches && matches[1]) return matches[1];
  const alt = html.match(/src=["']([^"']+\.pdf(?:\?[^"']*)?)["']/i);
  if (alt && alt[1]) return alt[1];
  return null;
};

const generateNvidiaPdf = async (url, filename) => {
  let browser;
  const outPath = path.join(os.tmpdir(), `nvidia-doc-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    const directPdf = await fetchPdf(url);
    if (directPdf) {
      await fs.writeFile(outPath, directPdf.buffer);
      return { outPath, filename };
    }

    const htmlRes = await fetchWithTimeout(url, 30_000);
    if (htmlRes.ok) {
      const html = await htmlRes.text();
      const pdfLink = guessPdfUrlFromHtml(html);
      if (pdfLink) {
        const resolved = new URL(pdfLink, url).toString();
        const pdfResult = await fetchPdf(resolved);
        if (pdfResult) {
          const pdfName = resolved.split('/').pop() || filename;
          await fs.writeFile(outPath, pdfResult.buffer);
          return { outPath, filename: pdfName };
        }
      }
    }

    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-gpu',
        '--ignore-certificate-errors',
        '--no-sandbox',
        '--disable-web-security'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });
    page.setDefaultTimeout(240_000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240_000 });
    await page.waitForLoadState('networkidle', { timeout: 240_000 });
    await page.waitForTimeout(2000);

    await page.addStyleTag({ content: NVIDIA_PDF_CSS });

    const scrollToBottom = async () => {
      let lastHeight = 0;
      for (let i = 0; i < 60; i += 1) {
        const height = await page.evaluate(() => document.body.scrollHeight);
        if (height === lastHeight) break;
        lastHeight = height;
        await page.evaluate((h) => window.scrollTo(0, h), height);
        await page.waitForTimeout(300);
      }
    };
    await scrollToBottom();
    try {
      await page.waitForFunction(
        () => Array.from(document.images || []).every((img) => img.complete),
        { timeout: 60_000 }
      );
    } catch {}
    try {
      await page.evaluate(() => document.fonts && document.fonts.ready);
    } catch {}
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.emulateMedia({ media: 'print' });

    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: '12mm', right: '12mm', bottom: '20mm', left: '12mm' },
      scale: 1,
      preferCSSPageSize: true
    });

    return { outPath, filename };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.warn('[PDF] 浏览器关闭失败:', closeError?.message || closeError);
      }
    }
  }
};

const runNvidiaPdfTask = async (taskId, url) => {
  const parsedUrl = new URL(url);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = parsedUrl.pathname.split('/').filter(Boolean).pop() || 'nvidia-doc';
  const filename = `${baseName}-${stamp}.pdf`;

  const maxRetries = 2;
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    try {
      taskQueue.updateTask(taskId, {
        status: 'processing',
        progress: Math.min(95, attempt * 30),
        metadata: { ...(taskQueue.getTask(taskId)?.metadata || {}), attempt }
      });
      const result = await generateNvidiaPdf(url, filename);
      taskQueue.completeTask(taskId, result);
      return;
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt > maxRetries) break;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }

  taskQueue.failTask(taskId, lastError || 'PDF 生成失败');
};

app.post('/api/nvidia-doc-pdf/tasks', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ ok: false, error: '请提供文档链接' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ ok: false, error: '链接格式不正确' });
  }

  if (parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ ok: false, error: '仅支持 https 链接' });
  }

  if (!parsedUrl.hostname.includes('nvidia.com')) {
    return res.status(400).json({ ok: false, error: '仅支持英伟达文档站点链接' });
  }

  const task = taskQueue.createTask('nvidia_doc_pdf', `nvidia-${Date.now()}`, {
    url,
    createdAt: new Date().toISOString()
  });

  runNvidiaPdfTask(task.id, url).catch((error) => {
    console.error('[PDF] 异步任务失败:', error);
    taskQueue.failTask(task.id, error);
  });

  res.json({ ok: true, taskId: task.id });
});

app.get('/api/nvidia-doc-pdf/tasks/:taskId', async (req, res) => {
  const task = taskQueue.getTask(req.params.taskId);
  if (!task) return res.status(404).json({ ok: false, error: '任务不存在' });
  res.json({ ok: true, task });
});

app.get('/api/nvidia-doc-pdf/tasks/:taskId/download', async (req, res) => {
  const task = taskQueue.getTask(req.params.taskId);
  if (!task) return res.status(404).json({ ok: false, error: '任务不存在' });
  if (task.status !== 'completed' || !task.result?.outPath) {
    return res.status(400).json({ ok: false, error: '任务未完成' });
  }

  const { outPath, filename } = task.result;
  const cleanupTempFile = async () => {
    try {
      await fs.unlink(outPath);
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        console.warn('[PDF] 临时文件清理失败:', err.message);
      }
    }
  };

  res.on('close', cleanupTempFile);
  res.download(outPath, filename || 'nvidia-doc.pdf', cleanupTempFile);
});

app.post('/api/chat', async (req, res) => {
  try {
    const {
      messages = [],
      model,
      max_tokens,
      temperature,
      useGemini,
      references = [],
      question
    } = req.body;
    const latestUserMessage = question ||
      [...messages].reverse().find(msg => msg.role === 'user')?.content ||
      '';

    // 如果指定使用 Gemini 或知识库无内容
    if (useGemini) {
      console.log('[Chat] Using Gemini API with Google Search');
      try {
        const geminiConfig = await getProviderConfig('gemini');
        if (!geminiConfig.apiKey) {
          throw new Error('未配置 Gemini API Key');
        }

        const response = await fetch(`${geminiConfig.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${geminiConfig.apiKey}`
          },
          body: JSON.stringify({
            model: model || 'gemini-3-flash-preview',
            messages,
            max_tokens: max_tokens || 8192,
            temperature: temperature || 0.7,
            // 启用 Google Search grounding（联网搜索）
            tools: [{ type: 'google_search' }]
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('[Chat] Gemini API error:', response.status, errorData);
          throw new Error(`Gemini API 请求失败: ${response.status}`);
        }

        const data = await response.json();
        const answerText = data.choices?.[0]?.message?.content || '';
        const validation = validateAnswerConsistency(answerText, references, latestUserMessage);
        return res.json({ ok: true, ...data, source: 'gemini', validation });
      } catch (geminiError) {
        console.error('[Chat] Gemini failed, falling back to SiliconFlow:', geminiError.message);
        // Gemini 失败，回退到 SiliconFlow
      }
    }

    // 默认使用 SiliconFlow
    const siliconflowConfig = await getProviderConfig('siliconflow');
    // 兼容旧的 API Key 存储方式
    const apiKey = siliconflowConfig.apiKey || await storage.getApiKey('siliconflow');
    if (!apiKey) {
      return res.status(400).json({ ok: false, error: '未配置 SiliconFlow API Key' });
    }

    const response = await fetch(`${siliconflowConfig.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || await getLLMModel(),
        messages,
        max_tokens: max_tokens || 8192,
        temperature: temperature || 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[Chat] API error:', response.status, errorData);
      return res.status(response.status).json({
        ok: false,
        error: errorData.error?.message || `API 请求失败: ${response.status}`
      });
    }

    const data = await response.json();
    const answerText = data.choices?.[0]?.message?.content || '';
    const validation = validateAnswerConsistency(answerText, references, latestUserMessage);
    res.json({ ok: true, ...data, source: 'siliconflow', validation });
  } catch (error) {
    console.error('[Chat] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const { messageId, verdict, question, answer, conversationId, confidenceScore } = req.body;
    if (!messageId || !verdict) {
      return res.status(400).json({ ok: false, error: '缺少必需字段' });
    }
    const entry = await addFeedbackEntry({
      id: `feedback-${Date.now()}`,
      messageId,
      verdict,
      question: question || '',
      answer: answer || '',
      conversationId: conversationId || '',
      confidenceScore: typeof confidenceScore === 'number' ? confidenceScore : null,
      timestamp: new Date().toISOString()
    });
    res.json({ ok: true, entry });
  } catch (error) {
    console.error('[Feedback] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/metrics/feedback', async (req, res) => {
  try {
    const metrics = await getFeedbackMetrics();
    res.json({ ok: true, metrics });
  } catch (error) {
    console.error('[Feedback] Metrics error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ========== 模型列表 API ==========

// 获取硅基流动模型列表
app.get('/api/models/siliconflow', async (req, res) => {
  try {
    const config = await getProviderConfig('siliconflow');
    // 兼容旧的 API Key 存储方式
    const apiKey = config.apiKey || await storage.getApiKey('siliconflow');
    if (!apiKey) {
      return res.status(400).json({ ok: false, error: '未配置 SiliconFlow API Key' });
    }

    const response = await fetch(`${config.baseUrl}/v1/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        ok: false,
        error: errorData.error?.message || `API 请求失败: ${response.status}`
      });
    }

    const data = await response.json();
    res.json({ ok: true, models: data.data || [] });
  } catch (error) {
    console.error('[Models] SiliconFlow error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 获取 Gemini 模型列表
app.get('/api/models/gemini', async (req, res) => {
  try {
    const config = await getProviderConfig('gemini');
    if (!config.apiKey) {
      return res.status(400).json({ ok: false, error: '未配置 Gemini API Key' });
    }

    const response = await fetch(`${config.baseUrl}/v1/models`, {
      headers: { 'Authorization': `Bearer ${config.apiKey}` }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        ok: false,
        error: errorData.error?.message || `API 请求失败: ${response.status}`
      });
    }

    const data = await response.json();
    res.json({ ok: true, models: data.data || [] });
  } catch (error) {
    console.error('[Models] Gemini error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============== 拓扑还原 API ==============
app.post('/api/topology-restore', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: '请上传文件' });
    }

    const networkType = req.body.networkType || 'ib';
    const configStr = req.body.config;
    const config = configStr ? JSON.parse(configStr) : {};
    const fileBuffer = req.file.buffer;
    const originalName = req.file.originalname;
    const input = parseTopologyUpload(fileBuffer, originalName);

    console.log(`[TopologyRestore] 开始解析 ${networkType} 网络拓扑，文件: ${req.file.originalname}`);
    console.log(`[TopologyRestore] 配置: ${JSON.stringify(config)}`);

    let result;
    if (networkType === 'ib') {
      const portMap = input.kind === 'csv'
        ? parseCSVPortMap(input.csvContent)
        : parseExcelPortMap(input.data);

      result = topology.buildTopologyStructure(portMap, {
        layerDetection: config.layerDetection || 'auto',
        manualLayers: config.manualLayers || null,
        podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\d+' },
        networkType: networkType  // 传递网络类型
      });
    } else if (networkType === 'roce') {
      if (input.kind === 'excel') {
        result = analyzeRoCETopology(input.data);
      } else {
        const portMap = parseCSVPortMap(input.csvContent);
        result = topology.buildTopologyStructure(portMap, {
          layerDetection: config.layerDetection || 'auto',
          manualLayers: config.manualLayers || null,
          podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\d+' },
          networkType: networkType
        });
      }
    } else {
      return res.status(400).json({ ok: false, error: '不支持的网络类型' });
    }

    if (!result || !result.success) {
      throw new Error('拓扑构建失败：' + (result?.error || '未知错误'));
    }

    console.log(`[TopologyRestore] 拓扑解析完成: ${result.metadata.stats.totalDevices} 设备, ${result.chainsCount} 链路`);
    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error('[TopologyRestore] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============== 拓扑还原 API V2 (流式加载) ==============
app.post('/api/topology-restore-v2', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: '请上传文件' });
    }

    const networkType = req.body.networkType || 'ib';
    const configStr = req.body.config;
    const config = configStr ? JSON.parse(configStr) : {};
    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;
    // 使用 let 以便根据规模自动调整
    let isLazy = req.query.mode === 'lazy' || req.body.mode === 'lazy';

    console.log(`[TopologyV2] 开始流式解析 ${networkType} 拓扑: ${fileName} (Request Lazy: ${isLazy})`);

    // 1. 解析原始数据
    const input = parseTopologyUpload(fileBuffer, fileName);
    let portMap;
    let result;
    let isFromKnowledgeBase = false;

    if (networkType === 'ib') {
      if (input.kind === 'csv') {
        try {
          portMap = parseCSVPortMap(input.csvContent);
        } catch (e) {
          // 尝试解析为 SN 清单
          console.log('[TopologyV2] 标准解析失败，尝试作为 SN 清单解析:', e.message);
          const snList = parseSNListCSV(input.csvContent);
          if (snList && snList.length > 0) {
            console.log(`[TopologyV2] 识别为 SN 清单 (${snList.length} 个条目)，尝试从知识库重建拓扑...`);
            portMap = await buildPortMapFromKnowledgeBase(snList, networkType);
            isFromKnowledgeBase = true;
            if (portMap.size === 0) {
              throw new Error('知识库中未找到相关连接信息');
            }
          } else {
            throw e; // 抛出原始错误
          }
        }
      } else {
        portMap = parseExcelPortMap(input.data);
      }
    } else if (networkType === 'roce') {
      if (input.kind === 'excel') {
        result = analyzeRoCETopology(input.data);
      } else {
        portMap = parseCSVPortMap(input.csvContent);
      }
    } else {
      return res.status(400).json({ ok: false, error: '不支持的网络类型' });
    }

    // 2. 构建拓扑结构
    if (!result) {
      result = topology.buildTopologyStructure(portMap, {
        layerDetection: config.layerDetection || 'auto',
        manualLayers: config.manualLayers || null,
        podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\d+' },
        networkType: networkType
      });
    }

    if (!result || !result.success) {
      throw new Error('拓扑构建失败：' + (result?.error || '未知错误'));
    }

    // 3. 决定渲染模式 和 Lazy 策略
    const totalNodes = result.nodeCount;
    let renderMode = 'reactflow';
    if (totalNodes > 2000) {
      renderMode = 'cytoscape';
    } else if (totalNodes > 1000) {
      // 这里的阈值可以根据实际性能测试调整
      renderMode = 'virtual-reactflow';
    }

    // 自动调整 Lazy 模式：如果节点少于 1500，强制关闭 Lazy，一次性发送所有数据
    if (isLazy && totalNodes < 1500) {
      console.log(`[TopologyV2] 节点数 (${totalNodes}) 较少，自动关闭 Lazy 模式，直接全量发送。`);
      isLazy = false;
    }

    console.log(`[TopologyV2] 节点数: ${totalNodes}, 模式: ${renderMode}, Final Lazy: ${isLazy}`);

    // 4. 开启流式响应 (NDJSON)
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // (a) 发送元数据
    res.write(JSON.stringify({
      type: 'meta',
      data: {
        nodeCount: result.nodeCount,
        edgeCount: result.edgeCount,
        renderMode,
        layers: result.metadata.layers,
        pods: result.metadata.pods,
        stats: result.metadata.stats,
        networkType: result.networkType || networkType,
        isLazy,
        layerY: result.layerY
      }
    }) + '\n');

    // (b) 发送所有层级节点 (动态层级)
    // 支持 Core/Spine/Leaf 以及 RoCE 的 CSW/SSW/ASW 等所有层级
    const allLayers = Object.keys(result.nodesByLayer);

    for (const layer of allLayers) {
      const nodes = result.nodesByLayer[layer];
      if (!nodes || nodes.length === 0) continue;

      // 如果是 Leaf 层 (或 RoCE 的 ASW/SSW) 在 Lazy 模式下是否需要跳过？
      // 当前逻辑：只有 'leaf' 且 Lazy 模式才跳过？
      // 为了安全，我们保留原逻辑：Lazy 模式下跳过 'leaf' 层的节点（改为按需加载）。
      // 对于 RoCE，通常节点数少，isLazy=false，所以全发。
      if (isLazy && layer === 'leaf') continue;

      // 分块发送
      const chunkSize = 500;
      for (let i = 0; i < nodes.length; i += chunkSize) {
        const chunk = nodes.slice(i, i + chunkSize);
        res.write(JSON.stringify({
          type: 'chunk',
          layer: layer,
          nodes: chunk
        }) + '\n');
        await new Promise(r => setImmediate(r));
      }
    }

    // (e) 发送连接 (分块发送)
    // 注意：Connections 数组可能很大
    if (result.connections && result.connections.length > 0) {
      let edges = result.connections;

      // Lazy 模式下，只发送非 Leaf 相关的边（即 Core-Spine）
      // 假设我们只过滤掉两端都是 Leaf 或者 连接到 Leaf 的边？
      // 通常 Core-Spine 是必要的。Spine-Leaf 在加载 Leaf 时加载。
      if (isLazy) {
        const leafIds = new Set((result.nodesByLayer.leaf || []).map(n => n.id));
        // 保留: 源和目标都 NOT IN leafIds
        edges = edges.filter(e => !leafIds.has(e.source) && !leafIds.has(e.target));
      }

      const chunkSize = 2000;
      for (let i = 0; i < edges.length; i += chunkSize) {
        const chunk = edges.slice(i, i + chunkSize);
        res.write(JSON.stringify({
          type: 'chunk',
          dataType: 'edges',
          items: chunk
        }) + '\n');
        await new Promise(r => setImmediate(r));
      }
    }

    // 结束响应
    res.end();

  } catch (error) {
    console.error('[TopologyV2] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: error.message });
    } else {
      // 如果流已经开始，发送一条错误消息
      res.write(JSON.stringify({ type: 'error', error: error.message }) + '\n');
      res.end();
    }
  }
});

// ============== 获取 POD 详情 API (Lazy Loading) ==============
app.post('/api/topology-pod-details', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'file required' });
    const podName = req.body.podName;
    if (!podName) return res.status(400).json({ ok: false, error: 'podName required' });

    const networkType = req.body.networkType || 'ib';
    const configStr = req.body.config;
    const config = configStr ? JSON.parse(configStr) : {};
    const fileBuffer = req.file.buffer;

    // 解析 (复用逻辑)
    const input = parseTopologyUpload(fileBuffer, req.file.originalname);

    let result;
    if (networkType === 'roce' && input.kind === 'excel') {
      result = analyzeRoCETopology(input.data);
    } else {
      const portMap = input.kind === 'csv'
        ? parseCSVPortMap(input.csvContent)
        : parseExcelPortMap(input.data);

      result = topology.buildTopologyStructure(portMap, {
        layerDetection: config.layerDetection || 'auto',
        manualLayers: config.manualLayers || null,
        podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\d+' },
        networkType: networkType
      });
    }

    if (!result || !result.success) throw new Error('Build failed');

    let podNodes = [];
    if (networkType === 'ib') {
      podNodes = (result.nodesByLayer.leaf || [])
        .filter(n => n.pod === podName)
        .map(n => ({ ...n, layer: n.layer || 'leaf' }));
    } else {
      Object.entries(result.nodesByLayer || {}).forEach(([layer, nodes]) => {
        if (Array.isArray(nodes)) {
          podNodes.push(...nodes.filter(n => n.pod === podName).map(n => ({ ...n, layer })));
        }
      });
    }
    const podNodeIds = new Set(podNodes.map(n => n.id));

    // 过滤边 (连接到该 POD 的边)
    const edges = result.connections.filter(e => podNodeIds.has(e.source) || podNodeIds.has(e.target));

    res.json({
      ok: true,
      pod: podName,
      nodes: podNodes,
      edges: edges
    });

  } catch (error) {
    console.error('[PodDetails] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============== 拓扑搜索 API (Deep Search) ==============
app.post('/api/topology-search', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'file required' });
    const query = req.body.query;
    if (!query) return res.json({ ok: true, matches: [] });

    // 复用解析逻辑 (同样需要优化复用代码)
    const networkType = req.body.networkType || 'ib';
    const configStr = req.body.config;
    const config = configStr ? JSON.parse(configStr) : {};
    const fileBuffer = req.file.buffer;

    const input = parseTopologyUpload(fileBuffer, req.file.originalname);

    let result;
    if (networkType === 'roce' && input.kind === 'excel') {
      result = analyzeRoCETopology(input.data);
    } else {
      const portMap = input.kind === 'csv'
        ? parseCSVPortMap(input.csvContent)
        : parseExcelPortMap(input.data);

      // 构建拓扑 (Server-side search requires full build to be accurate with layers/pods)
      result = topology.buildTopologyStructure(portMap, {
        layerDetection: config.layerDetection || 'auto',
        manualLayers: config.manualLayers || null,
        podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\d+' },
        networkType: networkType
      });
    }

    if (!result || !result.success) throw new Error('Build failed');

    // 搜索逻辑
    const matches = [];
    const searchLower = query.toLowerCase();

    // 遍历所有层级
    Object.entries(result.nodesByLayer).forEach(([layer, nodes]) => {
      if (!Array.isArray(nodes)) return;
      nodes.forEach(node => {
        if (node.id.toLowerCase().includes(searchLower) || (node.label && node.label.toLowerCase().includes(searchLower))) {
          matches.push({
            id: node.id,
            label: node.label,
            layer: layer,
            pod: node.pod
          });
        }
      });
    });

    // 限制返回数量
    const limitedMatches = matches.slice(0, 20);

    res.json({
      ok: true,
      matches: limitedMatches,
      total: matches.length
    });

  } catch (error) {
    console.error('[TopologySearch] Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============== 拓扑解析辅助函数 ==============

function getFileExtension(filename) {
  if (!filename) return '';
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function parseTopologyUpload(fileBuffer, filename) {
  const ext = getFileExtension(filename);
  if (ext === 'csv') {
    return { kind: 'csv', csvContent: fileBuffer.toString('utf-8') };
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return { kind: 'excel', data };
  }

  throw new Error('不支持的文件类型，请上传 CSV 或 Excel');
}

/**
 * 解析CSV格式的端口映射（UFM格式）
 */
function parseCSVPortMap(csvContent) {
  const lines = csvContent.split('\n').filter(line => line.trim());
  if (lines.length === 0) throw new Error('CSV文件为空');

  const headerLine = lines[0].replace(/^\ufeff/, '');
  const headers = headerLine.split(',').map(h => h.trim());

  const systemIdx = headers.findIndex(h => {
    const lower = h.toLowerCase();
    return lower === 'system' || lower === 'hostname';
  });
  const portIdx = headers.findIndex(h => {
    const lower = h.toLowerCase();
    return lower === 'port' || lower === 'ifname' || lower.includes('interface');
  });
  const peerNodeIdx = headers.findIndex(h => {
    const lower = h.toLowerCase();
    return lower.includes('peer') && (lower.includes('node') || lower.includes('device') || lower.includes('hostname') || lower.includes('name'));
  });
  const peerPortIdx = headers.findIndex(h => {
    const lower = h.toLowerCase();
    return lower.includes('peer') && (lower.includes('port') || lower.includes('interface'));
  });

  if (systemIdx === -1 || peerNodeIdx === -1) {
    throw new Error('CSV格式错误：需要 System 和 Peer Node 列');
  }

  const portMap = new Map();
  for (let i = 1; i < lines.length; i++) {
    // 简单的 CSV 解析 (不支持包含逗号的 Quoted 字段，但对于 UFM 导出通常足够)
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const sys = cols[systemIdx];
    const port = portIdx >= 0 ? cols[portIdx] : '';
    const peer = cols[peerNodeIdx];
    const peerPort = peerPortIdx >= 0 ? cols[peerPortIdx] : '';

    if (!sys || !peer || sys === 'nan' || peer === 'nan') continue;
    portMap.set(`${sys}|${port}`, { peer, peerPort });
  }

  console.log(`[TopologyRestore] CSV解析完成: ${portMap.size} 条端口映射. Sample: ${Array.from(portMap.keys())[0]}`);
  return portMap;
}

/**
 * 解析 SN 清单 CSV
 * 格式：cmdb数据库SN,主机名,带外地址...
 */
function parseSNListCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;

  const header = lines[0].toLowerCase();
  // 检查是否包含关键列
  if ((header.includes('sn') || header.includes('序列号')) &&
    (header.includes('主机名') || header.includes('hostname') || header.includes('ip'))) {

    // 提取可能的 SN
    const snList = [];
    const snIdx = lines[0].split(',').findIndex(c => c.toLowerCase().includes('sn') || c.includes('序列号'));
    if (snIdx === -1) return null;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols[snIdx] && cols[snIdx].trim()) {
        snList.push(cols[snIdx].trim());
      }
    }
    return snList;
  }
  return null;
}

/**
 * 从知识库扫描并构建 PortMap
 */
async function buildPortMapFromKnowledgeBase(snList, networkType) {
  const portMap = new Map();
  const relevantDevices = new Set();

  // 优化：如果提供了 SN 列表，我们可以尝试只保留相关的子图?
  // 目前策略：构建全局图，因为连接可能跨越多跳

  console.log('[KB-Topology] 开始扫描知识库构建拓扑...');

  await storage.scanChunks((chunk) => {
    const content = chunk.content;
    const lines = content.split('\n');
    let headerIdx = { system: -1, port: -1, peer: -1, peerPort: -1 };

    for (const line of lines) {
      // 1. 检测表头
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('system') || lowerLine.includes('hostname')) {
        const cols = line.split(',').map(c => c.trim());
        cols.forEach((col, idx) => {
          const lc = col.toLowerCase();
          if (lc === 'system' || lc === 'hostname') headerIdx.system = idx;
          else if (lc === 'port' || lc === 'ifname') headerIdx.port = idx;
          else if (lc.includes('peer') && lc.includes('node')) headerIdx.peer = idx;
          else if (lc.includes('peer') && lc.includes('port')) headerIdx.peerPort = idx;
        });
        continue;
      }

      // 2. 解析行
      const cols = line.split(',').map(c => c.trim());
      let sys, port, peer, peerPort;

      if (headerIdx.system >= 0 && headerIdx.peer >= 0 && cols.length > headerIdx.peer) {
        // 有表头匹配
        sys = cols[headerIdx.system];
        port = headerIdx.port >= 0 ? cols[headerIdx.port] : '';
        peer = cols[headerIdx.peer];
        peerPort = headerIdx.peerPort >= 0 ? cols[headerIdx.peerPort] : '';
      } else if (cols.length >= 4) {
        // 启发式：寻找网络设备名对 (GPU, IBLF, ASW...)
        // 简单逻辑：如果一行包含两个看似设备名的字串
        const devicePattern = /[a-z0-9]+-(gpu|ib|asw|sw)/i;
        for (let i = 0; i < cols.length - 1; i++) {
          if (devicePattern.test(cols[i])) {
            for (let j = i + 1; j < cols.length; j++) {
              if (devicePattern.test(cols[j])) {
                sys = cols[i];
                peer = cols[j];
                port = cols[i + 1] || ''; // 假设紧跟的是端口
                peerPort = cols[j + 1] || '';
                break;
              }
            }
          }
          if (sys) break;
        }
      }

      // 3. 验证并添加到 Map
      if (sys && peer && sys.length > 3 && peer.length > 3 && sys !== peer) {
        // 过滤掉非设备 (简单的长度和格式检查)
        // 规范化
        sys = sys.toUpperCase();
        peer = peer.toUpperCase();

        if (networkType === 'ib') {
          // IB 过滤: 必须包含 IB, GPU
          if (!sys.includes('IB') && !sys.includes('GPU') && !sys.includes('MDC')) continue;
        }

        const key = `${sys}|${port}`;

        // 避免重复和自环
        if (!portMap.has(key)) {
          portMap.set(key, { peer, peerPort });
        }
      }
    }
    return true; // 继续扫描
  });

  console.log(`[KB-Topology] 扫描完成，构建了 ${portMap.size} 条连接`);
  return portMap;
}

/**
 * 解析Excel格式的端口映射（NetQ格式）
 */
function parseExcelPortMap(data) {
  const portMap = new Map();

  if (!data || data.length === 0) {
    console.warn('[ParseExcel] 数据为空');
    return portMap;
  }

  // 获取第一行的字段名
  const firstRow = data[0];
  const fieldNames = Object.keys(firstRow);
  console.log(`[ParseExcel] Excel 字段名: ${fieldNames.join(', ')}`);

  // 灵活匹配字段名（支持多种格式）
  const findField = (row, ...patterns) => {
    for (const pattern of patterns) {
      const key = fieldNames.find(f => f.toLowerCase().includes(pattern.toLowerCase()));
      if (key && row[key]) {
        return row[key];
      }
    }
    return null;
  };

  for (const row of data) {
    // 优先精确匹配常见列名,后备模糊匹配
    const sys = findField(row, 'Hostname', 'hostname', 'device', 'system', 'node');
    const port = findField(row, 'Ifname', 'ifname', 'interface', 'port', 'eth');
    const peer = findField(row, 'Peer Node', 'peer node', 'peer hostname', 'peer device', 'peer name', 'remote hostname');
    const peerPort = findField(row, 'Peer Port', 'peer port', 'peer interface', 'peer eth', 'remote interface');

    if (!sys || !peer) {
      // 增强日志:显示原始数据帮助调试
      if (data.indexOf(row) < 3) {  // 只记录前3条
        console.log(`[ParseExcel] 跳过行 #${data.indexOf(row)}: sys=${sys || 'NULL'}, peer=${peer || 'NULL'}`);
      }
      continue;
    }

    portMap.set(`${sys}|${port || ''}`, { peer, peerPort: peerPort || '' });
  }

  console.log(`[ParseExcel] 解析完成: ${portMap.size} 条端口映射`);

  // 验证: 如果没提取到任何数据,输出警告
  if (portMap.size === 0) {
    console.error(`[ParseExcel] 警告: 未提取到任何连接! Excel字段名: ${fieldNames.join(', ')}`);
    console.error('[ParseExcel] 请检查Excel文件是否包含: Hostname/Peer Node 列');
  }

  return portMap;
}



// 解析IB网络拓扑 (UFM CSV格式) - 严格参考 generate_topology.py
function parseIBTopology(csvContent) {
  const lines = csvContent.split('\n').filter(line => line.trim());
  if (lines.length === 0) throw new Error('CSV文件为空');

  const headerLine = lines[0].replace(/^\ufeff/, '');
  const headers = headerLine.split(',').map(h => h.trim());

  const systemIdx = headers.findIndex(h => h.toLowerCase() === 'system');
  const portIdx = headers.findIndex(h => h.toLowerCase() === 'port');
  const peerNodeIdx = headers.findIndex(h => h.toLowerCase().includes('peer') && h.toLowerCase().includes('node'));
  const peerPortIdx = headers.findIndex(h => h.toLowerCase().includes('peer') && h.toLowerCase().includes('port'));

  if (systemIdx === -1 || peerNodeIdx === -1) {
    throw new Error('CSV格式错误：需要 System, Peer Node 列');
  }

  // 1. 构建完整的端口映射 port_map: (System, Port) -> (Peer Node, Peer Port)
  const portMap = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const sys = cols[systemIdx];
    const port = portIdx >= 0 ? cols[portIdx] : '';
    const peer = cols[peerNodeIdx];
    const peerPort = peerPortIdx >= 0 ? cols[peerPortIdx] : '';
    if (!sys || !peer || sys === 'nan' || peer === 'nan') continue;
    portMap.set(`${sys}|${port}`, { peer, peerPort });
  }

  // 2. 追溯三设备链路，收集节点（参考 Python: three_device_chains）
  const nodes = new Set();
  const uniqueEdges = new Set();
  const edges = [];

  for (const [key, value] of portMap) {
    const [sys, port] = key.split('|');
    const { peer, peerPort } = value;
    const keyB = `${peer}|${peerPort}`;

    if (portMap.has(keyB)) {
      const { peer: peer2 } = portMap.get(keyB);
      // 检查是否包含 IB 设备 (IBCR/IBSP/IBLF)
      if (['IBCR', 'IBSP', 'IBLF'].some(r => sys.includes(r) || peer.includes(r) || peer2.includes(r))) {
        nodes.add(sys);
        nodes.add(peer);
        nodes.add(peer2);
      }
    }
  }

  // 3. 补充所有 leaf-spine 直连边（带端口信息，去重）
  for (const [key, value] of portMap) {
    const [sys, port] = key.split('|');
    const { peer, peerPort } = value;
    if ((sys.includes('IBLF') && peer.includes('IBSP')) || (sys.includes('IBSP') && peer.includes('IBLF'))) {
      // 使用带端口的 edge_key 去重（参考 Python）
      const edgeKey = JSON.stringify([[sys, port], [peer, peerPort]].sort());
      if (!uniqueEdges.has(edgeKey)) {
        uniqueEdges.add(edgeKey);
        edges.push({ source: sys, target: peer, srcPort: port, dstPort: peerPort });
        nodes.add(sys);
        nodes.add(peer);
      }
    }
  }

  // 4. 补充 spine-core 边（带端口信息）
  for (const [key, value] of portMap) {
    const [sys, port] = key.split('|');
    const { peer, peerPort } = value;
    if ((sys.includes('IBSP') && peer.includes('IBCR')) || (sys.includes('IBCR') && peer.includes('IBSP'))) {
      nodes.add(sys);
      nodes.add(peer);
      const edgeKey = JSON.stringify([[sys, port], [peer, peerPort]].sort());
      if (!uniqueEdges.has(edgeKey)) {
        uniqueEdges.add(edgeKey);
        edges.push({ source: sys, target: peer, srcPort: port, dstPort: peerPort });
      }
    }
  }

  // 5. 统计三层设备
  const coreDevices = new Set();
  const spineDevices = new Set();
  const leafDevices = new Set();
  for (const dev of nodes) {
    const layer = getIBDeviceLayer(dev);
    if (layer === 'core') coreDevices.add(dev);
    else if (layer === 'spine') spineDevices.add(dev);
    else if (layer === 'leaf') leafDevices.add(dev);
  }

  const coreList = Array.from(coreDevices).sort();
  const spineList = Array.from(spineDevices).sort();
  const leafList = Array.from(leafDevices).sort();

  // 6. 统计所有 POD
  const podSet = new Set();
  for (const dev of [...spineList, ...leafList]) {
    const m = dev.match(/POD(\d+)/i);
    if (m) podSet.add(`POD${m[1]}`);
  }
  const pods = Array.from(podSet).sort();

  // 7. 布局参数（参考 Python）
  const layerGap = 200;
  const nodeGap = 180;
  const spineGap = 160;
  const leafGap = 150;
  const podSpacing = 800;

  // 8. 构建 nodesByLayer
  const nodesByLayer = {};

  // 计算所有 spine/leaf 的水平范围，让 Core 居中
  let childXs = [];
  if (pods.length > 0) {
    pods.forEach((pod, podIdx) => {
      const podOffsetX = (podIdx - (pods.length - 1) / 2) * podSpacing + 500;
      const podSpines = spineList.filter(s => s.includes(pod));
      const podLeafs = leafList.filter(l => l.includes(pod));
      podSpines.forEach((_, idx) => {
        childXs.push(podOffsetX + (idx - (podSpines.length - 1) / 2) * spineGap);
      });
      podLeafs.forEach((_, idx) => {
        childXs.push(podOffsetX + (idx - (podLeafs.length - 1) / 2) * leafGap);
      });
    });
  }
  const midX = childXs.length > 0 ? (Math.min(...childXs) + Math.max(...childXs)) / 2 : 500;

  // Core 层（居中于 spine/leaf 上方）
  if (coreList.length > 0) {
    nodesByLayer.core = coreList.map((dev, idx) => ({
      id: dev,
      label: dev,
      x: midX + (idx - (coreList.length - 1) / 2) * nodeGap,
      y: 0
    }));
  }

  // Spine 和 Leaf 按 POD 分组
  if (pods.length > 0) {
    nodesByLayer.spine = [];
    nodesByLayer.leaf = [];

    pods.forEach((pod, podIdx) => {
      const podOffsetX = (podIdx - (pods.length - 1) / 2) * podSpacing + 500;
      const podSpines = spineList.filter(s => s.includes(pod));
      const podLeafs = leafList.filter(l => l.includes(pod));

      podSpines.forEach((spine, idx) => {
        nodesByLayer.spine.push({
          id: spine,
          label: spine,
          pod,
          x: podOffsetX + (idx - (podSpines.length - 1) / 2) * spineGap,
          y: layerGap
        });
      });

      podLeafs.forEach((leaf, idx) => {
        nodesByLayer.leaf.push({
          id: leaf,
          label: leaf,
          pod,
          x: podOffsetX + (idx - (podLeafs.length - 1) / 2) * leafGap,
          y: layerGap * 2
        });
      });
    });
  } else {
    // 无 POD 信息时的布局
    if (spineList.length > 0) {
      nodesByLayer.spine = spineList.map((dev, idx) => ({
        id: dev, label: dev,
        x: 100 + idx * spineGap, y: layerGap
      }));
    }
    if (leafList.length > 0) {
      nodesByLayer.leaf = leafList.map((dev, idx) => ({
        id: dev, label: dev,
        x: 100 + idx * leafGap, y: layerGap * 2
      }));
    }
  }

  const layers = Object.keys(nodesByLayer).filter(k => nodesByLayer[k]?.length > 0);
  const layerY = { core: 0, spine: layerGap, leaf: layerGap * 2 };

  console.log(`[IB Topology] Core: ${coreList.length}, Spine: ${spineList.length}, Leaf: ${leafList.length}, Edges: ${edges.length}, PODs: ${pods.join(',')}`);

  return {
    networkType: 'ib',
    nodeCount: coreList.length + spineList.length + leafList.length,
    edgeCount: edges.length,
    nodesByLayer,
    connections: edges,
    layers,
    pods,
    layerY
  };
}

// RoCE网络设备类型识别 - 严格参考 network_connection_analyzer.py
function getRoCEDeviceType(deviceName) {
  if (!deviceName) return 'other';
  const upper = deviceName.toUpperCase();
  // 顺序很重要：SOOB 必须在 OOB 之前检查
  if (upper.includes('SOOB')) return 'soob';
  if (upper.includes('OOB')) return 'oob';
  if (upper.includes('LSW')) return 'lsw';

  // Core synonyms
  if (upper.match(/CSW|CORE|ROUTER|BORDER|GATEWAY|-CR-/)) return 'csw';

  // Spine synonyms
  if (upper.match(/SSW|SPINE|AGG|-SP-/)) return 'ssw';

  // Leaf synonyms
  if (upper.match(/ASW|LEAF|ACCESS|TOR|-LF-/)) return 'asw';

  return 'other';
}

// 解析RoCE网络拓扑 (NetQ Excel格式) - 严格参考 network_connection_analyzer.py
function parseRoCETopology(data) {
  if (!data || data.length === 0) throw new Error('Excel数据为空');

  const firstRow = data[0];
  const keys = Object.keys(firstRow);

  // 自动识别列名（参考 Python: parse_connections）
  let hostnameCol = keys.find(k => k.toLowerCase().includes('hostname')) || 'Hostname';
  let ifnameCol = keys.find(k => k.toLowerCase().includes('ifname')) || 'Ifname';
  let peerNodeCol = keys.find(k => k.toLowerCase().includes('peer') && k.toLowerCase().includes('node')) || 'Peer Node';
  let peerPortCol = keys.find(k => k.toLowerCase().includes('peer') && k.toLowerCase().includes('port')) || 'Peer Port';

  console.log(`[RoCE Topology] 识别列名: hostname=${hostnameCol}, ifname=${ifnameCol}, peerNode=${peerNodeCol}, peerPort=${peerPortCol}`);

  // 1. 构建连接图和端口映射（参考 Python: parse_connections）
  const connectionGraph = new Map();  // device -> Set of connected devices
  const deviceConnections = new Map(); // device -> list of connection IDs
  const connections = new Map();       // connId -> connection info
  const allDevices = new Set();

  for (const row of data) {
    const hostname = String(row[hostnameCol] || '').trim();
    const ifname = String(row[ifnameCol] || '').trim();
    const peerNode = String(row[peerNodeCol] || '').trim();
    const peerPort = String(row[peerPortCol] || '').trim();

    // 跳过空值或无效数据
    if (!hostname || !peerNode || hostname === 'nan' || peerNode === 'nan') continue;
    // 排除GPU设备
    if (hostname.toUpperCase().match(/GPU|COMPUTE|WORKER|NODE|HOST|SERVER|DGX|H100|A100|H800|A800|SRV|-N\d+|PSNODE/)) continue;
    if (peerNode.toUpperCase().match(/GPU|COMPUTE|WORKER|NODE|HOST|SERVER|DGX|H100|A100|H800|A800|SRV|-N\d+|PSNODE/)) continue;

    allDevices.add(hostname);
    allDevices.add(peerNode);

    // 连接图（双向）
    if (!connectionGraph.has(hostname)) connectionGraph.set(hostname, new Set());
    if (!connectionGraph.has(peerNode)) connectionGraph.set(peerNode, new Set());
    connectionGraph.get(hostname).add(peerNode);
    connectionGraph.get(peerNode).add(hostname);

    // 设备连接映射
    const connId = `${hostname}_${ifname}_to_${peerNode}_${peerPort}`;
    connections.set(connId, {
      localDevice: hostname,
      localInterface: ifname,
      peerDevice: peerNode,
      peerInterface: peerPort
    });

    if (!deviceConnections.has(hostname)) deviceConnections.set(hostname, []);
    if (!deviceConnections.has(peerNode)) deviceConnections.set(peerNode, []);
    deviceConnections.get(hostname).push(connId);
    deviceConnections.get(peerNode).push(connId);
  }

  console.log(`[RoCE Topology] 解析完成: ${allDevices.size} 设备, ${connections.size} 连接`);

  // 2. 发现网络拓扑路径 - 2层深度（参考 Python: discover_network_topology）
  const discoveredPaths = [];
  const visited = new Set();

  for (const startDevice of allDevices) {
    visited.add(startDevice);
    // 第一层：查找直接连接
    for (const connId of deviceConnections.get(startDevice) || []) {
      const conn = connections.get(connId);
      const peerDevice = conn.localDevice === startDevice ? conn.peerDevice : conn.localDevice;
      if (peerDevice === startDevice) continue;

      discoveredPaths.push([startDevice, peerDevice]);

      // 第二层：查找对端设备的直接连接
      for (const subConnId of deviceConnections.get(peerDevice) || []) {
        const subConn = connections.get(subConnId);
        const subPeer = subConn.localDevice === peerDevice ? subConn.peerDevice : subConn.localDevice;
        if (subPeer === peerDevice || subPeer === startDevice) continue;
        discoveredPaths.push([startDevice, peerDevice, subPeer]);
      }
    }
  }

  // 去重路径
  const uniquePaths = [];
  const seenPaths = new Set();
  for (const path of discoveredPaths) {
    const key = path.join('|');
    if (!seenPaths.has(key)) {
      seenPaths.add(key);
      uniquePaths.push(path);
    }
  }

  console.log(`[RoCE Topology] 发现 ${uniquePaths.length} 条路径`);

  // 3. 从路径中提取边和节点（参考 Python: export_html_topology）
  const edges = new Set();
  const nodes = new Set();
  for (const path of uniquePaths) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const edgeKey = [a, b].sort().join('|');
      edges.add(edgeKey);
      nodes.add(a);
      nodes.add(b);
    }
  }

  // 4. 按设备类型分组（参考 Python: 层级顺序 OTHER → OOB → SOOB → LSW → CSW → SSW → ASW）
  const devicesByType = { other: [], oob: [], soob: [], lsw: [], csw: [], ssw: [], asw: [] };
  for (const device of nodes) {
    const type = getRoCEDeviceType(device);
    devicesByType[type].push(device);
  }

  // 排序（参考 Python: sorted）
  Object.values(devicesByType).forEach(arr => arr.sort());

  // CSW 特殊排序（参考 Python: csw_sort_key）
  devicesByType.csw.sort((a, b) => {
    const getNum = (name) => {
      const m = name.toUpperCase().match(/CSW[-_]?0*(\d+)/);
      return m ? parseInt(m[1]) : 9999;
    };
    return getNum(a) - getNum(b);
  });

  // SSW/ASW 按 POD 和编号排序（参考 Python: extract_pod_and_num）
  const podNumSort = (a, b) => {
    const getPodNum = (name) => {
      const m = name.toUpperCase().match(/POD(\d+)[^\d]*(\d{1,4})$/);
      return m ? [parseInt(m[1]), parseInt(m[2])] : [9999, 9999];
    };
    const [podA, numA] = getPodNum(a);
    const [podB, numB] = getPodNum(b);
    return podA !== podB ? podA - podB : numA - numB;
  };
  devicesByType.ssw.sort(podNumSort);
  devicesByType.asw.sort(podNumSort);

  // 5. 布局参数（参考 Python: layer_y = [100, 200, 300, 400, 500, 700, 900]）
  const layerOrder = ['other', 'oob', 'soob', 'lsw', 'csw', 'ssw', 'asw'];
  const layerYValues = [100, 200, 300, 400, 500, 700, 900];
  const layerY = {};

  let layerIndex = 0;
  layerOrder.forEach((layer) => {
    if (devicesByType[layer]?.length > 0) {
      layerY[layer] = layerYValues[layerIndex];
      layerIndex++;
    }
  });

  // 6. 构建 nodesByLayer（参考 Python: node_positions 布局逻辑）
  const nodesByLayer = {};
  for (const [layer, devices] of Object.entries(devicesByType)) {
    if (devices.length === 0) continue;

    const y = layerY[layer] || 0;
    let startX, endX;

    // 参考 Python: OOB层 150-1850, OTHER层 100-1900, 其他层 600-1400
    if (layer === 'oob') {
      startX = 150; endX = 1850;
    } else if (layer === 'other') {
      startX = 100; endX = 1900;
    } else {
      // SOOB, LSW, CSW, SSW, ASW 集中在中间
      startX = 600; endX = 1400;
    }

    const gap = devices.length > 1 ? (endX - startX) / (devices.length - 1) : 0;
    nodesByLayer[layer] = devices.map((dev, idx) => ({
      id: dev,
      label: dev,
      x: devices.length > 1 ? startX + idx * gap : (startX + endX) / 2,
      y
    }));
  }

  // 7. 构建连接列表（带端口信息，去重）
  const connectionList = [];
  const edgeSet = new Set();
  for (const [connId, conn] of connections) {
    const edgeKey = [conn.localDevice, conn.peerDevice].sort().join('|');
    if (edgeSet.has(edgeKey)) continue;
    // 只保留在 nodes 中的设备
    if (!nodes.has(conn.localDevice) || !nodes.has(conn.peerDevice)) continue;
    edgeSet.add(edgeKey);
    connectionList.push({
      source: conn.localDevice,
      target: conn.peerDevice,
      srcPort: conn.localInterface,
      dstPort: conn.peerInterface
    });
  }

  const layers = Object.keys(nodesByLayer).filter(k => nodesByLayer[k]?.length > 0);

  console.log(`[RoCE Topology] 结果: ${nodes.size} 节点, ${connectionList.length} 边, 层级: ${layers.join(', ')}`);

  return {
    networkType: 'roce',
    nodeCount: nodes.size,
    edgeCount: connectionList.length,
    nodesByLayer,
    connections: connectionList,
    layers,
    pods: [],
    layerY
  };
}

// 增加 V8 内存限制提示
const v8 = await import('v8');
const totalHeapSize = v8.getHeapStatistics().total_available_size / 1024 / 1024;
console.log(`[Server] Max Heap Size: ${Math.round(totalHeapSize)} MB`);

const port = process.env.PORT || 8787;
const server = app.listen(port, () => {
  console.log(`Extractor server listening at http://localhost:${port}`);
  console.log('[Server] 服务器已启动，等待请求...');

  // 启动时尝试恢复中断的任务
  setTimeout(() => {
    console.log('[Server] 开始恢复中断的任务...');
    taskQueue.restoreInterruptedTasks().then(() => {
      console.log('[Server] 任务恢复完成');
    }).catch(err => {
      console.error('[Server] 任务恢复失败:', err);
    });
  }, 5000); // 延迟 5 秒执行，确保服务器已完全启动
});

// 确保服务器保持运行
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// 添加一个心跳定时器，确保事件循环保持活跃
const heartbeat = setInterval(() => {
  // 这个定时器会保持事件循环活跃
  // 不需要做任何事情，只是为了防止进程退出
}, 30000);

// 监听服务器关闭事件
server.on('close', () => {
  console.log('[Server] 服务器正在关闭...');
  clearInterval(heartbeat);
});

// 增加全局异常捕获，防止进程崩溃退出
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  console.error('[FATAL] Stack:', err.stack);
  // 不退出进程，保持服务运行
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  // 不退出进程
});

process.on('exit', (code) => {
  console.log(`[Server] 进程即将退出，退出码: ${code}`);
});

process.on('SIGINT', () => {
  console.log('[Server] 收到 SIGINT 信号，正在关闭服务器...');
  server.close(() => {
    console.log('[Server] 服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('[Server] 收到 SIGTERM 信号，正在关闭服务器...');
  server.close(() => {
    console.log('[Server] 服务器已关闭');
    process.exit(0);
  });
});
