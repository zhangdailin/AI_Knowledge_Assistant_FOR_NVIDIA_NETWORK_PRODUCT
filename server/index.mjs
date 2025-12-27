import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createRequire } from 'node:module';
import * as storage from './storage.mjs';
import * as taskQueue from './taskQueue.mjs';
import { embedText } from './embedding.mjs';
import { validateFileType, getFileCategory } from './fileValidation.mjs';
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

// 直接保留模块引用，调用时选择合适的导出
const pdfParse = pdfParseModule;
import mammoth from 'mammoth';
import { setTimeout as sleep } from 'node:timers/promises';

import * as chunking from './chunking.mjs';

const app = express();
// 配置 CORS 允许前端跨域请求
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
}));
// 增加 payload 限制，防止大请求导致 OOM
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

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
    // 根据文件大小调整参数
    // 大文件使用更大的块大小，减少块数量
    let parentSize = 2000;
    let childSize = 600;
    
    if (text.length > 500 * 1024) {
      // 大文件：使用更大的块
      parentSize = 3000;
      childSize = 800;
      console.log(`[Async] 大文件检测，使用优化参数: parentSize=${parentSize}, childSize=${childSize}`);
    }
    
    const chunkStartTime = Date.now();
    const chunks = chunking.enhancedParentChildChunking(text, 4000, parentSize, childSize);
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
    const docData = {
      userId,
      filename: fixedFilename,
      fileType: file.mimetype,
      fileSize: file.size,
      category: category || 'default',
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

app.post('/api/ocr', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no_file' });
    const endpoint = process.env.AZURE_VISION_ENDPOINT;
    const key = process.env.AZURE_VISION_KEY;
    if (!endpoint || !key) return res.status(400).json({ error: 'ocr_not_configured' });
    const url = `${endpoint.replace(/\/$/, '')}/vision/v3.2/read/analyze`;
    const init = {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/octet-stream'
      },
      body: file.buffer
    };
    const resp = await fetch(url, init);
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).json({ ok: false, error: 'ocr_submit_failed', detail: text });
    }
    const opLoc = resp.headers.get('operation-location');
    if (!opLoc) return res.status(500).json({ ok: false, error: 'missing_operation_location' });
    let result;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const r = await fetch(opLoc, {
        headers: { 'Ocp-Apim-Subscription-Key': key }
      });
      if (!r.ok) continue;
      result = await r.json();
      if (result.status === 'succeeded' || result.status === 'failed') break;
    }
    if (!result || result.status !== 'succeeded') {
      return res.status(500).json({ ok: false, error: 'ocr_timeout_or_failed', status: result?.status });
    }
    const pages = result.analyzeResult?.readResults || [];
    const lines = [];
    for (const pg of pages) {
      for (const ln of pg.lines || []) {
        if (ln.text) lines.push(ln.text);
      }
    }
    const text = lines.join('\n');
    return res.json({ ok: true, text, meta: { pages: pages.length } });
  } catch (e) {
    console.error('ocr error', e);
    return res.status(500).json({ ok: false, error: 'ocr_exception' });
  }
});

// ========== 知识库 API ==========

// 获取所有文档
app.get('/api/documents', async (req, res) => {
  try {
    const documents = await storage.getAllDocuments();
    res.json({ ok: true, documents });
  } catch (error) {
    console.error('获取文档列表失败:', error);
    res.status(500).json({ ok: false, error: '获取文档列表失败' });
  }
});

// 获取单个文档
app.get('/api/documents/:id', async (req, res) => {
  try {
    const document = await storage.getDocument(req.params.id);
    if (!document) {
      return res.status(404).json({ ok: false, error: '文档不存在' });
    }
    res.json({ ok: true, document });
  } catch (error) {
    console.error('获取文档失败:', error);
    res.status(500).json({ ok: false, error: '获取文档失败' });
  }
});

// 创建文档
app.post('/api/documents', async (req, res) => {
  try {
    const document = await storage.createDocument(req.body);
    res.json({ ok: true, document });
  } catch (error) {
    console.error('创建文档失败:', error);
    res.status(500).json({ ok: false, error: '创建文档失败' });
  }
});

