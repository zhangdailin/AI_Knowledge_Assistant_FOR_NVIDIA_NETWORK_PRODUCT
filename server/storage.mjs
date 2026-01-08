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
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');

// 初始化标记
let isInitialized = false;
let searchCacheInvalidator = null;

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
    try { await fs.unlink(tempPath); } catch { }
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
  if (searchCacheInvalidator) searchCacheInvalidator('createDocument');
  return newDocument;
}

export async function updateDocument(documentId, updates) {
  const documents = await getAllDocuments();
  const index = documents.findIndex(d => d.id === documentId);
  if (index === -1) return null;
  documents[index] = { ...documents[index], ...updates };
  await writeJSON(DOCUMENTS_FILE, documents);
  if (searchCacheInvalidator) searchCacheInvalidator('updateDocument');
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
    } catch { }

    invalidateChunkCache(`${documentId}.json`);
    if (searchCacheInvalidator) searchCacheInvalidator('deleteDocument');
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
    if (!byDoc[c.documentId]) byDoc[c.documentId] = [];
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

      // 更新文档的 chunkCount
      await updateDocument(docId, { chunkCount: existing.length });

      invalidateChunkCache(`${docId}.json`);
      if (searchCacheInvalidator) searchCacheInvalidator('createChunks');
      result.push(...newChunks);
    } finally {
      release();
    }
  }
  return result;
}

// 写入锁队列（带自动清理）
const writeQueueLocks = new Map();
const lockRefCounts = new Map();

async function acquireWriteLock(filePath) {
  if (!writeQueueLocks.has(filePath)) {
    writeQueueLocks.set(filePath, Promise.resolve());
    lockRefCounts.set(filePath, 0);
  }

  lockRefCounts.set(filePath, (lockRefCounts.get(filePath) || 0) + 1);
  const currentLock = writeQueueLocks.get(filePath);
  let releaseLock;
  const nextLock = currentLock.then(() => new Promise(resolve => releaseLock = resolve));
  writeQueueLocks.set(filePath, nextLock);
  await currentLock;

  return () => {
    if (releaseLock) releaseLock();
    // 清理：当没有等待的锁时，删除 Map 条目
    const count = (lockRefCounts.get(filePath) || 1) - 1;
    if (count <= 0) {
      writeQueueLocks.delete(filePath);
      lockRefCounts.delete(filePath);
    } else {
      lockRefCounts.set(filePath, count);
    }
  };
}

