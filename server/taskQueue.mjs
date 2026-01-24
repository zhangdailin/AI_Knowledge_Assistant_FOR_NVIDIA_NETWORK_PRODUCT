/**
 * 后台任务队列管理器
 * 处理文档的 embedding 生成等耗时任务
 */

import * as storage from './storage-adapter.mjs';
import { embedTexts } from './embedding.mjs';
import * as knowledgeGraph from './knowledgeGraph.mjs';
import * as chunking from './chunking.mjs';
import { LIMITS } from './constants.mjs';

// 任务状态
const TASK_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// 任务存储（内存中，生产环境应使用 Redis 或数据库）
const tasks = new Map();
const maintenanceState = {
  running: false,
  timer: null,
  lastRunAt: null,
  lastSummary: null
};

const DEFAULT_MAINTENANCE_CONFIG = {
  enabled: true,
  intervalMs: 10 * 60 * 1000,
  initialDelayMs: 15 * 1000,
  maxDocsPerRun: 200,
  maxChunkFixesPerRun: 10,
  maxEmbeddingTasksPerRun: 5,
  maxKnowledgeGraphTasksPerRun: 5
};

// 生成任务 ID
function generateTaskId() {
  return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// 创建任务
export function createTask(type, documentId, metadata = {}) {
  const taskId = generateTaskId();
  const task = {
    id: taskId,
    type,
    documentId,
    status: TASK_STATUS.PENDING,
    progress: 0,
    total: 0,
    current: 0,
    metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null
  };
  tasks.set(taskId, task);
  return task;
}

export function updateTask(taskId, updates = {}) {
  const task = tasks.get(taskId);
  if (!task) return null;
  Object.assign(task, updates);
  task.updatedAt = new Date().toISOString();
  tasks.set(taskId, task);
  return task;
}

// 获取任务
export function getTask(taskId) {
  return tasks.get(taskId) || null;
}

// 更新任务进度
export function updateTaskProgress(taskId, progress, current, total) {
  const task = tasks.get(taskId);
  if (task) {
    task.progress = progress;
    task.current = current;
    task.total = total;
    task.status = TASK_STATUS.PROCESSING;
    task.updatedAt = new Date().toISOString();
  }
}

// 完成任务
export function completeTask(taskId, result = {}) {
  const task = tasks.get(taskId);
  if (task) {
    task.status = TASK_STATUS.COMPLETED;
    task.progress = 100;
    task.current = task.total;
    task.updatedAt = new Date().toISOString();
    task.result = result;
  }
  cleanupOldTasks();
}

// 任务失败
export function failTask(taskId, error) {
  const task = tasks.get(taskId);
  if (task) {
    task.status = TASK_STATUS.FAILED;
    task.updatedAt = new Date().toISOString();
    task.error = error instanceof Error ? error.message : String(error);
  }
  cleanupOldTasks();
}

// 处理 embedding 生成任务
export async function processEmbeddingTask(taskId, documentId) {
  console.log(`[任务 ${taskId}] 开始处理文档 ${documentId} 的 embedding 生成`);
  const task = tasks.get(taskId);
  if (!task) throw new Error('任务不存在');

  try {
    task.status = TASK_STATUS.PROCESSING;
    task.updatedAt = new Date().toISOString();

    const chunks = await storage.getChunks(documentId);
    const chunksWithoutEmbedding = chunks.filter(
      ch => !ch.embedding || !Array.isArray(ch.embedding) || ch.embedding.length === 0
    );

    if (chunksWithoutEmbedding.length === 0) {
      completeTask(taskId, { message: '所有 chunks 已有 embedding' });
      return;
    }

    task.total = chunksWithoutEmbedding.length;
    task.current = 0;
    task.progress = 0;

    // 优化批处理参数：
    // - SiliconFlow API 最大批次大小限制为 64
    // - 增加并发度到 5（在 API 限速允许范围内最大化并行）
    const batchSize = 64; // 批次大小：每次 API 调用处理的文本数量（API 最大限制）
    const concurrency = 5; // 并发批次数：同时进行的 API 调用数量
    let successCount = 0;
    let failCount = 0;

    // 创建批次数组
    const batches = [];
    for (let i = 0; i < chunksWithoutEmbedding.length; i += batchSize) {
      batches.push(chunksWithoutEmbedding.slice(i, i + batchSize));
    }

    // 处理单个批次的函数
    const processBatch = async (batch, batchIndex) => {
      const texts = batch.map(c => c.content || "");
      let embeddings = null;
      let retryCount = 0;
      const MAX_RETRIES = 3;

      while (retryCount < MAX_RETRIES && !embeddings) {
        try {
          if (retryCount > 0) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retryCount - 1)));
          embeddings = await embedTexts(texts);
        } catch (err) {
          console.warn(`[任务 ${taskId}] 批次 ${batchIndex + 1} 失败 (尝试 ${retryCount + 1}):`, err.message);
          retryCount++;
        }
      }

      const result = { success: 0, failed: 0, updates: [] };

      if (embeddings) {
        batch.forEach((chunk, idx) => {
          if (embeddings[idx]) {
            result.updates.push({ chunkId: chunk.id, embedding: embeddings[idx] });
            result.success++;
          } else {
            result.failed++;
          }
        });
      } else {
        result.failed = batch.length;
        console.error(`[任务 ${taskId}] 批次 ${batchIndex + 1} 生成失败，跳过 ${batch.length} 个 chunks`);
      }

      return result;
    };

    // 并行处理批次（受控并发）
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchGroup = batches.slice(i, i + concurrency);
      const results = await Promise.all(
        batchGroup.map((batch, idx) => processBatch(batch, i + idx))
      );

      // 收集结果并更新存储
      const allUpdates = [];
      for (const result of results) {
        successCount += result.success;
        failCount += result.failed;
        allUpdates.push(...result.updates);
      }

      if (allUpdates.length > 0) {
        await storage.updateChunkEmbeddings(allUpdates, documentId);
      }

      task.current = successCount + failCount;
      task.progress = Math.round((task.current / chunksWithoutEmbedding.length) * 100);
      task.updatedAt = new Date().toISOString();

      console.log(`[任务 ${taskId}] 进度: ${task.current}/${task.total} (${task.progress}%)`);
    }

    completeTask(taskId, { successCount, failCount });

    // 🆕 自动触发知识图谱构建（仅在未存在时）
    console.log(`[任务 ${taskId}] Embedding 生成完成，检查知识图谱状态...`);
    try {
      const hasGraph = await knowledgeGraph.hasDocumentInGraph(documentId);
      if (!hasGraph) {
        await knowledgeGraph.processDocument(documentId);
        console.log(`[任务 ${taskId}] ✅ 知识图谱构建完成`);
      } else {
        console.log(`[任务 ${taskId}] 知识图谱已存在，跳过构建`);
      }
    } catch (kgError) {
      console.error(`[任务 ${taskId}] ⚠️ 知识图谱构建失败（不影响文档可用性）:`, kgError.message);
      // 知识图谱构建失败不影响主流程，只记录警告
    }
  } catch (error) {
    console.error(`[任务 ${taskId}] 处理失败:`, error);
    failTask(taskId, error);
    throw error;
  }
}