// 更新文档
app.put('/api/documents/:id', async (req, res) => {
  try {
    const document = await storage.updateDocument(req.params.id, req.body);
    if (!document) {
      return res.status(404).json({ ok: false, error: '文档不存在' });
    }
    res.json({ ok: true, document });
  } catch (error) {
    console.error('更新文档失败:', error);
    res.status(500).json({ ok: false, error: '更新文档失败' });
  }
});

// 删除文档
app.delete('/api/documents/:id', async (req, res) => {
  try {
    console.log(`[API] 删除文档请求: ${req.params.id}`);
    const deleted = await storage.deleteDocument(req.params.id);
    console.log(`[API] 删除文档成功: ${req.params.id}, deleted=${deleted}`);
    res.json({ ok: true, deleted });
  } catch (error) {
    console.error('[API] 删除文档失败:', error);
    console.error('[API] 错误堆栈:', error.stack);
    // 如果是 JSON 解析错误，尝试返回更友好的错误信息
    if (error instanceof SyntaxError || error.message.includes('JSON')) {
      res.status(500).json({ 
        ok: false, 
        error: '删除文档失败：数据文件可能已损坏，系统已尝试自动修复。请刷新页面后重试。',
        detail: error.message 
      });
    } else {
      res.status(500).json({ ok: false, error: '删除文档失败', detail: error.message });
    }
  }
});

// 获取文档的 chunks
app.get('/api/documents/:id/chunks', async (req, res) => {
  try {
    const chunks = await storage.getChunks(req.params.id);
    res.json({ ok: true, chunks });
  } catch (error) {
    console.error('获取 chunks 失败:', error);
    res.status(500).json({ ok: false, error: '获取 chunks 失败' });
  }
});

// 获取单个 chunk
app.get('/api/documents/:docId/chunks/:chunkId', async (req, res) => {
  try {
    const chunk = await storage.getChunk(req.params.docId, req.params.chunkId);
    if (!chunk) {
      return res.status(404).json({ ok: false, error: 'chunk 不存在' });
    }
    res.json({ ok: true, chunk });
  } catch (error) {
    console.error('获取 chunk 失败:', error);
    res.status(500).json({ ok: false, error: '获取 chunk 失败' });
  }
});

// 获取文档的 chunks 统计信息 (轻量级)
app.get('/api/documents/:id/chunk-stats', async (req, res) => {
  try {
    const stats = await storage.getChunkStats(req.params.id);
    res.json({ ok: true, stats });
  } catch (error) {
    console.error('获取 chunks 统计失败:', error);
    res.status(500).json({ ok: false, error: '获取 chunks 统计失败' });
  }
});

// 创建 chunks
app.post('/api/documents/:id/chunks', async (req, res) => {
  try {
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
  } catch (error) {
    console.error('创建 chunks 失败:', error);
    res.status(500).json({ ok: false, error: '创建 chunks 失败' });
  }
});

// 更新 chunk 的 embedding
app.put('/api/chunks/:id/embedding', async (req, res) => {
  try {
    const { embedding } = req.body;
    if (!Array.isArray(embedding)) {
      return res.status(400).json({ ok: false, error: 'embedding 必须是数组' });
    }
    
    const updated = await storage.updateChunkEmbedding(req.params.id, embedding);
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'chunk 不存在' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('更新 embedding 失败:', error);
    res.status(500).json({ ok: false, error: '更新 embedding 失败' });
  }
});

