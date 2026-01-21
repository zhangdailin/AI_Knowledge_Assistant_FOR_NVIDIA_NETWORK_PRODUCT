/**
 * SQLite 存储模块 - 使用 better-sqlite3
 * 替代 JSON 文件存储，提供更好的性能和事务支持
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { hnswIndex } from './hnswIndex.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库路径
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'knowledge.db');

let db = null;
let isInitialized = false;
let searchCacheInvalidator = null;

// ========== 数据库初始化 ==========

function getDatabase() {
    if (!db) {
        db = new Database(DB_PATH);
        // 启用 WAL 模式提升并发性能
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
    }
    return db;
}

export async function initStorage() {
    if (isInitialized) return;

    // 确保数据目录存在
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }

    const database = getDatabase();

    // 创建表结构
    database.exec(`
    -- 文档表
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'public',
      filename TEXT NOT NULL,
      file_type TEXT,
      file_size INTEGER,
      category TEXT,
      category_id TEXT,
      content_preview TEXT,
      uploaded_at TEXT,
      status TEXT DEFAULT 'pending',
      chunk_count INTEGER DEFAULT 0,
      error_message TEXT,
      metadata TEXT
    );
    
    -- Chunks 表
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_type TEXT,
      parent_id TEXT,
      start_index INTEGER,
      end_index INTEGER,
      section_title TEXT,
      embedding BLOB,
      metadata TEXT,
      created_at TEXT,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(chunk_type);
    CREATE INDEX IF NOT EXISTS idx_chunks_parent ON chunks(parent_id);
    
    -- 设置表
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    
    -- 分类表
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'folder',
      sort_order INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
    
    -- 反馈表
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT,
      answer TEXT,
      verdict TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_verdict ON feedback(verdict);
    
    -- 查询日志表
    CREATE TABLE IF NOT EXISTS query_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      response_time INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_query_logs_created ON query_logs(created_at);
    
    -- 负样本表
    CREATE TABLE IF NOT EXISTS negative_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      document_id TEXT NOT NULL,
      count INTEGER DEFAULT 1,
      UNIQUE(query, document_id)
    );
    CREATE INDEX IF NOT EXISTS idx_negative_query ON negative_samples(query);
  `);

    // 创建 FTS5 全文搜索虚拟表（如果不存在）
    try {
        database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        id,
        content,
        section_title,
        tokenize='unicode61'
      );
    `);
    } catch (e) {
        // FTS5 表可能已存在
        console.log('[SQLite] FTS5 表已存在或创建失败:', e.message);
    }

    isInitialized = true;
    console.log('[SQLite] 数据库初始化完成');
}

// ========== 文档管理 ==========

export async function getAllDocuments() {
    await initStorage();
    const database = getDatabase();
    const rows = database.prepare('SELECT * FROM documents ORDER BY uploaded_at DESC').all();
    return rows.map(rowToDocument);
}

export async function getDocument(documentId) {
    await initStorage();
    const database = getDatabase();
    const row = database.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
    return row ? rowToDocument(row) : null;
}

export async function createDocument(documentData) {
    await initStorage();
    const database = getDatabase();

    const doc = {
        id: documentData.id || `doc-${Date.now()}`,
        userId: documentData.userId || 'public',
        filename: documentData.filename,
        fileType: documentData.fileType || null,
        fileSize: documentData.fileSize || 0,
        category: documentData.category || 'default',
        categoryId: documentData.categoryId || 'default',
        contentPreview: documentData.contentPreview || '',
        uploadedAt: documentData.uploadedAt || new Date().toISOString(),
        status: documentData.status || 'pending',
        chunkCount: documentData.chunkCount || 0,
        errorMessage: documentData.errorMessage || null,
        metadata: documentData.metadata ? JSON.stringify(documentData.metadata) : null
    };

    database.prepare(`
    INSERT INTO documents (id, user_id, filename, file_type, file_size, category, category_id, 
      content_preview, uploaded_at, status, chunk_count, error_message, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
        doc.id, doc.userId, doc.filename, doc.fileType, doc.fileSize, doc.category, doc.categoryId,
        doc.contentPreview, doc.uploadedAt, doc.status, doc.chunkCount, doc.errorMessage, doc.metadata
    );

    if (searchCacheInvalidator) searchCacheInvalidator('createDocument');
    return rowToDocument(doc);
}

export async function updateDocument(documentId, updates) {
    await initStorage();
    const database = getDatabase();

    const existing = await getDocument(documentId);
    if (!existing) return null;

    const fields = [];
    const values = [];

    const fieldMap = {
        userId: 'user_id',
        filename: 'filename',
        fileType: 'file_type',
        fileSize: 'file_size',
        category: 'category',
        categoryId: 'category_id',
        contentPreview: 'content_preview',
        uploadedAt: 'uploaded_at',
        status: 'status',
        chunkCount: 'chunk_count',
        errorMessage: 'error_message'
    };

    for (const [key, dbField] of Object.entries(fieldMap)) {
        if (updates[key] !== undefined) {
            fields.push(`${dbField} = ?`);
            values.push(updates[key]);
        }
    }

    if (updates.metadata !== undefined) {
        fields.push('metadata = ?');
        values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length === 0) return existing;

    values.push(documentId);
    database.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    if (searchCacheInvalidator) searchCacheInvalidator('updateDocument');
    return await getDocument(documentId);
}

export async function deleteDocument(documentId) {
    await initStorage();
    const database = getDatabase();

    // 由于设置了 ON DELETE CASCADE，chunks 会自动删除
    const result = database.prepare('DELETE FROM documents WHERE id = ?').run(documentId);

    // 同步删除 FTS 索引
    database.prepare('DELETE FROM chunks_fts WHERE id IN (SELECT id FROM chunks WHERE document_id = ?)').run(documentId);

    if (searchCacheInvalidator) searchCacheInvalidator('deleteDocument');
    return result.changes > 0;
}

function rowToDocument(row) {
    return {
        id: row.id,
        userId: row.user_id,
        filename: row.filename,
        fileType: row.file_type,
        fileSize: row.file_size,
        category: row.category,
        categoryId: row.category_id,
        contentPreview: row.content_preview,
        uploadedAt: row.uploaded_at,
        status: row.status,
        chunkCount: row.chunk_count,
        errorMessage: row.error_message,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
    };
}

// ========== Chunks 管理 ==========

export async function getAllChunks() {
    await initStorage();
    const database = getDatabase();
    const rows = database.prepare('SELECT * FROM chunks').all();
    return rows.map(rowToChunk);
}

export async function getChunks(documentId) {
    await initStorage();
    const database = getDatabase();
    const rows = database.prepare('SELECT * FROM chunks WHERE document_id = ?').all(documentId);
    return rows.map(rowToChunk);
}

export async function getChunk(documentId, chunkId) {
    await initStorage();
    const database = getDatabase();
    const row = database.prepare('SELECT * FROM chunks WHERE document_id = ? AND id = ?').get(documentId, chunkId);
    return row ? rowToChunk(row) : null;
}

export async function getChunkStats(documentId) {
    await initStorage();
    const database = getDatabase();

    const stats = database.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN chunk_type = 'parent' THEN 1 ELSE 0 END) as parent_count,
      SUM(CASE WHEN chunk_type = 'child' THEN 1 ELSE 0 END) as child_count,
      SUM(CASE WHEN chunk_type NOT IN ('parent', 'child') OR chunk_type IS NULL THEN 1 ELSE 0 END) as normal_count,
      SUM(CASE WHEN embedding IS NOT NULL AND chunk_type != 'parent' THEN 1 ELSE 0 END) as with_embedding
    FROM chunks WHERE document_id = ?
  `).get(documentId);

    return {
        total: stats.total || 0,
        parentCount: stats.parent_count || 0,
        childCount: stats.child_count || 0,
        normalCount: stats.normal_count || 0,
        withEmbedding: stats.with_embedding || 0,
        requiringEmbedding: (stats.child_count || 0) + (stats.normal_count || 0)
    };
}

export async function createChunks(chunksData) {
    await initStorage();
    if (!chunksData || chunksData.length === 0) return [];

    const database = getDatabase();
    const insertChunk = database.prepare(`
    INSERT INTO chunks (id, document_id, content, chunk_type, parent_id, start_index, end_index, 
      section_title, embedding, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

    const insertFts = database.prepare(`
    INSERT INTO chunks_fts (id, content, section_title) VALUES (?, ?, ?)
  `);

    const transaction = database.transaction((chunks) => {
        const result = [];
        const docChunkCounts = new Map();

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const id = chunk.id || `chunk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`;
            const createdAt = chunk.createdAt || new Date().toISOString();

            // 序列化 embedding
            let embeddingBlob = null;
            if (Array.isArray(chunk.embedding) && chunk.embedding.length > 0) {
                embeddingBlob = Buffer.from(new Float32Array(chunk.embedding).buffer);
            }

            insertChunk.run(
                id,
                chunk.documentId,
                chunk.content || '',
                chunk.chunkType || null,
                chunk.parentId || null,
                chunk.startIndex || null,
                chunk.endIndex || null,
                chunk.sectionTitle || null,
                embeddingBlob,
                chunk.metadata ? JSON.stringify(chunk.metadata) : null,
                createdAt
            );

            // 插入 FTS 索引
            insertFts.run(id, chunk.content || '', chunk.sectionTitle || '');

            result.push({
                ...chunk,
                id,
                createdAt
            });

            // 统计每个文档的 chunk 数量
            docChunkCounts.set(chunk.documentId, (docChunkCounts.get(chunk.documentId) || 0) + 1);
        }

        // 更新文档的 chunkCount
        const updateDocCount = database.prepare(
            'UPDATE documents SET chunk_count = chunk_count + ? WHERE id = ?'
        );
        for (const [docId, count] of docChunkCounts) {
            updateDocCount.run(count, docId);
        }

        return result;
    });

    const result = transaction(chunksData);
    if (searchCacheInvalidator) searchCacheInvalidator('createChunks');
    return result;
}

export async function deleteChunksByDocument(documentId) {
    await initStorage();
    const database = getDatabase();

    // 先删除 FTS 索引
    database.prepare(`
    DELETE FROM chunks_fts WHERE id IN (SELECT id FROM chunks WHERE document_id = ?)
  `).run(documentId);

    // 删除 chunks
    const result = database.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);

    // 重置文档 chunk 计数
    database.prepare('UPDATE documents SET chunk_count = 0 WHERE id = ?').run(documentId);

    if (searchCacheInvalidator) searchCacheInvalidator('deleteChunksByDocument');
    console.log(`[SQLite] 已删除文档 ${documentId} 的 ${result.changes} 个 chunks`);
    return true;
}

export async function updateChunkEmbedding(chunkId, embedding) {
    await initStorage();
    const database = getDatabase();

    let embeddingBlob = null;
    if (Array.isArray(embedding) && embedding.length > 0) {
        embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
    }

    const result = database.prepare('UPDATE chunks SET embedding = ? WHERE id = ?').run(embeddingBlob, chunkId);

    if (searchCacheInvalidator) searchCacheInvalidator('updateChunkEmbedding');
    return result.changes > 0;
}

export async function updateChunkEmbeddings(updates, documentId) {
    await initStorage();
    if (!updates || updates.length === 0) return { success: 0, failed: 0 };

    const database = getDatabase();
    const updateStmt = database.prepare('UPDATE chunks SET embedding = ? WHERE id = ?');

    const transaction = database.transaction((updates) => {
        let success = 0;
        for (const update of updates) {
            let embeddingBlob = null;
            if (Array.isArray(update.embedding) && update.embedding.length > 0) {
                embeddingBlob = Buffer.from(new Float32Array(update.embedding).buffer);
            }
            const result = updateStmt.run(embeddingBlob, update.chunkId);
            if (result.changes > 0) success++;
        }
        return success;
    });

    const success = transaction(updates);
    if (searchCacheInvalidator) searchCacheInvalidator('updateChunkEmbeddings');
    return { success, failed: updates.length - success };
}

function rowToChunk(row) {
    // 反序列化 embedding
    let embedding = null;
    if (row.embedding) {
        const floatArray = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
        embedding = Array.from(floatArray);
    }

    return {
        id: row.id,
        documentId: row.document_id,
        content: row.content,
        chunkType: row.chunk_type,
        parentId: row.parent_id,
        startIndex: row.start_index,
        endIndex: row.end_index,
        sectionTitle: row.section_title,
        embedding,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        createdAt: row.created_at
    };
}

// ========== 全文搜索 ==========

export async function searchChunks(query, limit = 30, categoryIds = null) {
    await initStorage();
    const database = getDatabase();

    // 获取文档与分类映射
    let docFilter = '';
    const docParams = [];

    if (categoryIds && categoryIds.length > 0) {
        const documents = await getAllDocuments();
        const validDocIds = documents
            .filter(d => categoryIds.includes(d.categoryId) || categoryIds.includes(d.category))
            .map(d => d.id);

        if (validDocIds.length === 0) return [];

        docFilter = `AND c.document_id IN (${validDocIds.map(() => '?').join(', ')})`;
        docParams.push(...validDocIds);
    }

    // FTS5 全文搜索
    // 将查询分词，使用 OR 连接
    const queryWords = query.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [query];
    // 对特殊字符进行转义，避免 FTS5 语法错误
    const ftsQuery = queryWords.map(w => `"${w.replace(/"/g, '""')}"`).join(' OR ');

    try {
        const rows = database.prepare(`
            SELECT c.*,
                   bm25(chunks_fts) as rank
            FROM chunks_fts f
            JOIN chunks c ON f.id = c.id
            WHERE chunks_fts MATCH ?
            ${docFilter}
            ORDER BY rank
            LIMIT ?
        `).all(ftsQuery, ...docParams, limit * 2);

        // 转换结果
        const results = rows.map(row => {
            const chunk = rowToChunk(row);
            return {
                ...chunk,
                score: Math.abs(row.rank || 0),
                matchType: 'fts'
            };
        });

        return results.slice(0, limit);
    } catch (ftsError) {
        console.warn('[SQLite] FTS5 搜索失败，尝试降级搜索:', ftsError.message);

        // 降级：使用 LIKE 搜索
        const likePatterns = queryWords.map(w => `%${w}%`);
        const likeConditions = likePatterns.map(() => 'c.content LIKE ?').join(' OR ');

        const rows = database.prepare(`
            SELECT c.*
            FROM chunks c
            WHERE (${likeConditions})
            ${docFilter}
            LIMIT ?
        `).all(...likePatterns, ...docParams, limit);

        return rows.map(row => {
            const chunk = rowToChunk(row);
            return {
                ...chunk,
                score: 1.0,
                matchType: 'like'
            };
        });
    }
}

// ========== 向量搜索（优先使用 HNSW 索引，回退到线性扫描）==========

export async function vectorSearchChunks(queryEmbedding, limit = 30, categoryIds = null) {
    await initStorage();
    const database = getDatabase();

    // 首先尝试使用 HNSW 索引
    try {
        const hnswReady = await hnswIndex.initialize();
        if (hnswReady && hnswIndex.getSize() > 0) {
            // 使用 HNSW 进行快速近邻搜索
            const hnswResults = await hnswIndex.search(queryEmbedding, limit * 2);

            if (hnswResults.length > 0) {
                // 获取匹配的 chunk 详情
                const chunkIds = hnswResults.map(r => r.id);
                const placeholders = chunkIds.map(() => '?').join(', ');

                // 如果有分类过滤
                let docFilter = '';
                const params = [...chunkIds];

                if (categoryIds && categoryIds.length > 0) {
                    const documents = await getAllDocuments();
                    const validDocIds = documents
                        .filter(d => categoryIds.includes(d.categoryId) || categoryIds.includes(d.category))
                        .map(d => d.id);

                    if (validDocIds.length === 0) return [];

                    docFilter = `AND document_id IN (${validDocIds.map(() => '?').join(', ')})`;
                    params.push(...validDocIds);
                }

                const rows = database.prepare(`
                    SELECT * FROM chunks
                    WHERE id IN (${placeholders})
                    ${docFilter}
                `).all(...params);

                // 创建 id -> row 映射
                const rowMap = new Map();
                for (const row of rows) {
                    rowMap.set(row.id, row);
                }

                // 按 HNSW 分数排序返回
                const results = [];
                for (const hnswResult of hnswResults) {
                    const row = rowMap.get(hnswResult.id);
                    if (row) {
                        const chunk = rowToChunk(row);
                        results.push({
                            chunk,
                            score: hnswResult.score,
                            matchType: 'hnsw'
                        });
                    }
                }

                console.log(`[SQLite] HNSW 向量搜索: 返回 ${results.length} 个结果`);
                return results.slice(0, limit);
            }
        }
    } catch (hnswError) {
        console.warn('[SQLite] HNSW 搜索失败，回退到线性扫描:', hnswError.message);
    }

    // 回退：线性扫描（仅在 HNSW 不可用时）
    console.log('[SQLite] 使用线性扫描进行向量搜索');

    let docFilter = '';
    const params = [];

    if (categoryIds && categoryIds.length > 0) {
        const documents = await getAllDocuments();
        const validDocIds = documents
            .filter(d => categoryIds.includes(d.categoryId) || categoryIds.includes(d.category))
            .map(d => d.id);

        if (validDocIds.length === 0) return [];

        docFilter = `AND document_id IN (${validDocIds.map(() => '?').join(', ')})`;
        params.push(...validDocIds);
    }

    const rows = database.prepare(`
    SELECT * FROM chunks
    WHERE embedding IS NOT NULL
      AND chunk_type != 'parent'
    ${docFilter}
  `).all(...params);

    // 计算余弦相似度
    const results = [];
    for (const row of rows) {
        const chunk = rowToChunk(row);
        if (!chunk.embedding || chunk.embedding.length === 0) continue;

        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        results.push({
            chunk,
            score: similarity,
            matchType: 'linear'
        });
    }

    // 按相似度排序
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
}

// ========== 设置管理 ==========

export async function getSettings() {
    await initStorage();
    const database = getDatabase();

    const rows = database.prepare('SELECT * FROM settings').all();
    const settings = {};
    for (const row of rows) {
        try {
            settings[row.key] = JSON.parse(row.value);
        } catch {
            settings[row.key] = row.value;
        }
    }
    return settings;
}

export async function updateSettings(updates) {
    await initStorage();
    const database = getDatabase();

    const upsert = database.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

    const transaction = database.transaction((updates) => {
        for (const [key, value] of Object.entries(updates)) {
            upsert.run(key, JSON.stringify(value));
        }
    });

    transaction(updates);
    return await getSettings();
}

export async function getApiKey(provider) {
    const settings = await getSettings();
    return settings.apiKeys?.[provider] || null;
}

// ========== 查询日志 ==========

export async function addQueryLog(query, responseTime = 0) {
    await initStorage();
    const database = getDatabase();

    database.prepare(`
    INSERT INTO query_logs (query, response_time, created_at) VALUES (?, ?, ?)
  `).run(query, responseTime, new Date().toISOString());

    // 保留最近 1000 条
    database.prepare(`
    DELETE FROM query_logs WHERE id NOT IN (
      SELECT id FROM query_logs ORDER BY created_at DESC LIMIT 1000
    )
  `).run();

    return { query, responseTime };
}

export async function getQueryStats() {
    await initStorage();
    const database = getDatabase();

    const total = database.prepare('SELECT COUNT(*) as count FROM query_logs').get().count;
    const avgTime = database.prepare('SELECT AVG(response_time) as avg FROM query_logs').get().avg || 0;
    const recent = database.prepare('SELECT * FROM query_logs ORDER BY created_at DESC LIMIT 10').all();

    // 统计常见查询 (topQuestions 用于前端显示)
    const topQueries = database.prepare(`
    SELECT query, COUNT(*) as count
    FROM query_logs
    GROUP BY query
    ORDER BY count DESC
    LIMIT 10
  `).all();

    // 统计最近7天每天的查询数 (用于图表)
    const dailyStats = database.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM query_logs
    WHERE created_at >= DATE('now', '-7 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();

    // 格式化为前端期望的格式
    const topQuestions = topQueries.map(q => ({
        question: q.query,
        count: q.count
    }));

    // 生成最近7天的日期序列，填充缺失的日期
    const recentQueries = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const found = dailyStats.find(d => d.date === dateStr);
        recentQueries.push({
            date: dateStr,
            count: found ? found.count : 0
        });
    }

    return {
        totalQueries: total,
        avgResponseTime: Math.round(avgTime),
        recentQueries,
        topQuestions,
        // 保留原始格式以兼容其他可能的使用
        total,
        recent: recent.map(r => ({ query: r.query, responseTime: r.response_time, createdAt: r.created_at })),
        topQueries
    };
}

// ========== 反馈管理 ==========

export async function addFeedbackEntry(entry) {
    await initStorage();
    const database = getDatabase();

    database.prepare(`
    INSERT INTO feedback (question, answer, verdict, metadata, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
        entry.question || null,
        entry.answer || null,
        entry.verdict || null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        new Date().toISOString()
    );

    // 负样本学习
    if (entry.verdict === 'down' && entry.question && entry.metadata?.references) {
        await recordNegativeSample(entry.question, entry.metadata.references);
    }

    // 保留最近 2000 条
    database.prepare(`
    DELETE FROM feedback WHERE id NOT IN (
      SELECT id FROM feedback ORDER BY created_at DESC LIMIT 2000
    )
  `).run();

    return entry;
}

export async function getFeedbackMetrics() {
    await initStorage();
    const database = getDatabase();

    const total = database.prepare('SELECT COUNT(*) as count FROM feedback').get().count;
    const positive = database.prepare("SELECT COUNT(*) as count FROM feedback WHERE verdict = 'up'").get().count;
    const negative = database.prepare("SELECT COUNT(*) as count FROM feedback WHERE verdict = 'down'").get().count;
    const recent = database.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 10').all();

    return {
        total,
        positive,
        negative,
        positivityRate: total > 0 ? positive / total : 0,
        recent: recent.map(r => ({
            question: r.question,
            answer: r.answer,
            verdict: r.verdict,
            metadata: r.metadata ? JSON.parse(r.metadata) : null,
            createdAt: r.created_at
        })).reverse()
    };
}

export async function getAllFeedback() {
    await initStorage();
    const database = getDatabase();

    const rows = database.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all();
    return rows.map(r => ({
        question: r.question,
        answer: r.answer,
        verdict: r.verdict,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        createdAt: r.created_at
    }));
}

// ========== 负样本学习 ==========

async function recordNegativeSample(query, references) {
    const database = getDatabase();
    const normalizedQuery = query.toLowerCase().trim();

    const upsert = database.prepare(`
    INSERT INTO negative_samples (query, document_id, count)
    VALUES (?, ?, 1)
    ON CONFLICT(query, document_id) DO UPDATE SET count = count + 1
  `);

    if (Array.isArray(references)) {
        for (const ref of references) {
            const docId = ref.documentId || ref.id;
            if (docId) {
                upsert.run(normalizedQuery, docId);
            }
        }
    }

    console.log(`[SQLite] 已记录负样本: query="${normalizedQuery}"`);
}

export async function getNegativePenalty(query, documentId) {
    if (!query || !documentId) return 0;

    await initStorage();
    const database = getDatabase();
    const normalizedQuery = query.toLowerCase().trim();

    // 精确匹配
    const exact = database.prepare(
        'SELECT count FROM negative_samples WHERE query = ? AND document_id = ?'
    ).get(normalizedQuery, documentId);

    if (exact) {
        return -Math.min(exact.count * 0.1, 0.5);
    }

    // 模糊匹配
    const keywords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);
    if (keywords.length === 0) return 0;

    const likePattern = `%${keywords[0]}%`;
    const fuzzy = database.prepare(
        'SELECT count FROM negative_samples WHERE query LIKE ? AND document_id = ?'
    ).get(likePattern, documentId);

    if (fuzzy) {
        return -Math.min(fuzzy.count * 0.05, 0.25);
    }

    return 0;
}

// ========== 分类管理 ==========

const DEFAULT_CATEGORY = { id: 'default', name: '默认分类', icon: 'folder', children: [] };

export async function getCategories() {
    await initStorage();
    const database = getDatabase();

    const rows = database.prepare('SELECT * FROM categories ORDER BY sort_order').all();

    if (rows.length === 0) {
        // 初始化默认分类
        database.prepare(
            'INSERT OR IGNORE INTO categories (id, parent_id, name, icon, sort_order) VALUES (?, ?, ?, ?, ?)'
        ).run('default', null, '默认分类', 'folder', 0);
        return { tree: [DEFAULT_CATEGORY] };
    }

    // 构建树结构
    const nodeMap = new Map();
    const roots = [];

    for (const row of rows) {
        nodeMap.set(row.id, {
            id: row.id,
            name: row.name,
            icon: row.icon || 'folder',
            children: []
        });
    }

    for (const row of rows) {
        const node = nodeMap.get(row.id);
        if (row.parent_id && nodeMap.has(row.parent_id)) {
            nodeMap.get(row.parent_id).children.push(node);
        } else {
            roots.push(node);
        }
    }

    return { tree: roots };
}

export async function saveCategories(categories) {
    await initStorage();
    const database = getDatabase();

    // 清空并重建
    const transaction = database.transaction((tree) => {
        database.prepare('DELETE FROM categories').run();

        const insert = database.prepare(
            'INSERT INTO categories (id, parent_id, name, icon, sort_order) VALUES (?, ?, ?, ?, ?)'
        );

        let sortOrder = 0;
        const insertNodes = (nodes, parentId) => {
            for (const node of nodes) {
                insert.run(node.id, parentId, node.name, node.icon || 'folder', sortOrder++);
                if (node.children && node.children.length > 0) {
                    insertNodes(node.children, node.id);
                }
            }
        };

        insertNodes(tree, null);
    });

    transaction(categories.tree || []);
    if (searchCacheInvalidator) searchCacheInvalidator('saveCategories');
    return categories;
}

export async function addCategory(parentId, category) {
    await initStorage();
    const database = getDatabase();

    const newId = `cat-${Date.now()}`;
    const maxOrder = database.prepare('SELECT MAX(sort_order) as max FROM categories').get().max || 0;

    database.prepare(
        'INSERT INTO categories (id, parent_id, name, icon, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(newId, parentId || null, category.name, category.icon || 'folder', maxOrder + 1);

    if (searchCacheInvalidator) searchCacheInvalidator('addCategory');
    return { id: newId, name: category.name, icon: category.icon || 'folder', children: [] };
}

export async function updateCategory(categoryId, updates) {
    await initStorage();
    const database = getDatabase();

    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
        fields.push('name = ?');
        values.push(updates.name);
    }
    if (updates.icon !== undefined) {
        fields.push('icon = ?');
        values.push(updates.icon);
    }

    if (fields.length > 0) {
        values.push(categoryId);
        database.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);

        // 更新相关文档的分类名称
        if (updates.name !== undefined) {
            database.prepare('UPDATE documents SET category = ? WHERE category_id = ?').run(updates.name, categoryId);
        }
    }

    if (searchCacheInvalidator) searchCacheInvalidator('updateCategory');
    return await getCategories();
}

export async function deleteCategory(categoryId) {
    if (categoryId === 'default') return false;

    await initStorage();
    const database = getDatabase();

    // 删除分类及其子分类
    const collectIds = (id) => {
        const ids = [id];
        const children = database.prepare('SELECT id FROM categories WHERE parent_id = ?').all(id);
        for (const child of children) {
            ids.push(...collectIds(child.id));
        }
        return ids;
    };

    const idsToDelete = collectIds(categoryId);

    const transaction = database.transaction(() => {
        // 将相关文档移到默认分类
        for (const id of idsToDelete) {
            database.prepare(
                "UPDATE documents SET category_id = 'default', category = '默认分类' WHERE category_id = ?"
            ).run(id);
        }

        // 删除分类
        for (const id of idsToDelete) {
            database.prepare('DELETE FROM categories WHERE id = ?').run(id);
        }
    });

    transaction();
    if (searchCacheInvalidator) searchCacheInvalidator('deleteCategory');
    return true;
}

export function getCategoryAndChildrenIds(catId, nodes) {
    const ids = [catId];

    const findAndCollect = (nodeList) => {
        for (const node of nodeList) {
            if (node.id === catId) {
                const collectIds = (n) => {
                    ids.push(n.id);
                    if (n.children) n.children.forEach(collectIds);
                };
                if (node.children) node.children.forEach(collectIds);
                return;
            }
            if (node.children) findAndCollect(node.children);
        }
    };

    findAndCollect(nodes);
    return ids;
}

// ========== 工具函数 ==========

export function setSearchCacheInvalidator(fn) {
    searchCacheInvalidator = typeof fn === 'function' ? fn : null;
}

export async function reloadCacheConfig() {
    // SQLite 不需要缓存配置
}

// ========== 辅助搜索函数 ==========

/**
 * 搜索特定模式的块
 */
export async function findChunksByPattern(pattern, limit = 10) {
    await initStorage();
    const database = getDatabase();

    const rows = database.prepare('SELECT * FROM chunks').all();
    const results = [];

    for (const row of rows) {
        const chunk = rowToChunk(row);
        const content = typeof chunk.content === 'string' ? chunk.content : '';
        if (content && pattern.test(content)) {
            results.push(chunk);
            if (results.length >= limit) break;
        }
    }

    return results;
}

/**
 * 通用的块扫描器
 */
export async function scanChunks(processor) {
    await initStorage();
    const database = getDatabase();

    const rows = database.prepare('SELECT * FROM chunks').all();
    for (const row of rows) {
        const chunk = rowToChunk(row);
        const shouldContinue = await processor(chunk);
        if (shouldContinue === false) return;
    }
}

// ========== 关闭数据库 ==========

export function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        isInitialized = false;
        console.log('[SQLite] 数据库已关闭');
    }
}

// 进程退出时关闭数据库
process.on('exit', closeDatabase);
process.on('SIGINT', () => {
    closeDatabase();
    process.exit(0);
});
