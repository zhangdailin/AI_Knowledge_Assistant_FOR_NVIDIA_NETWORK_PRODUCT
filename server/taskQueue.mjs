/**
 * 后台任务队列管理器
 * 处理文档的 embedding 生成等耗时任务
 */

import * as storage from './storage.mjs';
import { embedText } from './embedding.mjs';

// 任务状态
const TASK_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// 任务存储（内存中，生产环境应使用 Redis 或数据库）
const tasks = new Map();

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
}

// 任务失败
export function failTask(taskId, error) {
  const task = tasks.get(taskId);
  if (task) {
    task.status = TASK_STATUS.FAILED;
    task.updatedAt = new Date().toISOString();
    task.error = error instanceof Error ? error.message : String(error);
  }
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

    const batchSize = 20; // 增加批次大小，SiliconFlow 支持较大批次
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < chunksWithoutEmbedding.length; i += batchSize) {
      const batch = chunksWithoutEmbedding.slice(i, i + batchSize);
      const texts = batch.map(c => c.content || "");

      let embeddings = null;
      let retryCount = 0;
      const MAX_RETRIES = 3;

      while (retryCount < MAX_RETRIES && !embeddings) {
        try {
          if (retryCount > 0) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retryCount - 1)));
          embeddings = await embedTexts(texts);
        } catch (err) {
          console.warn(`[任务 ${taskId}] Batch embedding failed (Attempt ${retryCount + 1}):`, err.message);
          retryCount++;
        }
      }

      if (embeddings) {
        const updates = [];
        batch.forEach((chunk, idx) => {
          if (embeddings[idx]) {
            updates.push({ chunkId: chunk.id, embedding: embeddings[idx] });
            successCount++;
          } else {
            failCount++;
          }
        });

        if (updates.length > 0) {
          await storage.updateChunkEmbeddings(updates, documentId);
        }
      } else {
        failCount += batch.length;
        console.error(`[任务 ${taskId}] 批次生成失败，跳过 ${batch.length} 个 chunks`);
      }

      task.current = successCount + failCount;
      task.progress = Math.round((task.current / chunksWithoutEmbedding.length) * 100);
      task.updatedAt = new Date().toISOString();
      
      if (i % 40 === 0) {
        console.log(`[任务 ${taskId}] 进度: ${task.current}/${task.total} (${task.progress}%)`);
      }
    }

    completeTask(taskId, { successCount, failCount });
  } catch (error) {
    console.error(`[任务 ${taskId}] 处理失败:`, error);
    failTask(taskId, error);
    throw error;
  }
}

// 导入 embedTexts
import { embedTexts } from './embedding.mjs';

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
