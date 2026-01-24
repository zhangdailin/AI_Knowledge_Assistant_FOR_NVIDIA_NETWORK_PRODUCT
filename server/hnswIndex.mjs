/**
 * HNSW 索引管理模块
 * 使用 hnswlib-node 实现高效向量近邻搜索
 * 将查询复杂度从 O(N) 降至 O(log N)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

// 动态导入 hnswlib-node (可能在某些环境不可用)
let HierarchicalNSW;
try {
    const hnswlib = await import('hnswlib-node');
    // ESM 模块需要从 default 导出获取
    HierarchicalNSW = hnswlib.default?.HierarchicalNSW || hnswlib.HierarchicalNSW;
    if (!HierarchicalNSW) {
        console.warn('[HnswIndex] hnswlib-node 模块结构异常，HierarchicalNSW 未找到');
    }
} catch (e) {
    console.warn('[HnswIndex] hnswlib-node 不可用，将使用线性扫描回退:', e.message);
    HierarchicalNSW = null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');

// 默认配置
const DEFAULT_CONFIG = {
    dimensions: 1024,           // BGE-M3 embedding 维度
    maxElements: 100000,        // 最大元素数量
    efConstruction: 200,        // 构建时的 ef 参数 (越大精度越高，构建越慢)
    M: 16,                      // 每层连接数 (越大精度越高，内存越大)
    efSearch: 100,              // 搜索时的 ef 参数 (越大精度越高，搜索越慢)
    autoSaveInterval: 60000,    // 自动保存间隔 (ms)
    dataDir: DEFAULT_DATA_DIR
};

// 索引文件路径
const HNSW_INDEX_FILE = 'hnsw_index.bin';
const HNSW_MAPPING_FILE = 'hnsw_mapping.json';
const DB_PATH = path.join(DEFAULT_DATA_DIR, 'knowledge.db');

let mappingDb = null;

function getMappingDb() {
    if (!mappingDb) {
        mappingDb = new Database(DB_PATH);
        mappingDb.pragma('journal_mode = WAL');
        mappingDb.pragma('foreign_keys = ON');
    }
    return mappingDb;
}

function ensureMappingTable(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS hnsw_mapping (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT
    );
  `);
}

async function loadMappingFromDb() {
    try {
        const db = getMappingDb();
        ensureMappingTable(db);
        const row = db.prepare('SELECT payload FROM hnsw_mapping WHERE id = 1').get();
        if (!row?.payload) return null;
        return JSON.parse(row.payload);
    } catch (error) {
        console.warn('[HnswIndex] SQLite 映射读取失败:', error.message);
        return null;
    }
}

async function saveMappingToDb(mappingData) {
    try {
        const db = getMappingDb();
        ensureMappingTable(db);
        db.prepare(`
      INSERT INTO hnsw_mapping (id, payload, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(JSON.stringify(mappingData), new Date().toISOString());
        return true;
    } catch (error) {
        console.warn('[HnswIndex] SQLite 映射保存失败:', error.message);
        return false;
    }
}

/**
 * HNSW 索引管理类
 */