export async function updateChunkEmbedding(chunkId, embedding) {
  await initStorage();
  // 遍历查找（性能较差，但为了兼容性）
  const files = await fs.readdir(CHUNKS_DIR);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(CHUNKS_DIR, file);

    // 先获取锁，再读取，避免 TOCTOU
    const release = await acquireWriteLock(filePath);
    try {
      const chunks = await readJSON(filePath, []);
      const index = chunks.findIndex(c => c.id === chunkId);
      if (index !== -1) {
        chunks[index] = { ...chunks[index], embedding };
        await writeJSON(filePath, chunks);
        invalidateChunkCache(file);
        if (searchCacheInvalidator) searchCacheInvalidator('updateChunkEmbedding');
        return true;
      }
    } finally {
      release();
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
        invalidateChunkCache(`${documentId}.json`);
        if (searchCacheInvalidator) searchCacheInvalidator('updateChunkEmbeddings');
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
  '保存': ['save', 'write', 'commit', 'store', 'persist'],
  '重启': ['reboot', 'reload', 'restart', 'reset'],
  '删除': ['delete', 'remove', 'unset', 'clear', 'erase', 'no'],
  '开启': ['enable', 'up', 'start', 'activate', 'on'],
  '关闭': ['disable', 'down', 'stop', 'deactivate', 'off', 'shutdown'],
  '调试': ['debug', 'trace', 'log', 'monitor', 'troubleshoot'],
  '升级': ['upgrade', 'update', 'install', 'patch', 'firmware'],
  '连接': ['connect', 'ssh', 'telnet', 'console', 'link'],
  '验证': ['verify', 'validate', 'check', 'confirm', 'test'],
  '应用': ['apply', 'commit', 'activate', 'deploy'],
  '备份': ['backup', 'snapshot', 'export', 'save'],
  '恢复': ['restore', 'recover', 'rollback', 'revert'],
  '监控': ['monitor', 'watch', 'track', 'observe'],

  // --- Objects / Entities ---
  '所有': ['all', 'full', 'entire', 'everything', 'total', 'whole'],
  '设备': ['device', 'system', 'switch', 'router', 'box', 'hardware', 'platform', 'node', 'chassis', 'appliance'],
  '当前': ['current', 'currently', 'active', 'running', 'applied', 'now'],
  '接口': ['interface', 'port', 'int', 'eth', 'swp', 'link', 'nic'],
  '路由': ['route', 'routing', 'rib', 'fib', 'forwarding', 'nexthop', 'gateway'],
  '网络': ['network', 'net', 'fabric', 'infrastructure', 'topology'],
  '版本': ['version', 'ver', 'revision', 'release', 'image', 'build'],
  '用户': ['user', 'username', 'account', 'admin', 'role'],
  '密码': ['password', 'passwd', 'secret', 'credential', 'auth'],
  '邻居': ['neighbor', 'peer', 'adjacency', 'next-hop'],
  '日志': ['log', 'logging', 'syslog', 'journal', 'audit'],
  '错误': ['error', 'fail', 'failure', 'drop', 'discard', 'loss', 'down', 'issue'],
  '起不来': ['down', 'fail', 'failure', 'not established', 'not up'],
  '怎么办': ['troubleshoot', 'fix', 'solution', 'how to', 'debug'],
  '故障': ['failure', 'fault', 'problem', 'issue', 'malfunction', 'outage'],
  '性能': ['performance', 'throughput', 'latency', 'bandwidth', 'speed'],
  '流量': ['traffic', 'flow', 'packet', 'data', 'throughput'],

  // --- Protocols / Technologies ---
  'bgp': ['border gateway protocol', 'ebgp', 'ibgp', 'as', 'asn', 'autonomous system'],
  'ospf': ['open shortest path first', 'area', 'lsa', 'spf'],
  'evpn': ['ethernet vpn', 'vxlan', 'type-2', 'type-3', 'type-5'],
  'vxlan': ['virtual extensible lan', 'vni', 'vtep', 'overlay', 'tunnel'],
  'vni': ['virtual network identifier', 'segment id', 'vnid'],
  'mlag': ['multi-chassis link aggregation', 'clag', 'bond', 'peer-link', 'peerlink', 'dual-connected', 'mlag-id', 'backup-ip', 'mclag'],
  'roce': ['rdma over converged ethernet', 'infiniband', 'ib', 'rdma', 'pfc', 'ecn', 'qos'],
  'infiniband': ['ib', 'roce', 'rdma', 'fabric', 'subnet manager', 'sm'],
  'rdma': ['remote direct memory access', 'roce', 'infiniband', 'iwarp'],
  'pfc': ['priority flow control', 'pause', 'lossless', 'no-drop'],
  'ecn': ['explicit congestion notification', 'marking', 'cwr', 'ce'],
  'qos': ['quality of service', 'cos', 'dscp', 'priority', 'scheduling', 'marking'],

  // --- NVUE specific command mappings ---
  'nv set': ['nv config', 'nvue', 'nv set interface', 'nv set system', 'nv set mlag', 'nv set bridge', 'nv set router', 'nv set evpn', 'nv set vrf'],
  'nvue': ['nv set', 'nv show', 'nv config', 'nv unset', 'nv action'],
  'nv': ['nvue', 'nv set', 'nv show', 'nv config', 'nv unset'],
  'netq': ['netq show', 'netq check', 'netq trace', 'netq agent'],

  // --- Layer 2/3 Technologies ---
  'stp': ['spanning tree', 'rstp', 'mstp', 'pvst', 'bpdu'],
  'lacp': ['link aggregation', 'bond', 'port-channel', 'lag', 'etherchannel'],
  'lldp': ['link layer discovery', 'cdp', 'neighbor discovery'],
  'vlan': ['virtual lan', 'bridge', 'dot1q', '802.1q', 'trunk', 'access'],
  'vrf': ['virtual routing and forwarding', 'vpn-instance', 'routing instance'],
  'acl': ['access control list', 'filter', 'policy', 'rule', 'permit', 'deny'],
  'bfd': ['bidirectional forwarding detection', 'fast-failover'],
  'ptp': ['precision time protocol', '1588', 'ieee1588', 'grandmaster', 'boundary clock'],
  'snmp': ['simple network management protocol', 'trap', 'inform', 'oid', 'mib'],
  'ntp': ['network time protocol', 'time', 'clock', 'stratum'],
  'dhcp': ['dynamic host configuration protocol', 'relay', 'bootp', 'option82'],
  'dns': ['domain name system', 'resolve', 'nameserver', 'lookup'],
  'arp': ['address resolution protocol', 'mac address', 'ip mapping'],
  'fdb': ['forwarding database', 'mac table', 'cam table'],
  'multicast': ['igmp', 'pim', 'mroute', 'mcast', 'group'],

  // --- Common Abbreviations ---
  'mac': ['media access control', 'hardware address', 'ethernet address'],
  'ip': ['internet protocol', 'ipv4', 'ipv6', 'address'],
  'mtu': ['maximum transmission unit', 'jumbo frame', 'packet size'],
  'ttl': ['time to live', 'hop limit'],
  'qinq': ['802.1ad', 'double tag', 'stacked vlan'],
  'gre': ['generic routing encapsulation', 'tunnel'],
  'ipsec': ['ip security', 'vpn', 'encryption'],
  'nat': ['network address translation', 'pat', 'source nat', 'destination nat'],
  'hsrp': ['hot standby router protocol', 'vrrp', 'gateway redundancy'],
  'vrrp': ['virtual router redundancy protocol', 'hsrp', 'gateway'],

  // --- Storage & File Systems ---
  '文件': ['file', 'document', 'config file', 'image'],
  '目录': ['directory', 'folder', 'path'],
  '存储': ['storage', 'disk', 'flash', 'memory'],

  // --- Common Chinese Queries ---
  '怎样': ['how to', 'how', 'method', 'way'],
  '为什么': ['why', 'reason', 'cause'],
  '原理': ['principle', 'mechanism', 'concept', 'theory'],
  '区别': ['difference', 'compare', 'versus', 'vs'],
  '优势': ['advantage', 'benefit', 'pros'],
  '缺点': ['disadvantage', 'limitation', 'cons', 'issue'],
  '建议': ['recommend', 'suggestion', 'best practice'],
  '注意': ['caution', 'warning', 'notice', 'important']
};

// 简单的内存缓存 (带 LRU 淘汰)
const chunkCache = new Map(); // file -> { data: [], timestamp: number }
let CACHE_TTL = 60 * 1000; // 默认 60s，可从配置覆盖
let MAX_CACHE_ENTRIES = 50; // 默认最大 50 个文件，可从配置覆盖

// 从配置加载缓存参数
async function loadCacheConfig() {
  try {
    const settings = await readJSON(SETTINGS_FILE, {});
    if (settings.retrieval) {
      CACHE_TTL = settings.retrieval.chunkCacheTTL || CACHE_TTL;
      MAX_CACHE_ENTRIES = settings.retrieval.chunkCacheMaxEntries || MAX_CACHE_ENTRIES;
    }
  } catch (e) {
    // 使用默认值
  }
}

function pruneChunkCache(now = Date.now()) {
  for (const [key, val] of chunkCache.entries()) {
    if (now - val.timestamp > CACHE_TTL) {
      chunkCache.delete(key);
    }
  }

  while (chunkCache.size > MAX_CACHE_ENTRIES) {
    const firstKey = chunkCache.keys().next().value;
    chunkCache.delete(firstKey);
  }
}

export async function reloadCacheConfig() {
  await loadCacheConfig();
  pruneChunkCache();
}

export function setSearchCacheInvalidator(fn) {
  searchCacheInvalidator = typeof fn === 'function' ? fn : null;
}

function invalidateChunkCache(file) {
  chunkCache.delete(file);
}

// 初始化时加载配置
loadCacheConfig();

async function getChunksFromFile(file) {
  const now = Date.now();
  const cached = chunkCache.get(file);
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    // LRU: 移动到最后
    chunkCache.delete(file);
    chunkCache.set(file, cached);
    return cached.data;
  }

  // 清理过期缓存 + LRU 淘汰
  pruneChunkCache(now);

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

function collectCategoryMaps(nodes, idSet, nameToId) {
  for (const node of nodes) {
    idSet.add(node.id);
    nameToId.set(node.name, node.id);
    if (node.children) collectCategoryMaps(node.children, idSet, nameToId);
  }
}

function resolveDocumentCategoryId(doc, categoryIdSet, categoryNameToId) {
  if (doc.categoryId) {
    if (categoryIdSet.has(doc.categoryId)) return doc.categoryId;
    if (categoryNameToId.has(doc.categoryId)) return categoryNameToId.get(doc.categoryId);
  }
  if (doc.category && categoryIdSet.has(doc.category)) return doc.category;
  if (doc.category && categoryNameToId.has(doc.category)) return categoryNameToId.get(doc.category);
  return 'default';
}

export async function searchChunks(query, limit = 30, categoryIds = null) {
  await initStorage();
  const files = await fs.readdir(CHUNKS_DIR);
  let queryLower = query.toLowerCase();

  // 查询重写：将口语化表达转换为技术术语
  const queryRewritePatterns = [
    // 查看/检查 -> show
    { pattern: /(怎么|如何)(看|查看|查询|检查)(.+)/, rewrite: (m, _, __, target) => `show ${target.trim()}` },
    { pattern: /(查看|检查|看)(.+)(状态|信息|配置)/, rewrite: (m, _, target) => `show ${target.trim()}` },

    // 配置 -> config/set
    { pattern: /(怎么|如何)(配置|设置)(.+)/, rewrite: (m, _, __, target) => `config ${target.trim()} set` },
    { pattern: /(配置|设置)(.+)(方法|步骤|命令)/, rewrite: (m, _, target) => `config ${target.trim()}` },

    // 概念查询
    { pattern: /(.+)(是什么|什么意思|含义)/, rewrite: (m, term) => `${term.trim()} 定义 概念` },

    // 故障排查
    { pattern: /(.+)(不工作|无法|失败|报错)/, rewrite: (m, issue) => `${issue.trim()} troubleshoot debug 故障` },
    { pattern: /(怎么|如何)(解决|修复|排查)(.+)/, rewrite: (m, _, __, issue) => `${issue.trim()} troubleshoot fix` },

    // 操作指南
    { pattern: /(启用|禁用|开启|关闭)(.+)/, rewrite: (m, action, target) => `${target.trim()} ${action} enable disable` },
  ];

  let rewritten = false;
  for (const { pattern, rewrite } of queryRewritePatterns) {
    const match = queryLower.match(pattern);
    if (match) {
      const newQuery = rewrite(...match);
      if (newQuery && newQuery !== queryLower) {
        console.log(`[QueryRewrite] "${query}" => "${newQuery}"`);
        queryLower = newQuery;
        rewritten = true;
        break; // 只应用第一个匹配的规则
      }
    }
  }

  // 定义停用词列表（与前端保持一致）
  const stopWords = new Set([
    '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
    '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
    '自己', '这', '那', '能', '吗', '么', '为', '啊', '呢', '吧', '如何', '怎么', '什么'
  ]);

  const rawQueryWords = (queryLower.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [])
    .filter(w => {
      // 保留长度>=2的词，或单字中文但非停用词
      if (w.length >= 2) return !stopWords.has(w);
      return /[\u4e00-\u9fa5]/.test(w) && !stopWords.has(w);
    });

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

  // 同义词扩展后，再次过滤停用词（确保扩展的词不包含停用词）
  const expandedQueryWords = Array.from(queryWordsSet).filter(w => !stopWords.has(w));
  const technicalTerms = expandedQueryWords.filter(w => /^[a-z0-9]+$/.test(w));
  const technicalTermsSet = new Set(technicalTerms);

  const documents = await getAllDocuments();
  const docMap = new Map(documents.map(d => [d.id, d]));
  const categoriesData = await getCategories();
  const categoryIdSet = new Set();
  const categoryNameToId = new Map();
  collectCategoryMaps(categoriesData.tree || [], categoryIdSet, categoryNameToId);

  const results = [];

  // Pre-compile word patterns for faster matching if needed, but includes is often faster for simple strings

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const docId = file.replace('.json', '');
    const doc = docMap.get(docId);
    let filenameScoreBonus = 0;
    let categoryScoreBonus = 0;

    if (doc) {
      const filenameLower = doc.filename.toLowerCase();
      for (const word of expandedQueryWords) {
        if (filenameLower.includes(word)) filenameScoreBonus += 1;
      }

      // 分类优先加分：如果指定了分类，匹配分类的文档获得加分
      if (categoryIds && categoryIds.length > 0) {
        const docCatId = resolveDocumentCategoryId(doc, categoryIdSet, categoryNameToId);
        if (categoryIds.includes(docCatId)) {
          categoryScoreBonus = 6; // 分类匹配加分
        }
      }
    }

    const chunks = await getChunksFromFile(file);

    for (const chunk of chunks) {
      const content = typeof chunk.content === 'string' ? chunk.content : '';
      const contentLower = content.toLowerCase();
      if (!contentLower) continue;

      let score = 0;
      let matchedCount = 0;
      const hasExactMatch = contentLower.includes(queryLower);

      if (hasExactMatch) score += 10;

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

      const hasContentMatch = hasExactMatch || matchedCount > 0;
      if (!hasContentMatch) continue;

      const docScoreBonus = Math.min(filenameScoreBonus + categoryScoreBonus, 8);
      score += docScoreBonus;

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

export async function vectorSearchChunks(queryEmbedding, limit = 30, categoryIds = null) {
  await initStorage();
  const files = await fs.readdir(CHUNKS_DIR);
  let topResults = [];
  let mismatchCount = 0;
  let totalEmbeddings = 0;
  let mismatchExample = null;

  // 从配置读取向量搜索阈值
  const settings = await readJSON(SETTINGS_FILE, {});
  const minScore = settings.retrieval?.vectorMinScore ?? 0.2;

  // 获取文档映射用于分类匹配
  const documents = await getAllDocuments();
  const docMap = new Map(documents.map(d => [d.id, d]));
  const categoriesData = await getCategories();
  const categoryIdSet = new Set();
  const categoryNameToId = new Map();
  collectCategoryMaps(categoriesData.tree || [], categoryIdSet, categoryNameToId);

  // 第一步：从所有文件中收集所有chunks
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const docId = file.replace('.json', '');
    const doc = docMap.get(docId);

    const chunks = await getChunksFromFile(file);

    for (const chunk of chunks) {
      if (Array.isArray(chunk.embedding) && chunk.embedding.length > 0) {
        totalEmbeddings++;
        if (chunk.embedding.length !== queryEmbedding.length) {
          mismatchCount++;
          if (mismatchExample === null) mismatchExample = chunk.embedding.length;
          continue;
        }

        let score = cosine(queryEmbedding, chunk.embedding);

        // 分类优先加分：如果指定了分类，匹配分类的结果获得加分
        if (categoryIds && categoryIds.length > 0 && doc) {
          const docCatId = resolveDocumentCategoryId(doc, categoryIdSet, categoryNameToId);
          if (categoryIds.includes(docCatId)) {
            score += 0.05; // 分类匹配加分（向量分数范围 0-1）
          }
        }

        // 只保留相似度足够的结果
        if (score > minScore) {
          topResults.push({ chunk, score });
        }
      }
    }
  }

  if (mismatchCount > 0) {
    const mismatchSummary = totalEmbeddings > 0
      ? `${mismatchCount}/${totalEmbeddings}`
      : `${mismatchCount}`;
    const allMismatched = totalEmbeddings > 0 && mismatchCount === totalEmbeddings;
    const detail = mismatchExample !== null ? `, sample=${mismatchExample}` : '';
    const severity = allMismatched ? 'all' : 'partial';
    console.warn(`[vectorSearch] ${severity} embedding dimension mismatch: query=${queryEmbedding.length}${detail}, skipped=${mismatchSummary}. Consider regenerating embeddings.`);
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
      const content = typeof chunk.content === 'string' ? chunk.content : '';
      if (content && pattern.test(content)) {
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
  const apiKeys = settings.apiKeys || {};
  return apiKeys[provider] || null;
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

// ========== 反馈与指标 ==========

export async function addFeedbackEntry(entry) {
  await initStorage();
  const feedback = await readJSON(FEEDBACK_FILE, []);
  feedback.push(entry);
  if (feedback.length > 2000) {
    feedback.splice(0, feedback.length - 2000);
  }
  await writeJSON(FEEDBACK_FILE, feedback);

  // 负样本学习：如果是负面反馈，记录(query, documentId)对
  if (entry.verdict === 'down' && entry.question && entry.metadata?.references) {
    await recordNegativeSample(entry.question, entry.metadata.references);
  }

  return entry;
}

export async function getFeedbackMetrics() {
  await initStorage();
  const feedback = await readJSON(FEEDBACK_FILE, []);
  const total = feedback.length;
  const positive = feedback.filter(item => item.verdict === 'up').length;
  const negative = feedback.filter(item => item.verdict === 'down').length;
  const recent = feedback.slice(-10).reverse();

  return {
    total,
    positive,
    negative,
    positivityRate: total > 0 ? positive / total : 0,
    recent
  };
}

export async function getAllFeedback() {
  await initStorage();
  return await readJSON(FEEDBACK_FILE, []);
}

// ========== 负样本学习 ==========

const NEGATIVE_SAMPLES_FILE = path.join(DATA_DIR, 'negative_samples.json');

/**
 * 记录负样本：用户对某个查询+文档组合给出负反馈
 * @param {string} query - 查询文本
 * @param {Array} references - 参考文档列表
 */
async function recordNegativeSample(query, references) {
  const negativeSamples = await readJSON(NEGATIVE_SAMPLES_FILE, {});

  // 规范化query（小写、去空格）
  const normalizedQuery = query.toLowerCase().trim();

  if (!negativeSamples[normalizedQuery]) {
    negativeSamples[normalizedQuery] = {};
  }

  // 记录每个参考文档的负反馈次数
  if (Array.isArray(references)) {
    for (const ref of references) {
      const docId = ref.documentId || ref.id;
      if (docId) {
        negativeSamples[normalizedQuery][docId] = (negativeSamples[normalizedQuery][docId] || 0) + 1;
      }
    }
  }

  await writeJSON(NEGATIVE_SAMPLES_FILE, negativeSamples);
  console.log(`[NegativeSample] 已记录负样本: query="${normalizedQuery}", docs=${Object.keys(negativeSamples[normalizedQuery]).length}`);
}

/**
 * 获取负样本惩罚分数
 * @param {string} query - 查询文本
 * @param {string} documentId - 文档ID
 * @returns {number} - 惩罚分数（负数，用于降权）
 */
export async function getNegativePenalty(query, documentId) {
  if (!query || !documentId) return 0;

  const negativeSamples = await readJSON(NEGATIVE_SAMPLES_FILE, {});
  const normalizedQuery = query.toLowerCase().trim();

  // 精确匹配查询
  if (negativeSamples[normalizedQuery] && negativeSamples[normalizedQuery][documentId]) {
    const feedbackCount = negativeSamples[normalizedQuery][documentId];
    // 每个负反馈 -0.1分，最多 -0.5分
    return -Math.min(feedbackCount * 0.1, 0.5);
  }

  // 模糊匹配：查询包含关键词
  const queryKeywords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);
  for (const [cachedQuery, docs] of Object.entries(negativeSamples)) {
    // 如果当前查询包含缓存查询的所有词（或反之），认为相似
    const cachedKeywords = cachedQuery.split(/\s+/).filter(w => w.length > 2);
    const isMatch = queryKeywords.some(kw => cachedQuery.includes(kw)) ||
                   cachedKeywords.some(kw => normalizedQuery.includes(kw));

    if (isMatch && docs[documentId]) {
      const feedbackCount = docs[documentId];
      // 模糊匹配的惩罚减半
      return -Math.min(feedbackCount * 0.05, 0.25);
    }
  }

  return 0;
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
  if (searchCacheInvalidator) searchCacheInvalidator('addCategory');
  return newCat;
}

export async function updateCategory(categoryId, updates) {
  const categories = await getCategories();
  let previousName = null;

  const update = (nodes) => {
    for (const node of nodes) {
      if (node.id === categoryId) {
        previousName = node.name;
        Object.assign(node, updates);
        return true;
      }
      if (node.children && update(node.children)) return true;
    }
    return false;
  };
  update(categories.tree);

  await saveCategories(categories);

  if (previousName) {
    const documents = await getAllDocuments();
    const updatedDocuments = documents.map(doc => {
      const matchesId = doc.categoryId === categoryId;
      const matchesName = doc.category === previousName;
      const matchesLegacyId = doc.categoryId === previousName;
      if (matchesId || matchesName || matchesLegacyId) {
        return {
          ...doc,
          categoryId,
          category: updates.name || doc.category || previousName
        };
      }
      return doc;
    });
    await writeJSON(DOCUMENTS_FILE, updatedDocuments);
  }

  if (searchCacheInvalidator) searchCacheInvalidator('updateCategory');
  return categories;
}

export async function deleteCategory(categoryId) {
  if (categoryId === 'default') return false;

  const categories = await getCategories();
  let removedName = null;

  const remove = (nodes, parent) => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === categoryId) {
        removedName = nodes[i].name;
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
  const defaultName = DEFAULT_CATEGORIES.tree[0]?.name || '默认分类';
  const updated = documents.map(doc => {
    const matchesId = doc.categoryId === categoryId;
    const matchesName = removedName && doc.category === removedName;
    const matchesLegacyId = removedName && doc.categoryId === removedName;
    if (matchesId || matchesName || matchesLegacyId) {
      return { ...doc, categoryId: 'default', category: defaultName, categoryPath: ['default'] };
    }
    return doc;
  });
  await writeJSON(DOCUMENTS_FILE, updated);

  if (searchCacheInvalidator) searchCacheInvalidator('deleteCategory');
  return true;
}

/**
 * 递归获取分类及其所有子分类的 ID
 * @param {string} catId - 目标分类 ID
 * @param {Array} nodes - 分类树节点数组
 * @returns {string[]} - 包含目标分类及其所有子分类的 ID 数组
 */
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
