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
const QUERY_LOGS_FILE = path.join(DATA_DIR, 'query_logs.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');

// 初始化标记
let isInitialized = false;

async function initStorage() {
  if (isInitialized) return;
  await ensureDataDir();
  isInitialized = true;
}

async function ensureDataDir() {
  try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR, { recursive: true }); }
  try { await fs.access(CHUNKS_DIR); } catch { await fs.mkdir(CHUNKS_DIR, { recursive: true }); }
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
  // 警告：可能 OOM。建议在大型部署中使用向量数据库或流式处理。
  await initStorage();
  const files = await fs.readdir(CHUNKS_DIR);
  const all = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const chunks = await readJSON(path.join(CHUNKS_DIR, file), []);
      all.push(...chunks);
    } catch (e) {
      console.error(`[storage] 加载 chunks 失败: ${file}`, e);
    }
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

// Technical term mappings for cross-lingual search
const TERM_MAPPINGS = {
  // ... (keeping the existing mappings for reference or refactoring them)

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
  '起不来': ['down', 'fail', 'failure', 'not established'],
  '怎么办': ['troubleshoot', 'fix', 'solution', 'how to', 'debug'],
  
  // --- Protocols / Technologies ---
  'bgp': ['border gateway protocol', 'ebgp', 'ibgp'],
  'ospf': ['open shortest path first'],
  'evpn': ['ethernet vpn', 'vxlan'],
  'vxlan': ['virtual extensible lan', 'vni', 'vtep', 'overlay'],
  'vni': ['virtual network identifier', 'segment id'],
  'mlag': ['multi-chassis link aggregation', 'clag', 'bond', 'peer-link', 'peerlink', 'dual-connected', 'mlag-id', 'backup-ip'],
  // NVUE specific command mappings
  'nv set': ['nv config', 'nvue', 'nv set interface', 'nv set system', 'nv set mlag', 'nv set bridge', 'nv set router', 'nv set evpn', 'nv set vrf'],
  'nvue': ['nv set', 'nv show', 'nv config', 'nv unset', 'nv action'],
  'nv': ['nvue', 'nv set', 'nv show', 'nv config', 'nv unset'],
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

// 简单的内存缓存
const chunkCache = new Map(); // file -> { data: [], timestamp: number }
const CACHE_TTL = 60 * 1000; // 1 minute

async function getChunksFromFile(file) {
    const now = Date.now();
    const cached = chunkCache.get(file);
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
        return cached.data;
    }
    
    // 清理过期缓存
    for (const [key, val] of chunkCache.entries()) {
        if (now - val.timestamp > CACHE_TTL) {
            chunkCache.delete(key);
        }
    }
    
    const filePath = path.join(CHUNKS_DIR, file);
    try {
        const data = await readJSON(filePath, []);
        // 只有数据是数组时才缓存
        if (Array.isArray(data)) {
            chunkCache.set(file, { data, timestamp: now });
            return data;
        }
        return [];
    } catch (e) {
        console.error(`[storage] 读取文件缓存失败: ${file}`, e);
        return [];
    }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchChunks(query, limit = 30) {
  await initStorage();
  const files = await fs.readdir(CHUNKS_DIR);
  const queryLower = query.toLowerCase();
  
  const rawQueryWords = (queryLower.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [])
    .filter(w => w.length >= 2 || (w.length === 1 && /[\u4e00-\u9fa5]/.test(w))); 

  const intent = { isCommand: false, isConcept: false, isTroubleshooting: false };

  if (['config', 'configuration', '配置', 'show', 'list', '列出', '显示', 'set', 'add', 'del', 'delete'].some(k => queryLower.includes(k)) ||
      /nv\s+(set|show|config|unset|action)/.test(queryLower) ||
      queryLower.includes('nvue') || queryLower.includes('如何使用')) {
    intent.isCommand = true;
  }

  if (['what is', 'explain', 'concept', 'definition', 'intro', '介绍', '什么是', '概念', '原理', '解释'].some(k => queryLower.includes(k))) {
    intent.isConcept = true;
  }
  
  if (['debug', 'fix', 'issue', 'problem', 'fail', 'error', '调试', '故障', '错误', '问题', '排错', '怎么办', '起不来'].some(k => queryLower.includes(k))) {
    intent.isTroubleshooting = true;
  }

  const queryWordsSet = new Set(rawQueryWords);
  for (const word of rawQueryWords) {
    if (TERM_MAPPINGS[word]) {
      for (const synonym of TERM_MAPPINGS[word]) queryWordsSet.add(synonym);
    }
    for (const [key, values] of Object.entries(TERM_MAPPINGS)) {
      if (word.includes(key) && word !== key) {
        for (const v of values) queryWordsSet.add(v);
      }
    }
  }
  
  const expandedQueryWords = Array.from(queryWordsSet);
  const technicalTerms = expandedQueryWords.filter(w => /^[a-z0-9]+$/.test(w));
  const technicalTermsSet = new Set(technicalTerms);
  
  const documents = await getAllDocuments();
  const docMap = new Map(documents.map(d => [d.id, d]));

  const results = [];
  
  // Pre-compile word patterns for faster matching if needed, but includes is often faster for simple strings
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const docId = file.replace('.json', '');
    const doc = docMap.get(docId);
    let docScoreBonus = 0;
    
    if (doc) {
      const filenameLower = doc.filename.toLowerCase();
      for (const word of expandedQueryWords) {
        if (filenameLower.includes(word)) docScoreBonus += 2;
      }
    }

    const chunks = await getChunksFromFile(file);
    
    for (const chunk of chunks) {
      const contentLower = chunk.content.toLowerCase();
      let score = docScoreBonus;
      let matchedCount = 0;
      
      if (contentLower.includes(queryLower)) score += 10;
      
      for (const word of expandedQueryWords) {
        if (!word) continue;
        
        // Use a more efficient way to count occurrences without creating arrays
        let count = 0;
        let pos = contentLower.indexOf(word);
        while (pos !== -1) {
          count++;
          pos = contentLower.indexOf(word, pos + word.length);
        }
        
        if (count > 0) {
          const tf = 1 + Math.log(count);
          const wordScore = technicalTermsSet.has(word) ? 3 : 1;
          score += tf * wordScore;
          matchedCount++;
        }
      }
      
      if (matchedCount > 1) score += matchedCount * 1.5;

      if (score > 2) {
          if (intent.isCommand) {
             const hasCommandKeywords = contentLower.includes('nv config') ||
                                      contentLower.includes('nv show') ||
                                      contentLower.includes('nv set') ||
                                      /(nv|show|netq|vtysh)\s+(config|show|ip|interface|platform)/.test(contentLower);

             if (hasCommandKeywords || contentLower.includes('```')) {
                 score += 10;
                 if ((queryLower.includes('show') || queryLower.includes('显示')) && contentLower.includes('show')) score += 5;
                 if ((queryLower.includes('config') || queryLower.includes('配置')) && (contentLower.includes('config') || contentLower.includes('nv set'))) score += 5;
                 if (queryLower.includes('set') && contentLower.includes('nv set')) score += 8;
                 if ((queryLower.includes('mlag') || queryLower.includes('clag')) && (contentLower.includes('nv set') && (contentLower.includes('mlag') || contentLower.includes('bond')))) score += 15;
             }
          }

          if (intent.isConcept) {
             if (/\sis a\s|\srefers to\s|\sdescribes\s|是.*(?:一种|一个|用于)|指的是|定义为/.test(contentLower)) score += 15;
             if (contentLower.startsWith('#')) score += 10;
          }
          
          if (intent.isTroubleshooting) {
             if (['error', 'fail', 'failure', 'down', 'drop', 'discard', 'troubleshoot', 'debug', 'log', 'problem', 'issue'].some(t => contentLower.includes(t))) score += 15;
          }
      }
      
      if (score > 0) {
        results.push({ chunk: { ...chunk, score, debug_intent: intent }, score });
      }
    }

    if (results.length > limit * 50) {
        results.sort((a, b) => b.score - a.score);
        results.length = limit * 25; 
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, limit).map(r => r.chunk);
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

  // 降低向量搜索阈值，提高召回率
  const minScore = 0.2;

  // 第一步：从所有文件中收集所有chunks
  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const chunks = await getChunksFromFile(file);

    for (const chunk of chunks) {
      if (Array.isArray(chunk.embedding) && chunk.embedding.length > 0) {
        const score = cosine(queryEmbedding, chunk.embedding);
        // 只保留相似度足够的结果
        if (score > minScore) {
           topResults.push({ chunk, score });
        }
      }
    }
  }

  // 第二步：排序并返回前limit个结果
  // 注意：不在循环中进行剪枝，而是在最后统一排序
  return topResults.sort((a, b) => b.score - a.score).slice(0, limit);
}

