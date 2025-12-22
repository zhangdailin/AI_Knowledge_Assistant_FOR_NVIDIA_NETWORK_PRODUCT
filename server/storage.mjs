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

export async function getChunk(documentId, chunkId) {
  await initStorage();
  const chunks = await readJSON(path.join(CHUNKS_DIR, `${documentId}.json`), []);
  return chunks.find(c => c.id === chunkId) || null;
}

export async function getChunkStats(documentId) {
  await initStorage();
  try {
    const chunks = await readJSON(path.join(CHUNKS_DIR, `${documentId}.json`), []);
    // 计算统计信息
    const total = chunks.length;
    const parentChunks = chunks.filter(c => c.chunkType === 'parent');
    const childChunks = chunks.filter(c => c.chunkType === 'child');
    const normalChunks = chunks.filter(c => c.chunkType !== 'parent' && c.chunkType !== 'child');
    
    // 需要 Embedding 的块
    const chunksRequiringEmbedding = [...childChunks, ...normalChunks];
    const withEmbedding = chunksRequiringEmbedding.filter(c => Array.isArray(c.embedding) && c.embedding.length > 0).length;
    
    return {
      total,
      parentCount: parentChunks.length,
      childCount: childChunks.length,
      normalCount: normalChunks.length,
      withEmbedding,
      requiringEmbedding: chunksRequiringEmbedding.length
    };
  } catch (error) {
    console.error(`[storage] 获取统计失败: ${documentId}`, error);
    return { total: 0, parentCount: 0, childCount: 0, normalCount: 0, withEmbedding: 0, requiringEmbedding: 0 };
  }
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

// Technical term mappings for cross-lingual search
const TERM_MAPPINGS = {
  // --- Actions ---
  '配置': ['config', 'configuration', 'settings', 'setup', 'provisioning', 'set'],
  'config': ['配置', '设置'],
  '显示': ['show', 'display', 'view', 'list', 'get', 'print'],
  '列出': ['list', 'show', 'ls', 'display', 'enumerate'],
  '查看': ['check', 'view', 'show', 'display', 'inspect'],
  '状态': ['status', 'state', 'health', 'condition', 'info', 'summary'],
  '命令': ['command', 'cli', 'cmd', 'instruction', 'nv', 'nvue', 'netq', 'vtysh'],
  '保存': ['save', 'write', 'commit', 'store'],
  '重启': ['reboot', 'reload', 'restart', 'reset'],
  '删除': ['delete', 'remove', 'unset', 'clear', 'erase', 'no'],
  '开启': ['enable', 'up', 'start', 'activate', 'on'],
  '关闭': ['disable', 'down', 'stop', 'deactivate', 'off', 'shutdown'],
  '调试': ['debug', 'trace', 'log', 'monitor'],
  '升级': ['upgrade', 'update', 'install', 'patch'],
  '连接': ['connect', 'ssh', 'telnet', 'console', 'link'],
  
  // --- Objects / Entities ---
  '所有': ['all', 'full', 'entire', 'everything', 'total', 'whole'],
  '设备': ['device', 'system', 'switch', 'router', 'box', 'hardware', 'platform', 'node', 'chassis'],
  '当前': ['current', 'currently', 'active', 'running', 'applied', 'now'],
  '接口': ['interface', 'port', 'int', 'eth', 'swp'],
  '路由': ['route', 'routing', 'rib', 'fib', 'forwarding'],
  '网络': ['network', 'net', 'fabric', 'infrastructure'],
  '版本': ['version', 'ver', 'revision', 'release', 'image'],
  '用户': ['user', 'username', 'account', 'admin', 'role'],
  '密码': ['password', 'passwd', 'secret', 'credential', 'auth'],
  '邻居': ['neighbor', 'peer', 'adjacency'],
  '日志': ['log', 'logging', 'syslog', 'journal'],
  '错误': ['error', 'fail', 'failure', 'drop', 'discard', 'loss', 'down'],
  
  // --- Protocols / Technologies ---
  'bgp': ['border gateway protocol', 'ebgp', 'ibgp'],
  'ospf': ['open shortest path first'],
  'evpn': ['ethernet vpn', 'vxlan'],
  'vxlan': ['virtual extensible lan', 'vni', 'vtep', 'overlay'],
  'mlag': ['multi-chassis link aggregation', 'clag', 'bond', 'peer-link'],
  'stp': ['spanning tree', 'rstp', 'mstp', 'pvst'],
  'lacp': ['link aggregation', 'bond', 'port-channel', 'lag'],
  'lldp': ['link layer discovery'],
  'vlan': ['virtual lan', 'bridge', 'dot1q'],
  'vrf': ['virtual routing and forwarding', 'vpn-instance'],
  'acl': ['access control list', 'filter', 'policy', 'rule'],
  'bfd': ['bidirectional forwarding detection'],
  'ptp': ['precision time protocol', '1588'],
  'snmp': ['simple network management protocol', 'trap', 'inform'],
  'ntp': ['network time protocol', 'time'],
  'dhcp': ['dynamic host configuration protocol', 'relay'],
  'dns': ['domain name system', 'resolve', 'nameserver']
};

export async function searchChunks(query, limit = 30) {
  await initStorage();
  const files = await fs.readdir(CHUNKS_DIR);
  const queryLower = query.toLowerCase();
  
  // Improved tokenization: match English words or Chinese characters sequences
  // This handles "检查vxlan" -> "检查", "vxlan"
  const rawQueryWords = (queryLower.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [])
    .filter(w => w.length >= 2 || (w.length === 1 && /[\u4e00-\u9fa5]/.test(w))); 

  // --- Intent Detection ---
  const intent = {
    isCommand: false,
    isConcept: false,
    isTroubleshooting: false
  };

  // Check for command-related keywords
  if (['config', 'configuration', '配置', 'show', 'list', '列出', '显示', 'set', 'add', 'del', 'delete'].some(k => queryLower.includes(k))) {
    intent.isCommand = true;
  }

  // Check for concept-related keywords
  if (['what is', 'explain', 'concept', 'definition', 'intro', '介绍', '什么是', '概念', '原理'].some(k => queryLower.includes(k))) {
    intent.isConcept = true;
  }
  
  // Check for troubleshooting keywords
  if (['debug', 'fix', 'issue', 'problem', 'fail', 'error', '调试', '故障', '错误', '问题', '排错'].some(k => queryLower.includes(k))) {
    intent.isTroubleshooting = true;
  }

  // Expand query words with synonyms/translations
  const queryWords = new Set(rawQueryWords);
  rawQueryWords.forEach(word => {
    // Check if the word exists in mappings (as a key)
    if (TERM_MAPPINGS[word]) {
      TERM_MAPPINGS[word].forEach(synonym => queryWords.add(synonym));
    }
    // Also check partial matches for Chinese (e.g. "配置命令" -> contains "配置" and "命令")
    for (const [key, values] of Object.entries(TERM_MAPPINGS)) {
      if (word.includes(key) && word !== key) {
        values.forEach(v => queryWords.add(v));
      }
    }
  });
  
  // Convert back to array for iteration
  const expandedQueryWords = Array.from(queryWords);
  
  // Extract potential technical terms (English words) for higher weighting
  const technicalTerms = expandedQueryWords.filter(w => /^[a-z0-9]+$/.test(w));
  
  // Load documents for filename matching
  const documents = await getAllDocuments();
  const docMap = new Map(documents.map(d => [d.id, d]));

  const results = [];
  
  // 逐个文件处理，避免 OOM
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const docId = file.replace('.json', '');
    const doc = docMap.get(docId);
    let docScoreBonus = 0;
    
    // Calculate document title match bonus once per document
    if (doc) {
      const filenameLower = doc.filename.toLowerCase();
      expandedQueryWords.forEach(word => {
        if (filenameLower.includes(word)) {
          docScoreBonus += 2; // Bonus for matching filename
        }
      });
    }

    const chunks = await readJSON(path.join(CHUNKS_DIR, file), []);
    
    for (const chunk of chunks) {
      const contentLower = chunk.content.toLowerCase();
      let score = docScoreBonus; // Start with document bonus
      let matchedCount = 0;
      
      // Exact match bonus (original query)
      if (contentLower.includes(queryLower)) score += 10;
      
      expandedQueryWords.forEach(word => {
        if (!word) return;
        // Simple occurrence counting (faster than regex)
        const parts = contentLower.split(word);
        const count = parts.length - 1;
        
        if (count > 0) {
          // Term Frequency (TF) scoring: 1 + log(count)
          // This prevents keyword stuffing from dominating, but rewards multiple mentions
          const tf = 1 + Math.log(count);
          
          let wordScore = 1;
          // Technical term bonus (e.g. "vxlan", "config")
          if (technicalTerms.includes(word)) {
            wordScore = 3; 
          }
          
          score += tf * wordScore;
          matchedCount++;
        }
      });
      
      // Bonus for matching multiple UNIQUE words (phrase matching approximation)
      // If we matched 5 different keywords, that's better than matching 1 keyword 5 times
      if (matchedCount > 1) {
        score += matchedCount * 1.5;
      }

      // --- Adaptive Scoring based on Intent ---
      
      if (score > 5) { // Only apply optimizations if we have basic relevance
          
          // 1. Command Intent Optimization
          if (intent.isCommand) {
             // RELAXED: Just check if the content contains the command keywords directly
             // This covers both HTML tables "<td>nv show" and plain text "nv show"
             const hasCommandKeywords = /(nv|show|netq|vtysh)\s+(config|show|ip|interface|platform)/.test(contentLower) ||
                                      contentLower.includes('nv config') ||
                                      contentLower.includes('nv show');

             const isCommandStructure = hasCommandKeywords || 
                                      /<tr><td>\s*(nv|show|netq|vtysh)/.test(contentLower) || 
                                      /^\s*(nv|show|netq|vtysh)/.test(contentLower) ||
                                      contentLower.includes('```'); 
             
             if (isCommandStructure) {
                 score += 10; // Boost potential command blocks
                 
                 // Double boost if it matches the specific action verb
                 if (queryLower.includes('show') && contentLower.includes('show')) score += 5;
                 if (queryLower.includes('config') && contentLower.includes('config')) score += 5;
             }
          }

          // 2. Concept/Definition Intent Optimization
          if (intent.isConcept) {
             // Look for definition patterns: "X is a...", "X describes..."
             const isDefinition = /\sis a\s|\srefers to\s|\sdescribes\s/.test(contentLower);
             // Look for headers
             const isHeader = /^#+\s/.test(contentLower);
             
             if (isDefinition) score += 5;
             if (isHeader) score += 5;
          }
          
          // 3. Troubleshooting Intent Optimization
          if (intent.isTroubleshooting) {
             if (contentLower.includes('error') || contentLower.includes('fail') || contentLower.includes('troubleshoot')) {
                 score += 10;
             }
          }
      }
      
      if (score > 0) {
        results.push({ chunk, score });
      }
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, limit).map(r => r.chunk);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  // Assume a and b are same length
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

export async function vectorSearchChunks(queryEmbedding, limit = 30) {
  await initStorage();
  const files = await fs.readdir(CHUNKS_DIR);
  let topResults = [];
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const chunks = await readJSON(path.join(CHUNKS_DIR, file), []);
    
    for (const chunk of chunks) {
      if (Array.isArray(chunk.embedding) && chunk.embedding.length > 0) {
        const score = cosine(queryEmbedding, chunk.embedding);
        // Optimization: Don't store chunks with very low scores
        if (score > 0.1) {
           topResults.push({ chunk, score });
        }
      }
    }
    
    // Memory optimization: Prune results periodically if they get too large
    if (topResults.length > limit * 5) {
      topResults.sort((a, b) => b.score - a.score);
      topResults = topResults.slice(0, limit * 2);
    }
  }
  
  return topResults.sort((a, b) => b.score - a.score).slice(0, limit);
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
