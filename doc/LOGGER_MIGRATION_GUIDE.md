# Logger Migration Guide

本指南说明如何将现有的 `console.log` 语句迁移到新的结构化日志系统。

## 新日志系统的优势

1. **环境感知**: 根据 `NODE_ENV` 和 `LOG_LEVEL` 自动调整日志输出
2. **结构化输出**: 生产环境使用 JSON 格式，便于日志分析
3. **安全性**: 自动过滤敏感信息（API keys, passwords, tokens）
4. **性能**: 可配置日志级别，减少生产环境的日志开销
5. **可维护性**: 统一的日志格式和接口

## 使用方法

### 1. 导入 Logger

```javascript
import { logger } from './utils/logger.mjs';
```

### 2. 日志级别

```javascript
// DEBUG - 详细的调试信息（仅开发环境）
logger.debug('Processing chunk', { chunkId, size: chunk.length });

// INFO - 一般信息（默认级别）
logger.info('Document uploaded successfully', { documentId, filename });

// WARN - 警告信息
logger.warn('Cache miss, falling back to database', { query });

// ERROR - 错误信息
logger.error('Failed to generate embedding', { error: error.message, text });

// PERF - 性能指标
const start = Date.now();
// ... 执行操作 ...
logger.perf('Embedding generation', Date.now() - start, { count: texts.length });
```

### 3. 迁移示例

#### 迁移前 (embedding.mjs)

```javascript
console.log(`[Embedding] 批量生成 ${textsToEmbed.length} 个 embeddings`);
console.error('[Embedding] API 调用失败:', error.message);
console.log(`[Embedding] 成功生成 ${embeddings.length} 个 embeddings`);
```

#### 迁移后

```javascript
logger.info('Batch embedding generation started', { count: textsToEmbed.length });
logger.error('Embedding API call failed', { error: error.message, model: embeddingModel });
logger.info('Embedding generation completed', { count: embeddings.length, duration: Date.now() - start });
```

#### 迁移前 (storage-sqlite.mjs)

```javascript
console.log('[SQLite] 数据库初始化完成');
console.log('[SQLite] FTS5 表已存在或创建失败:', e.message);
console.log(`[SQLite] 已删除文档 ${documentId} 的 ${result.changes} 个 chunks`);
```

#### 迁移后

```javascript
logger.info('SQLite database initialized', { path: DB_PATH });
logger.debug('FTS5 table creation skipped', { reason: e.message });
logger.info('Document chunks deleted', { documentId, count: result.changes });
```

#### 迁移前 (hybridRetrieval.mjs)

```javascript
console.log(`[HybridRetrieval] 查询: "${query}"`);
console.log(`[HybridRetrieval] 关键词搜索: ${keywordResults.length} 个结果`);
console.log(`[HybridRetrieval] 向量搜索: ${vectorResults.length} 个结果`);
console.log(`[HybridRetrieval] RRF 融合后: ${fusedResults.length} 个结果`);
```

#### 迁移后

```javascript
logger.info('Hybrid retrieval started', { query, strategy });
logger.debug('Keyword search completed', { count: keywordResults.length });
logger.debug('Vector search completed', { count: vectorResults.length });
logger.info('RRF fusion completed', {
  count: fusedResults.length,
  keywordWeight,
  vectorWeight
});
```

## 环境配置

### 设置日志级别

```bash
# 开发环境 - 显示所有日志
export LOG_LEVEL=DEBUG

# 生产环境 - 仅显示重要信息
export LOG_LEVEL=INFO

# 仅显示错误
export LOG_LEVEL=ERROR

# 关闭所有日志
export LOG_LEVEL=NONE
```

### 日志格式

**开发环境** (易读格式):
```
[2026-01-23T10:30:45.123Z] INFO  Document uploaded successfully {"documentId":"doc-123","filename":"test.pdf"}
```

**生产环境** (JSON 格式):
```json
{"timestamp":"2026-01-23T10:30:45.123Z","level":"INFO","message":"Document uploaded successfully","documentId":"doc-123","filename":"test.pdf"}
```

## 创建子 Logger