// 搜索特定模式的块 (不加载全部内容到内存)
export async function findChunksByPattern(pattern, limit = 10) {
  await initStorage();
  const files = await fs.readdir(CHUNKS_DIR);
  const results = [];
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const chunks = await getChunksFromFile(file);
    for (const chunk of chunks) {
      if (pattern.test(chunk.content)) {
        results.push(chunk);
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

// 通用的块扫描器
export async function scanChunks(processor) {
  await initStorage();
  const files = await fs.readdir(CHUNKS_DIR);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const chunks = await getChunksFromFile(file);
    for (const chunk of chunks) {
      const shouldContinue = await processor(chunk);
      if (shouldContinue === false) return;
    }
  }
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

// ========== 查询日志管理 ==========

export async function addQueryLog(query, responseTime = 0) {
  await initStorage();
  const logs = await readJSON(QUERY_LOGS_FILE, []);
  logs.push({
    id: `log-${Date.now()}`,
    query,
    responseTime,
    timestamp: new Date().toISOString()
  });
  // 只保留最近 1000 条日志
  if (logs.length > 1000) {
    logs.splice(0, logs.length - 1000);
  }
  await writeJSON(QUERY_LOGS_FILE, logs);
}

export async function getQueryStats() {
  await initStorage();
  const logs = await readJSON(QUERY_LOGS_FILE, []);

  // 计算最近7天的查询统计
  const now = new Date();
  const recentQueries = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    const dayStart = new Date(date.setHours(0, 0, 0, 0));
    const dayEnd = new Date(date.setHours(23, 59, 59, 999));

    const count = logs.filter(log => {
      const logDate = new Date(log.timestamp);
      return logDate >= dayStart && logDate <= dayEnd;
    }).length;

    recentQueries.push({ date: dateStr, count });
  }

  // 统计热门问题（按问题内容分组）
  const questionCounts = {};
  logs.forEach(log => {
    const q = log.query.trim().substring(0, 50);
    questionCounts[q] = (questionCounts[q] || 0) + 1;
  });

  const topQuestions = Object.entries(questionCounts)
    .map(([question, count]) => ({ question, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 计算平均响应时间
  const logsWithTime = logs.filter(l => l.responseTime > 0);
  const avgResponseTime = logsWithTime.length > 0
    ? (logsWithTime.reduce((sum, l) => sum + l.responseTime, 0) / logsWithTime.length / 1000).toFixed(1)
    : 0;

  return {
    totalQueries: logs.length,
    avgResponseTime: parseFloat(avgResponseTime),
    recentQueries,
    topQuestions
  };
}

// ========== 分类管理 ==========

const DEFAULT_CATEGORIES = {
  tree: [
    {
      id: 'default',
      name: '默认分类',
      icon: 'folder',
      children: []
    }
  ]
};

export async function getCategories() {
  await initStorage();
  return await readJSON(CATEGORIES_FILE, DEFAULT_CATEGORIES);
}

export async function saveCategories(categories) {
  await initStorage();
  await writeJSON(CATEGORIES_FILE, categories);
  return categories;
}

export async function addCategory(parentId, category) {
  const categories = await getCategories();
  const newCat = {
    id: `cat-${Date.now()}`,
    name: category.name,
    icon: category.icon || 'folder',
    children: []
  };

  if (!parentId) {
    categories.tree.push(newCat);
  } else {
    const addToParent = (nodes) => {
      for (const node of nodes) {
        if (node.id === parentId) {
          node.children = node.children || [];
          node.children.push(newCat);
          return true;
        }
        if (node.children && addToParent(node.children)) return true;
      }
      return false;
    };
    addToParent(categories.tree);
  }

  await saveCategories(categories);
  return newCat;
}

export async function updateCategory(categoryId, updates) {
  const categories = await getCategories();

  const update = (nodes) => {
    for (const node of nodes) {
      if (node.id === categoryId) {
        Object.assign(node, updates);
        return true;
      }
      if (node.children && update(node.children)) return true;
    }
    return false;
  };
  update(categories.tree);

  await saveCategories(categories);
  return categories;
}

export async function deleteCategory(categoryId) {
  if (categoryId === 'default') return false;

  const categories = await getCategories();

  const remove = (nodes, parent) => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === categoryId) {
        nodes.splice(i, 1);
        return true;
      }
      if (nodes[i].children && remove(nodes[i].children, nodes[i])) return true;
    }
    return false;
  };
  remove(categories.tree, null);

  await saveCategories(categories);

  // 将该分类下的文档移到默认分类
  const documents = await getAllDocuments();
  const updated = documents.map(doc => {
    if (doc.categoryId === categoryId) {
      return { ...doc, categoryId: 'default', categoryPath: ['default'] };
    }
    return doc;
  });
  await writeJSON(DOCUMENTS_FILE, updated);

  return true;
}
