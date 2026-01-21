/**
 * 存储适配器 - 使用 SQLite 后端
 * 已移除 JSON 存储支持，统一使用 SQLite
 */

import * as storage from './storage-sqlite.mjs';

console.log('[Storage] 使用 SQLite 存储后端');

// 导出所有存储接口
export const initStorage = storage.initStorage;
export const getAllDocuments = storage.getAllDocuments;
export const getDocument = storage.getDocument;
export const createDocument = storage.createDocument;
export const updateDocument = storage.updateDocument;
export const deleteDocument = storage.deleteDocument;

export const getAllChunks = storage.getAllChunks;
export const getChunks = storage.getChunks;
export const getChunk = storage.getChunk;
export const getChunkStats = storage.getChunkStats;
export const createChunks = storage.createChunks;
export const deleteChunksByDocument = storage.deleteChunksByDocument;
export const updateChunkEmbedding = storage.updateChunkEmbedding;
export const updateChunkEmbeddings = storage.updateChunkEmbeddings;

export const searchChunks = storage.searchChunks;
export const vectorSearchChunks = storage.vectorSearchChunks;
export const findChunksByPattern = storage.findChunksByPattern;
export const scanChunks = storage.scanChunks;

export const getSettings = storage.getSettings;
export const updateSettings = storage.updateSettings;
export const getApiKey = storage.getApiKey;

export const addQueryLog = storage.addQueryLog;
export const getQueryStats = storage.getQueryStats;

export const addFeedbackEntry = storage.addFeedbackEntry;
export const getFeedbackMetrics = storage.getFeedbackMetrics;
export const getAllFeedback = storage.getAllFeedback;

export const getNegativePenalty = storage.getNegativePenalty;

export const getCategories = storage.getCategories;
export const saveCategories = storage.saveCategories;
export const addCategory = storage.addCategory;
export const updateCategory = storage.updateCategory;
export const deleteCategory = storage.deleteCategory;
export const getCategoryAndChildrenIds = storage.getCategoryAndChildrenIds;

export const setSearchCacheInvalidator = storage.setSearchCacheInvalidator;
export const reloadCacheConfig = storage.reloadCacheConfig;

export const closeDatabase = storage.closeDatabase;

// 导出当前使用的后端类型
export const STORAGE_BACKEND = 'sqlite';
