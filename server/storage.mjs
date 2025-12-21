/**
 * 服务器端存储管理器
 * 使用文件系统存储文档和 chunks 数据，实现多用户共享
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据存储目录
const DATA_DIR = path.join(__dirname, '..', 'data');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json');
const CHUNKS_FILE = path.join(DATA_DIR, 'chunks.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// 确保数据目录存在
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

// 读取 JSON 文件
async function readJSON(filePath, defaultValue = []) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    // 尝试解析 JSON
    try {
      return JSON.parse(data);
    } catch (parseError) {
      // JSON 解析失败，可能是文件损坏
      console.error(`[storage] JSON 解析失败: ${filePath}`, parseError.message);
      console.error(`[storage] 文件大小: ${data.length} 字符，位置: ${parseError.message.match(/position (\d+)/)?.[1] || 'unknown'}`);
      
      // 尝试修复：查找最后一个完整的 JSON 对象
      try {
        // 如果是数组，尝试找到最后一个完整的元素
        if (data.trim().startsWith('[')) {
          console.log(`[storage] 尝试修复数组格式的 JSON 文件`);
          let lastValidIndex = -1;
          let braceCount = 0;
          let bracketCount = 0; // 数组括号计数
          let inString = false;
          let escapeNext = false;
          let lastCommaIndex = -1;
          
          for (let i = 0; i < data.length; i++) {
            const char = data[i];
            
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            
            if (char === '\\') {
              escapeNext = true;
              continue;
            }
            
            if (char === '"') {
              inString = !inString;
              continue;
            }
            
            if (inString) continue;
            
            if (char === '{') {
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0 && bracketCount === 1) {
                // 找到一个完整的对象（在数组的第一层）
                lastValidIndex = i;
              }
            } else if (char === '[') {
              bracketCount++;
            } else if (char === ']') {
              bracketCount--;
              if (bracketCount === 0) {
                // 数组结束
                if (lastValidIndex > 0) {
                  // 找到了最后一个完整的对象
                  break;
                } else {
                  // 数组提前结束，可能损坏
                  break;
                }
              }
            } else if (char === ',' && braceCount === 0 && bracketCount === 1) {
              // 在数组的第一层，对象之间的逗号
              lastCommaIndex = i;
            }
          }
          
          if (lastValidIndex > 0) {
            // 找到最后一个完整对象的位置，截取到该位置
            let repairedData = data.substring(0, lastValidIndex + 1);
            // 移除最后一个逗号（如果有）
            repairedData = repairedData.replace(/,\s*$/, '');
            // 添加数组结束符
            repairedData += '\n]';
            
            try {
              const repaired = JSON.parse(repairedData);
              console.warn(`[storage] 已修复 JSON 文件，保留了 ${repaired.length} 个元素`);
              // 保存修复后的文件（使用原子写入）
              const tempPath = `${filePath}.tmp.${Date.now()}`;
              await fs.writeFile(tempPath, JSON.stringify(repaired, null, 2), 'utf-8');
              try {
                await fs.rename(tempPath, filePath);
              } catch {
                await fs.unlink(filePath).catch(() => {});
                await fs.rename(tempPath, filePath);
              }
              return repaired;
            } catch (reparseError) {
              console.error(`[storage] 修复后的数据仍然无法解析:`, reparseError.message);
              // 继续执行备份逻辑
            }
          } else {
            console.warn(`[storage] 无法找到最后一个完整的 JSON 对象`);
          }
        }
      } catch (repairError) {
        console.error(`[storage] 修复 JSON 文件失败:`, repairError);
      }
      
      // 如果修复失败，备份损坏的文件并返回默认值
      const backupPath = `${filePath}.backup.${Date.now()}`;
      await fs.copyFile(filePath, backupPath).catch(() => {});
      console.warn(`[storage] 已备份损坏的文件到: ${backupPath}`);
      console.warn(`[storage] 使用默认值: ${JSON.stringify(defaultValue).substring(0, 100)}...`);
      return defaultValue;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`[storage] 文件不存在，使用默认值: ${filePath}`);
      return defaultValue;
    }
    // 对于其他读取错误（如权限问题），记录详细错误信息
    console.error(`[storage] 读取文件失败: ${filePath}`, error);
    console.error(`[storage] 错误代码: ${error.code}, 错误消息: ${error.message}`);
    // 对于读取错误，也返回默认值而不是抛出错误，确保系统可以继续运行
    console.warn(`[storage] 使用默认值继续运行: ${filePath}`);
    return defaultValue;
  }
}

// 写入 JSON 文件
// 原子写入 JSON 文件（先写入临时文件，然后重命名，避免写入中断导致文件损坏）
async function writeJSON(filePath, data) {
  try {
    await ensureDataDir();
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    console.log(`[storage] 写入 JSON 文件: ${filePath}, 数据大小: ${JSON.stringify(data).length} 字符`);
    
    try {
      // 先写入临时文件
      const jsonString = JSON.stringify(data, null, 2);
      await fs.writeFile(tempPath, jsonString, 'utf-8');
      console.log(`[storage] 临时文件已写入: ${tempPath}`);
      
      // 然后原子性地重命名（在 Windows 上可能需要先删除目标文件）
      // 使用重试机制处理 Windows 文件锁定问题
      let renameSuccess = false;
      let lastError = null;
      const maxRetries = 5;
      
      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          await fs.rename(tempPath, filePath);
          console.log(`[storage] 文件已重命名: ${filePath}${retry > 0 ? ` (重试 ${retry} 次后成功)` : ''}`);
          renameSuccess = true;
          break;
        } catch (renameError) {
          lastError = renameError;
          // #region agent log
          console.log(`[storage] [RETRY] 重命名失败 (尝试 ${retry + 1}/${maxRetries}):`, renameError.code, renameError.message);
          // #endregion
          
          // 如果重命名失败（可能是 Windows 的限制），先删除目标文件再重命名
          if (renameError.code === 'EPERM' || renameError.code === 'EACCES') {
            // 等待一小段时间，让其他操作完成
            if (retry < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, 100 * (retry + 1))); // 递增等待时间
            }
            
            try {
              await fs.unlink(filePath);
              console.log(`[storage] 已删除旧文件: ${filePath}`);
            } catch (unlinkError) {
              // #region agent log
              console.log(`[storage] [RETRY] 删除旧文件失败:`, unlinkError.code, unlinkError.message);
              // #endregion
              // 如果删除也失败，可能是文件正在被使用，等待后重试
              if (retry < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 200 * (retry + 1)));
                continue; // 跳过重命名，直接重试
              }
            }
            
            // 如果还有重试机会，继续循环
            if (retry < maxRetries - 1) {
              continue;
            }
          } else {
            // 其他错误，不重试
            throw renameError;
          }
        }
      }
      
      if (!renameSuccess && lastError) {
        throw lastError;
      }
    } catch (error) {
      console.error(`[storage] 写入 JSON 文件失败: ${filePath}`, error);
      // 如果写入失败，尝试清理临时文件
      try {
        await fs.unlink(tempPath);
        console.log(`[storage] 已清理临时文件: ${tempPath}`);
      } catch (cleanupError) {
        console.warn(`[storage] 清理临时文件失败（忽略）:`, cleanupError);
        // 忽略清理错误
      }
      throw error;
    }
  } catch (error) {
    console.error(`[storage] writeJSON 最终失败: ${filePath}`, error);
    throw error;
  }
}

// 文档管理
export async function getAllDocuments() {
  return await readJSON(DOCUMENTS_FILE, []);
}

export async function getDocument(documentId) {
  const documents = await getAllDocuments();
  return documents.find(d => d.id === documentId) || null;
}

export async function createDocument(documentData) {
  const documents = await getAllDocuments();
  const newDocument = {
    userId: documentData.userId || 'shared', // 默认使用共享用户ID
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
  if (index === -1) {
    return null;
  }
  documents[index] = { ...documents[index], ...updates };
  await writeJSON(DOCUMENTS_FILE, documents);
  return documents[index];
}

export async function deleteDocument(documentId) {
  try {
    console.log(`[storage] 开始删除文档: ${documentId}`);
    // getAllDocuments 已经包含了错误处理，即使 JSON 损坏也会返回空数组
    const documents = await getAllDocuments();
    console.log(`[storage] 当前共有 ${documents.length} 个文档`);
    const filtered = documents.filter(d => d.id !== documentId);
    console.log(`[storage] 删除后剩余 ${filtered.length} 个文档`);
    
    // 写入文档列表（这是关键操作，如果失败应该抛出错误）
    try {
      await writeJSON(DOCUMENTS_FILE, filtered);
      console.log(`[storage] 文档列表已更新`);
    } catch (writeError) {
      console.error(`[storage] 写入文档列表失败:`, writeError);
      // 文档列表写入失败，删除操作失败
      throw new Error(`删除文档失败：无法更新文档列表 - ${writeError.message}`);
    }
    
    // 同时删除相关的 chunks（即使失败也不影响文档删除，因为文档已经从列表中删除了）
    try {
      await deleteChunksByDocument(documentId);
    } catch (chunkError) {
      console.error(`[storage] 删除 chunks 失败，但文档已从列表中删除:`, chunkError);
      // 不抛出错误，因为文档已经成功从列表中删除
      // chunks 可以在后续清理
    }
    
    return filtered.length < documents.length;
  } catch (error) {
    console.error(`[storage] 删除文档失败:`, error);
    console.error(`[storage] 错误堆栈:`, error.stack);
    throw error;
  }
}

// Chunks 管理
export async function getAllChunks() {
  return await readJSON(CHUNKS_FILE, []);
}

export async function getChunks(documentId) {
  const chunks = await getAllChunks();
  return chunks.filter(c => c.documentId === documentId);
}

export async function createChunks(chunksData) {
  const chunks = await getAllChunks();
  const newChunks = chunksData.map((chunk, index) => ({
    ...chunk,
    id: chunk.id || `chunk-${Date.now()}-${index}`,
    createdAt: chunk.createdAt || new Date().toISOString()
  }));
  chunks.push(...newChunks);
  await writeJSON(CHUNKS_FILE, chunks);
  return newChunks;
}

// 写入队列锁，确保同一时间只有一个写入操作
const writeQueueLocks = new Map();

// 获取写入锁（使用更可靠的队列实现）
async function acquireWriteLock(filePath) {
  // #region agent log
  console.log(`[storage] [LOCK] 请求写入锁: ${filePath}`);
  // #endregion
  
  // 如果还没有锁，创建一个已解决的 Promise
  if (!writeQueueLocks.has(filePath)) {
    writeQueueLocks.set(filePath, Promise.resolve());
  }
  
  // 获取当前的锁 Promise
  const currentLock = writeQueueLocks.get(filePath);
  
  // 创建一个新的 Promise，它会在当前锁完成后才解决
  let releaseLock;
  const nextLock = currentLock.then(() => {
    return new Promise((resolve) => {
      releaseLock = resolve;
      // #region agent log
      console.log(`[storage] [LOCK] 获得写入锁: ${filePath}`);
      // #endregion
    });
  });
  
  // 更新锁队列
  writeQueueLocks.set(filePath, nextLock);
  
  // 等待当前锁完成
  await currentLock;
  
  // #region agent log
  console.log(`[storage] [LOCK] 等待完成，返回释放函数: ${filePath}`);
  // #endregion
  
  // 返回释放函数
  return () => {
    // #region agent log
    console.log(`[storage] [LOCK] 释放写入锁: ${filePath}`);
    // #endregion
    if (releaseLock) {
      releaseLock();
    }
  };
}

export async function updateChunkEmbedding(chunkId, embedding) {
  try {
    const release = await acquireWriteLock(CHUNKS_FILE);
    try {
      const chunks = await getAllChunks();
      const index = chunks.findIndex(c => c.id === chunkId);
      if (index === -1) {
        return false;
      }
      chunks[index] = { ...chunks[index], embedding };
      await writeJSON(CHUNKS_FILE, chunks);
      return true;
    } finally {
      release();
    }
  } catch (error) {
    console.error(`[storage] 更新 chunk embedding 失败:`, error);
    return false;
  }
}

// 批量更新多个 chunks 的 embedding（更高效，避免多次文件写入）
export async function updateChunkEmbeddings(updates) {
  if (!updates || updates.length === 0) {
    return { success: 0, failed: 0 };
  }
  
  // #region agent log
  console.log(`[storage] [BATCH] 批量更新开始: ${updates.length} 个 chunks`);
  // #endregion
  
  try {
    const release = await acquireWriteLock(CHUNKS_FILE);
    try {
      const chunks = await getAllChunks();
      const updateMap = new Map(updates.map(u => [u.chunkId, u.embedding]));
      let updated = 0;
      
      for (let i = 0; i < chunks.length; i++) {
        if (updateMap.has(chunks[i].id)) {
          chunks[i] = { ...chunks[i], embedding: updateMap.get(chunks[i].id) };
          updated++;
        }
      }
      
      // #region agent log
      console.log(`[storage] [BATCH] 找到 ${updated}/${updates.length} 个 chunks 需要更新`);
      // #endregion
      
      if (updated > 0) {
        await writeJSON(CHUNKS_FILE, chunks);
        // #region agent log
        console.log(`[storage] [BATCH] 批量更新成功: ${updated} 个 chunks`);
        // #endregion
      }
      
      return { success: updated, failed: updates.length - updated };
    } finally {
      release();
    }
  } catch (error) {
    // #region agent log
    console.error(`[storage] [BATCH] 批量更新失败:`, error);
    // #endregion
    console.error(`[storage] 批量更新 chunk embeddings 失败:`, error);
    return { success: 0, failed: updates.length };
  }
}

export async function deleteChunksByDocument(documentId) {
  try {
    console.log(`[storage] 删除文档 ${documentId} 的 chunks`);
    // getAllChunks 已经包含了错误处理，即使 JSON 损坏也会返回空数组
    const chunks = await getAllChunks();
    console.log(`[storage] 当前共有 ${chunks.length} 个 chunks`);
    const filtered = chunks.filter(c => c.documentId !== documentId);
    console.log(`[storage] 删除后剩余 ${filtered.length} 个 chunks`);
    // 即使 chunks 为空或损坏，也尝试写入（清空该文档的 chunks）
    await writeJSON(CHUNKS_FILE, filtered);
    return chunks.length - filtered.length;
  } catch (error) {
    // 如果写入失败，记录错误但不抛出（因为文档已经删除）
    console.error(`[storage] 删除 chunks 失败（文档已删除）:`, error);
    // 不抛出错误，允许文档删除操作继续
    return 0;
  }
}

export async function searchChunks(query, limit = 30) {
  const chunks = await getAllChunks();
  const queryLower = query.toLowerCase();
  
  // 简单的关键词匹配搜索
  const scored = chunks.map(chunk => {
    const contentLower = chunk.content.toLowerCase();
    let score = 0;
    
    // 精确匹配
    if (contentLower.includes(queryLower)) {
      score += 10;
    }
    
    // 关键词匹配
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    queryWords.forEach(word => {
      if (contentLower.includes(word)) {
        score += 1;
      }
    });
    
    return { chunk, score };
  });
  
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.chunk);
}

// 设置管理（API keys 等）
export async function getSettings() {
  return await readJSON(SETTINGS_FILE, {});
}

export async function updateSettings(updates) {
  const settings = await getSettings();
  const updated = { ...settings, ...updates };
  await writeJSON(SETTINGS_FILE, updated);
  return updated;
}

export async function getApiKey(provider) {
  const settings = await getSettings();
  // 优先使用服务器存储的 API key，然后尝试环境变量（不带 VITE_ 前缀，因为这是服务器端）
  const envKeyName = `${provider.toUpperCase()}_API_KEY`;
  const apiKey = settings.apiKeys?.[provider] || process.env[envKeyName] || process.env[`VITE_${envKeyName}`] || null;
  return apiKey;
}
