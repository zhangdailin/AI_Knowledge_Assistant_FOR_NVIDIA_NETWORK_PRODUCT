/**
 * 服务器端存储管理器 (V2 - 分文件存储版)
 * 使用文件系统存储文档和 chunks 数据，实现多用户共享
 * 解决 OOM 问题：将 chunks 按文档 ID 分散存储
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据存储目录
const DATA_DIR = path.join(__dirname, '..', 'data');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');
const OLD_CHUNKS_FILE = path.join(DATA_DIR, 'chunks.json');

// 初始化标记
let isInitialized = false;

async function initStorage() {
  if (isInitialized) return;
  await ensureDataDir();
  await migrateChunks();
  isInitialized = true;
}

async function ensureDataDir() {
  try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR, { recursive: true }); }
  try { await fs.access(CHUNKS_DIR); } catch { await fs.mkdir(CHUNKS_DIR, { recursive: true }); }
}

async function migrateChunks() {
  try {
    await fs.access(OLD_CHUNKS_FILE);
    const files = await fs.readdir(CHUNKS_DIR);
    if (files.length > 0) return; // 已迁移，跳过

    console.log('[storage] 正在迁移旧的 chunks.json 到分文件存储...');
    try {
        const data = await fs.readFile(OLD_CHUNKS_FILE, 'utf-8');
        const chunks = JSON.parse(data);
        
        const chunksByDoc = {};
        for (const chunk of chunks) {
            if (!chunksByDoc[chunk.documentId]) chunksByDoc[chunk.documentId] = [];
            chunksByDoc[chunk.documentId].push(chunk);
        }
        
        for (const [docId, docChunks] of Object.entries(chunksByDoc)) {
            await writeJSON(path.join(CHUNKS_DIR, `${docId}.json`), docChunks);
        }
        
        await fs.rename(OLD_CHUNKS_FILE, `${OLD_CHUNKS_FILE}.migrated`);
        console.log('[storage] 迁移完成');
    } catch (e) {
        console.error('[storage] 迁移失败 (可能是文件过大或损坏):', e);
        await fs.rename(OLD_CHUNKS_FILE, `${OLD_CHUNKS_FILE}.failed`);
    }
  } catch {
    // 旧文件不存在，无需迁移
  }
}

// 读取 JSON 文件
async function readJSON(filePath, defaultValue = []) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return defaultValue;
    console.error(`[storage] 读取文件失败: ${filePath}`, error);
    return defaultValue;
  }
}

// 写入 JSON 文件 (原子写入)
async function writeJSON(filePath, data) {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try { await fs.unlink(tempPath); } catch {}
    throw error;
  }
}

// 文档管理
export async function getAllDocuments() {
  await initStorage();
  return await readJSON(DOCUMENTS_FILE, []);
}

export async function getDocument(documentId) {
  const documents = await getAllDocuments();
  return documents.find(d => d.id === documentId) || null;
}

export async function createDocument(documentData) {
  const documents = await getAllDocuments();
  const newDocument = {
    userId: documentData.userId || 'shared',
    ...documentData,
    id: documentData.id || `doc-${Date.now()}`,
    uploadedAt: documentData.uploadedAt || new Date().toISOString()
  };
  documents.push(newDocument);
  await writeJSON(DOCUMENTS_FILE, documents);
  return newDocument;
}

export async function updateDocument(documentId, updates) {
  const documents = await getAllDocuments();
  const index = documents.findIndex(d => d.id === documentId);
  if (index === -1) return null;
  documents[index] = { ...documents[index], ...updates };
  await writeJSON(DOCUMENTS_FILE, documents);
  return documents[index];
}

export async function deleteDocument(documentId) {
  try {
    const documents = await getAllDocuments();
    const filtered = documents.filter(d => d.id !== documentId);
    await writeJSON(DOCUMENTS_FILE, filtered);
    
    // 删除 chunks 文件
    try {
        await fs.unlink(path.join(CHUNKS_DIR, `${documentId}.json`));
    } catch {}
    
    return filtered.length < documents.length;
  } catch (error) {
    console.error(`[storage] 删除文档失败:`, error);
    throw error;
  }
}

// Chunks 管理

export async function getAllChunks() {
  // 警告：可能 OOM
  await initStorage();
  const files = await fs.readdir(CHUNKS_DIR);
  const all = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const chunks = await readJSON(path.join(CHUNKS_DIR, file), []);
    all.push(...chunks);
  }
  return all;
}

export async function getChunks(documentId) {
  await initStorage();
  return await readJSON(path.join(CHUNKS_DIR, `${documentId}.json`), []);
}

export async function createChunks(chunksData) {
  await initStorage();
  if (chunksData.length === 0) return [];

  const byDoc = {};
  chunksData.forEach(c => {
      if(!byDoc[c.documentId]) byDoc[c.documentId] = [];
      byDoc[c.documentId].push(c);
  });
  
  const result = [];
  
  for (const [docId, chunks] of Object.entries(byDoc)) {
      const filePath = path.join(CHUNKS_DIR, `${docId}.json`);
      const release = await acquireWriteLock(filePath);
      try {
          const existing = await readJSON(filePath, []);
          const newChunks = chunks.map((c, i) => ({
              ...c,
              id: c.id || `chunk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`,
              createdAt: c.createdAt || new Date().toISOString()
          }));
          existing.push(...newChunks);
          await writeJSON(filePath, existing);
          result.push(...newChunks);
      } finally {
          release();
      }
  }
  return result;
}

// 写入锁队列
const writeQueueLocks = new Map();
async function acquireWriteLock(filePath) {
  if (!writeQueueLocks.has(filePath)) writeQueueLocks.set(filePath, Promise.resolve());
  const currentLock = writeQueueLocks.get(filePath);
  let releaseLock;
  const nextLock = currentLock.then(() => new Promise(resolve => releaseLock = resolve));
  writeQueueLocks.set(filePath, nextLock);
  await currentLock;
  return () => releaseLock && releaseLock();
}

export async function updateChunkEmbedding(chunkId, embedding) {
  await initStorage();
  // 遍历查找（性能较差，但为了兼容性）
  const files = await fs.readdir(CHUNKS_DIR);
  for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(CHUNKS_DIR, file);
      const chunks = await readJSON(filePath, []);
      const index = chunks.findIndex(c => c.id === chunkId);
      if (index !== -1) {
          const release = await acquireWriteLock(filePath);
          try {
              // 重新读取以防并发
              const currentChunks = await readJSON(filePath, []);
              const currentIndex = currentChunks.findIndex(c => c.id === chunkId);
              if (currentIndex !== -1) {
                  currentChunks[currentIndex] = { ...currentChunks[currentIndex], embedding };
                  await writeJSON(filePath, currentChunks);
                  return true;
              }
          } finally {
              release();
          }
      }
  }
  return false;
}

// 批量更新 chunks 的 embedding
// 增加 documentId 参数以优化性能
export async function updateChunkEmbeddings(updates, documentId) {
  await initStorage();
  if (!updates || updates.length === 0) return { success: 0, failed: 0 };
  
  // 如果提供了 documentId，直接去该文件更新
  if (documentId) {
      const filePath = path.join(CHUNKS_DIR, `${documentId}.json`);
      const release = await acquireWriteLock(filePath);
      try {
          const chunks = await readJSON(filePath, []);
          const updateMap = new Map(updates.map(u => [u.chunkId, u.embedding]));
          let updated = 0;
          
          for (let i = 0; i < chunks.length; i++) {
              if (updateMap.has(chunks[i].id)) {
                  chunks[i] = { ...chunks[i], embedding: updateMap.get(chunks[i].id) };
                  updated++;
              }
          }
          
          if (updated > 0) {
              await writeJSON(filePath, chunks);
          }
          return { success: updated, failed: updates.length - updated };
      } catch (e) {
          console.error('[storage] 批量更新失败:', e);
          return { success: 0, failed: updates.length };
      } finally {
          release();
      }
  } else {
      // 没有 documentId，退化为逐个更新（或者按文件分组）
      // 这里简化处理：逐个调用 updateChunkEmbedding
      let success = 0;
      for (const update of updates) {
          if (await updateChunkEmbedding(update.chunkId, update.embedding)) {
              success++;
          }
      }
      return { success, failed: updates.length - success };
  }
}

export async function deleteChunksByDocument(documentId) {
    try {
        const filePath = path.join(CHUNKS_DIR, `${documentId}.json`);
        await fs.unlink(filePath);
        return 1;
    } catch {
        return 0;
    }
}

export async function searchChunks(query, limit = 30) {
  await initStorage();
  const files = await fs.readdir(CHUNKS_DIR);
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  
  const results = [];
  
  // 逐个文件处理，避免 OOM
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const chunks = await readJSON(path.join(CHUNKS_DIR, file), []);
    
    for (const chunk of chunks) {
      const contentLower = chunk.content.toLowerCase();
      let score = 0;
      if (contentLower.includes(queryLower)) score += 10;
      queryWords.forEach(word => {
        if (contentLower.includes(word)) score += 1;
      });
      
      if (score > 0) {
        results.push({ chunk, score });
      }
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, limit).map(r => r.chunk);
}

// 设置管理
export async function getSettings() {
  await initStorage();
  return await readJSON(SETTINGS_FILE, {});
}

export async function updateSettings(updates) {
  await initStorage();
  const settings = await getSettings();
  const updated = { ...settings, ...updates };
  await writeJSON(SETTINGS_FILE, updated);
  return updated;
}

export async function getApiKey(provider) {
  const settings = await getSettings();
  const envKeyName = `${provider.toUpperCase()}_API_KEY`;
  return settings.apiKeys?.[provider] || process.env[envKeyName] || process.env[`VITE_${envKeyName}`] || null;
}
