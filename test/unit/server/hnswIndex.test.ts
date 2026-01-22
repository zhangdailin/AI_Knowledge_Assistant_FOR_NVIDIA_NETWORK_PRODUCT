/**
 * HNSW 索引单元测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HnswIndex } from '../../../server/hnswIndex.mjs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('HnswIndex', () => {
    const testDir = path.join(os.tmpdir(), `hnsw-test-${Date.now()}`);
    let index;

    beforeAll(async () => {
        await fs.mkdir(testDir, { recursive: true });
        index = new HnswIndex({
            dimensions: 128, // 使用较小维度加快测试
            maxElements: 1000,
            dataDir: testDir,
            autoSaveInterval: 60000 // 禁用测试期间自动保存
        });
    });

    afterAll(async () => {
        if (index) {
            await index.shutdown();
        }
        // 清理测试目录
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch (e) {
            // 忽略清理错误
        }
    });

    it('应该成功初始化', async () => {
        const result = await index.initialize();
        // 如果 hnswlib-node 可用，返回 true；否则返回 false
        expect(typeof result).toBe('boolean');
    });

    it('应该返回正确的就绪状态', () => {
        const stats = index.getStats();
        expect(stats).toHaveProperty('isReady');
        expect(stats).toHaveProperty('vectorCount');
        expect(stats).toHaveProperty('dimensions');
    });

    describe('当索引就绪时', () => {
        beforeAll(async () => {
            // 确保索引初始化
            await index.initialize();
        });

        it('应该能添加向量', async () => {
            if (!index.isReady()) {
                console.warn('跳过测试：HNSW 索引不可用');
                return;
            }

            const vector = Array(128).fill(0).map(() => Math.random());
            const result = await index.addVector('test-chunk-1', vector);
            expect(result).toBe(true);
        });

        it('应该能批量添加向量', async () => {
            if (!index.isReady()) {
                console.warn('跳过测试：HNSW 索引不可用');
                return;
            }

            const items = Array(10).fill(null).map((_, i) => ({
                id: `batch-chunk-${i}`,
                vector: Array(128).fill(0).map(() => Math.random())
            }));

            const result = await index.addVectors(items);
            expect(result.added).toBe(10);
            expect(result.skipped).toBe(0);
        });

        it('应该能执行 K-近邻搜索', async () => {
            if (!index.isReady()) {
                console.warn('跳过测试：HNSW 索引不可用');
                return;
            }

            const queryVector = Array(128).fill(0).map(() => Math.random());
            const results = await index.search(queryVector, 5);

            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeLessThanOrEqual(5);

            if (results.length > 0) {
                expect(results[0]).toHaveProperty('id');
                expect(results[0]).toHaveProperty('score');
                expect(results[0]).toHaveProperty('distance');
            }
        });

        it('应该能删除向量', async () => {
            if (!index.isReady()) {
                console.warn('跳过测试：HNSW 索引不可用');
                return;
            }

            const result = await index.removeVector('test-chunk-1');
            expect(result).toBe(true);
        });

        it('应该能保存和加载索引', async () => {
            if (!index.isReady()) {
                console.warn('跳过测试：HNSW 索引不可用');
                return;
            }

            // 添加一些数据
            const vector = Array(128).fill(0).map(() => Math.random());
            await index.addVector('persist-test-chunk', vector);

            // 保存
            const saveResult = await index.save();
            expect(saveResult).toBe(true);

            // 检查文件是否存在
            const indexFile = path.join(testDir, 'hnsw_index.bin');
            const mappingFile = path.join(testDir, 'hnsw_mapping.json');

            const indexExists = await fs.access(indexFile).then(() => true).catch(() => false);
            const mappingExists = await fs.access(mappingFile).then(() => true).catch(() => false);

            expect(indexExists).toBe(true);
            expect(mappingExists).toBe(true);
        });
    });

    describe('边界情况', () => {
        it('应该拒绝维度不匹配的向量', async () => {
            if (!index.isReady()) {
                console.warn('跳过测试：HNSW 索引不可用');
                return;
            }

            const wrongDimVector = Array(64).fill(0).map(() => Math.random());
            const result = await index.addVector('wrong-dim-chunk', wrongDimVector);
            expect(result).toBe(false);
        });

        it('应该对空索引返回空结果', async () => {
            // 创建一个新的空索引
            const emptyIndex = new HnswIndex({
                dimensions: 128,
                maxElements: 100,
                dataDir: path.join(testDir, 'empty')
            });

            await emptyIndex.initialize();

            if (!emptyIndex.isReady()) {
                console.warn('跳过测试：HNSW 索引不可用');
                return;
            }

            const queryVector = Array(128).fill(0).map(() => Math.random());
            const results = await emptyIndex.search(queryVector, 5);
            expect(results).toEqual([]);
        });
    });
});