// 搜索 chunks (混合检索：关键词 + 向量)
app.get('/api/chunks/search', async (req, res) => {
  try {
    const { q, limit = 30 } = req.query;
    if (!q) {
      return res.status(400).json({ ok: false, error: '缺少查询参数 q' });
    }

    const maxResults = parseInt(limit);
    const startTime = Date.now();

    // 1. 并行执行：关键词搜索 + 向量生成
    const keywordSearchPromise = storage.searchChunks(q, maxResults);
    const vectorSearchPromise = (async () => {
      try {
        // 尝试生成 query embedding
        const embedding = await embedText(q);
        if (embedding) {
           // 如果成功，执行向量搜索
           return await storage.vectorSearchChunks(embedding, maxResults);
        }
      } catch (e) {
        // 向量搜索失败不影响关键词搜索
      }
      return [];
    })();

    const [keywordResults, vectorResults] = await Promise.all([
      keywordSearchPromise,
      vectorSearchPromise
    ]);

    console.log(`[Search] Query: "${q}" | Keyword=${keywordResults.length}, Vector=${vectorResults.length} | ${Date.now() - startTime}ms`);

    // 检测查询意图
    const queryLower = q.toLowerCase();
    const isCommandQuery = /nv\s+(set|show|config|unset)/.test(queryLower) ||
                          ['配置', '命令', 'config', 'show', 'how to', '如何'].some(k => queryLower.includes(k));
    const isTechQuery = ['mlag', 'bgp', 'evpn', 'vxlan', 'ospf', 'lacp', 'bond', 'cumulus'].some(k => queryLower.includes(k));

    // 2. 结果融合 (RRF - Reciprocal Rank Fusion with Intent-Aware Weighting)
    const combinedResults = new Map();
    const k = 60; // RRF constant

    // 根据查询意图调整关键词和向量的权重
    const keywordWeight = (isCommandQuery || isTechQuery) ? 1.5 : 1.0;  // 命令/技术查询增加关键词权重
    const vectorWeight = (isCommandQuery || isTechQuery) ? 0.8 : 1.0;   // 命令/技术查询降低向量权重

    // 处理关键词结果
    keywordResults.forEach((chunk, index) => {
      const id = chunk.id;
      if (!combinedResults.has(id)) {
        combinedResults.set(id, { chunk, score: 0, sources: [] });
      }
      const item = combinedResults.get(id);
      // RRF: 1 / (k + rank) * weight
      item.score += (1 / (k + index + 1)) * keywordWeight;

      // Keyword Match Bonus: 如果关键词匹配得分极高，给予额外 RRF 权重
      // 这解决了 RRF 对"绝对匹配"不敏感的问题
      if (chunk.score > 10) {
          item.score += 0.05; // 相当于提升排名的效果
      }

      // 额外加分：命令查询且内容包含 nv set/show
      if (isCommandQuery && chunk.content) {
          const contentLower = chunk.content.toLowerCase();
          if (contentLower.includes('nv set') || contentLower.includes('nv show') || contentLower.includes('```')) {
              item.score += 0.08;
          }
          // MLAG 特定加分
          if (queryLower.includes('mlag') && (contentLower.includes('mlag') || contentLower.includes('bond mlag'))) {
              item.score += 0.1;
          }
      }

      item.sources.push('keyword');
      item.keywordScore = chunk.score;
    });

    // 处理向量结果
    vectorResults.forEach((item, index) => {
      const chunk = item.chunk;
      const id = chunk.id;
      if (!combinedResults.has(id)) {
        combinedResults.set(id, { chunk, score: 0, sources: [] });
      }
      const entry = combinedResults.get(id);
      // 应用向量权重
      entry.score += (1 / (k + index + 1)) * vectorWeight;

      // Vector Similarity Bonus: 如果相似度极高 (>0.85)，给予额外权重
      if (item.score > 0.85) {
          entry.score += 0.05;
      }

      entry.sources.push('vector');
      entry.vectorScore = item.score;
    });

    // 3. 排序和格式化
    const finalResults = Array.from(combinedResults.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(entry => {
        // 动态截断内容：如果是向量匹配且内容极长，只返回相关部分
        // (这里暂不实现复杂的窗口滑动，只做简单的长度保护)
        let displayContent = entry.chunk.content;
        
        return {
          ...entry.chunk,
          content: displayContent,
          _score: entry.score,
          _sources: entry.sources,
          _debug: {
             keywordScore: entry.keywordScore,
             vectorScore: entry.vectorScore
          }
        };
      });

    res.json({ ok: true, chunks: finalResults });
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
    // #region agent log
    console.log(`[API] [DEBUG] 创建 embedding 任务，文档 ID: ${documentId}`);
    // #endregion
    console.log(`[API] 创建 embedding 任务，文档 ID: ${documentId}`);
    
    const task = taskQueue.createTask('generate_embeddings', documentId);
    // #region agent log
    console.log(`[API] [DEBUG] 任务已创建: ${task.id}, status=${task.status}, type=${task.type}`);
    // #endregion
    console.log(`[API] 任务已创建: ${task.id}, status=${task.status}`);
    
    // 异步处理任务（不阻塞响应）
    // #region agent log
    console.log(`[API] [DEBUG] 准备异步处理任务 ${task.id}`);
    // #endregion
    taskQueue.processEmbeddingTask(task.id, documentId).catch(error => {
      // #region agent log
      console.error(`[API] [DEBUG] 处理 embedding 任务 ${task.id} 失败:`, error);
      console.error(`[API] [DEBUG] 错误堆栈:`, error.stack);
      // #endregion
      console.error(`[API] 处理 embedding 任务 ${task.id} 失败:`, error);
      console.error(`[API] 错误堆栈:`, error.stack);
    });
    
    // 添加日志以确认任务已启动
    // #region agent log
    console.log(`[API] [DEBUG] 任务 ${task.id} 已提交异步处理`);
    // #endregion
    console.log(`[API] 任务 ${task.id} 已提交异步处理`);
    
    res.json({ ok: true, taskId: task.id, task });
  } catch (error) {
    // #region agent log
    console.error('[API] [DEBUG] 创建任务失败:', error);
    // #endregion
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

    // 获取所有 chunks
    const allChunks = await storage.getAllChunks();
    const allContent = allChunks.map(c => c.content).join('\n');

    const results = [];
    const notFound = [];

    for (const sn of snList) {
      const snTrimmed = sn.trim().toUpperCase();
      if (!snTrimmed) continue;

      // 1. 查找 SN 对应的主机名
      // 格式: GOG4X8312A0040,GOG4X8312A0040,GOG4X8312A0040,GOG4X8312A0040,MDC-DH1E-M09-POD1-GPU-214
      const snPattern = new RegExp(`${snTrimmed}[^\\n]*?(MDC-[A-Z0-9-]+-GPU-\\d+)`, 'i');
      const snMatch = allContent.match(snPattern);

      if (!snMatch) {
        notFound.push(snTrimmed);
        continue;
      }

      const hostname = snMatch[1];

      // 2. 查找主机名连接的 IBLF
      // 格式: MDC-DH1E-A07-POD1-GPU-001 连接到多个 IBLF
      const iblfPattern = new RegExp(`${hostname}[^\\n]*?(MDC-[A-Z0-9-]+-IBLF-\\d+)`, 'gi');
      const iblfMatches = [...allContent.matchAll(iblfPattern)];

      // 去重
      const iblfs = [...new Set(iblfMatches.map(m => m[1]))];

      if (iblfs.length === 0) {
        // 尝试通过主机名的位置信息推断 IBLF
        // 从主机名提取位置信息 (如 MDC-DH1E-M09-POD1-GPU-214 -> DH1E, POD1)
        const locMatch = hostname.match(/MDC-(DH\d[EW])-[A-Z](\d+)-POD(\d)/i);
        if (locMatch) {
          const [, building, rack, pod] = locMatch;
          // 搜索同一 POD 的 IBLF
          const podIblfPattern = new RegExp(`MDC-${building}-[GH]\\d+-\\d+U-POD${pod}-RAIL\\d-IBLF-\\d+`, 'gi');
          const podIblfs = [...allContent.matchAll(podIblfPattern)];
          const uniquePodIblfs = [...new Set(podIblfs.map(m => m[0]))];

          // 根据 rack 位置筛选合适的 IBLF 组
          const rackNum = parseInt(rack);
          // IBLF 编号规则: 每8台服务器共享一组 IBLF
          const iblfGroup = Math.ceil(rackNum / 8);
          const filteredIblfs = uniquePodIblfs.filter(iblf => {
            const iblfNum = iblf.match(/IBLF-(\d+)/)?.[1];
            return iblfNum && parseInt(iblfNum) === iblfGroup;
          });

          if (filteredIblfs.length > 0) {
            iblfs.push(...filteredIblfs);
          }
        }
      }

      results.push({
        sn: snTrimmed,
        hostname,
        iblfs: [...new Set(iblfs)].sort()
      });
    }

    // 3. 按 IBLF 组合分组
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
        hostname: result.hostname
      });
    }

    // 转换为数组并排序
    const groupedResults = Array.from(groups.values())
      .sort((a, b) => b.servers.length - a.servers.length);

    res.json({
      ok: true,
      summary: {
        total: snList.length,
        found: results.length,
        notFound: notFound.length,
        groups: groupedResults.length
      },
      groups: groupedResults,
      notFound,
      details: results
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

    // 获取所有 chunks
    const allChunks = await storage.getAllChunks();
    const allContent = allChunks.map(c => c.content).join('\n');

    const results = [];
    const notFound = [];

    for (const sn of snList) {
      const snTrimmed = sn.trim().toUpperCase();
      if (!snTrimmed) continue;

      // 1. 查找 SN 对应的主机名
      // 格式: GOG4X8312A0040,GOG4X8312A0040,GOG4X8312A0040,GOG4X8312A0040,MDC-DH1E-M09-POD1-GPU-214
      const snPattern = new RegExp(`${snTrimmed}[^\\n]*?(MDC-[A-Z0-9-]+-GPU-\\d+)`, 'i');
      const snMatch = allContent.match(snPattern);

      if (!snMatch) {
        notFound.push(snTrimmed);
        continue;
      }

      const hostname = snMatch[1];

      // 2. 查找主机名对应的带内地址 (inband)
      // 常见格式: hostname,IP 或 hostname IP 或 hostname: IP
      // 带内地址通常是 10.x.x.x 或 192.168.x.x
      let inband = '';
      const inbandPatterns = [
        new RegExp(`${hostname}[,\\s:]+?(10\\.\\d+\\.\\d+\\.\\d+)`, 'i'),
        new RegExp(`${hostname}[,\\s:]+?(192\\.168\\.\\d+\\.\\d+)`, 'i'),
        new RegExp(`${hostname}[^\\n]*?inband[^\\n]*?(\\d+\\.\\d+\\.\\d+\\.\\d+)`, 'i'),
        new RegExp(`inband[^\\n]*?${hostname}[^\\n]*?(\\d+\\.\\d+\\.\\d+\\.\\d+)`, 'i')
      ];

      for (const pattern of inbandPatterns) {
        const match = allContent.match(pattern);
        if (match) {
          inband = match[1];
          break;
        }
      }

      // 3. 查找主机名对应的带外地址 (outband/BMC/IPMI)
      // 带外地址通常是 BMC 或 IPMI 地址
      let outband = '';
      const outbandPatterns = [
        new RegExp(`${hostname}[^\\n]*?(?:bmc|ipmi|outband|oob)[^\\n]*?(\\d+\\.\\d+\\.\\d+\\.\\d+)`, 'i'),
        new RegExp(`(?:bmc|ipmi|outband|oob)[^\\n]*?${hostname}[^\\n]*?(\\d+\\.\\d+\\.\\d+\\.\\d+)`, 'i'),
        // 尝试从主机名推断 BMC 地址 (hostname-bmc 格式)
        new RegExp(`${hostname}-(?:bmc|ipmi)[,\\s:]+?(\\d+\\.\\d+\\.\\d+\\.\\d+)`, 'i')
      ];

      for (const pattern of outbandPatterns) {
        const match = allContent.match(pattern);
        if (match) {
          outband = match[1];
          break;
        }
      }

      results.push({
        sn: snTrimmed,
        hostname,
        inband,
        outband
      });
    }

    res.json({
      ok: true,
      summary: {
        total: snList.length,
        found: results.length,
        notFound: notFound.length
      },
      results,
      notFound
    });
  } catch (error) {
    console.error('[SN-Address] Error:', error);
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

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model, max_tokens, temperature, useGemini } = req.body;

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
        return res.json({ ok: true, ...data, source: 'gemini' });
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
        model: model || 'Qwen/Qwen3-32B',
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
    res.json({ ok: true, ...data, source: 'siliconflow' });
  } catch (error) {
    console.error('[Chat] Error:', error);
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