对于需要持久化上下文的模块，可以创建子 logger：

```javascript
// 在模块初始化时创建
const moduleLogger = logger.child({ module: 'knowledgeGraph' });

// 使用时自动包含模块信息
moduleLogger.info('Graph initialized', { nodeCount: 100 });
// 输出: [2026-01-23T10:30:45.123Z] INFO  Graph initialized {"module":"knowledgeGraph","nodeCount":100}
```

## 性能考虑

1. **避免在循环中使用 logger.info/warn/error**
   ```javascript
   // ❌ 不好
   for (const chunk of chunks) {
     logger.info('Processing chunk', { chunkId: chunk.id });
   }

   // ✅ 好
   logger.info('Processing chunks', { count: chunks.length });
   for (const chunk of chunks) {
     logger.debug('Processing chunk', { chunkId: chunk.id }); // 仅在 DEBUG 模式输出
   }
   ```

2. **使用 logger.debug 替代详细日志**
   - `logger.debug` 在生产环境（LOG_LEVEL=INFO）下不会输出
   - 减少 I/O 开销和日志存储成本

3. **避免记录大对象**
   ```javascript
   // ❌ 不好
   logger.info('Search results', { results: allResults }); // 可能有数百个结果

   // ✅ 好
   logger.info('Search results', { count: allResults.length, topScore: allResults[0]?.score });
   ```

## 迁移优先级

### 高优先级（立即迁移）
1. **错误日志**: 所有 `console.error`
2. **安全相关**: 包含 API keys、tokens 的日志
3. **性能关键路径**: 搜索、embedding 生成等

### 中优先级
1. **业务逻辑**: 文档上传、删除等操作
2. **数据库操作**: CRUD 操作日志

### 低优先级
1. **调试信息**: 开发时的临时日志
2. **统计信息**: 非关键的计数和统计

## 完整示例

```javascript
import { logger } from './utils/logger.mjs';

export async function processDocument(documentId) {
  const start = Date.now();

  try {
    logger.info('Document processing started', { documentId });

    // 获取文档
    const doc = await getDocument(documentId);
    if (!doc) {
      logger.warn('Document not found', { documentId });
      return null;
    }

    logger.debug('Document retrieved', {
      documentId,
      size: doc.fileSize,
      type: doc.fileType
    });

    // 处理文档
    const chunks = await chunkDocument(doc);
    logger.info('Document chunked', {
      documentId,
      chunkCount: chunks.length
    });

    // 生成 embeddings
    const embeddings = await generateEmbeddings(chunks);
    logger.info('Embeddings generated', {
      documentId,
      count: embeddings.length
    });

    // 记录性能
    logger.perf('Document processing', Date.now() - start, {
      documentId,
      chunkCount: chunks.length
    });

    return { success: true, chunkCount: chunks.length };

  } catch (error) {
    logger.error('Document processing failed', {
      documentId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}
```

## 测试

在测试环境中，可以临时设置日志级别：

```javascript
import { logger, LOG_LEVELS } from './utils/logger.mjs';

// 测试前
const originalLevel = logger.level;
logger.level = LOG_LEVELS.NONE; // 关闭日志

// 运行测试
// ...

// 测试后恢复
logger.level = originalLevel;
```

## 常见问题

### Q: 如何在生产环境查看 DEBUG 日志？
A: 临时设置环境变量 `LOG_LEVEL=DEBUG` 并重启服务。

### Q: 日志文件在哪里？
A: 当前实现输出到 stdout/stderr，可以通过进程管理器（如 PM2）重定向到文件。

### Q: 如何集成日志分析工具？
A: 生产环境的 JSON 格式日志可以直接导入 ELK、Splunk 等工具。

### Q: 性能影响有多大？
A: 在 INFO 级别下，性能影响 < 1%。DEBUG 级别会有更多开销，仅建议在开发环境使用。

## 下一步

1. 逐步迁移关键模块（embedding.mjs, storage-sqlite.mjs, hybridRetrieval.mjs）
2. 添加日志轮转和归档策略
3. 集成日志监控和告警系统
4. 考虑使用专业日志库（如 winston, pino）替代自定义实现
