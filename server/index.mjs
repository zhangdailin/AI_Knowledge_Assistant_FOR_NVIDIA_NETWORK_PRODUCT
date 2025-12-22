import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createRequire } from 'node:module';
import * as storage from './storage.mjs';
import * as taskQueue from './taskQueue.mjs';
import { embedText } from './embedding.mjs';

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
// 增加 payload 限制，防止大请求导致 OOM
app.use(cors());
app.use(express.json({ limit: '100mb' })); 
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// 异步处理文件上传
async function processUploadedFile(documentId, file) {
  try {
    console.log(`[Async] 开始处理文档: ${documentId}, 文件: ${file.originalname}`);
    
    // 1. 解析文本
    let text = '';
    const mime = file.mimetype || '';
    const name = file.originalname.toLowerCase();
    
    if (mime.includes('pdf') || name.endsWith('.pdf')) {
       const PdfParseClass = pdfParseModule?.PDFParse || pdfParseModule?.default?.PDFParse || pdfParseModule;
       const parser = new PdfParseClass({ data: file.buffer });
       const result = await parser.getText({});
       text = result?.text || '';
    } else if (mime.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) {
       const result = await mammoth.extractRawText({ buffer: file.buffer });
       text = result.value;
    } else {
       // 默认作为文本处理
       text = file.buffer.toString('utf-8');
    }
    
    text = (text || '').trim();
    if (!text) throw new Error('提取文本为空');
    
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
    
    // 1. 创建文档记录 (status: processing)
    const docData = {
      userId,
      filename: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size,
      category: category || 'default',
      contentPreview: '处理中...', // 初始预览
      uploadedAt: new Date().toISOString(),
      status: 'processing'
    };
    
    const document = await storage.createDocument(docData);
    
    // 2. 立即响应前端
    res.json({ ok: true, document });
    
    // 3. 异步处理
    // 注意：这里没有 await，故意让它在后台运行
    processUploadedFile(document.id, file);
    
  } catch (error) {
    console.error('上传处理失败:', error);
    res.status(500).json({ ok: false, error: '上传失败' });
  }
});

app.post('/api/extract', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no_file' });
    const name = file.originalname.toLowerCase();
    const mime = file.mimetype || '';
    let text = '';
    if (mime.includes('pdf') || name.endsWith('.pdf')) {
      let data;
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
        data = { text: result?.text || '', numpages: result?.total || result?.pages?.length || 0, info: result?.info || {} };

        if (typeof parser.destroy === 'function') {
          await parser.destroy();
        }
      } catch (callError) {
        console.error('extract error', callError);
        return res.status(500).json({ ok: false, error: 'extract_failed', detail: String(callError) });
      }
      text = (data.text || '').trim();
      if (text.length === 0) {
        return res.status(500).json({ ok: false, error: 'extract_empty', detail: 'PDF解析成功但未提取到文本内容，可能是扫描件或受保护文档' });
      }
      return res.json({ ok: true, text, meta: { pages: data.numpages, info: data.info } });
    }
    if (mime.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = (result.value || '').trim();
      return res.json({ ok: true, text, meta: {} });
    }
    // fallback to utf-8 text
    text = Buffer.from(file.buffer).toString('utf-8');
    return res.json({ ok: true, text, meta: {} });
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
    console.log(`[Search] Query: "${q}"`);

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
        console.warn('[Search] Vector search skipped due to embedding error:', e.message);
      }
      return [];
    })();

    const [keywordResults, vectorResults] = await Promise.all([
      keywordSearchPromise,
      vectorSearchPromise
    ]);

    console.log(`[Search] Results: Keyword=${keywordResults.length}, Vector=${vectorResults.length}`);

    // 2. 结果融合 (RRF - Reciprocal Rank Fusion)
    const combinedResults = new Map();
    const k = 60; // RRF constant

    // 处理关键词结果
    keywordResults.forEach((chunk, index) => {
      const id = chunk.id;
      if (!combinedResults.has(id)) {
        combinedResults.set(id, { chunk, score: 0, sources: [] });
      }
      const item = combinedResults.get(id);
      // RRF: 1 / (k + rank)
      item.score += 1 / (k + index + 1);
      
      // Keyword Match Bonus: 如果关键词匹配得分极高，给予额外 RRF 权重
      // 这解决了 RRF 对"绝对匹配"不敏感的问题
      if (chunk.score > 10) {
          item.score += 0.05; // 相当于提升排名的效果
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
      entry.score += 1 / (k + index + 1);
      
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

// 增加 V8 内存限制提示
const v8 = await import('v8');
const totalHeapSize = v8.getHeapStatistics().total_available_size / 1024 / 1024;
console.log(`[Server] Max Heap Size: ${Math.round(totalHeapSize)} MB`);

const port = process.env.PORT || 8787;
const server = app.listen(port, () => {
  console.log(`Extractor server listening at http://localhost:${port}`);
});

// 增加全局异常捕获，防止进程崩溃退出
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  // 不退出进程，保持服务运行
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  // 不退出进程
});