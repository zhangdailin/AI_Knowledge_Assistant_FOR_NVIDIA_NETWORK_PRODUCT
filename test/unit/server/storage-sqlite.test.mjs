/**
 * SQLite 存储模块单元测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as storage from '../../../server/storage-sqlite.mjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.join(__dirname, '../../data/knowledge-test.db');

describe('SQLite Storage Module', () => {
    beforeAll(async () => {
        // 使用测试数据库
        process.env.SQLITE_DB_PATH = TEST_DB_PATH;
        await storage.initStorage();
    });

    afterAll(() => {
        storage.closeDatabase();
    });

    describe('Documents', () => {
        it('should create and retrieve a document', async () => {
            const doc = await storage.createDocument({
                filename: 'test.md',
                fileType: 'text/markdown',
                fileSize: 1024,
                category: '默认分类',
                categoryId: 'default'
            });

            expect(doc.id).toBeDefined();
            expect(doc.filename).toBe('test.md');

            const retrieved = await storage.getDocument(doc.id);
            expect(retrieved).toBeTruthy();
            expect(retrieved.filename).toBe('test.md');
        });

        it('should update a document', async () => {
            const docs = await storage.getAllDocuments();
            const doc = docs[0];

            const updated = await storage.updateDocument(doc.id, {
                status: 'ready',
                chunkCount: 10
            });

            expect(updated.status).toBe('ready');
            expect(updated.chunkCount).toBe(10);
        });

        it('should list all documents', async () => {
            const docs = await storage.getAllDocuments();
            expect(Array.isArray(docs)).toBe(true);
            expect(docs.length).toBeGreaterThan(0);
        });
    });

    describe('Chunks', () => {
        let testDocId;

        beforeAll(async () => {
            const doc = await storage.createDocument({
                filename: 'chunking-test.md',
                fileType: 'text/markdown'
            });
            testDocId = doc.id;
        });

        it('should create chunks', async () => {
            const chunks = await storage.createChunks([
                { documentId: testDocId, content: 'Test chunk 1', sectionTitle: 'Section A' },
                { documentId: testDocId, content: 'Test chunk 2', sectionTitle: 'Section B' }
            ]);

            expect(chunks.length).toBe(2);
            expect(chunks[0].id).toBeDefined();
        });

        it('should get chunks by document', async () => {
            const chunks = await storage.getChunks(testDocId);
            expect(chunks.length).toBe(2);
        });

        it('should get chunk stats', async () => {
            const stats = await storage.getChunkStats(testDocId);
            expect(stats.total).toBe(2);
            expect(stats.normalCount).toBe(2);
        });

        it('should update chunk embedding', async () => {
            const chunks = await storage.getChunks(testDocId);
            const embedding = new Array(768).fill(0.1);

            const result = await storage.updateChunkEmbedding(chunks[0].id, embedding);
            expect(result).toBe(true);

            const updated = await storage.getChunk(testDocId, chunks[0].id);
            expect(updated.embedding).toBeTruthy();
            expect(updated.embedding.length).toBe(768);
        });
    });

    describe('FTS5 Search', () => {
        it('should search chunks by keyword', async () => {
            const results = await storage.searchChunks('Test chunk', 10);
            expect(results.length).toBeGreaterThan(0);
        });
    });

    describe('Settings', () => {
        it('should update and retrieve settings', async () => {
            await storage.updateSettings({
                testKey: { foo: 'bar' }
            });

            const settings = await storage.getSettings();
            expect(settings.testKey).toEqual({ foo: 'bar' });
        });
    });

    describe('Categories', () => {
        it('should get categories', async () => {
            const cats = await storage.getCategories();
            expect(cats.tree).toBeDefined();
            expect(Array.isArray(cats.tree)).toBe(true);
        });

        it('should add a category', async () => {
            const cat = await storage.addCategory(null, { name: 'Test Category' });
            expect(cat.id).toBeDefined();
            expect(cat.name).toBe('Test Category');
        });
    });

    describe('Feedback', () => {
        it('should add feedback entry', async () => {
            const entry = await storage.addFeedbackEntry({
                question: 'What is BGP?',
                answer: 'Border Gateway Protocol',
                verdict: 'up'
            });

            expect(entry.verdict).toBe('up');
        });

        it('should get feedback metrics', async () => {
            const metrics = await storage.getFeedbackMetrics();
            expect(metrics.total).toBeGreaterThan(0);
        });
    });

    describe('Query Logs', () => {
        it('should add query log', async () => {
            const log = await storage.addQueryLog('test query', 150);
            expect(log.query).toBe('test query');
        });

        it('should get query stats', async () => {
            const stats = await storage.getQueryStats();
            expect(stats.total).toBeGreaterThan(0);
        });
    });
});