class HnswIndex {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.index = null;
        this.idToLabel = new Map();     // chunk ID -> 索引 label
        this.labelToId = new Map();     // 索引 label -> chunk ID
        this.nextLabel = 0;
        this.isInitialized = false;
        this.isDirty = false;           // 是否有未保存的更改
        this.autoSaveTimer = null;
        this.pendingOperations = Promise.resolve();
    }

    applyMappingData(mappingData) {
        this.idToLabel = new Map(
            Object.entries(mappingData.idToLabel || {}).map(([k, v]) => [k, Number(v)])
        );
        this.labelToId = new Map(
            Object.entries(mappingData.labelToId || {}).map(([k, v]) => [parseInt(k, 10), v])
        );
        this.nextLabel = Number(mappingData.nextLabel) || 0;
    }

    /**
     * 初始化索引 (加载或创建)
     */
    async initialize() {
        if (this.isInitialized) return true;
        if (!HierarchicalNSW) {
            console.warn('[HnswIndex] hnswlib-node 不可用，跳过初始化');
            return false;
        }

        try {
            await fs.mkdir(this.config.dataDir, { recursive: true });

            const indexPath = path.join(this.config.dataDir, HNSW_INDEX_FILE);
            const mappingPath = path.join(this.config.dataDir, HNSW_MAPPING_FILE);

            // 创建索引实例
            this.index = new HierarchicalNSW('cosine', this.config.dimensions);

            // 尝试加载现有索引
            try {
                await fs.access(indexPath);

                // 加载索引
                this.index.readIndexSync(indexPath);

                // 加载映射（优先 SQLite，兼容旧文件）
                let mappingData = await loadMappingFromDb();
                if (!mappingData) {
                    try {
                        await fs.access(mappingPath);
                        mappingData = JSON.parse(await fs.readFile(mappingPath, 'utf-8'));
                        await saveMappingToDb(mappingData);
                        console.log('[HnswIndex] 已从 hnsw_mapping.json 迁移映射到 SQLite');
                    } catch (mappingError) {
                        // 继续回退
                    }
                }

                if (mappingData) {
                    this.applyMappingData(mappingData);
                    console.log(`[HnswIndex] 索引加载成功，包含 ${this.idToLabel.size} 个向量`);
                } else {
                    console.warn('[HnswIndex] 映射缺失，重建索引映射');
                    this.index.initIndex(this.config.maxElements, this.config.M, this.config.efConstruction);
                    this.idToLabel.clear();
                    this.labelToId.clear();
                    this.nextLabel = 0;
                    await saveMappingToDb({ idToLabel: {}, labelToId: {}, nextLabel: 0 });
                }
            } catch (loadError) {
                // 索引不存在或损坏，创建新索引
                console.log('[HnswIndex] 创建新索引...');
                this.index.initIndex(this.config.maxElements, this.config.M, this.config.efConstruction);
                this.idToLabel.clear();
                this.labelToId.clear();
                this.nextLabel = 0;
                await saveMappingToDb({ idToLabel: {}, labelToId: {}, nextLabel: 0 });
            }

            // 设置搜索参数
            this.index.setEf(this.config.efSearch);

            this.isInitialized = true;
            this.startAutoSave();

            console.log('[HnswIndex] 初始化完成');
            return true;
        } catch (error) {
            console.error('[HnswIndex] 初始化失败:', error);
            this.index = null;
            return false;
        }
    }

    /**
     * 检查索引是否就绪
     */
    isReady() {
        return this.isInitialized && this.index !== null;
    }

    /**
     * 获取索引中的向量数量
     */
    getSize() {
        return this.idToLabel.size;
    }

    /**
     * 添加单个向量
     * @param {string} id - chunk ID
     * @param {number[]} vector - 嵌入向量
     */
    async addVector(id, vector) {
        if (!this.isReady()) {
            throw new Error('索引未初始化');
        }

        if (!Array.isArray(vector) || vector.length !== this.config.dimensions) {
            console.warn(`[HnswIndex] 跳过无效向量: id=${id}, dim=${vector?.length}`);
            return false;
        }

        // 序列化操作以避免并发问题
        this.pendingOperations = this.pendingOperations.then(async () => {
            try {
                // 如果已存在，先删除旧的
                if (this.idToLabel.has(id)) {
                    const oldLabel = this.idToLabel.get(id);
                    this.index.markDelete(oldLabel);
                    this.labelToId.delete(oldLabel);
                }

                // 添加新向量
                const label = this.nextLabel++;
                this.index.addPoint(vector, label);
                this.idToLabel.set(id, label);
                this.labelToId.set(label, id);
                this.isDirty = true;

                return true;
            } catch (error) {
                console.error(`[HnswIndex] 添加向量失败: id=${id}`, error);
                return false;
            }
        });

        return this.pendingOperations;
    }

    /**
     * 批量添加向量
     * @param {Array<{id: string, vector: number[]}>} items
     */
    async addVectors(items) {
        if (!this.isReady()) {
            throw new Error('索引未初始化');
        }

        let added = 0;
        let skipped = 0;

        for (const { id, vector } of items) {
            if (!Array.isArray(vector) || vector.length !== this.config.dimensions) {
                skipped++;
                continue;
            }

            const result = await this.addVector(id, vector);
            if (result) added++;
        }

        console.log(`[HnswIndex] 批量添加: 成功=${added}, 跳过=${skipped}`);
        return { added, skipped };
    }

    /**
     * 删除向量
     * @param {string} id - chunk ID
     */
    async removeVector(id) {
        if (!this.isReady()) return false;

        this.pendingOperations = this.pendingOperations.then(async () => {
            try {
                if (!this.idToLabel.has(id)) {
                    return false;
                }

                const label = this.idToLabel.get(id);
                this.index.markDelete(label);
                this.idToLabel.delete(id);
                this.labelToId.delete(label);
                this.isDirty = true;

                return true;
            } catch (error) {
                console.error(`[HnswIndex] 删除向量失败: id=${id}`, error);
                return false;
            }
        });

        return this.pendingOperations;
    }

    /**
     * 批量删除向量
     * @param {string[]} ids - chunk ID 列表
     */
    async removeVectors(ids) {
        if (!this.isReady()) return 0;

        let removed = 0;
        for (const id of ids) {
            if (await this.removeVector(id)) {
                removed++;
            }
        }

        console.log(`[HnswIndex] 批量删除: ${removed}/${ids.length}`);
        return removed;
    }

    /**
     * K-近邻搜索
     * @param {number[]} queryVector - 查询向量
     * @param {number} k - 返回的近邻数量
     * @returns {Array<{id: string, distance: number, score: number}>}
     */
    async search(queryVector, k = 10) {
        if (!this.isReady()) {
            throw new Error('索引未初始化');
        }

        if (!Array.isArray(queryVector) || queryVector.length !== this.config.dimensions) {
            throw new Error(`查询向量维度不匹配: 期望 ${this.config.dimensions}, 实际 ${queryVector?.length}`);
        }

        const currentCount = this.idToLabel.size;
        if (currentCount === 0) {
            return [];
        }

        // 调整 k 以不超过索引大小
        const effectiveK = Math.min(k, currentCount);

        try {
            const result = this.index.searchKnn(queryVector, effectiveK);

            const results = [];
            for (let i = 0; i < result.neighbors.length; i++) {
                const label = result.neighbors[i];
                const distance = result.distances[i];
                const id = this.labelToId.get(label);

                if (id) {
                    // 余弦距离转相似度 (hnswlib 使用 1 - cosine_similarity)
                    const score = 1 - distance;
                    results.push({ id, distance, score });
                }
            }

            return results;
        } catch (error) {
            console.error('[HnswIndex] 搜索失败:', error);
            throw error;
        }
    }

    /**
     * 保存索引到磁盘
     */
    async save() {
        if (!this.isReady() || !this.isDirty) return false;

        try {
            const indexPath = path.join(this.config.dataDir, HNSW_INDEX_FILE);

            // 保存索引
            this.index.writeIndexSync(indexPath);

            // 保存映射
            const mappingData = {
                idToLabel: Object.fromEntries(this.idToLabel),
                labelToId: Object.fromEntries(this.labelToId),
                nextLabel: this.nextLabel,
                savedAt: new Date().toISOString()
            };
            await saveMappingToDb(mappingData);

            this.isDirty = false;
            console.log(`[HnswIndex] 索引已保存，包含 ${this.idToLabel.size} 个向量`);
            return true;
        } catch (error) {
            console.error('[HnswIndex] 保存失败:', error);
            return false;
        }
    }

    /**
     * 启动自动保存定时器
     */
    startAutoSave() {
        if (this.autoSaveTimer) return;

        this.autoSaveTimer = setInterval(async () => {
            if (this.isDirty) {
                await this.save();
            }
        }, this.config.autoSaveInterval);

        // 防止定时器阻止进程退出
        this.autoSaveTimer.unref?.();
    }

    /**
     * 停止自动保存并保存最终状态
     */
    async shutdown() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }

        await this.save();
    }

    /**
     * 获取索引统计信息
     */
    getStats() {
        return {
            isReady: this.isReady(),
            vectorCount: this.idToLabel.size,
            dimensions: this.config.dimensions,
            maxElements: this.config.maxElements,
            isDirty: this.isDirty
        };
    }

    /**
     * 重建索引 (从头开始)
     * @param {Array<{id: string, vector: number[]}>} items - 所有向量
     */
    async rebuild(items) {
        if (!HierarchicalNSW) {
            console.warn('[HnswIndex] hnswlib-node 不可用，无法重建索引');
            return false;
        }

        console.log(`[HnswIndex] 开始重建索引，共 ${items.length} 个向量...`);
        const startTime = Date.now();

        try {
            // 创建新索引
            this.index = new HierarchicalNSW('cosine', this.config.dimensions);
            this.index.initIndex(this.config.maxElements, this.config.M, this.config.efConstruction);
            this.index.setEf(this.config.efSearch);

            // 清空映射
            this.idToLabel.clear();
            this.labelToId.clear();
            this.nextLabel = 0;

            // 批量添加
            let added = 0;
            for (const { id, vector } of items) {
                if (Array.isArray(vector) && vector.length === this.config.dimensions) {
                    const label = this.nextLabel++;
                    this.index.addPoint(vector, label);
                    this.idToLabel.set(id, label);
                    this.labelToId.set(label, id);
                    added++;
                }
            }

            this.isDirty = true;
            this.isInitialized = true;
            await this.save();

            const elapsed = Date.now() - startTime;
            console.log(`[HnswIndex] 索引重建完成: ${added} 个向量, 耗时 ${elapsed}ms`);
            return true;
        } catch (error) {
            console.error('[HnswIndex] 索引重建失败:', error);
            return false;
        }
    }

    /**
     * 检查是否需要重建索引 (向量数量与存储不一致)
     * @param {number} expectedCount - 预期的向量数量
     */
    needsRebuild(expectedCount) {
        if (!this.isReady()) return true;
        const currentCount = this.idToLabel.size;
        // 如果差异超过 10%，需要重建
        const diff = Math.abs(currentCount - expectedCount);
        return diff > expectedCount * 0.1;
    }
}

// 导出单例实例
export const hnswIndex = new HnswIndex();

// 导出类用于测试
export { HnswIndex };