// 获取所有任务（用于查询）
export function getAllTasks() {
  return Array.from(tasks.values());
}

// 获取文档的任务
export function getDocumentTasks(documentId) {
  return Array.from(tasks.values()).filter(t => t.documentId === documentId);
}

// 清理旧任务（保留最近 100 个）
export function cleanupOldTasks() {
  const taskArray = Array.from(tasks.values());
  taskArray.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (taskArray.length > 100) {
    const toDelete = taskArray.slice(100);
    toDelete.forEach(task => tasks.delete(task.id));
  }
}

// 恢复中断的任务（服务器启动时调用）
export async function restoreInterruptedTasks() {
  console.log('[任务队列] 开始检查未完成的 Embedding 任务...');
  try {
    const documents = await storage.getAllDocuments();
    let restoredCount = 0;

    for (const doc of documents) {
      // 检查该文档是否已有正在运行的任务（防止重复）
      const existingTasks = getDocumentTasks(doc.id);
      const hasRunningTask = existingTasks.some(t =>
        t.status === TASK_STATUS.PENDING || t.status === TASK_STATUS.PROCESSING
      );

      if (hasRunningTask) {
        console.log(`[任务队列] 文档 ${doc.id} 已有运行中的任务，跳过检查`);
        continue;
      }

      // 检查 chunks 状态
      const chunks = await storage.getChunks(doc.id);
      const chunksWithoutEmbedding = chunks.filter(
        ch => !ch.embedding || !Array.isArray(ch.embedding) || ch.embedding.length === 0
      );

      if (chunksWithoutEmbedding.length > 0) {
        console.log(`[任务队列] 发现文档 ${doc.id} 有 ${chunksWithoutEmbedding.length} 个 chunks 缺失 embedding，自动创建恢复任务`);

        const task = createTask('generate_embeddings', doc.id, {
          reason: 'auto_restore',
          restoredAt: new Date().toISOString()
        });

        // 异步执行，不阻塞启动流程
        processEmbeddingTask(task.id, doc.id).catch(err => {
          console.error(`[任务队列] 恢复任务 ${task.id} 执行失败:`, err);
        });

        restoredCount++;
      }
    }

    console.log(`[任务队列] 检查完成，共恢复 ${restoredCount} 个任务`);
  } catch (error) {
    console.error('[任务队列] 恢复任务失败:', error);
  }
}

