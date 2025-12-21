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
  // #region agent log
  console.log(`[任务队列] [DEBUG] processEmbeddingTask 被调用: taskId=${taskId}, documentId=${documentId}`);
  // #endregion
  console.log(`[任务队列] processEmbeddingTask 被调用: taskId=${taskId}, documentId=${documentId}`);
  const task = tasks.get(taskId);
  if (!task) {
    // #region agent log
    console.error(`[任务队列] [DEBUG] 任务不存在: ${taskId}`);
    // #endregion
    console.error(`[任务队列] 任务不存在: ${taskId}`);
    throw new Error('任务不存在');
  }

  try {
    // #region agent log
    console.log(`[任务队列] [DEBUG] 任务状态: ${task.status}, 类型: ${task.type}`);
    // #endregion
    console.log(`[任务 ${taskId}] 开始处理，当前任务状态: ${task.status}`);
    task.status = TASK_STATUS.PROCESSING;
    task.updatedAt = new Date().toISOString();
    // #region agent log
    console.log(`[任务队列] [DEBUG] 任务状态已更新为 PROCESSING`);
    // #endregion

    console.log(`[任务 ${taskId}] 开始处理文档 ${documentId} 的 embedding 生成`);

    // 获取文档的 chunks
    // #region agent log
    console.log(`[任务队列] [DEBUG] 开始获取文档 ${documentId} 的 chunks`);
    // #endregion
    const chunks = await storage.getChunks(documentId);
    // #region agent log
    console.log(`[任务队列] [DEBUG] 获取到 ${chunks.length} 个 chunks`);
    // #endregion
    console.log(`[任务 ${taskId}] 获取到 ${chunks.length} 个 chunks`);
    const chunksWithoutEmbedding = chunks.filter(
      ch => !ch.embedding || !Array.isArray(ch.embedding) || ch.embedding.length === 0
    );
    // #region agent log
    console.log(`[任务队列] [DEBUG] 需要生成 embedding 的 chunks: ${chunksWithoutEmbedding.length}`);
    // #endregion

    if (chunksWithoutEmbedding.length === 0) {
      console.log(`[任务 ${taskId}] 所有 chunks 已有 embedding，任务完成`);
      completeTask(taskId, { message: '所有 chunks 已有 embedding' });
      return;
    }

    console.log(`[任务 ${taskId}] 需要为 ${chunksWithoutEmbedding.length} 个 chunks 生成 embedding`);
    task.total = chunksWithoutEmbedding.length;
    task.current = 0;
    task.progress = 0;

    // 检查 API key
    const apiKey = await storage.getApiKey('siliconflow');
    console.log(`[任务 ${taskId}] API key 检查: ${apiKey ? '已配置' : '未配置'}`);
    if (!apiKey) {
      throw new Error('SiliconFlow API key 未配置，请在设置中配置 API key');
    }

    // 批量处理
    const batchSize = 5;
    let successCount = 0;
    let failCount = 0;
    const pendingUpdates = [];

    for (let i = 0; i < chunksWithoutEmbedding.length; i += batchSize) {
      const batch = chunksWithoutEmbedding.slice(i, i + batchSize);
      
      // 并发生成 embedding
      const embeddingResults = await Promise.all(
        batch.map(async (chunk) => {
          try {
            const embedding = await embedText(chunk.content.substring(0, 2000));
            if (embedding && Array.isArray(embedding) && embedding.length > 0) {
              return { chunkId: chunk.id, embedding, success: true };
            } else {
              console.error(`[任务 ${taskId}] chunk ${chunk.id} embedding 返回为空或格式错误`);
              return { chunkId: chunk.id, embedding: null, success: false };
            }
          } catch (error) {
            console.error(`[任务 ${taskId}] 为 chunk ${chunk.id} 生成 embedding 失败:`, error.message);
            return { chunkId: chunk.id, embedding: null, success: false, error: error.message };
          }
        })
      );

      // 收集成功的更新
      const successfulUpdates = embeddingResults
        .filter(r => r.success && r.embedding)
        .map(r => ({ chunkId: r.chunkId, embedding: r.embedding }));
      
      pendingUpdates.push(...successfulUpdates);
      
      // 统计成功和失败
      embeddingResults.forEach(r => {
        if (r.success) {
          successCount++;
        } else {
          failCount++;
        }
      });

      // 每批次或每 10 个 chunks 批量写入一次
      if (pendingUpdates.length >= 10 || i + batchSize >= chunksWithoutEmbedding.length) {
        if (pendingUpdates.length > 0) {
          // #region agent log
          console.log(`[任务 ${taskId}] [BATCH] 准备批量更新 ${pendingUpdates.length} 个 chunks`);
          // #endregion
          try {
            const result = await storage.updateChunkEmbeddings(pendingUpdates);
            // 批量更新可能部分成功，调整计数
            const actualSuccess = result.success;
            const actualFailed = result.failed;
            // #region agent log
            console.log(`[任务 ${taskId}] [BATCH] 批量更新结果: 成功 ${actualSuccess}, 失败 ${actualFailed}`);
            // #endregion
            // 注意：这里 successCount 和 failCount 已经包含了生成 embedding 的结果
            // 如果批量更新失败，需要调整计数
            if (actualFailed > 0) {
              console.warn(`[任务 ${taskId}] 批量更新中有 ${actualFailed} 个 chunks 更新失败`);
            }
            pendingUpdates.length = 0; // 清空待更新列表
          } catch (error) {
            // #region agent log
            console.error(`[任务 ${taskId}] [BATCH] 批量更新异常:`, error);
            // #endregion
            console.error(`[任务 ${taskId}] 批量更新失败:`, error);
            // 批量更新失败，尝试逐个更新
            for (const update of pendingUpdates) {
              try {
                const result = await storage.updateChunkEmbedding(update.chunkId, update.embedding);
                if (!result) {
                  console.error(`[任务 ${taskId}] chunk ${update.chunkId} embedding 保存失败`);
                }
              } catch (err) {
                console.error(`[任务 ${taskId}] chunk ${update.chunkId} embedding 保存异常:`, err);
              }
            }
            pendingUpdates.length = 0;
          }
        }
      }

      // 更新进度（使用实际成功数，而不是批次索引）
      task.current = successCount + failCount;
      task.progress = Math.round((task.current / chunksWithoutEmbedding.length) * 100);
      task.updatedAt = new Date().toISOString();
      
      if (i % 10 === 0 || i + batchSize >= chunksWithoutEmbedding.length) {
        console.log(`[任务 ${taskId}] 进度: ${task.current}/${task.total} (${task.progress}%), 成功: ${successCount}, 失败: ${failCount}`);
      }

      // 延迟避免 API 限流
      if (i + batchSize < chunksWithoutEmbedding.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // 验证实际保存的 embedding 数量
    const finalChunks = await storage.getChunks(documentId);
    const finalChunksWithEmbedding = finalChunks.filter(
      ch => ch.embedding && Array.isArray(ch.embedding) && ch.embedding.length > 0
    ).length;
    
    console.log(`[任务 ${taskId}] 完成: 成功 ${successCount}, 失败 ${failCount}, 总计 ${chunksWithoutEmbedding.length}, 实际保存: ${finalChunksWithEmbedding}/${finalChunks.length}`);
    completeTask(taskId, {
      successCount,
      failCount,
      total: chunksWithoutEmbedding.length,
      actualSaved: finalChunksWithEmbedding,
      actualTotal: finalChunks.length
    });
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
