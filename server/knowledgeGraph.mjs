/**
 * 知识图谱模块 - Neo4j 集成
 * 实现实体抽取、图谱存储和混合检索
 */

import neo4j from 'neo4j-driver';
import * as storage from './storage.mjs';

// Neo4j 连接配置
let driver = null;
let isConnected = false;

// SiliconFlow API 配置
const SILICONFLOW_CHAT_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const DEFAULT_NER_MODEL = 'deepseek-ai/DeepSeek-V3';

/**
 * 使用 LLM 进行实体抽取（SiliconFlow API）
 * @param {string} text - 要抽取实体的文本
 * @param {Object} options - 选项
 * @returns {Object} 提取的实体（vendors, functions, commands, parameters, relationships）
 */
export async function extractEntitiesWithLLM(text, options = {}) {
  const {
    model = DEFAULT_NER_MODEL,
    timeout = 30000,
    source = 'llm-ner'
  } = options;

  if (!text || text.trim().length < 10) {
    return { vendors: [], functions: [], commands: [], parameters: [], relationships: [] };
  }

  // 截断过长文本
  const maxTextLength = 3000;
  const truncatedText = text.length > maxTextLength
    ? text.substring(0, maxTextLength) + '...'
    : text;

  try {
    const apiKey = await storage.getApiKey('siliconflow');
    if (!apiKey) {
      console.warn('[KnowledgeGraph] LLM NER 跳过: SiliconFlow API key 未配置');
      return null; // 返回 null 表示应该降级到正则方式
    }

    const systemPrompt = `你是一个网络技术文档实体识别专家。从文本中提取以下类型的实体：

1. **厂商 (vendors)**: 网络设备或软件厂商名称（如 NVIDIA, Cisco, Cumulus, Mellanox 等）
2. **功能 (functions)**: 网络功能或协议名称（如 VXLAN, BGP, MLAG, QoS, ECMP 等）
3. **命令 (commands)**: CLI 命令或配置命令（如 nv set, show interface, ip route 等）
4. **参数 (parameters)**: 命令参数或配置选项（如 --verbose, vni, peer-group 等）

请以 JSON 格式返回，格式如下：
{
  "vendors": ["厂商1", "厂商2"],
  "functions": ["功能1", "功能2"],
  "commands": ["命令1", "命令2"],
  "parameters": ["参数1", "参数2"]
}

注意：
- 只提取明确出现在文本中的实体
- 命令应保留完整格式（如 "nv set interface" 而不只是 "nv"）
- 如果某类实体没有找到，返回空数组
- 只返回 JSON，不要有其他内容`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(SILICONFLOW_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请从以下文本中提取网络技术相关实体：\n\n${truncatedText}` }
        ],
        temperature: 0.1, // 低温度保证一致性
        max_tokens: 1000
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`[KnowledgeGraph] LLM NER API 错误 ${response.status}: ${errorText.substring(0, 100)}`);
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();

    if (!content) {
      console.warn('[KnowledgeGraph] LLM NER 返回空内容');
      return null;
    }

    // 解析 JSON 响应
    let parsed;
    try {
      // 尝试提取 JSON（处理可能有额外文本的情况）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(content);
      }
    } catch (parseError) {
      console.warn('[KnowledgeGraph] LLM NER 解析失败:', content.substring(0, 100));
      return null;
    }

    // 转换为标准格式
    const entities = {
      vendors: (parsed.vendors || []).map(name => ({ name, source, heuristic: false })),
      functions: (parsed.functions || []).map(name => ({ name, source, heuristic: false })),
      commands: (parsed.commands || []).map(name => ({ name, category: 'config', source })),
      parameters: (parsed.parameters || []).map(name => ({ name, type: 'string', source })),
      relationships: []
    };

    console.log(`[KnowledgeGraph] LLM NER 提取: ${entities.vendors.length} 厂商, ${entities.functions.length} 功能, ${entities.commands.length} 命令, ${entities.parameters.length} 参数`);

    return entities;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('[KnowledgeGraph] LLM NER 超时');
    } else {
      console.error('[KnowledgeGraph] LLM NER 失败:', error.message);
    }
    return null;
  }
}

/**
 * 智能实体抽取：结合 LLM 和正则两种方式
 * @param {string} text - 文本内容
 * @param {Object} options - 选项
 * @returns {Object} 提取的实体
 */
export async function smartExtractEntities(text, options = {}) {
  const {
    useLLM = 'auto', // 'auto' | 'always' | 'never' | 'hybrid'
    llmThreshold = 500, // 文本长度阈值，超过则尝试 LLM
    ...regexOptions
  } = options;

  // 如果禁用 LLM，直接使用正则
  if (useLLM === 'never') {
    return extractEntities(text, regexOptions);
  }

  // 判断是否应该使用 LLM
  const shouldUseLLM = useLLM === 'always' ||
    (useLLM === 'auto' && text.length >= llmThreshold) ||
    useLLM === 'hybrid';

  if (shouldUseLLM) {
    const llmResult = await extractEntitiesWithLLM(text, options);

    if (llmResult) {
      if (useLLM === 'hybrid') {
        // 混合模式：合并 LLM 和正则结果
        const regexResult = extractEntities(text, regexOptions);
        return mergeEntityResults(llmResult, regexResult);
      }
      return llmResult;
    }
    // LLM 失败，降级到正则
    console.log('[KnowledgeGraph] LLM 失败，降级到正则方式');
  }

  return extractEntities(text, regexOptions);
}

/**
 * 合并两个实体抽取结果（去重）
 */
function mergeEntityResults(result1, result2) {
  const merged = {
    vendors: [],
    functions: [],
    commands: [],
    parameters: [],
    relationships: []
  };

  const seenVendors = new Set();
  const seenFunctions = new Set();
  const seenCommands = new Set();
  const seenParameters = new Set();

  for (const r of [result1, result2]) {
    for (const v of r.vendors || []) {
      const key = v.name?.toLowerCase();
      if (key && !seenVendors.has(key)) {
        seenVendors.add(key);
        merged.vendors.push(v);
      }
    }
    for (const f of r.functions || []) {
      const key = f.name?.toLowerCase();
      if (key && !seenFunctions.has(key)) {
        seenFunctions.add(key);
        merged.functions.push(f);
      }
    }
    for (const c of r.commands || []) {
      const key = c.name?.toLowerCase();
      if (key && !seenCommands.has(key)) {
        seenCommands.add(key);
        merged.commands.push(c);
      }
    }
    for (const p of r.parameters || []) {
      const key = p.name?.toLowerCase();
      if (key && !seenParameters.has(key)) {
        seenParameters.add(key);
        merged.parameters.push(p);
      }
    }
    merged.relationships.push(...(r.relationships || []));
  }

  return merged;
}

/**
 * 初始化 Neo4j 连接
 */
export async function initNeo4j() {
  if (isConnected && driver) {
    return driver;
  }

  try {
    const settings = await storage.getSettings();
    const neo4jConfig = settings?.neo4j || {};

    const uri = neo4jConfig.uri || process.env.NEO4J_URI || 'bolt://localhost:7687';
    const username = neo4jConfig.username || process.env.NEO4J_USERNAME || 'neo4j';
    const password = neo4jConfig.password || process.env.NEO4J_PASSWORD || 'password';

    driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 30000,
      disableLosslessIntegers: true
    });

    // 验证连接
    await driver.verifyConnectivity();
    isConnected = true;
    console.log('[KnowledgeGraph] ✅ Neo4j 连接成功');

    // 初始化 Schema
    await initSchema();

    return driver;
  } catch (error) {
    console.error('[KnowledgeGraph] ❌ Neo4j 连接失败:', error.message);
    isConnected = false;
    throw error;
  }
}

/**
 * 初始化知识图谱 Schema
 * 创建索引和约束以提升查询性能
 */
async function initSchema() {
  const session = driver.session();
  try {
    // 创建唯一性约束（自动创建索引）
    await session.run(`
      CREATE CONSTRAINT vendor_name_unique IF NOT EXISTS
      FOR (v:Vendor) REQUIRE v.name IS UNIQUE
    `);

    await session.run(`
      CREATE CONSTRAINT function_name_unique IF NOT EXISTS
      FOR (f:Function) REQUIRE f.name IS UNIQUE
    `);

    await session.run(`
      CREATE CONSTRAINT command_name_unique IF NOT EXISTS
      FOR (c:Command) REQUIRE c.name IS UNIQUE
    `);

    await session.run(`
      CREATE CONSTRAINT parameter_name_unique IF NOT EXISTS
      FOR (p:Parameter) REQUIRE p.name IS UNIQUE
    `);

    // 创建 Chunk 节点约束和索引
    await session.run(`
      CREATE CONSTRAINT chunk_id_unique IF NOT EXISTS
      FOR (ch:Chunk) REQUIRE ch.id IS UNIQUE
    `);

    await session.run(`
      CREATE INDEX chunk_document_idx IF NOT EXISTS
      FOR (ch:Chunk) ON (ch.documentId)
    `);

    // 创建全文索引用于搜索
    await session.run(`
      CREATE FULLTEXT INDEX kg_search IF NOT EXISTS
      FOR (n:Vendor|Function|Command) ON EACH [n.name]
    `);

    console.log('[KnowledgeGraph] ✅ Schema 初始化完成');
  } catch (error) {
    console.error('[KnowledgeGraph] Schema 初始化错误:', error.message);
  } finally {
    await session.close();
  }
}

/**
 * 关闭 Neo4j 连接
 */
export async function closeNeo4j() {
  if (driver) {
    await driver.close();
    driver = null;
    isConnected = false;
    console.log('[KnowledgeGraph] Neo4j 连接已关闭');
  }
}

const DEFAULT_FUNCTION_NAME = 'general';

const FUNCTION_DOMAIN_TERMS = new Map([
  // === 基础网络功能 ===
  ['routing', 'Routing'],
  ['route', 'Routing'],
  ['interface', 'Interface'],
  ['qos', 'QoS'],
  ['security', 'Security'],
  ['monitoring', 'Monitoring'],
  ['telemetry', 'Telemetry'],
  ['system', 'System'],
  ['platform', 'System'],
  ['firewall', 'Firewall'],
  ['gateway', 'Gateway'],
  ['switch', 'Switch'],
  ['switching', 'Switching'],
  ['router', 'Router'],

  // === 数据中心网络 ===
  ['datacenter', 'Datacenter Networking'],
  ['data center', 'Datacenter Networking'],
  ['数据中心', 'Datacenter Networking'],
  ['fabric', 'Network Fabric'],
  ['leaf-spine', 'Leaf-Spine'],
  ['leaf spine', 'Leaf-Spine'],
  ['underlay', 'Underlay Network'],
  ['overlay', 'Overlay Network'],
  ['spine', 'Spine Switch'],
  ['leaf', 'Leaf Switch'],
  ['clos', 'Clos Topology'],

  // === SDN 与自动化 ===
  ['sdn', 'SDN'],
  ['software defined', 'SDN'],
  ['netconf', 'NETCONF'],
  ['yang', 'YANG'],
  ['ansible', 'Ansible Automation'],
  ['automation', 'Network Automation'],
  ['自动化', 'Network Automation'],
  ['openconfig', 'OpenConfig'],
  ['restconf', 'RESTCONF'],
  ['零接触', 'Zero Touch Provisioning'],
  ['ztp', 'Zero Touch Provisioning'],

  // === NVIDIA 特定技术 ===
  ['cumulus', 'Cumulus Linux'],
  ['nvue', 'NVUE'],
  ['netq', 'NetQ'],
  ['spectrum', 'Spectrum ASIC'],
  ['switchx', 'SwitchX'],
  ['bluefield', 'BlueField DPU'],
  ['dpu', 'DPU'],
  ['connectx', 'ConnectX'],
  ['mellanox', 'Mellanox'],

  // === RoCE / RDMA ===
  ['rdma', 'RDMA'],
  ['roce', 'RoCE'],
  ['rocev2', 'RoCEv2'],
  ['infiniband', 'InfiniBand'],
  ['ib', 'InfiniBand'],
  ['pfc', 'Priority Flow Control'],
  ['ecn', 'ECN'],
  ['congestion', 'Congestion Control'],
  ['拥塞控制', 'Congestion Control'],
  ['lossless', 'Lossless Networking'],
  ['无损网络', 'Lossless Networking'],

  // === 高级路由协议 ===
  ['segment routing', 'Segment Routing'],
  ['sr', 'Segment Routing'],
  ['srv6', 'SRv6'],
  ['mpls', 'MPLS'],
  ['ldp', 'LDP'],
  ['rsvp', 'RSVP-TE'],

  // === 其他网络功能 ===
  ['nat', 'NAT'],
  ['地址转换', 'NAT'],
  ['multicast', 'Multicast'],
  ['组播', 'Multicast'],
  ['igmp', 'IGMP'],
  ['pim', 'PIM'],
  ['spanning tree', 'STP'],
  ['生成树', 'STP'],
  ['port channel', 'Port Channel'],
  ['端口聚合', 'Port Channel'],
  ['bond', 'Bonding'],
  ['mlag', 'MLAG'],
  ['clag', 'MLAG'],
  ['peerlink', 'MLAG'],
  ['peer link', 'MLAG'],
  ['多机箱', 'MLAG'],
  ['跨机箱', 'MLAG'],
  ['双机箱', 'MLAG'],
  ['高可用', 'High Availability'],
  ['ha', 'High Availability'],
  ['failover', 'Failover'],
  ['故障转移', 'Failover'],

  // === 中文映射 ===
  ['路由', 'Routing'],
  ['接口', 'Interface'],
  ['安全', 'Security'],
  ['监控', 'Monitoring'],
  ['日志', 'Monitoring'],
  ['系统', 'System'],
  ['防火墙', 'Firewall'],
  ['网关', 'Gateway'],
  ['交换机', 'Switch'],
  ['路由器', 'Router'],
  ['访问控制', 'ACL'],
  ['虚拟局域网', 'VLAN'],
  ['链路聚合', 'LACP']
]);

const FUNCTION_HINT_TERMS = [
  'protocol',
  'feature',
  'service',
  'routing',
  'overlay',
  'tunnel',
  'tunneling',
  'control',
  'security',
  'monitoring',
  'telemetry',
  'switching',
  'bridging',
  'configuration',
  '配置',
  '协议'
];

const FUNCTION_CONTEXT_TERMS = [
  'protocol',
  'routing',
  'overlay',
  'tunnel',
  'tunneling',
  'feature',
  'service',
  'switching',
  'bridging',
  'security',
  'monitoring',
  'telemetry'
];

const FUNCTION_CONTEXT_REGEX = new RegExp(
  `\\b(?:${FUNCTION_CONTEXT_TERMS.map(escapeRegExp).join('|')})\\b`,
  'i'
);

const FUNCTION_ACRONYM_STOPWORDS = new Set([
  'CPU', 'GPU', 'NIC', 'PCI', 'PCIE', 'OS', 'CLI', 'API', 'SDK',
  'IP', 'TCP', 'UDP', 'HTTP', 'HTTPS', 'FTP', 'SSH', 'TLS', 'SSL',
  'SNMP', 'NTP', 'DNS', 'DHCP', 'MAC', 'MTU', 'UUID'
]);

const FUNCTION_TOKEN_STOPWORDS = new Set([
  'show', 'set', 'config', 'configure', 'configuration', 'enable', 'disable',
  'add', 'delete', 'remove', 'unset', 'apply', 'list', 'get', 'status',
  'route', 'router', 'interface', 'system', 'default', 'general', 'nv',
  'vendor', 'vendors', 'guide', 'manual', 'document', 'documentation',
  'example', 'sample', 'section', 'chapter', 'table', 'figure',
  'the', 'and', 'or', 'for', 'with', 'from', 'this', 'that', 'these', 'those',
  'in', 'on', 'by', 'to', 'of', 'as', 'at', 'is', 'are', 'be', 'has', 'have'
]);

const LOWER_FUNCTION_ALLOWLIST = new Set([
  'bgp', 'ospf', 'evpn', 'vxlan', 'mlag', 'clag', 'lacp', 'stp', 'vlan', 'vrf',
  'acl', 'bfd', 'roce', 'rdma', 'pfc', 'ecn', 'ntp', 'snmp', 'dhcp', 'dns',
  'arp', 'nd', 'igmp', 'pim', 'ptp', 'qos', 'dpu', 'nvue', 'netq', 'lldp',
  'sr', 'srv6', 'mpls', 'vni', 'vtep', 'vrf', 'ztp'
]);

const VENDOR_LABEL_TERMS = [
  'vendor', 'manufacturer', 'company', 'corp', 'corporation', 'inc',
  'supplier', 'provider',
  '厂商', '供应商', '公司', '集团', '品牌'
];

const VENDOR_STOPWORDS = new Set([
  'linux', 'user', 'guide', 'configuration', 'configure', 'command', 'commands',
  'network', 'networks', 'system', 'systems', 'software', 'platform',
  'switch', 'router', 'routing', 'protocol', 'documentation', 'manual',
  'overview', 'default', 'general', 'enable', 'disable', 'set', 'show',
  'use', 'using', 'run', 'install', 'setup', 'chapter', 'section', 'example'
]);

const VENDOR_CONTEXT_TERMS = [
  'switch', 'router', 'hardware', 'platform', 'linux', 'operating system',
  'network', 'networks', 'device', 'appliance', 'manual', 'guide', 'documentation',
  '交换机', '路由器', '硬件', '平台', '系统', '网络', '设备', '文档', '手册'
];

const VENDOR_SUFFIXES = [
  'Networks', 'Systems', 'Technologies', 'Technology', 'Communications',
  'Software', 'Solutions', 'Labs', 'Group', 'Holdings', 'Inc', 'Corp',
  'Corporation', 'Ltd', 'Limited', 'Company', 'Co', 'Co.'
];

const VENDOR_STRIP_SUFFIXES = new Set([
  'Inc', 'Corp', 'Corporation', 'Ltd', 'Limited', 'Company', 'Co', 'Co.',
  'Group', 'Holdings', 'Linux', 'OS'
]);

const DEFAULT_VENDOR_NAME = 'NVIDIA';
const VENDOR_ALIAS_GROUPS = [
  { canonical: 'NVIDIA', aliases: ['nvidia', '英伟达', '英偉達'] },
  { canonical: 'Mellanox', aliases: ['mellanox', '迈络思', '梅兰诺克斯'] },
  { canonical: 'Cumulus', aliases: ['cumulus'] },
  { canonical: 'Cisco', aliases: ['cisco', '思科'] },
  { canonical: 'Juniper', aliases: ['juniper', '瞻博'] },
  { canonical: 'Arista', aliases: ['arista', '阿里斯塔'] },
  { canonical: 'Huawei', aliases: ['huawei', '华为'] },
  { canonical: 'H3C', aliases: ['h3c', '新华三'] },
  { canonical: 'Ruijie', aliases: ['ruijie', '锐捷'] },
  { canonical: 'Dell', aliases: ['dell', '戴尔'] }
];
const MULTI_VENDOR_SIGNALS = [
  /\bvs\b/i,
  /\bversus\b/i,
  /\bcompare\b/i,
  /\bcomparison\b/i,
  /对比|比较|区别|差异/
];

// 语义关系模式 - 用于提取命令/功能之间的高级关系
const SEMANTIC_RELATIONSHIP_PATTERNS = {
  // REPLACES: 替代/废弃关系
  replaces: [
    /(\w+[\w\-\s]+)\s+(?:replaces?|supersedes?|deprecated)\s+(\w+[\w\-\s]+)/gi,
    /(\w+[\w\-\s]+)\s+(?:is\s+)?(?:the\s+)?(?:new|replacement|successor)\s+(?:for|of|to)\s+(\w+[\w\-\s]+)/gi,
    /(?:use|prefer)\s+(\w+[\w\-\s]+)\s+instead\s+of\s+(\w+[\w\-\s]+)/gi,
    /(\w+[\w\-\s]+)\s+取代\s*(?:了)?\s*(\w+[\w\-\s]+)/g,
    /(\w+[\w\-\s]+)\s+已?(?:弃用|废弃|过时).*?(?:使用|用)\s*(\w+[\w\-\s]+)/g
  ],
  // REQUIRES: 依赖关系
  requires: [
    /(\w+[\w\-\s]+)\s+(?:requires?|needs?|depends?\s+on)\s+(\w+[\w\-\s]+)/gi,
    /(?:before|prior\s+to)\s+(?:using|running|enabling)\s+(\w+[\w\-\s]+).*?(?:must|need\s+to|should)\s+(?:enable|configure|set)\s+(\w+[\w\-\s]+)/gi,
    /(\w+[\w\-\s]+)\s+(?:依赖|需要|前提)\s*(?:是)?\s*(\w+[\w\-\s]+)/g,
    /(?:启用|使用|配置)\s*(\w+[\w\-\s]+)\s*(?:之前|前).*?(?:需要|必须)\s*(?:先)?\s*(?:启用|配置)\s*(\w+[\w\-\s]+)/g
  ],
  // SIMILAR_TO: 相似关系
  similarTo: [
    /(\w+[\w\-\s]+)\s+(?:is\s+)?(?:similar|equivalent|comparable)\s+to\s+(\w+[\w\-\s]+)/gi,
    /(\w+[\w\-\s]+)\s+(?:和|与)\s*(\w+[\w\-\s]+)\s*(?:类似|相似|相当|等效)/g
  ],
  // CONFLICTS_WITH: 冲突关系
  conflictsWith: [
    /(\w+[\w\-\s]+)\s+(?:conflicts?\s+with|incompatible\s+with|cannot\s+be\s+used\s+with)\s+(\w+[\w\-\s]+)/gi,
    /(\w+[\w\-\s]+)\s+(?:和|与)\s*(\w+[\w\-\s]+)\s*(?:冲突|不兼容|互斥)/g
  ]
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function indexOfKeyword(textLower, keywordLower) {
  if (!keywordLower) return -1;
  if (/^[a-z0-9][a-z0-9\\s\\-]*$/.test(keywordLower)) {
    const regex = new RegExp(`\\b${escapeRegExp(keywordLower)}\\b`, 'i');
    const match = regex.exec(textLower);
    return match ? match.index : -1;
  }
  return textLower.indexOf(keywordLower);
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function toNumber(value, fallback = 0) {
  if (value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeVendorName(value) {
  const cleaned = normalizeWhitespace(String(value || '').replace(/["'()[\]<>]/g, ''));
  const stripped = cleaned.replace(/^(the|a|an)\s+/i, '');
  return stripped.replace(/[.,;:]+$/g, '');
}

function isStopwordVendor(value) {
  const lowered = value.toLowerCase();
  return VENDOR_STOPWORDS.has(lowered);
}

function normalizeVendorKey(value) {
  return String(value || '').trim().toLowerCase();
}

function findVendorNameMatch(vendorNames, target) {
  const normalized = normalizeVendorKey(target);
  if (!normalized) return null;
  return vendorNames.find(name => normalizeVendorKey(name) === normalized) || null;
}

function resolveVendorGroupName(group, vendorNames) {
  const candidates = [group.canonical, ...group.aliases];
  for (const vendorName of vendorNames) {
    const normalized = normalizeVendorKey(vendorName);
    if (!normalized) continue;
    if (candidates.some(candidate => normalizeVendorKey(candidate) === normalized)) {
      return vendorName;
    }
  }
  return group.canonical;
}

function resolveVendorAlias(value, vendorNames) {
  const normalized = normalizeVendorKey(value);
  if (!normalized) return null;
  const group = VENDOR_ALIAS_GROUPS.find(entry => {
    if (normalizeVendorKey(entry.canonical) === normalized) return true;
    return entry.aliases.some(alias => normalizeVendorKey(alias) === normalized);
  });
  if (!group) return null;
  return resolveVendorGroupName(group, vendorNames);
}

function resolveVendorNameFromText(value, vendorNames) {
  return findVendorNameMatch(vendorNames, value) || resolveVendorAlias(value, vendorNames) || value;
}

/**
 * 从文本中提取语义关系（替代、依赖、相似、冲突）
 * @param {string} text - 文本内容
 * @param {Set} knownEntities - 已知的实体名称集合
 * @returns {Array} 语义关系列表
 */
function extractSemanticRelationships(text, knownEntities = new Set()) {
  const relationships = [];
  const seenRelations = new Set();

  const relationshipTypes = {
    replaces: 'REPLACES',
    requires: 'REQUIRES',
    similarTo: 'SIMILAR_TO',
    conflictsWith: 'CONFLICTS_WITH'
  };

  for (const [patternType, patterns] of Object.entries(SEMANTIC_RELATIONSHIP_PATTERNS)) {
    const relType = relationshipTypes[patternType];

    for (const pattern of patterns) {
      // 重置正则状态
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const entity1 = match[1]?.trim();
        const entity2 = match[2]?.trim();

        // 验证实体名称合理性
        if (!entity1 || !entity2 || entity1.length < 2 || entity2.length < 2) continue;
        if (entity1.length > 50 || entity2.length > 50) continue;
        if (entity1.toLowerCase() === entity2.toLowerCase()) continue;

        // 创建唯一键避免重复
        const key = `${entity1.toLowerCase()}|${relType}|${entity2.toLowerCase()}`;
        if (seenRelations.has(key)) continue;
        seenRelations.add(key);

        // 确定实体类型（优先使用已知实体）
        const type1 = knownEntities.has(entity1.toLowerCase()) ? 'Command' : 'Function';
        const type2 = knownEntities.has(entity2.toLowerCase()) ? 'Command' : 'Function';

        relationships.push({
          from: entity1,
          to: entity2,
          type: relType,
          fromType: type1,
          toType: type2
        });
      }
    }
  }

  return relationships;
}

function detectVendorMentions(text, vendorNames) {
  const matches = [];
  const seen = new Set();
  const textLower = text.toLowerCase();

  const addMatch = (name, index) => {
    const key = normalizeVendorKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    matches.push({ name, index });
  };

  for (const vendorName of vendorNames) {
    const vendorLower = normalizeVendorKey(vendorName);
    if (!vendorLower) continue;
    const index = indexOfKeyword(textLower, vendorLower);
    if (index !== -1 || text.includes(vendorName)) {
      addMatch(vendorName, index === -1 ? textLower.indexOf(vendorLower) : index);
    }
  }

  for (const group of VENDOR_ALIAS_GROUPS) {
    for (const alias of group.aliases) {
      const aliasLower = normalizeVendorKey(alias);
      if (!aliasLower) continue;
      const index = indexOfKeyword(textLower, aliasLower);
      if (index === -1) continue;
      const resolved = resolveVendorGroupName(group, vendorNames);
      addMatch(resolved, index);
    }
  }

  matches.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return matches;
}

export function detectPreferredVendors(text, vendorNames = [], options = {}) {
  const safeText = typeof text === 'string' ? text : '';
  const defaultVendor = resolveVendorNameFromText(
    options.defaultVendor || process.env.DEFAULT_VENDOR || DEFAULT_VENDOR_NAME,
    vendorNames
  );
  const explicitMatches = detectVendorMentions(safeText, vendorNames);
  const explicitVendors = explicitMatches.map(match => match.name);

  const allowMultiple = options.allowMultiple === true ||
    MULTI_VENDOR_SIGNALS.some(pattern => pattern.test(safeText));

  if (explicitVendors.length === 0) {
    return {
      explicitVendors: [],
      preferredVendors: defaultVendor ? [defaultVendor] : [],
      usedDefault: Boolean(defaultVendor)
    };
  }

  if (explicitVendors.length > 1 && !allowMultiple) {
    let chosen = explicitVendors[0];
    if (defaultVendor) {
      const defaultIndex = explicitVendors.findIndex(v =>
        normalizeVendorKey(v) === normalizeVendorKey(defaultVendor)
      );
      if (defaultIndex !== -1) {
        chosen = explicitVendors[defaultIndex];
      }
    }
    return {
      explicitVendors,
      preferredVendors: [chosen],
      usedDefault: false
    };
  }

  return {
    explicitVendors,
    preferredVendors: explicitVendors,
    usedDefault: false
  };
}

function normalizeFunctionName(value) {
  const trimmed = normalizeWhitespace(String(value || ''));
  if (!trimmed) return '';
  if (/^[A-Z0-9\-]+$/.test(trimmed)) return trimmed;
  return trimmed.replace(/\b\w/g, (char) => char.toUpperCase());
}

function looksLikeAcronym(value) {
  const letters = value.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2 || letters.length > 8) return false;
  const upperCount = letters.replace(/[^A-Z]/g, '').length;
  return upperCount >= Math.ceil(letters.length * 0.6);
}

function looksLikeLowerAcronym(value) {
  if (!/^[a-z]{2,6}$/.test(value)) return false;
  if (FUNCTION_TOKEN_STOPWORDS.has(value)) return false;
  return LOWER_FUNCTION_ALLOWLIST.has(value);
}

const COMMAND_PROMPT_REGEX = /^[\w.-]+@[\w.-]+(?:[:~][\w/.~-]*)?[#$]\s+/;
const INTERFACE_TOKEN_REGEX = /^(?:eth|swp|bond|vlan)\d+(?:\.\d+)?$/i;
const INTERFACE_RANGE_REGEX = /^(?:eth|swp|bond)\d+(?:-\d+)$/i;
const PEERLINK_TOKEN_REGEX = /^peerlink(?:\.\d+)?$/i;
const IP_TOKEN_REGEX = /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/;
const MAC_TOKEN_REGEX = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const HEX_TOKEN_REGEX = /^0x[0-9a-f]+$/i;
const NUMBER_TOKEN_REGEX = /^\d+$/;
const COMMAND_CONFIG_VERBS = new Set([
  'configure', 'show', 'set', 'get', 'enable', 'disable', 'add', 'delete', 'remove'
]);
const COMMAND_CONFIG_OBJECTS = new Set([
  'interface', 'vlan', 'bridge', 'bond', 'router', 'bgp', 'ospf', 'mlag', 'clag',
  'vrf', 'evpn', 'vxlan', 'lacp', 'stp', 'pfc', 'roce', 'qos', 'acl', 'bfd'
]);
const COMMAND_ARTICLES = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those']);
const COMMAND_STOPWORDS = new Set(['address', 'addresses', 'packet', 'packets']);

function cleanCommandLine(line) {
  let cleaned = String(line || '').trim();
  if (!cleaned) return '';
  cleaned = cleaned.replace(COMMAND_PROMPT_REGEX, '');
  cleaned = cleaned.replace(/^[#$]\s+/, '');
  cleaned = cleaned.replace(/\s+#\s.*$/, '');
  return cleaned.trim();
}

function normalizeCommandName(value) {
  const cleaned = normalizeWhitespace(String(value || '').replace(/[;]+$/g, ''));
  if (!cleaned) return '';
  const tokens = cleaned.split(' ').map((token) => token.replace(/[;,]+$/g, '')).filter(Boolean);
  const normalizedTokens = tokens.map((token) => {
    const lowered = token.toLowerCase();
    if (IP_TOKEN_REGEX.test(lowered)) return '<ip>';
    if (MAC_TOKEN_REGEX.test(lowered)) return '<mac>';
    if (HEX_TOKEN_REGEX.test(lowered)) return '<hex>';
    if (NUMBER_TOKEN_REGEX.test(lowered)) return '<num>';
    if (PEERLINK_TOKEN_REGEX.test(lowered)) return token;
    if (INTERFACE_RANGE_REGEX.test(lowered)) return '<iface-range>';
    if (INTERFACE_TOKEN_REGEX.test(lowered)) return '<iface>';
    return token;
  });
  return normalizedTokens.join(' ').trim();
}

function isCommandNoise(command, category) {
  const tokens = String(command || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return true;

  const first = tokens[0].toLowerCase();
  const second = tokens[1]?.toLowerCase();

  if (category === 'nvue' && tokens.length < 3) return true;
  if (category === 'config' && COMMAND_CONFIG_VERBS.has(first)) {
    if (!second || COMMAND_ARTICLES.has(second) || COMMAND_STOPWORDS.has(second)) return true;
    if (NUMBER_TOKEN_REGEX.test(second)) return true;
    if (!COMMAND_CONFIG_OBJECTS.has(second)) return true;
  }

  if (category === 'linux' && first === 'ip') {
    const ipSubcommands = new Set(['addr', 'link', 'route', 'neigh', 'rule', 'maddr']);
    if (!second || !ipSubcommands.has(second)) return true;
  }

  return false;
}

function extractCommandCandidates(text) {
  if (!text || typeof text !== 'string') return [];
  const candidates = new Set();
  const codeBlocks = [];
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const content = match[0]
      .replace(/```[\s\S]*?\n?/, '')
      .replace(/```$/, '');
    if (content.trim()) {
      codeBlocks.push(content);
    }
  }

  const addLine = (line) => {
    const cleaned = cleanCommandLine(line);
    if (cleaned) {
      candidates.add(cleaned);
    }
  };

  if (codeBlocks.length > 0) {
    codeBlocks.forEach(block => {
      block.split('\n').forEach(addLine);
    });
  }

  const inlineMatches = text.match(/`([^`]+)`/g) || [];
  inlineMatches.forEach(item => {
    const value = item.replace(/`/g, '').trim();
    if (value) {
      candidates.add(value);
    }
  });

  text.split('\n').forEach(line => {
    if (COMMAND_PROMPT_REGEX.test(line) || /^\s*[#$]\s+/.test(line) || /^\s*nv\s+/i.test(line)) {
      addLine(line);
    }
  });

  return Array.from(candidates);
}

function extractVendorCandidates(text, options = {}) {
  const candidates = new Map();
  const textLower = text.toLowerCase();
  const vendorNames = Array.isArray(options.vendorNames) ? options.vendorNames : [];
  const explicitVendor = options.vendorName;
  const allowHeuristic = options.allowHeuristic !== false;

  const addCandidate = (name) => {
    const cleanName = normalizeVendorName(name);
    if (!cleanName) return;
    if (isStopwordVendor(cleanName)) return;
    const key = cleanName.toLowerCase();
    if (!candidates.has(key)) {
      candidates.set(key, cleanName);
    }
  };

  if (explicitVendor) {
    addCandidate(explicitVendor);
  }

  for (const vendorName of vendorNames) {
    const vendorLower = typeof vendorName === 'string' ? vendorName.toLowerCase() : '';
    if (!vendorLower) continue;
    if (indexOfKeyword(textLower, vendorLower) !== -1 || text.includes(vendorName)) {
      addCandidate(vendorName);
    }
  }

  if (allowHeuristic) {
    const vendorLabelRegex = new RegExp(
      `(?:${VENDOR_LABEL_TERMS.join('|')})\\s*[:：]?\\s*([A-Za-z0-9&.\\- ]{2,40}|[\\u4e00-\\u9fa5]{2,10})`,
      'gi'
    );
    for (const match of text.matchAll(vendorLabelRegex)) {
      addCandidate(match[1]);
    }

    const suffixPattern = new RegExp(
      `\\b([A-Z][A-Za-z0-9&.\\-]{1,}(?:\\s+[A-Z][A-Za-z0-9&.\\-]{1,}){0,2})\\s+(${VENDOR_SUFFIXES.join('|')})\\b`,
      'g'
    );
    for (const match of text.matchAll(suffixPattern)) {
      const phrase = normalizeWhitespace(match[1]);
      const suffix = match[2];
      const candidate = VENDOR_STRIP_SUFFIXES.has(suffix) ? phrase : `${phrase} ${suffix}`;
      addCandidate(candidate);
    }

    for (const match of text.matchAll(/\b[A-Z][a-z][A-Za-z0-9&.\-]{2,}\b/g)) {
      const token = match[0];
      if (isStopwordVendor(token)) continue;
      if (typeof match.index === 'number') {
        const windowStart = Math.max(0, match.index - 20);
        const windowEnd = Math.min(textLower.length, match.index + token.length + 20);
        const windowText = textLower.slice(windowStart, windowEnd);
        const hasContext = VENDOR_CONTEXT_TERMS.some(term => windowText.includes(term));
        if (!hasContext) continue;
      } else {
        continue;
      }
      addCandidate(token);
    }

    for (const match of text.matchAll(/\b[A-Z][A-Z0-9&.\-]{2,}\b/g)) {
      const token = match[0];
      const upperToken = token.toUpperCase();
      const minLength = /\d/.test(upperToken) ? 3 : 5;
      if (upperToken.length < minLength) continue;
      if (FUNCTION_ACRONYM_STOPWORDS.has(upperToken)) continue;
      if (typeof match.index === 'number' && upperToken.length <= 5) {
        const windowStart = Math.max(0, match.index - 30);
        const windowEnd = Math.min(textLower.length, match.index + token.length + 30);
        const windowText = textLower.slice(windowStart, windowEnd);
        if (FUNCTION_CONTEXT_REGEX.test(windowText)) continue;
      }
      addCandidate(token);
    }
  }

  return Array.from(candidates.values());
}

function extractFunctionCandidates(text, options = {}) {
  const candidates = new Map();
  const vendorNames = new Set(
    (options.vendorNames || [])
      .map((name) => String(name || '').toLowerCase())
      .filter(Boolean)
  );

  const addCandidate = (name) => {
    const normalized = normalizeFunctionName(name);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (vendorNames.has(key)) return;
    if (!candidates.has(key)) {
      candidates.set(key, normalized);
    }
  };

  const textLower = text.toLowerCase();
  for (const [term, name] of FUNCTION_DOMAIN_TERMS.entries()) {
    if (indexOfKeyword(textLower, term.toLowerCase()) !== -1) {
      addCandidate(name);
    }
  }

  const hintPattern = FUNCTION_HINT_TERMS.map(escapeRegExp).join('|');
  const hintRegex = new RegExp(
    `\\b([A-Z][A-Za-z0-9&.\\-]{1,}(?:\\s+[A-Z][A-Za-z0-9&.\\-]{1,}){0,2})\\s+(?:${hintPattern})\\b`,
    'g'
  );
  for (const match of text.matchAll(hintRegex)) {
    addCandidate(match[1]);
  }

  const tokenRegex = /\b[A-Za-z0-9][A-Za-z0-9\-]{1,}\b/g;
  for (const match of text.matchAll(tokenRegex)) {
    const token = match[0];
    const lowerToken = token.toLowerCase();
    if (FUNCTION_TOKEN_STOPWORDS.has(lowerToken)) continue;
    const isLowerAcronym = looksLikeLowerAcronym(lowerToken);
    const isUpperAcronym = looksLikeAcronym(token);
    if (!isLowerAcronym && !isUpperAcronym) continue;
    const normalized = token.toUpperCase();
    if (FUNCTION_ACRONYM_STOPWORDS.has(normalized)) continue;

    if (!isLowerAcronym && !LOWER_FUNCTION_ALLOWLIST.has(lowerToken)) {
      if (typeof match.index !== 'number') continue;
      const windowStart = Math.max(0, match.index - 30);
      const windowEnd = Math.min(textLower.length, match.index + token.length + 30);
      const windowText = textLower.slice(windowStart, windowEnd);
      if (!FUNCTION_CONTEXT_REGEX.test(windowText)) continue;
    }

    addCandidate(normalized);
  }

  return new Set(candidates.values());
}

function inferFunctionsFromText(text, options = {}) {
  return extractFunctionCandidates(text, options);
}

/**
 * 实体抽取 - 从文本中提取厂商、功能、命令、参数等实体
 * @param {string} text - 输入文本
 * @param {Object} metadata - 文档元数据
 * @returns {Object} 提取的实体
 */
export function extractEntities(text, metadata = {}) {
  const entities = {
    vendors: [],
    functions: [],
    commands: [],
    parameters: [],
    relationships: []
  };

  if (!text || typeof text !== 'string') {
    return entities;
  }

  const textLower = text.toLowerCase();
  const source = metadata.documentId || metadata.source || 'unknown';
  const allowDefaultFunction = metadata.allowDefaultFunction !== false;

  const vendorMap = new Map();
  const functionMap = new Map();
  const commandMap = new Map();
  const parameterMap = new Map();

  const addVendor = (name) => {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) return;
    const key = cleanName.toLowerCase();
    if (!vendorMap.has(key)) {
      vendorMap.set(key, { name: cleanName, source });
    }
  };

  const addFunction = (name) => {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) return;
    const key = cleanName.toLowerCase();
    if (!functionMap.has(key)) {
      functionMap.set(key, { name: cleanName, source });
    }
  };

  const addCommand = (name, category) => {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const normalizedName = normalizeCommandName(cleanName);
    if (!normalizedName || normalizedName.length <= 3) return null;
    if (isCommandNoise(normalizedName, category)) return null;
    const key = normalizedName.toLowerCase();
    if (!commandMap.has(key)) {
      commandMap.set(key, { name: normalizedName, category, source });
    }
    return normalizedName;
  };

  const addParameter = (name, type) => {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName || cleanName.length <= 1) return;
    const key = cleanName.toLowerCase();
    if (!parameterMap.has(key)) {
      parameterMap.set(key, { name: cleanName, type, source });
    }
  };

  // 1. 提取厂商实体（文档元数据 + 文本模式）
  const vendorCandidates = extractVendorCandidates(text, {
    vendorName: metadata.vendorName,
    vendorNames: metadata.vendorNames,
    allowHeuristic: metadata.allowHeuristicVendors !== false
  });

  for (const vendorName of vendorCandidates) {
    addVendor(vendorName);
  }

  // 2. 提取命令实体 - 优先从命令行上下文提取，避免正文噪音
  const fullTextCommandPatterns = [
    { regex: /\bnv\s+(?:set|show|config|unset|apply|list)(?:\s+[\w\-\.\/]+)*/gi, category: 'nvue' },
    { regex: /\bnetq\s+(?:show|check|trace)\b[^\n]*/gi, category: 'netq' }
  ];

  const lineCommandPatterns = [
    { regex: /^nv\s+(?:set|show|config|unset|apply|list)(?:\s+[\w\-\.\/]+)*/i, category: 'nvue' },
    { regex: /^netq\s+(?:show|check|trace)\b(?:\s+[\w\-\.\/]+)*/i, category: 'netq' },
    { regex: /^(?:sudo\s+)?(?:ifreload|ifup|ifdown)\b(?:\s+[\w\-\.\/]+)*/i, category: 'linux' },
    { regex: /^(?:ip|ifconfig|route|netstat|ping|traceroute|tcpdump|ethtool|brctl)\b(?:\s+[\w\-\.\/]+)*/i, category: 'linux' },
    { regex: /^(?:configure|show|set|get|enable|disable|add|delete|remove)\b(?:\s+[\w\-\.\/]+)*/i, category: 'config' },
    { regex: /^(?:vlan|interface|router|bgp|ospf|mlag)\b(?:\s+(?:add|delete|show|config|set))?\s*[\w\-\.\/]*/i, category: 'network' }
  ];

  const commandMatches = [];
  for (const pattern of fullTextCommandPatterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const commandText = match[0]?.trim();
      if (!commandText) continue;
      const normalized = addCommand(commandText, pattern.category);
      if (normalized && typeof match.index === 'number') {
        commandMatches.push({ name: normalized, index: match.index });
      }
    }
  }

  const commandCandidates = extractCommandCandidates(text);
  for (const candidate of commandCandidates) {
    for (const pattern of lineCommandPatterns) {
      const match = candidate.match(pattern.regex);
      if (!match) continue;
      const commandText = match[0]?.trim();
      if (!commandText) continue;
      const normalized = addCommand(commandText, pattern.category);
      if (normalized) {
        const matchIndex = textLower.indexOf(commandText.toLowerCase());
        if (matchIndex !== -1) {
          commandMatches.push({ name: normalized, index: matchIndex });
        }
      }
    }
  }

  // 3. 提取参数实体
  const parameterPatterns = [
    // 网络参数
    { regex: /\b(vlan|vrf|bgp|ospf|mlag|lacp|bond)\s*[=:]?\s*(\w+)/gi, type: 'network_param' },
    // MLAG/CLAG 相关参数
    { regex: /\bclag(?:d|ed)?(?:[.\-][\w-]+)+\b/gi, type: 'mlag_param' },
    // IP 地址
    { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?\b/g, type: 'ip_address' },
    // 端口号
    { regex: /\bport\s*[=:]?\s*(\d+)/gi, type: 'port' },
    // 接口名称
    { regex: /\b(eth|swp|bond|vlan)\d+/gi, type: 'interface' },
    { regex: /\bpeerlink(?:\.\d+)?\b/gi, type: 'interface' }
  ];

  for (const pattern of parameterPatterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const paramName = match[0]?.trim();
      if (!paramName) continue;
      addParameter(paramName, pattern.type);
    }
  }

  // 4. 提取功能实体
  const functionMatches = [];
  const functionCandidates = extractFunctionCandidates(text, {
    vendorNames: vendorCandidates
  });

  for (const funcName of functionCandidates) {
    const index = indexOfKeyword(textLower, funcName.toLowerCase());
    addFunction(funcName);
    if (index !== -1) {
      functionMatches.push({ name: funcName, index });
    }
  }

  // 5. 关联功能与命令
  const commandFunctionMap = new Map();
  for (const command of commandMap.values()) {
    const inferred = inferFunctionsFromText(command.name, {
      vendorNames: vendorCandidates
    });
    if (inferred.size === 0 && functionMatches.length > 0) {
      const commandIndex = commandMatches.find(m => m.name === command.name)?.index;
      if (typeof commandIndex === 'number') {
        let closest = null;
        let closestDistance = Infinity;
        for (const match of functionMatches) {
          const distance = Math.abs(match.index - commandIndex);
          if (distance < closestDistance) {
            closest = match.name;
            closestDistance = distance;
          }
        }
        if (closest && closestDistance < 200) {
          inferred.add(closest);
        }
      }
    }

    if (inferred.size === 0 && allowDefaultFunction) {
      inferred.add(DEFAULT_FUNCTION_NAME);
    }

    for (const funcName of inferred) {
      addFunction(funcName);
    }
    commandFunctionMap.set(command.name, inferred);
  }

  entities.vendors = Array.from(vendorMap.values());
  entities.functions = Array.from(functionMap.values());
  entities.commands = Array.from(commandMap.values());
  entities.parameters = Array.from(parameterMap.values());

  // 6. 提取关系
  // 厂商-功能关系
  if (entities.vendors.length > 0 && entities.functions.length > 0) {
    // 如果有厂商和功能，创建它们之间的关系
    for (const vendor of entities.vendors) {
      for (const func of entities.functions) {
        entities.relationships.push({
          from: vendor.name,
          to: func.name,
          type: 'HAS_FUNCTION',
          fromType: 'Vendor',
          toType: 'Function'
        });
      }
    }
  } else if (entities.vendors.length === 0 && entities.functions.length > 0) {
    // 如果只有功能没有厂商，尝试推断或创建通用厂商
    // 检查是否能从 metadata 或文本推断厂商
    const inferredVendor = metadata.vendorName ||
      (metadata.category && !isDefaultCategoryName(metadata.category) ? metadata.category : null);

    if (inferredVendor) {
      addVendor(inferredVendor);
      entities.vendors = Array.from(vendorMap.values());

      // 创建推断厂商与功能的关系
      for (const func of entities.functions) {
        entities.relationships.push({
          from: inferredVendor,
          to: func.name,
          type: 'HAS_FUNCTION',
          fromType: 'Vendor',
          toType: 'Function'
        });
      }
    }
  }

  // 功能-命令关系
  for (const [commandName, functions] of commandFunctionMap.entries()) {
    for (const funcName of functions) {
      entities.relationships.push({
        from: funcName,
        to: commandName,
        type: 'HAS_COMMAND',
        fromType: 'Function',
        toType: 'Command'
      });
    }
  }

  // 命令-参数关系
  for (const command of entities.commands) {
    for (const param of entities.parameters) {
      const commandIndex = text.indexOf(command.name);
      const paramIndex = text.indexOf(param.name);
      if (commandIndex !== -1 && paramIndex !== -1 && Math.abs(commandIndex - paramIndex) < 150) {
        entities.relationships.push({
          from: command.name,
          to: param.name,
          type: 'HAS_PARAMETER',
          fromType: 'Command',
          toType: 'Parameter'
        });
      }
    }
  }

  // 7. 提取语义关系（替代、依赖、相似、冲突）
  const knownEntityNames = new Set([
    ...entities.commands.map(c => c.name.toLowerCase()),
    ...entities.functions.map(f => f.name.toLowerCase())
  ]);
  const semanticRels = extractSemanticRelationships(text, knownEntityNames);
  entities.relationships.push(...semanticRels);

  // 8. 合理性检查 - 防止过度识别
  const textLength = text.length;
  const maxCommandsPerKB = 20;
  const maxCommands = Math.max(100, Math.floor(textLength / 1000) * maxCommandsPerKB);

  if (entities.commands.length > maxCommands) {
    console.warn(`[KnowledgeGraph] ⚠️ 命令数量异常 (${entities.commands.length}), 限制为 ${maxCommands}`);
    entities.commands = entities.commands.slice(0, maxCommands);
  }

  return entities;
}

/**
 * 将实体存储到 Neo4j 知识图谱
 * @param {Object} entities - 提取的实体
 * @param {Object} chunkMetadata - chunk 元数据 (id, documentId, text)
 */
export async function storeEntities(entities, chunkMetadata = {}) {
  if (!isConnected) {
    await initNeo4j();
  }

  const session = driver.session();
  const chunkId = chunkMetadata.chunkId || chunkMetadata.id;
  const documentId = chunkMetadata.documentId;

  try {
    // 0. 创建 Chunk 节点（如果提供了 chunkId）
    if (chunkId && documentId) {
      await session.run(`
        MERGE (ch:Chunk {id: $chunkId})
        ON CREATE SET
          ch.documentId = $documentId,
          ch.createdAt = datetime()
        ON MATCH SET
          ch.documentId = $documentId
      `, { chunkId, documentId });
    }

    // 1. 创建厂商节点
    for (const vendor of entities.vendors || []) {
      await session.run(`
        MERGE (v:Vendor {name: $name})
        ON CREATE SET
          v.createdAt = datetime(),
          v.sources = [$source]
        ON MATCH SET
          v.sources = CASE
            WHEN v.sources IS NULL
            THEN [$source]
            WHEN NOT $source IN v.sources
            THEN v.sources + $source
            ELSE v.sources
          END
      `, {
        name: vendor.name,
        source: vendor.source
      });

      // 创建 Chunk -> Vendor MENTIONS 关系
      if (chunkId) {
        await session.run(`
          MATCH (ch:Chunk {id: $chunkId})
          MATCH (v:Vendor {name: $name})
          MERGE (ch)-[r:MENTIONS]->(v)
          ON CREATE SET r.weight = 1
          ON MATCH SET r.weight = r.weight + 1
        `, { chunkId, name: vendor.name });
      }
    }

    // 2. 创建功能节点
    for (const func of entities.functions || []) {
      await session.run(`
        MERGE (f:Function {name: $name})
        ON CREATE SET
          f.createdAt = datetime(),
          f.sources = [$source]
        ON MATCH SET
          f.sources = CASE
            WHEN f.sources IS NULL
            THEN [$source]
            WHEN NOT $source IN f.sources
            THEN f.sources + $source
            ELSE f.sources
          END
      `, {
        name: func.name,
        source: func.source
      });

      // 创建 Chunk -> Function MENTIONS 关系
      if (chunkId) {
        await session.run(`
          MATCH (ch:Chunk {id: $chunkId})
          MATCH (f:Function {name: $name})
          MERGE (ch)-[r:MENTIONS]->(f)
          ON CREATE SET r.weight = 1
          ON MATCH SET r.weight = r.weight + 1
        `, { chunkId, name: func.name });
      }
    }

    // 3. 创建命令节点
    for (const command of entities.commands || []) {
      await session.run(`
        MERGE (c:Command {name: $name})
        ON CREATE SET
          c.category = $category,
          c.createdAt = datetime(),
          c.sources = [$source]
        ON MATCH SET
          c.sources = CASE
            WHEN c.sources IS NULL
            THEN [$source]
            WHEN NOT $source IN c.sources
            THEN c.sources + $source
            ELSE c.sources
          END
      `, {
        name: command.name,
        category: command.category,
        source: command.source
      });

      // 创建 Chunk -> Command MENTIONS 关系
      if (chunkId) {
        await session.run(`
          MATCH (ch:Chunk {id: $chunkId})
          MATCH (c:Command {name: $name})
          MERGE (ch)-[r:MENTIONS]->(c)
          ON CREATE SET r.weight = 1
          ON MATCH SET r.weight = r.weight + 1
        `, { chunkId, name: command.name });
      }
    }

    // 4. 创建参数节点
    for (const param of entities.parameters || []) {
      await session.run(`
        MERGE (p:Parameter {name: $name})
        ON CREATE SET
          p.type = $type,
          p.createdAt = datetime(),
          p.sources = [$source]
        ON MATCH SET
          p.sources = CASE
            WHEN p.sources IS NULL
            THEN [$source]
            WHEN NOT $source IN p.sources
            THEN p.sources + $source
            ELSE p.sources
          END
      `, {
        name: param.name,
        type: param.type,
        source: param.source
      });

      // 创建 Chunk -> Parameter MENTIONS 关系
      if (chunkId) {
        await session.run(`
          MATCH (ch:Chunk {id: $chunkId})
          MATCH (p:Parameter {name: $name})
          MERGE (ch)-[r:MENTIONS]->(p)
          ON CREATE SET r.weight = 1
          ON MATCH SET r.weight = r.weight + 1
        `, { chunkId, name: param.name });
      }
    }

    // 5. 创建关系
    for (const rel of entities.relationships) {
      const query = `
        MATCH (from:${rel.fromType} {name: $from})
        MATCH (to:${rel.toType} {name: $to})
        MERGE (from)-[r:${rel.type}]->(to)
        ON CREATE SET r.createdAt = datetime(), r.weight = 1
        ON MATCH SET r.weight = r.weight + 1
      `;

      await session.run(query, {
        from: rel.from,
        to: rel.to
      });
    }

    const chunkInfo = chunkId ? `, chunk: ${chunkId}` : '';
    console.log(`[KnowledgeGraph] ✅ 存储实体: ${entities.vendors?.length || 0} 厂商, ${entities.functions?.length || 0} 功能, ${entities.commands?.length || 0} 命令, ${entities.parameters?.length || 0} 参数${chunkInfo}`);
  } catch (error) {
    console.error('[KnowledgeGraph] 存储实体失败:', error.message);
    throw error;
  } finally {
    await session.close();
  }
}

function isDefaultCategoryName(name) {
  if (!name) return true;
  const lowered = String(name).toLowerCase();
  return lowered === 'default' || name === '默认分类';
}

function findCategoryById(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findCategoryById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function findCategoryByName(nodes, name) {
  for (const node of nodes || []) {
    if (node.name === name) return node;
    if (node.children) {
      const found = findCategoryByName(node.children, name);
      if (found) return found;
    }
  }
  return null;
}

function collectVendorNames(nodes, names) {
  for (const node of nodes || []) {
    if (node?.name && !isDefaultCategoryName(node.name)) {
      names.push(node.name);
    }
    if (node.children) collectVendorNames(node.children, names);
  }
}

async function getVendorNames() {
  const categories = await storage.getCategories();
  const names = [];
  collectVendorNames(categories?.tree || [], names);
  return names;
}

async function resolveVendorName(documentId) {
  const doc = await storage.getDocument(documentId);
  if (!doc) return null;

  const categories = await storage.getCategories();
  const tree = categories?.tree || [];

  const byId = doc.categoryId ? findCategoryById(tree, doc.categoryId) : null;
  const byName = doc.category ? findCategoryByName(tree, doc.category) : null;
  const vendorName = byId?.name || byName?.name || doc.category || null;

  return isDefaultCategoryName(vendorName) ? null : vendorName;
}

/**
 * 从知识图谱中检索相关实体
 * @param {string} query - 查询文本
 * @param {number} limit - 返回结果数量限制
 * @returns {Array} 相关实体和路径
 */
export async function queryKnowledgeGraph(query, limit = 10) {
  if (!isConnected) {
    await initNeo4j();
  }

  const session = driver.session();
  try {
    const safeLimit = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 10));
    const results = [];

    // 1. 从查询中提取关键实体
    const vendorNames = await getVendorNames();
    const vendorDetection = detectPreferredVendors(query, vendorNames, {});
    const preferredVendor = vendorDetection.preferredVendors[0] || null;
    const applyVendorFilter = Boolean(preferredVendor);

    const queryEntities = extractEntities(query, {
      vendorNames,
      source: 'query',
      allowDefaultFunction: false,
      allowHeuristicVendors: false
    });

    if (preferredVendor && queryEntities.vendors.length === 0) {
      queryEntities.vendors.push({ name: preferredVendor, source: 'query' });
    }

    const vendorTargets = applyVendorFilter
      ? [{ name: preferredVendor }]
      : queryEntities.vendors;

    // 2. 查找厂商相关信息
    for (const vendor of vendorTargets.slice(0, 3)) {
      const result = await session.run(`
        MATCH (v:Vendor {name: $vendorName})
        OPTIONAL MATCH (v)-[:HAS_FUNCTION]->(f:Function)
        OPTIONAL MATCH (f)-[:HAS_COMMAND]->(c:Command)
        OPTIONAL MATCH (c)-[:HAS_PARAMETER]->(p:Parameter)
        RETURN v,
               collect(DISTINCT f) as functions,
               collect(DISTINCT c) as commands,
               collect(DISTINCT p) as parameters
        LIMIT 1
      `, { vendorName: vendor.name });

      if (result.records.length > 0) {
        const record = result.records[0];
        results.push({
          type: 'vendor',
          vendor: record.get('v').properties,
          functions: record.get('functions').map(f => f.properties),
          commands: record.get('commands').map(c => c.properties),
          parameters: record.get('parameters').map(p => p.properties),
          relevance: 1.0
        });
      }
    }

    // 3. 查找功能相关信息
    for (const func of queryEntities.functions.slice(0, 3)) {
      const result = applyVendorFilter
        ? await session.run(`
            MATCH (v:Vendor {name: $vendorName})-[:HAS_FUNCTION]->(f:Function {name: $functionName})
            OPTIONAL MATCH (f)-[:HAS_COMMAND]->(c:Command)
            OPTIONAL MATCH (c)-[:HAS_PARAMETER]->(p:Parameter)
            RETURN f,
                   collect(DISTINCT v) as vendors,
                   collect(DISTINCT c) as commands,
                   collect(DISTINCT p) as parameters
            LIMIT 1
          `, { functionName: func.name, vendorName: preferredVendor })
        : await session.run(`
            MATCH (f:Function {name: $functionName})
            OPTIONAL MATCH (v:Vendor)-[:HAS_FUNCTION]->(f)
            OPTIONAL MATCH (f)-[:HAS_COMMAND]->(c:Command)
            OPTIONAL MATCH (c)-[:HAS_PARAMETER]->(p:Parameter)
            RETURN f,
                   collect(DISTINCT v) as vendors,
                   collect(DISTINCT c) as commands,
                   collect(DISTINCT p) as parameters
            LIMIT 1
          `, { functionName: func.name });

      if (result.records.length > 0) {
        const record = result.records[0];
        results.push({
          type: 'function',
          function: record.get('f').properties,
          vendors: record.get('vendors').map(v => v.properties),
          commands: record.get('commands').map(c => c.properties),
          parameters: record.get('parameters').map(p => p.properties),
          relevance: 0.9
        });
      }
    }

    // 4. 查找命令相关信息
    for (const command of queryEntities.commands.slice(0, 3)) {
      const result = applyVendorFilter
        ? await session.run(`
            MATCH (v:Vendor {name: $vendorName})-[:HAS_FUNCTION]->(f:Function)-[:HAS_COMMAND]->(c:Command {name: $commandName})
            OPTIONAL MATCH (c)-[:HAS_PARAMETER]->(p:Parameter)
            RETURN c,
                   collect(DISTINCT f) as functions,
                   collect(DISTINCT v) as vendors,
                   collect(DISTINCT p) as parameters
            LIMIT 1
          `, { commandName: command.name, vendorName: preferredVendor })
        : await session.run(`
            MATCH (c:Command {name: $commandName})
            OPTIONAL MATCH (f:Function)-[:HAS_COMMAND]->(c)
            OPTIONAL MATCH (v:Vendor)-[:HAS_FUNCTION]->(f)
            OPTIONAL MATCH (c)-[:HAS_PARAMETER]->(p:Parameter)
            RETURN c,
                   collect(DISTINCT f) as functions,
                   collect(DISTINCT v) as vendors,
                   collect(DISTINCT p) as parameters
            LIMIT 1
          `, { commandName: command.name });

      if (result.records.length > 0) {
        const record = result.records[0];
        results.push({
          type: 'command',
          command: record.get('c').properties,
          functions: record.get('functions').map(f => f.properties),
          vendors: record.get('vendors').map(v => v.properties),
          parameters: record.get('parameters').map(p => p.properties),
          relevance: 0.85
        });
      }
    }

    // 5. 如果没有找到精确匹配，使用全文搜索
    if (results.length === 0) {
      const searchResult = applyVendorFilter
        ? await session.run(`
            CALL db.index.fulltext.queryNodes('kg_search', $query)
            YIELD node, score
            MATCH (v:Vendor {name: $vendorName})
            WHERE node = v
               OR (v)-[:HAS_FUNCTION]->(node)
               OR (v)-[:HAS_FUNCTION]->(:Function)-[:HAS_COMMAND]->(node)
            OPTIONAL MATCH (node)-[r]->(related)
            RETURN node, collect(DISTINCT related) as related, score
            ORDER BY score DESC
            LIMIT $limit
          `, { query: query, limit: neo4j.int(safeLimit), vendorName: preferredVendor })
        : await session.run(`
            CALL db.index.fulltext.queryNodes('kg_search', $query)
            YIELD node, score
            MATCH (node)-[r]->(related)
            RETURN node, collect(DISTINCT related) as related, score
            ORDER BY score DESC
            LIMIT $limit
          `, { query: query, limit: neo4j.int(safeLimit) });

      for (const record of searchResult.records) {
        results.push({
          type: 'search',
          node: record.get('node').properties,
          related: record.get('related').map(n => n.properties),
          relevance: record.get('score')
        });
      }
    }

    return results.slice(0, safeLimit);
  } catch (error) {
    console.error('[KnowledgeGraph] 查询失败:', error.message);
    return [];
  } finally {
    await session.close();
  }
}

/**
 * 多跳图谱遍历 - 发现实体之间的间接关系
 * @param {string} query - 用户查询
 * @param {Object} options - 选项
 * @param {number} options.maxHops - 最大跳数 (默认 2)
 * @param {number} options.limit - 返回路径数量限制 (默认 20)
 * @returns {Object} { entities: [], paths: [], context: string }
 */
export async function multiHopQuery(query, options = {}) {
  const { maxHops = 2, limit = 20 } = options;

  if (!isConnected) {
    await initNeo4j();
  }

  if (!isConnected) {
    console.log('[KnowledgeGraph] Neo4j 未连接，跳过多跳查询');
    return { entities: [], paths: [], context: '' };
  }

  const session = driver.session();
  try {
    const vendorNames = await getVendorNames();

    // 1. 从查询中提取实体
    const queryEntities = extractEntities(query, {
      vendorNames,
      source: 'query',
      allowDefaultFunction: false
    });

    const entityNames = [
      ...queryEntities.vendors.map(v => v.name),
      ...queryEntities.functions.map(f => f.name),
      ...queryEntities.commands.map(c => c.name)
    ].slice(0, 5); // 最多取5个实体

    if (entityNames.length === 0) {
      console.log('[KnowledgeGraph] 查询中未提取到实体，跳过多跳查询');
      return { entities: [], paths: [], context: '' };
    }

    console.log(`[KnowledgeGraph] 多跳查询实体: ${entityNames.join(', ')} (maxHops=${maxHops})`);

    const allPaths = [];
    const relatedEntities = new Map();

    // 2. 对每个实体执行 N 跳遍历
    // 2. 对每个实体执行多跳查询
    for (const entityName of entityNames) {
      if (!entityName) continue;

      // 2.1 意图检测
      const queryLower = query.toLowerCase();
      let preferredRels = [];
      let intent = 'general';

      if (queryLower.match(/需要|依赖|前置|条件|require|depend|prereq/)) {
        intent = 'prerequisite';
        preferredRels = ['REQUIRES', 'DEPENDS_ON', 'HAS_PREREQUISITE'];
      } else if (queryLower.match(/冲突|问题|兼容|conflict|issue|compatib/)) {
        intent = 'conflict';
        preferredRels = ['CONFLICTS_WITH', 'INCOMPATIBLE_WITH'];
      } else if (queryLower.match(/替代|旧版|升级|replace|upgrade|deprecat/)) {
        intent = 'replacement';
        preferredRels = ['REPLACES', 'SUPERSEDES', 'DEPRECATED_BY'];
      } else if (queryLower.match(/区别|不同|diff|compare|vs/)) {
        intent = 'comparison';
        // 比较通常涉及 sibling 关系或相同的 parent
        preferredRels = ['SIMILAR_TO', 'RELATED_TO'];
      }

      console.log(`[KnowledgeGraph] 实体 "${entityName}" 意图识别: ${intent} (Preferred: ${preferredRels.join(',')})`);

      // 2.2 Cypher 查询
      const result = await session.run(`
        MATCH (start)
        WHERE (start:Vendor OR start:Function OR start:Command OR start:Parameter)
          AND start.name =~ $pattern
        WITH start
        LIMIT 3
        
        CALL {
          WITH start
          MATCH path = (start)-[rels*1..${maxHops}]-(related)
          WHERE related <> start
          AND NOT related:Chunk 
          RETURN path, related, length(path) as hops
          ORDER BY hops ASC
          LIMIT $limit
        }
        RETURN start, path, related, hops
      `, {
        pattern: `(?i).*${entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}.*`,
        limit: neo4j.int(limit * 2)
      });

      for (const record of result.records) {
        const startNode = record.get('start').properties;
        const relatedNode = record.get('related').properties;
        const hopsValue = record.get('hops');
        const hops = typeof hopsValue?.toNumber === 'function' ? hopsValue.toNumber() : Number(hopsValue);
        const pathData = record.get('path');

        // 分析路径中的关系类型
        let pathScore = 1.0;
        const relTypes = [];
        if (pathData?.segments) {
          pathData.segments.forEach(seg => {
            const rType = seg.relationship.type;
            relTypes.push(rType);
            // 命中意图关系给予高分
            if (preferredRels.includes(rType)) {
              pathScore += 2.0;
            }
            // 语义强的关系给予基础分
            if (['REQUIRES', 'CONFLICTS_WITH', 'REPLACES'].includes(rType)) {
              pathScore += 0.5;
            }
          });
        }

        // 收集相关实体
        const relatedKey = relatedNode.name?.toLowerCase();
        if (relatedKey) {
          const existing = relatedEntities.get(relatedKey);
          // 如果新路径得分更高，更新实体元数据
          if (!existing || pathScore > (existing.score || 0)) {
            relatedEntities.set(relatedKey, {
              name: relatedNode.name,
              type: record.get('related').labels?.[0] || 'Unknown',
              hops,
              connectedTo: entityName,
              score: pathScore,   // 记录分数
              intentMatch: preferredRels.some(r => relTypes.includes(r))
            });
          }
        }

        // 构建路径描述
        if (pathData?.segments) {
          const pathDesc = pathData.segments.map(seg => {
            const relType = seg.relationship.type;
            const endName = seg.end.properties?.name || '?';
            return `--[${relType}]-->${endName}`;
          }).join(' ');

          allPaths.push({
            from: startNode.name,
            path: `${startNode.name} ${pathDesc}`,
            hops,
            to: relatedNode.name,
            score: pathScore,
            intentMatch: preferredRels.some(r => relTypes.includes(r))
          });
        }
      }
    }

    // 3. 去重并排序
    const uniquePaths = [];
    const pathSet = new Set();
    for (const p of allPaths) {
      if (!pathSet.has(p.path)) {
        pathSet.add(p.path);
        uniquePaths.push(p);
      }
    }
    uniquePaths.sort((a, b) => a.hops - b.hops);

    // 4. 生成上下文摘要
    const entities = Array.from(relatedEntities.values()).slice(0, 15);
    let context = '';
    if (entities.length > 0) {
      const grouped = {};
      for (const e of entities) {
        if (!grouped[e.type]) grouped[e.type] = [];
        grouped[e.type].push(e.name);
      }
      context = Object.entries(grouped)
        .map(([type, names]) => `${type}: ${names.join(', ')}`)
        .join('\n');
    }

    console.log(`[KnowledgeGraph] 多跳查询完成: ${entities.length} 相关实体, ${uniquePaths.length} 路径`);

    return {
      entities,
      paths: uniquePaths.slice(0, limit),
      context
    };
  } catch (error) {
    console.error('[KnowledgeGraph] 多跳查询失败:', error.message);
    return { entities: [], paths: [], context: '' };
  } finally {
    await session.close();
  }
}

/**
 * 批量处理文档，提取并存储实体
 * @param {string} documentId - 文档 ID
 */
export async function processDocument(documentId) {
  try {
    const chunks = await storage.getChunks(documentId);
    if (!chunks || chunks.length === 0) {
      console.log(`[KnowledgeGraph] 文档 ${documentId} 没有 chunks`);
      return { vendors: 0, functions: 0, commands: 0, parameters: 0 };
    }

    const vendorName = await resolveVendorName(documentId);
    const vendorNames = await getVendorNames();
    const allowHeuristicVendors = !vendorName;

    // 改进去重机制 - 跨 chunk 去重
    const allEntities = {
      vendors: new Map(),
      functions: new Map(),
      commands: new Map(),
      parameters: new Map(),
      relationships: [] // 收集所有关系
    };

    for (const chunk of chunks) {
      const chunkText = typeof chunk.text === 'string'
        ? chunk.text
        : (typeof chunk.content === 'string' ? chunk.content : '');

      if (!chunkText || !chunkText.trim()) {
        continue;
      }

      const entities = extractEntities(chunkText, {
        documentId: documentId,
        chunkId: chunk.id,
        vendorName,
        vendorNames,
        allowHeuristicVendors
      });

      // 存储每个 chunk 的实体，创建 MENTIONS 关系
      if (entities.vendors.length > 0 || entities.functions.length > 0 ||
        entities.commands.length > 0 || entities.parameters.length > 0) {
        await storeEntities(entities, {
          chunkId: chunk.id,
          documentId: documentId
        });
      }

      // 跨 chunk 去重 - 使用 Map 存储唯一实体（用于统计）
      entities.vendors.forEach(v => {
        const key = v.name.toLowerCase();
        if (!allEntities.vendors.has(key)) {
          allEntities.vendors.set(key, v);
        }
      });

      entities.functions.forEach(f => {
        const key = f.name.toLowerCase();
        if (!allEntities.functions.has(key)) {
          allEntities.functions.set(key, f);
        }
      });

      entities.commands.forEach(c => {
        const key = c.name.toLowerCase();
        if (!allEntities.commands.has(key)) {
          allEntities.commands.set(key, c);
        }
      });

      entities.parameters.forEach(p => {
        const key = p.name.toLowerCase();
        if (!allEntities.parameters.has(key)) {
          allEntities.parameters.set(key, p);
        }
      });

      // 收集所有关系（跨 chunk）
      allEntities.relationships.push(...entities.relationships);
    }

    // 去重关系
    const uniqueRelationships = [];
    const relSet = new Set();
    for (const rel of allEntities.relationships) {
      const key = `${rel.fromType}: ${rel.from} | ${rel.type} | ${rel.toType}: ${rel.to}`;
      if (!relSet.has(key)) {
        relSet.add(key);
        uniqueRelationships.push(rel);
      }
    }

    // 注意：实体已在每个 chunk 处理时存储，这里只需要存储跨 chunk 的关系
    // 关系已经在 storeEntities 中处理，此处为保险起见再处理一次
    const uniqueEntities = {
      vendors: Array.from(allEntities.vendors.values()),
      functions: Array.from(allEntities.functions.values()),
      commands: Array.from(allEntities.commands.values()),
      parameters: Array.from(allEntities.parameters.values()),
      relationships: uniqueRelationships
    };

    // 只存储关系（实体已经在每个 chunk 处理时存储）
    if (uniqueRelationships.length > 0) {
      await storeEntities({
        vendors: [],
        functions: [],
        commands: [],
        parameters: [],
        relationships: uniqueRelationships
      });
    }

    const totalEntities = {
      vendors: uniqueEntities.vendors.length,
      functions: uniqueEntities.functions.length,
      commands: uniqueEntities.commands.length,
      parameters: uniqueEntities.parameters.length
    };

    console.log(`[KnowledgeGraph] ✅ 文档 ${documentId} 处理完成: `, totalEntities);
    return totalEntities;
  } catch (error) {
    console.error(`[KnowledgeGraph] 处理文档 ${documentId} 失败: `, error.message);
    throw error;
  }
}

/**
 * 获取知识图谱统计信息
 */
export async function getGraphStats() {
  if (!isConnected) {
    await initNeo4j();
  }

  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH(v: Vendor)
      WITH count(v) as vendorCount,
        sum(size(coalesce(v.sources, []))) as vendorTotal
      MATCH(f: Function)
      WITH vendorCount, vendorTotal,
        count(f) as functionCount,
        sum(size(coalesce(f.sources, []))) as functionTotal
      MATCH(c: Command)
      WITH vendorCount, vendorTotal, functionCount, functionTotal,
        count(c) as commandCount,
        sum(size(coalesce(c.sources, []))) as commandTotal
      MATCH(p: Parameter)
      WITH vendorCount, vendorTotal, functionCount, functionTotal,
        commandCount, commandTotal,
        count(p) as paramCount,
        sum(size(coalesce(p.sources, []))) as paramTotal
      MATCH() - [r] -> ()
      RETURN vendorCount, vendorTotal,
        functionCount, functionTotal,
        commandCount, commandTotal,
        paramCount, paramTotal,
        count(r) as relationshipCount
    `);

    if (result.records.length > 0) {
      const record = result.records[0];
      return {
        vendors: record.get('vendorCount'),
        vendorsTotal: record.get('vendorTotal'),
        functions: record.get('functionCount'),
        functionsTotal: record.get('functionTotal'),
        commands: record.get('commandCount'),
        commandsTotal: record.get('commandTotal'),
        parameters: record.get('paramCount'),
        parametersTotal: record.get('paramTotal'),
        relationships: record.get('relationshipCount')
      };
    }

    return {
      vendors: 0,
      vendorsTotal: 0,
      functions: 0,
      functionsTotal: 0,
      commands: 0,
      commandsTotal: 0,
      parameters: 0,
      parametersTotal: 0,
      relationships: 0
    };
  } catch (error) {
    console.error('[KnowledgeGraph] 获取统计信息失败:', error.message);
    return {
      vendors: 0,
      vendorsTotal: 0,
      functions: 0,
      functionsTotal: 0,
      commands: 0,
      commandsTotal: 0,
      parameters: 0,
      parametersTotal: 0,
      relationships: 0
    };
  } finally {
    await session.close();
  }
}

/**
 * 获取知识图谱质量报告
 */
export async function getGraphQualityReport() {
  const stats = await getGraphStats();
  if (!isConnected) {
    await initNeo4j();
  }

  const session = driver.session();
  try {
    const domainNodesResult = await session.run(`
      MATCH (n)
      WHERE n:Vendor OR n:Function OR n:Command OR n:Parameter
      RETURN count(n) as count
    `);

    const semanticRelResult = await session.run(`
      MATCH (a)-[r]->(b)
      WHERE NOT r:MENTIONS AND NOT (a:Chunk OR b:Chunk)
      RETURN count(r) as count
    `);

    const degreeResult = await session.run(`
      MATCH (n)
      WHERE n:Vendor OR n:Function OR n:Command OR n:Parameter
      OPTIONAL MATCH (n)--(m)
      WHERE NOT m:Chunk
      WITH n, count(m) as degree
      RETURN avg(degree) as avgDegree, max(degree) as maxDegree, min(degree) as minDegree
    `);

    const isolatedResult = await session.run(`
      MATCH (n)
      WHERE n:Vendor OR n:Function OR n:Command OR n:Parameter
      OPTIONAL MATCH (n)--(m)
      WHERE NOT m:Chunk
      WITH n, count(m) as degree
      WHERE degree = 0
      RETURN labels(n)[0] as label, count(n) as count
    `);

    const coverageResult = await session.run(`
      MATCH (c:Command)
      WITH count(c) as totalCommands
      OPTIONAL MATCH (c2:Command)
      WHERE NOT (:Function)-[:HAS_COMMAND]->(c2)
      WITH totalCommands, count(c2) as commandsWithoutFunction
      OPTIONAL MATCH (f:Function)
      WHERE NOT (:Vendor)-[:HAS_FUNCTION]->(f)
      WITH totalCommands, commandsWithoutFunction, count(f) as functionsWithoutVendor
      RETURN totalCommands, commandsWithoutFunction, functionsWithoutVendor
    `);

    const defaultFunctionResult = await session.run(`
      MATCH (f:Function {name: $default})-[:HAS_COMMAND]->(c:Command)
      RETURN count(c) as count
    `, { default: DEFAULT_FUNCTION_NAME });

    const evidenceResult = await session.run(`
      MATCH (v:Vendor)
      WITH avg(size(coalesce(v.sources, []))) as vendorAvg
      MATCH (f:Function)
      WITH vendorAvg, avg(size(coalesce(f.sources, []))) as functionAvg
      MATCH (c:Command)
      WITH vendorAvg, functionAvg, avg(size(coalesce(c.sources, []))) as commandAvg
      MATCH (p:Parameter)
      RETURN vendorAvg, functionAvg, commandAvg, avg(size(coalesce(p.sources, []))) as parameterAvg
    `);

    const lowEvidenceResult = await session.run(`
      MATCH (v:Vendor)
      WHERE size(coalesce(v.sources, [])) <= 1
      WITH count(v) as vendorLow
      MATCH (f:Function)
      WHERE size(coalesce(f.sources, [])) <= 1
      WITH vendorLow, count(f) as functionLow
      MATCH (c:Command)
      WHERE size(coalesce(c.sources, [])) <= 1
      WITH vendorLow, functionLow, count(c) as commandLow
      MATCH (p:Parameter)
      WHERE size(coalesce(p.sources, [])) <= 1
      RETURN vendorLow, functionLow, commandLow, count(p) as parameterLow
    `);

    const topCommandsResult = await session.run(`
      MATCH (c:Command)
      RETURN c.name as name, size(coalesce(c.sources, [])) as sources
      ORDER BY sources DESC, name ASC
      LIMIT 10
    `);

    const topParametersResult = await session.run(`
      MATCH (p:Parameter)
      RETURN p.name as name, size(coalesce(p.sources, [])) as sources
      ORDER BY sources DESC, name ASC
      LIMIT 10
    `);

    const domainNodes = toNumber(domainNodesResult.records[0]?.get('count'));
    const semanticRelationships = toNumber(semanticRelResult.records[0]?.get('count'));
    const degreeRecord = degreeResult.records[0];
    const isolatedByLabel = {};
    isolatedResult.records.forEach(record => {
      isolatedByLabel[record.get('label')] = toNumber(record.get('count'));
    });

    const coverageRecord = coverageResult.records[0];
    const defaultCommandCount = toNumber(defaultFunctionResult.records[0]?.get('count'));
    const totalCommands = toNumber(coverageRecord?.get('totalCommands'));
    const commandsWithoutFunction = toNumber(coverageRecord?.get('commandsWithoutFunction'));
    const functionsWithoutVendor = toNumber(coverageRecord?.get('functionsWithoutVendor'));

    const evidenceRecord = evidenceResult.records[0] || {};
    const lowEvidenceRecord = lowEvidenceResult.records[0] || {};

    return {
      stats,
      domainNodes,
      semanticRelationships,
      degree: {
        avg: toNumber(degreeRecord?.get('avgDegree')),
        max: toNumber(degreeRecord?.get('maxDegree')),
        min: toNumber(degreeRecord?.get('minDegree'))
      },
      isolated: {
        vendors: isolatedByLabel.Vendor || 0,
        functions: isolatedByLabel.Function || 0,
        commands: isolatedByLabel.Command || 0,
        parameters: isolatedByLabel.Parameter || 0
      },
      coverage: {
        totalCommands,
        commandsWithoutFunction,
        functionsWithoutVendor,
        defaultFunctionCommands: defaultCommandCount,
        defaultFunctionRatio: totalCommands > 0 ? defaultCommandCount / totalCommands : 0
      },
      evidence: {
        avgSources: {
          vendors: toNumber(evidenceRecord.get?.('vendorAvg')),
          functions: toNumber(evidenceRecord.get?.('functionAvg')),
          commands: toNumber(evidenceRecord.get?.('commandAvg')),
          parameters: toNumber(evidenceRecord.get?.('parameterAvg'))
        },
        lowEvidence: {
          vendors: toNumber(lowEvidenceRecord.get?.('vendorLow')),
          functions: toNumber(lowEvidenceRecord.get?.('functionLow')),
          commands: toNumber(lowEvidenceRecord.get?.('commandLow')),
          parameters: toNumber(lowEvidenceRecord.get?.('parameterLow'))
        }
      },
      topCommands: topCommandsResult.records.map(record => ({
        name: record.get('name'),
        sources: toNumber(record.get('sources'))
      })),
      topParameters: topParametersResult.records.map(record => ({
        name: record.get('name'),
        sources: toNumber(record.get('sources'))
      }))
    };
  } catch (error) {
    console.error('[KnowledgeGraph] 获取质量报告失败:', error.message);
    return {
      stats,
      status: 'error',
      error: error.message
    };
  } finally {
    await session.close();
  }
}

/**
 * 清空知识图谱
 */
export async function clearGraph() {
  if (!isConnected) {
    await initNeo4j();
  }

  const session = driver.session();
  try {
    await session.run('MATCH (n) DETACH DELETE n');
    console.log('[KnowledgeGraph] ✅ 知识图谱已清空');
  } catch (error) {
    console.error('[KnowledgeGraph] 清空图谱失败:', error.message);
    throw error;
  } finally {
    await session.close();
  }
}

/**
 * 导出完整知识图谱数据用于可视化
 * @returns {Object} 包含节点和关系的图谱数据
 */
export async function exportGraphData() {
  if (!isConnected) {
    await initNeo4j();
  }

  const session = driver.session();
  try {
    // 获取所有节点
    const nodesResult = await session.run(`
      MATCH(n)
      RETURN labels(n) as labels, properties(n) as props, id(n) as id
    `);

    const nodes = nodesResult.records.map(record => ({
      id: record.get('id'),
      labels: record.get('labels'),
      properties: record.get('props')
    }));

    // 获取所有关系
    const relsResult = await session.run(`
      MATCH(a) - [r] -> (b)
      RETURN id(a) as fromId, id(b) as toId, type(r) as type, properties(r) as props
    `);

    const relationships = relsResult.records.map(record => ({
      from: record.get('fromId'),
      to: record.get('toId'),
      type: record.get('type'),
      properties: record.get('props')
    }));

    console.log(`[KnowledgeGraph] 导出数据: ${nodes.length} 节点, ${relationships.length} 关系`);

    return {
      nodes,
      relationships,
      stats: {
        totalNodes: nodes.length,
        totalRelationships: relationships.length,
        nodesByLabel: nodes.reduce((acc, node) => {
          const label = node.labels[0] || 'Unknown';
          acc[label] = (acc[label] || 0) + 1;
          return acc;
        }, {})
      }
    };
  } catch (error) {
    console.error('[KnowledgeGraph] 导出图谱数据失败:', error.message);
    throw error;
  } finally {
    await session.close();
  }
}

/**
 * 根据实体获取相关的 chunk IDs
 * @param {string} entityName - 实体名称
 * @param {string} entityType - 实体类型 (Vendor, Function, Command, Parameter)
 * @param {number} limit - 返回数量限制
 * @returns {Array} chunk IDs 和相关信息
 */
export async function getChunksByEntity(entityName, entityType = 'Function', limit = 10) {
  if (!isConnected) {
    await initNeo4j();
  }

  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH(ch: Chunk) - [r: MENTIONS] -> (e: ${entityType} { name: $entityName })
      RETURN ch.id as chunkId, ch.documentId as documentId, r.weight as weight
      ORDER BY r.weight DESC
      LIMIT $limit
        `, {
      entityName,
      limit: neo4j.int(limit)
    });

    return result.records.map(record => ({
      chunkId: record.get('chunkId'),
      documentId: record.get('documentId'),
      weight: record.get('weight')?.toNumber?.() || record.get('weight') || 1
    }));
  } catch (error) {
    console.error('[KnowledgeGraph] 获取实体相关 chunks 失败:', error.message);
    return [];
  } finally {
    await session.close();
  }
}

/**
 * 获取查询相关的所有 chunk IDs（基于提取的实体）
 * @param {string} query - 查询文本
 * @param {number} limit - 每个实体返回的 chunk 数量限制
 * @returns {Array} chunk IDs 和相关信息
 */
export async function getChunksFromQuery(query, limit = 5) {
  const vendorNames = await getVendorNames();
  const queryEntities = extractEntities(query, {
    vendorNames,
    source: 'query',
    allowDefaultFunction: false,
    allowHeuristicVendors: false
  });

  const allChunks = new Map();

  // 从厂商获取 chunks
  for (const vendor of queryEntities.vendors.slice(0, 3)) {
    const chunks = await getChunksByEntity(vendor.name, 'Vendor', limit);
    for (const chunk of chunks) {
      const existing = allChunks.get(chunk.chunkId);
      if (existing) {
        existing.weight += chunk.weight;
        existing.matchedEntities.push({ type: 'Vendor', name: vendor.name });
      } else {
        allChunks.set(chunk.chunkId, {
          ...chunk,
          matchedEntities: [{ type: 'Vendor', name: vendor.name }]
        });
      }
    }
  }

  // 从功能获取 chunks
  for (const func of queryEntities.functions.slice(0, 3)) {
    const chunks = await getChunksByEntity(func.name, 'Function', limit);
    for (const chunk of chunks) {
      const existing = allChunks.get(chunk.chunkId);
      if (existing) {
        existing.weight += chunk.weight;
        existing.matchedEntities.push({ type: 'Function', name: func.name });
      } else {
        allChunks.set(chunk.chunkId, {
          ...chunk,
          matchedEntities: [{ type: 'Function', name: func.name }]
        });
      }
    }
  }

  // 从命令获取 chunks
  for (const command of queryEntities.commands.slice(0, 3)) {
    const chunks = await getChunksByEntity(command.name, 'Command', limit);
    for (const chunk of chunks) {
      const existing = allChunks.get(chunk.chunkId);
      if (existing) {
        existing.weight += chunk.weight;
        existing.matchedEntities.push({ type: 'Command', name: command.name });
      } else {
        allChunks.set(chunk.chunkId, {
          ...chunk,
          matchedEntities: [{ type: 'Command', name: command.name }]
        });
      }
    }
  }

  // 按权重排序返回
  return Array.from(allChunks.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit * 3);
}

// ========== GraphRAG: 社区检测 ==========

/**
 * 检测知识图谱中的社区（基于 Louvain 算法）
 * 需要 Neo4j GDS 插件，如果不可用则使用简化版本
 * @param {Object} options - 选项
 * @returns {Object} 社区检测结果
 */
export async function detectCommunities(options = {}) {
  const {
    writeProperty = 'communityId',
    relationshipTypes = ['HAS_FUNCTION', 'HAS_COMMAND', 'MENTIONS'],
    minCommunitySize = 2
  } = options;

  if (!isConnected) {
    await initNeo4j();
  }

  const session = driver.session();

  try {
    // 尝试使用 Neo4j GDS Louvain 算法
    let result;
    let useGDS = false;

    try {
      // 检查 GDS 是否可用
      await session.run('CALL gds.list() YIELD name RETURN name LIMIT 1');
      useGDS = true;
    } catch (e) {
      console.log('[GraphRAG] Neo4j GDS 不可用，使用简化社区检测算法');
    }

    if (useGDS) {
      // 创建图投影
      const graphName = 'community_graph_' + Date.now();

      try {
        await session.run(`
          CALL gds.graph.project(
          $graphName,
          ['Vendor', 'Function', 'Command', 'Chunk'],
          $relationshipTypes
        )
        `, { graphName, relationshipTypes });

        // 运行 Louvain 社区检测
        result = await session.run(`
          CALL gds.louvain.stream($graphName)
          YIELD nodeId, communityId
          RETURN gds.util.asNode(nodeId) as node, communityId
          ORDER BY communityId
        `, { graphName });

        // 删除图投影
        await session.run('CALL gds.graph.drop($graphName)', { graphName });

      } catch (gdsError) {
        console.error('[GraphRAG] GDS 执行失败:', gdsError.message);
        useGDS = false;
      }
    }

    // 简化版社区检测: 基于共享实体的连通分量
    if (!useGDS) {
      result = await session.run(`
      MATCH(v: Vendor) - [: HAS_FUNCTION] -> (f:Function)
        OPTIONAL MATCH(f) - [: HAS_COMMAND] -> (c:Command)
        WITH v, collect(DISTINCT f) as functions, collect(DISTINCT c) as commands
        RETURN v.name as vendorName,
        [f in functions | f.name] as functionNames,
        [c in commands | c.name] as commandNames,
        id(v) as communityId
        ORDER BY size(functions) DESC
        `);
    }

    // 解析结果
    const communities = new Map();

    if (useGDS) {
      for (const record of result.records) {
        const node = record.get('node');
        const communityId = record.get('communityId');

        if (!communities.has(communityId)) {
          communities.set(communityId, {
            id: communityId,
            members: [],
            labels: new Set()
          });
        }

        const community = communities.get(communityId);
        const labels = node.labels || [];
        const name = node.properties?.name || 'Unknown';

        community.members.push({ name, labels });
        labels.forEach(l => community.labels.add(l));
      }
    } else {
      // 简化版结果解析
      for (const record of result.records) {
        const vendorName = record.get('vendorName');
        const functionNames = record.get('functionNames') || [];
        const commandNames = record.get('commandNames') || [];
        const communityId = record.get('communityId');

        communities.set(communityId, {
          id: communityId,
          vendor: vendorName,
          members: [
            { name: vendorName, labels: ['Vendor'] },
            ...functionNames.map(n => ({ name: n, labels: ['Function'] })),
            ...commandNames.map(n => ({ name: n, labels: ['Command'] }))
          ],
          labels: new Set(['Vendor', 'Function', 'Command'])
        });
      }
    }

    // 过滤小社区
    const filteredCommunities = Array.from(communities.values())
      .filter(c => c.members.length >= minCommunitySize)
      .map(c => ({
        ...c,
        labels: Array.from(c.labels),
        size: c.members.length
      }));

    // 写入社区 ID 到节点
    for (const community of filteredCommunities) {
      const memberNames = community.members.map(m => m.name);
      await session.run(`
      MATCH(n) WHERE n.name IN $memberNames
        SET n.${writeProperty} = $communityId
        `, {
        memberNames,
        communityId: community.id
      });
    }

    console.log(`[GraphRAG] 检测到 ${filteredCommunities.length} 个社区`);

    return {
      success: true,
      algorithmUsed: useGDS ? 'gds.louvain' : 'simplified',
      communities: filteredCommunities,
      stats: {
        totalCommunities: filteredCommunities.length,
        avgSize: filteredCommunities.reduce((s, c) => s + c.size, 0) / filteredCommunities.length || 0,
        largestCommunity: Math.max(...filteredCommunities.map(c => c.size), 0)
      }
    };

  } catch (error) {
    console.error('[GraphRAG] 社区检测失败:', error.message);
    return { success: false, error: error.message, communities: [] };
  } finally {
    await session.close();
  }
}

/**
 * 获取指定社区的所有成员
 * @param {number|string} communityId - 社区 ID
 * @returns {Array} 社区成员列表
 */
export async function getCommunityMembers(communityId) {
  if (!isConnected) {
    await initNeo4j();
  }

  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH(n) WHERE n.communityId = $communityId
      RETURN labels(n) as labels, n.name as name, n.communityId as communityId
      ORDER BY labels(n)[0], n.name
        `, { communityId });

    return result.records.map(r => ({
      name: r.get('name'),
      labels: r.get('labels'),
      communityId: r.get('communityId')
    }));
  } finally {
    await session.close();
  }
}

/**
 * 为社区生成摘要（使用 LLM）
 * @param {number|string} communityId - 社区 ID
 * @param {Object} options - 选项
 * @returns {string} 社区摘要
 */
export async function generateCommunitySummary(communityId, options = {}) {
  const { model = 'deepseek-ai/DeepSeek-V3' } = options;

  const members = await getCommunityMembers(communityId);

  if (members.length === 0) {
    return null;
  }

  // 按类型分组
  const byType = {};
  for (const m of members) {
    const type = m.labels[0] || 'Unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push(m.name);
  }

  const memberDescription = Object.entries(byType)
    .map(([type, names]) => `${type}: ${names.join(', ')} `)
    .join('\n');

  try {
    const apiKey = await storage.getApiKey('siliconflow');
    if (!apiKey) {
      // 无 API Key，生成简单摘要
      const vendor = byType['Vendor']?.[0] || '未知厂商';
      const funcCount = byType['Function']?.length || 0;
      const cmdCount = byType['Command']?.length || 0;
      return `${vendor} 相关社区，包含 ${funcCount} 个功能和 ${cmdCount} 个命令。`;
    }

    const response = await fetch(SILICONFLOW_CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey} `,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'system',
          content: '你是一个网络技术专家。请用 1-2 句话简洁地描述以下知识图谱社区的主题和用途。'
        }, {
          role: 'user',
          content: `社区成员: \n${memberDescription} `
        }],
        temperature: 0.3,
        max_tokens: 200
      })
    });

    if (response.ok) {
      const data = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || null;
    }
  } catch (error) {
    console.error('[GraphRAG] 生成社区摘要失败:', error.message);
  }

  return null;
}

/**
 * 获取所有社区及其摘要
 * @returns {Array} 社区列表（含摘要）
 */
export async function getAllCommunitiesWithSummaries() {
  if (!isConnected) {
    await initNeo4j();
  }

  const session = driver.session();
  try {
    // 获取所有社区 ID
    const result = await session.run(`
      MATCH(n) WHERE n.communityId IS NOT NULL
      RETURN DISTINCT n.communityId as communityId, count(n) as size
      ORDER BY size DESC
        `);

    const communities = [];
    for (const record of result.records) {
      const communityId = record.get('communityId');
      const size = record.get('size');
      const members = await getCommunityMembers(communityId);
      const summary = await generateCommunitySummary(communityId);

      communities.push({
        id: communityId,
        size,
        members: members.slice(0, 10), // 只返回前 10 个成员
        summary
      });
    }

    return communities;
  } finally {
    await session.close();
  }
}
