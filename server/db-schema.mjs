/**
 * SQLite 数据库架构定义
 * 使用 better-sqlite3 实现高性能存储
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const DB_PATH = path.join(__dirname, '..', 'data', 'knowledge.db');

/**
 * 初始化数据库架构
 * @param {Database} db - better-sqlite3 数据库实例
 */
export function initializeSchema(db) {
  // 启用 WAL 模式以提高并发性能
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456'); // 256MB mmap

  // ========== 文档表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'shared',
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      category_id TEXT,
      category TEXT,
      chunk_count INTEGER DEFAULT 0,
      uploaded_at TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_documents_category_id ON documents(category_id);
    CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at ON documents(uploaded_at);
  `);

  // ========== Chunks 表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      chunk_type TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_chunk_type ON chunks(chunk_type);
  `);

  // ========== FTS5 全文搜索表 ==========
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      id UNINDEXED,
      content,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- FTS5 触发器：插入时同步
    CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(id, content) VALUES (new.id, new.content);
    END;

    -- FTS5 触发器：更新时同步
    CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE ON chunks BEGIN
      UPDATE chunks_fts SET content = new.content WHERE id = old.id;
    END;

    -- FTS5 触发器：删除时同步
    CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
      DELETE FROM chunks_fts WHERE id = old.id;
    END;
  `);

  // ========== 设置表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // ========== 查询日志表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS query_logs (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      response_time INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_query_logs_timestamp ON query_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_query_logs_created_at ON query_logs(created_at);
  `);

  // ========== 分类表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'folder',
      parent_id TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
    CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);
  `);

  // ========== 反馈表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      verdict TEXT NOT NULL CHECK(verdict IN ('up', 'down')),
      question TEXT,
      answer TEXT,
      metadata TEXT,
      timestamp TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_verdict ON feedback(verdict);
    CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON feedback(timestamp);
  `);

  // ========== 负样本学习表 ==========
  db.exec(`
    CREATE TABLE IF NOT EXISTS negative_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      document_id TEXT NOT NULL,
      feedback_count INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(query, document_id)
    );

    CREATE INDEX IF NOT EXISTS idx_negative_samples_query ON negative_samples(query);
    CREATE INDEX IF NOT EXISTS idx_negative_samples_document_id ON negative_samples(document_id);
  `);

  // 插入默认分类（如果不存在）
  const defaultCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (id, name, icon, parent_id)
    VALUES ('default', '默认分类', 'folder', NULL)
  `);
  defaultCategory.run();

  console.log('[db-schema] 数据库架构初始化完成');
}

/**
 * 创建或打开数据库
 * @param {string} dbPath - 数据库文件路径（可选）
 * @returns {Database} - better-sqlite3 数据库实例
 */
export function createDatabase(dbPath = DB_PATH) {
  const db = new Database(dbPath, {
    verbose: process.env.NODE_ENV === 'development' ? console.log : null
  });

  // 初始化架构
  initializeSchema(db);

  return db;
}

/**
 * 获取数据库统计信息
 * @param {Database} db - 数据库实例
 * @returns {Object} - 统计信息
 */
export function getDatabaseStats(db) {
  const stats = {
    documents: db.prepare('SELECT COUNT(*) as count FROM documents').get().count,
    chunks: db.prepare('SELECT COUNT(*) as count FROM chunks').get().count,
    categories: db.prepare('SELECT COUNT(*) as count FROM categories').get().count,
    queryLogs: db.prepare('SELECT COUNT(*) as count FROM query_logs').get().count,
    feedback: db.prepare('SELECT COUNT(*) as count FROM feedback').get().count,
    negativeSamples: db.prepare('SELECT COUNT(*) as count FROM negative_samples').get().count,
    dbSize: db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get().size
  };

  return stats;
}

/**
 * 优化数据库（VACUUM + ANALYZE）
 * @param {Database} db - 数据库实例
 */
export function optimizeDatabase(db) {
  console.log('[db-schema] 开始优化数据库...');
  db.exec('VACUUM');
  db.exec('ANALYZE');
  console.log('[db-schema] 数据库优化完成');
}

/**
 * 备份数据库
 * @param {Database} db - 数据库实例
 * @param {string} backupPath - 备份文件路径
 */
export function backupDatabase(db, backupPath) {
  return new Promise((resolve, reject) => {
    db.backup(backupPath)
      .then(() => {
        console.log(`[db-schema] 数据库备份完成: ${backupPath}`);
        resolve();
      })
      .catch(reject);
  });
}

export default {
  createDatabase,
  initializeSchema,
  getDatabaseStats,
  optimizeDatabase,
  backupDatabase,
  DB_PATH
};
