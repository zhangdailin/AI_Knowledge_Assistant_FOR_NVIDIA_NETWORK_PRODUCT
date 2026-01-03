/**
 * 批量操作 API 模块
 * 支持批量文档处理、批量检索等操作
 */

import * as storage from './storage.mjs';
import { embedTexts } from './embedding.mjs';
import { enhancedParentChildChunking } from './chunking.mjs';
import fs from 'fs/promises';

/**
 * 批量上传文档
 * @param {Array} files - 文件数组
 * @param {Object} options - 批量上传选项
 * @returns {Object} - 批量上传结果
 */
export async function batchUploadDocuments(files, options = {}) {
  const {
    category = 'default',
    batchSize = 5,
    autoProcess = true
  } = options;

  const results = {
    success: [],
    failed: [],
    total: files.length
  };

  // 分批处理，避免系统过载
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    const batchPromises = batch.map(async (file) => {
      try {
        // 创建文档记录
        const document = await storage.createDocument({
          filename: file.originalname || file.name,
          fileSize: file.size,
          mimeType: file.mimetype || file.type,
          category,
          categoryId: category,
          status: 'pending',
          uploadedAt: new Date().toISOString()
        });

        // 如果启用自动处理，立即处理文档
        if (autoProcess) {
          // 这里可以调用文档处理逻辑
          // 为了不阻塞，可以异步处理
          processDocumentAsync(document.id, file).catch(err => {
            console.error(`[BatchUpload] 处理文档失败: ${document.id}`, err);
          });
        }

        results.success.push({
          documentId: document.id,
          filename: document.filename,
          status: 'uploaded'
        });
      } catch (error) {
        results.failed.push({
          filename: file.originalname || file.name,
          error: error.message
        });
      }
    });

    await Promise.all(batchPromises);

    // 批次间添加短暂延迟
    if (i + batchSize < files.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * 批量删除文档
 * @param {Array} documentIds - 文档ID数组
 * @returns {Object} - 批量删除结果
 */
export async function batchDeleteDocuments(documentIds) {
  const results = {
    success: [],
    failed: [],
    total: documentIds.length
  };

  for (const docId of documentIds) {
    try {
      const deleted = await storage.deleteDocument(docId);
      if (deleted) {
        results.success.push(docId);
      } else {
        results.failed.push({
          documentId: docId,
          error: 'Document not found'
        });
      }
    } catch (error) {
      results.failed.push({
        documentId: docId,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * 批量更新文档元数据
 * @param {Array} updates - 更新数组 [{documentId, updates}]
 * @returns {Object} - 批量更新结果
 */
export async function batchUpdateDocuments(updates) {
  const results = {
    success: [],
    failed: [],
    total: updates.length
  };

  for (const { documentId, updates: docUpdates } of updates) {
    try {
      const updated = await storage.updateDocument(documentId, docUpdates);
      if (updated) {
        results.success.push({
          documentId,
          updates: docUpdates
        });
      } else {
        results.failed.push({
          documentId,
          error: 'Document not found'
        });
      }
    } catch (error) {
      results.failed.push({
        documentId,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * 批量搜索
 * @param {Array} queries - 查询数组
 * @param {Object} options - 搜索选项
 * @returns {Object} - 批量搜索结果
 */
export async function batchSearch(queries, options = {}) {
  const {
    limit = 10,
    categoryId = null,
    parallel = true
  } = options;

  const results = [];

  if (parallel) {
    // 并行搜索
    const searchPromises = queries.map(async (query) => {
      try {
        const searchResults = await storage.searchChunks(query, limit, categoryId ? [categoryId] : null);
        return {
          query,
          results: searchResults,
          count: searchResults.length,
          status: 'success'
        };
      } catch (error) {
        return {
          query,
          results: [],
          count: 0,
          status: 'failed',
          error: error.message
        };
      }
    });

    return await Promise.all(searchPromises);
  } else {
    // 串行搜索
    for (const query of queries) {
      try {
        const searchResults = await storage.searchChunks(query, limit, categoryId ? [categoryId] : null);
        results.push({
          query,
          results: searchResults,
          count: searchResults.length,
          status: 'success'
        });
      } catch (error) {
        results.push({
          query,
          results: [],
          count: 0,
          status: 'failed',
          error: error.message
        });
      }
    }

    return results;
  }
}

/**
 * 批量生成 Embeddings
 * @param {string} documentId - 文档ID
 * @returns {Object} - 生成结果
 */
export async function batchGenerateEmbeddings(documentId) {
  const chunks = await storage.getChunks(documentId);

  if (chunks.length === 0) {
    return {
      success: false,
      error: 'No chunks found for this document'
    };
  }

  // 过滤需要生成 embedding 的 chunks
  const chunksNeedingEmbedding = chunks.filter(c =>
    c.chunkType !== 'parent' && (!c.embedding || c.embedding.length === 0)
  );

  if (chunksNeedingEmbedding.length === 0) {
    return {
      success: true,
      message: 'All chunks already have embeddings',
      processed: 0,
      total: chunks.length
    };
  }

  const batchSize = 10; // 每批处理10个
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < chunksNeedingEmbedding.length; i += batchSize) {
    const batch = chunksNeedingEmbedding.slice(i, i + batchSize);
    const texts = batch.map(c => c.content);

    try {
      const embeddings = await embedTexts(texts);

      // 更新 embeddings
      const updates = batch.map((chunk, idx) => ({
        chunkId: chunk.id,
        embedding: embeddings[idx]
      })).filter(u => u.embedding !== null);

      if (updates.length > 0) {
        await storage.updateChunkEmbeddings(updates, documentId);
        processed += updates.length;
      }

      failed += batch.length - updates.length;
    } catch (error) {
      console.error(`[BatchEmbedding] 批次处理失败:`, error);
      failed += batch.length;
    }

    // 批次间延迟，避免 API 限流
    if (i + batchSize < chunksNeedingEmbedding.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return {
    success: true,
    processed,
    failed,
    total: chunksNeedingEmbedding.length
  };
}

/**
 * 批量导出文档
 * @param {Array} documentIds - 文档ID数组
 * @param {string} format - 导出格式 (json, csv)
 * @returns {Object} - 导出数据
 */
export async function batchExportDocuments(documentIds, format = 'json') {
  const documents = [];

  for (const docId of documentIds) {
    try {
      const doc = await storage.getDocument(docId);
      if (doc) {
        const chunks = await storage.getChunks(docId);
        documents.push({
          ...doc,
          chunks: chunks.map(c => ({
            id: c.id,
            content: c.content,
            chunkType: c.chunkType,
            metadata: c.metadata
          }))
        });
      }
    } catch (error) {
      console.error(`[BatchExport] 导出文档失败: ${docId}`, error);
    }
  }

  if (format === 'json') {
    return {
      format: 'json',
      data: documents,
      count: documents.length,
      exportedAt: new Date().toISOString()
    };
  } else if (format === 'csv') {
    // 简化的 CSV 格式
    const csvRows = ['Document ID,Filename,Category,Upload Date,Chunk Count'];

    documents.forEach(doc => {
      csvRows.push([
        doc.id,
        doc.filename,
        doc.category || 'N/A',
        doc.uploadedAt,
        doc.chunks.length
      ].join(','));
    });

    return {
      format: 'csv',
      data: csvRows.join('\n'),
      count: documents.length,
      exportedAt: new Date().toISOString()
    };
  }

  throw new Error(`Unsupported export format: ${format}`);
}

/**
 * 批量重新处理文档
 * @param {Array} documentIds - 文档ID数组
 * @returns {Object} - 处理结果
 */
export async function batchReprocessDocuments(documentIds) {
  const results = {
    success: [],
    failed: [],
    total: documentIds.length
  };

  for (const docId of documentIds) {
    try {
      // 更新文档状态为处理中
      await storage.updateDocument(docId, { status: 'processing' });

      // 异步重新处理
      reprocessDocumentAsync(docId).catch(err => {
        console.error(`[BatchReprocess] 重新处理失败: ${docId}`, err);
        storage.updateDocument(docId, { status: 'failed', error: err.message });
      });

      results.success.push(docId);
    } catch (error) {
      results.failed.push({
        documentId: docId,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * 异步处理文档（内部函数）
 */
async function processDocumentAsync(documentId, file) {
  // 这里应该调用实际的文档处理逻辑
  // 简化示例
  console.log(`[ProcessAsync] 开始处理文档: ${documentId}`);

  // 模拟处理延迟
  await new Promise(resolve => setTimeout(resolve, 1000));

  await storage.updateDocument(documentId, { status: 'ready' });
  console.log(`[ProcessAsync] 文档处理完成: ${documentId}`);
}

/**
 * 异步重新处理文档（内部函数）
 */
async function reprocessDocumentAsync(documentId) {
  console.log(`[ReprocessAsync] 开始重新处理文档: ${documentId}`);

  // 删除旧的 chunks
  const chunks = await storage.getChunks(documentId);
  // 这里应该实现删除逻辑

  // 重新生成 chunks 和 embeddings
  // 这里应该调用实际的处理逻辑

  await storage.updateDocument(documentId, { status: 'ready' });
  console.log(`[ReprocessAsync] 文档重新处理完成: ${documentId}`);
}

/**
 * 批量操作统计
 * @returns {Object} - 统计信息
 */
export async function getBatchOperationStats() {
  const documents = await storage.getAllDocuments();

  const stats = {
    totalDocuments: documents.length,
    byStatus: {},
    byCategory: {},
    totalSize: 0,
    avgSize: 0
  };

  documents.forEach(doc => {
    // 按状态统计
    stats.byStatus[doc.status] = (stats.byStatus[doc.status] || 0) + 1;

    // 按分类统计
    const category = doc.category || 'uncategorized';
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;

    // 大小统计
    stats.totalSize += doc.fileSize || 0;
  });

  stats.avgSize = stats.totalDocuments > 0
    ? Math.round(stats.totalSize / stats.totalDocuments)
    : 0;

  return stats;
}