function getDocumentText(document) {
  if (!document) return '';
  const metadata = document.metadata || {};
  const candidates = [
    metadata.rawText,
    metadata.raw_text,
    metadata.text,
    metadata.content,
    metadata.sourceText,
    metadata.fullText,
    metadata.originalText
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  const preview = document.contentPreview;
  if (typeof preview === 'string') {
    const trimmed = preview.trim();
    if (trimmed && !/处理中|processing/i.test(trimmed)) {
      return trimmed;
    }
  }

  return '';
}

function hasRunningTask(documentId, type) {
  return getDocumentTasks(documentId).some(task => {
    if (type && task.type !== type) return false;
    return task.status === TASK_STATUS.PENDING || task.status === TASK_STATUS.PROCESSING;
  });
}

async function rebuildChunksFromText(document, text) {
  if (!document?.id) return { ok: false, reason: 'missing_document' };
  if (!text || !text.trim()) return { ok: false, reason: 'empty_text' };

  if (text.length > LIMITS.MAX_TEXT_SIZE) {
    console.warn(`[AutoRepair] 文档 ${document.id} 文本过大，跳过自动切片`);
    return { ok: false, reason: 'text_too_large' };
  }

  let maxChunkSize = LIMITS.MAX_CHUNK_SIZE;
  if (text.length > 500 * 1024) {
    maxChunkSize = 6000;
  }

  const chunks = chunking.enhancedParentChildChunking(text, maxChunkSize, null, null, {
    documentType: document?.category || document?.categoryId || 'general'
  });

  if (!chunks || chunks.length === 0) {
    return { ok: false, reason: 'no_chunks' };
  }

  const chunksWithDocId = chunks.map(chunk => ({ ...chunk, documentId: document.id }));
  await storage.createChunks(chunksWithDocId);
  await storage.updateDocument(document.id, { status: 'ready', errorMessage: null });

  return { ok: true, chunkCount: chunks.length };
}

function resolveMaintenanceConfig(settings, overrides) {
  const configFromSettings = settings?.maintenance?.autoRepair || settings?.maintenance?.autoProcess || {};
  return {
    ...DEFAULT_MAINTENANCE_CONFIG,
    ...configFromSettings,
    ...overrides
  };
}

export async function runAutoMaintenance(overrides = {}) {
  if (maintenanceState.running) {
    return maintenanceState.lastSummary || { ok: false, reason: 'already_running' };
  }

  maintenanceState.running = true;
  const startedAt = Date.now();

  try {
    const settings = await storage.getSettings();
    const config = resolveMaintenanceConfig(settings, overrides);

    if (config.enabled === false) {
      maintenanceState.lastSummary = { ok: true, skipped: true, reason: 'disabled' };
      return maintenanceState.lastSummary;
    }

    const documents = await storage.getAllDocuments();
    let scanned = 0;
    let skippedProcessing = 0;
    let chunkFixed = 0;
    let chunkFailed = 0;
    let embeddingQueued = 0;
    let kgProcessed = 0;
    let kgSkipped = 0;

    for (const doc of documents) {
      if (scanned >= config.maxDocsPerRun) break;
      scanned++;

      if (doc.status === 'processing') {
        skippedProcessing++;
        continue;
      }

      const stats = await storage.getChunkStats(doc.id);

      if (stats.total === 0) {
        if (chunkFixed >= config.maxChunkFixesPerRun) continue;
        const text = getDocumentText(doc);
        const result = await rebuildChunksFromText(doc, text);
        if (result.ok) {
          chunkFixed++;
          const task = createTask('generate_embeddings', doc.id, { reason: 'auto_repair_chunk' });
          processEmbeddingTask(task.id, doc.id).catch(err => {
            console.error(`[AutoRepair] Embedding 生成失败: ${doc.id}`, err);
          });
        } else {
          chunkFailed++;
          if (result.reason === 'empty_text') {
            await storage.updateDocument(doc.id, {
              status: 'error',
              errorMessage: '缺少原始文本，无法自动切片，请重新上传'
            });
          }
        }
        continue;
      }

      if (doc.chunkCount !== stats.total) {
        await storage.updateDocument(doc.id, { chunkCount: stats.total });
      }

      const embeddingsNeeded = stats.requiringEmbedding > 0 && stats.withEmbedding < stats.requiringEmbedding;
      let queuedEmbeddingForDoc = false;
      if (embeddingsNeeded && embeddingQueued < config.maxEmbeddingTasksPerRun && !hasRunningTask(doc.id, 'generate_embeddings')) {
        const task = createTask('generate_embeddings', doc.id, { reason: 'auto_repair_embedding' });
        processEmbeddingTask(task.id, doc.id).catch(err => {
          console.error(`[AutoRepair] Embedding 生成失败: ${doc.id}`, err);
        });
        embeddingQueued++;
        queuedEmbeddingForDoc = true;
      }

      if (!queuedEmbeddingForDoc && kgProcessed < config.maxKnowledgeGraphTasksPerRun) {
        try {
          const hasGraph = await knowledgeGraph.hasDocumentInGraph(doc.id);
          if (!hasGraph) {
            await knowledgeGraph.processDocument(doc.id);
            kgProcessed++;
          } else {
            kgSkipped++;
          }
        } catch (error) {
          console.warn(`[AutoRepair] 知识图谱检查失败: ${doc.id} (${error.message})`);
        }
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const summary = {
      ok: true,
      scanned,
      skippedProcessing,
      chunkFixed,
      chunkFailed,
      embeddingQueued,
      kgProcessed,
      kgSkipped,
      elapsedMs
    };

    maintenanceState.lastRunAt = new Date().toISOString();
    maintenanceState.lastSummary = summary;
    console.log('[AutoRepair] 扫描完成:', summary);
    return summary;
  } catch (error) {
    console.error('[AutoRepair] 扫描失败:', error);
    maintenanceState.lastSummary = { ok: false, error: error.message };
    return maintenanceState.lastSummary;
  } finally {
    maintenanceState.running = false;
  }
}

export function startAutoMaintenance(overrides = {}) {
  if (maintenanceState.timer) return maintenanceState.timer;

  const intervalMs = Number(overrides.intervalMs) || DEFAULT_MAINTENANCE_CONFIG.intervalMs;
  const initialDelayMs = Number(overrides.initialDelayMs) || DEFAULT_MAINTENANCE_CONFIG.initialDelayMs;

  setTimeout(() => {
    runAutoMaintenance(overrides).catch(err => {
      console.error('[AutoRepair] 首次扫描失败:', err);
    });
  }, initialDelayMs);

  maintenanceState.timer = setInterval(() => {
    runAutoMaintenance(overrides).catch(err => {
      console.error('[AutoRepair] 定时扫描失败:', err);
    });
  }, intervalMs);

  return maintenanceState.timer;
}

export function stopAutoMaintenance() {
  if (maintenanceState.timer) {
    clearInterval(maintenanceState.timer);
    maintenanceState.timer = null;
  }
}

export function getAutoMaintenanceStatus() {
  return {
    running: maintenanceState.running,
    lastRunAt: maintenanceState.lastRunAt,
    lastSummary: maintenanceState.lastSummary
  };
}
