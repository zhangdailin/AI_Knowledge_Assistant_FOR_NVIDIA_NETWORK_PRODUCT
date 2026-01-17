/**
 * 知识图谱模块 - Neo4j 集成
 * 实现实体抽取、图谱存储和混合检索
 */

import neo4j from 'neo4j-driver';
import * as storage from './storage.mjs';

// Neo4j 连接配置
let driver = null;
let isConnected = false;

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

function normalizeVendorName(value) {
  const cleaned = normalizeWhitespace(String(value || '').replace(/["'()[\]<>]/g, ''));
  const stripped = cleaned.replace(/^(the|a|an)\s+/i, '');
  return stripped.replace(/[.,;:]+$/g, '');
}

function isStopwordVendor(value) {
  const lowered = value.toLowerCase();
  return VENDOR_STOPWORDS.has(lowered);
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
  return true;
}

function extractVendorCandidates(text, options = {}) {
  const candidates = new Map();
  const textLower = text.toLowerCase();
  const vendorNames = Array.isArray(options.vendorNames) ? options.vendorNames : [];
  const explicitVendor = options.vendorName;

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
    if (!looksLikeAcronym(token) && !looksLikeLowerAcronym(lowerToken)) continue;
    const normalized = token.toUpperCase();
    if (FUNCTION_ACRONYM_STOPWORDS.has(normalized)) continue;
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
    if (!cleanName || cleanName.length <= 3) return;
    const key = cleanName.toLowerCase();
    if (!commandMap.has(key)) {
      commandMap.set(key, { name: cleanName, category, source });
    }
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
    vendorNames: metadata.vendorNames
  });

  for (const vendorName of vendorCandidates) {
    addVendor(vendorName);
  }

  // 2. 提取命令实体 - 放宽匹配模式
  const commandPatterns = [
    // Cumulus/NVUE 命令
    { regex: /\bnv\s+(?:set|show|config|unset|apply|list)(?:\s+[\w\-\.\/]+)*/gi, category: 'nvue' },
    // Linux 网络命令
    { regex: /\b(?:ip|ifconfig|route|netstat|ping|traceroute|tcpdump|ethtool|brctl)\s+[\w\-]+/gi, category: 'linux' },
    // 配置命令 - 包含更多常见命令
    { regex: /\b(?:configure|show|set|get|enable|disable|add|delete|remove)\s+[\w\-]+/gi, category: 'config' },
    // 网络特定命令
    { regex: /\b(?:vlan|interface|router|bgp|ospf|mlag)\s+(?:add|delete|show|config|set)\s*[\w\-]*/gi, category: 'network' }
  ];

  const commandMatches = [];
  for (const pattern of commandPatterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const commandText = match[0]?.trim();
      if (!commandText) continue;
      addCommand(commandText, pattern.category);
      if (typeof match.index === 'number') {
        commandMatches.push({ name: commandText, index: match.index });
      }
    }
  }

  // 3. 提取参数实体
  const parameterPatterns = [
    // 网络参数
    { regex: /\b(vlan|vrf|bgp|ospf|mlag|lacp|bond)\s*[=:]?\s*(\w+)/gi, type: 'network_param' },
    // IP 地址
    { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?\b/g, type: 'ip_address' },
    // 端口号
    { regex: /\bport\s*[=:]?\s*(\d+)/gi, type: 'port' },
    // 接口名称
    { regex: /\b(eth|swp|bond|vlan)\d+/gi, type: 'interface' }
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
      if (commandIndex !== -1 && paramIndex !== -1 && Math.abs(commandIndex - paramIndex) < 100) {
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

  // 7. 合理性检查 - 防止过度识别
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
 * @param {Object} chunkMetadata - chunk 元数据
 */
export async function storeEntities(entities, chunkMetadata = {}) {
  if (!isConnected) {
    await initNeo4j();
  }

  const session = driver.session();
  try {
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

    console.log(`[KnowledgeGraph] ✅ 存储实体: ${entities.vendors?.length || 0} 厂商, ${entities.functions?.length || 0} 功能, ${entities.commands?.length || 0} 命令, ${entities.parameters?.length || 0} 参数`);
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
    const queryEntities = extractEntities(query, { vendorNames, source: 'query', allowDefaultFunction: false });

    // 2. 查找厂商相关信息
    for (const vendor of queryEntities.vendors.slice(0, 3)) {
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
      const result = await session.run(`
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
      const result = await session.run(`
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
      const searchResult = await session.run(`
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
        vendorNames
      });

      // 跨 chunk 去重 - 使用 Map 存储唯一实体
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
      const key = `${rel.fromType}:${rel.from}|${rel.type}|${rel.toType}:${rel.to}`;
      if (!relSet.has(key)) {
        relSet.add(key);
        uniqueRelationships.push(rel);
      }
    }

    // 转换为数组并存储
    const uniqueEntities = {
      vendors: Array.from(allEntities.vendors.values()),
      functions: Array.from(allEntities.functions.values()),
      commands: Array.from(allEntities.commands.values()),
      parameters: Array.from(allEntities.parameters.values()),
      relationships: uniqueRelationships
    };

    if (uniqueEntities.vendors.length > 0 || uniqueEntities.functions.length > 0 ||
        uniqueEntities.commands.length > 0 || uniqueEntities.parameters.length > 0) {
      await storeEntities(uniqueEntities);
    }

    const totalEntities = {
      vendors: uniqueEntities.vendors.length,
      functions: uniqueEntities.functions.length,
      commands: uniqueEntities.commands.length,
      parameters: uniqueEntities.parameters.length
    };

    console.log(`[KnowledgeGraph] ✅ 文档 ${documentId} 处理完成:`, totalEntities);
    return totalEntities;
  } catch (error) {
    console.error(`[KnowledgeGraph] 处理文档 ${documentId} 失败:`, error.message);
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
      MATCH (v:Vendor)
      WITH count(v) as vendorCount,
           sum(size(coalesce(v.sources, []))) as vendorTotal
      MATCH (f:Function)
      WITH vendorCount, vendorTotal,
           count(f) as functionCount,
           sum(size(coalesce(f.sources, []))) as functionTotal
      MATCH (c:Command)
      WITH vendorCount, vendorTotal, functionCount, functionTotal,
           count(c) as commandCount,
           sum(size(coalesce(c.sources, []))) as commandTotal
      MATCH (p:Parameter)
      WITH vendorCount, vendorTotal, functionCount, functionTotal,
           commandCount, commandTotal,
           count(p) as paramCount,
           sum(size(coalesce(p.sources, []))) as paramTotal
      MATCH ()-[r]->()
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
      MATCH (n)
      RETURN labels(n) as labels, properties(n) as props, id(n) as id
    `);

    const nodes = nodesResult.records.map(record => ({
      id: record.get('id'),
      labels: record.get('labels'),
      properties: record.get('props')
    }));

    // 获取所有关系
    const relsResult = await session.run(`
      MATCH (a)-[r]->(b)
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
