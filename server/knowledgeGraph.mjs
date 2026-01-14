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
      CREATE CONSTRAINT device_name_unique IF NOT EXISTS
      FOR (d:Device) REQUIRE d.name IS UNIQUE
    `);

    await session.run(`
      CREATE CONSTRAINT command_name_unique IF NOT EXISTS
      FOR (c:Command) REQUIRE c.name IS UNIQUE
    `);

    await session.run(`
      CREATE CONSTRAINT parameter_name_unique IF NOT EXISTS
      FOR (p:Parameter) REQUIRE p.name IS UNIQUE
    `);

    await session.run(`
      CREATE CONSTRAINT protocol_name_unique IF NOT EXISTS
      FOR (pr:Protocol) REQUIRE pr.name IS UNIQUE
    `);

    // 创建全文索引用于搜索
    await session.run(`
      CREATE FULLTEXT INDEX device_search IF NOT EXISTS
      FOR (d:Device) ON EACH [d.name, d.type, d.description]
    `);

    await session.run(`
      CREATE FULLTEXT INDEX command_search IF NOT EXISTS
      FOR (c:Command) ON EACH [c.name, c.description, c.syntax]
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

/**
 * 实体抽取 - 从文本中提取设备、命令、参数等实体
 * @param {string} text - 输入文本
 * @param {Object} metadata - 文档元数据
 * @returns {Object} 提取的实体
 */
export function extractEntities(text, metadata = {}) {
  const entities = {
    devices: [],
    commands: [],
    parameters: [],
    protocols: [],
    relationships: []
  };

  if (!text || typeof text !== 'string') {
    return entities;
  }

  const textLower = text.toLowerCase();

  // 1. 提取设备实体
  const devicePatterns = [
    // 网络设备命名模式
    { regex: /\b(IBCR|IBSP|IBLF|CSW|SSW|ASW)[-_]?\w*\d+/gi, type: 'switch' },
    { regex: /\b(core|spine|leaf|tor)[-_]?switch[-_]?\d*/gi, type: 'switch' },
    { regex: /\b(router|switch|gateway|firewall)[-_]?\d*/gi, type: 'network_device' },
    // GPU/计算节点
    { regex: /\b(GPU|DGX|H100|A100|H800|A800)[-_]?\w*\d*/gi, type: 'compute_node' },
    { regex: /\b(node|host|server)[-_]?\d+/gi, type: 'compute_node' }
  ];

  for (const pattern of devicePatterns) {
    const matches = text.match(pattern.regex);
    if (matches) {
      for (const match of matches) {
        const deviceName = match.trim();
        if (deviceName.length > 2 && !entities.devices.find(d => d.name === deviceName)) {
          entities.devices.push({
            name: deviceName,
            type: pattern.type,
            source: metadata.documentId || 'unknown'
          });
        }
      }
    }
  }

  // 2. 提取命令实体
  const commandPatterns = [
    // Cumulus/NVUE 命令
    { regex: /\bnv\s+(set|show|config|unset|apply)\s+[\w\-\.]+(?:\s+[\w\-\.]+)*/gi, category: 'nvue' },
    // Linux 网络命令
    { regex: /\b(ip|ifconfig|route|netstat|ping|traceroute|tcpdump)\s+[\w\-]+/gi, category: 'linux' },
    // 配置命令
    { regex: /\b(configure|show|set|get|enable|disable)\s+[\w\-]+/gi, category: 'config' }
  ];

  for (const pattern of commandPatterns) {
    const matches = text.match(pattern.regex);
    if (matches) {
      for (const match of matches) {
        const commandText = match.trim();
        if (commandText.length > 3 && !entities.commands.find(c => c.name === commandText)) {
          entities.commands.push({
            name: commandText,
            category: pattern.category,
            source: metadata.documentId || 'unknown'
          });
        }
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
    const matches = text.match(pattern.regex);
    if (matches) {
      for (const match of matches) {
        const paramName = match.trim();
        if (paramName.length > 1 && !entities.parameters.find(p => p.name === paramName)) {
          entities.parameters.push({
            name: paramName,
            type: pattern.type,
            source: metadata.documentId || 'unknown'
          });
        }
      }
    }
  }

  // 4. 提取协议实体
  const protocolKeywords = [
    'BGP', 'OSPF', 'EVPN', 'VXLAN', 'MLAG', 'LACP', 'STP', 'RSTP',
    'LLDP', 'ARP', 'ICMP', 'TCP', 'UDP', 'RoCE', 'InfiniBand'
  ];

  for (const protocol of protocolKeywords) {
    const regex = new RegExp(`\\b${protocol}\\b`, 'gi');
    if (regex.test(text)) {
      if (!entities.protocols.find(p => p.name.toLowerCase() === protocol.toLowerCase())) {
        entities.protocols.push({
          name: protocol,
          source: metadata.documentId || 'unknown'
        });
      }
    }
  }

  // 5. 提取关系
  // 设备-命令关系
  for (const device of entities.devices) {
    for (const command of entities.commands) {
      // 检查命令是否在设备附近出现（简单的共现检测）
      const deviceIndex = text.indexOf(device.name);
      const commandIndex = text.indexOf(command.name);
      if (deviceIndex !== -1 && commandIndex !== -1 && Math.abs(deviceIndex - commandIndex) < 200) {
        entities.relationships.push({
          from: device.name,
          to: command.name,
          type: 'USES_COMMAND',
          fromType: 'Device',
          toType: 'Command'
        });
      }
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

  // 设备-协议关系
  for (const device of entities.devices) {
    for (const protocol of entities.protocols) {
      const deviceIndex = text.indexOf(device.name);
      const protocolIndex = text.toLowerCase().indexOf(protocol.name.toLowerCase());
      if (deviceIndex !== -1 && protocolIndex !== -1 && Math.abs(deviceIndex - protocolIndex) < 300) {
        entities.relationships.push({
          from: device.name,
          to: protocol.name,
          type: 'SUPPORTS_PROTOCOL',
          fromType: 'Device',
          toType: 'Protocol'
        });
      }
    }
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
    // 1. 创建设备节点
    for (const device of entities.devices) {
      await session.run(`
        MERGE (d:Device {name: $name})
        ON CREATE SET
          d.type = $type,
          d.createdAt = datetime(),
          d.sources = [$source]
        ON MATCH SET
          d.sources = CASE
            WHEN NOT $source IN d.sources
            THEN d.sources + $source
            ELSE d.sources
          END
      `, {
        name: device.name,
        type: device.type,
        source: device.source
      });
    }

    // 2. 创建命令节点
    for (const command of entities.commands) {
      await session.run(`
        MERGE (c:Command {name: $name})
        ON CREATE SET
          c.category = $category,
          c.createdAt = datetime(),
          c.sources = [$source]
        ON MATCH SET
          c.sources = CASE
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

    // 3. 创建参数节点
    for (const param of entities.parameters) {
      await session.run(`
        MERGE (p:Parameter {name: $name})
        ON CREATE SET
          p.type = $type,
          p.createdAt = datetime(),
          p.sources = [$source]
        ON MATCH SET
          p.sources = CASE
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

    // 4. 创建协议节点
    for (const protocol of entities.protocols) {
      await session.run(`
        MERGE (pr:Protocol {name: $name})
        ON CREATE SET
          pr.createdAt = datetime(),
          pr.sources = [$source]
        ON MATCH SET
          pr.sources = CASE
            WHEN NOT $source IN pr.sources
            THEN pr.sources + $source
            ELSE pr.sources
          END
      `, {
        name: protocol.name,
        source: protocol.source
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

    console.log(`[KnowledgeGraph] ✅ 存储实体: ${entities.devices.length} 设备, ${entities.commands.length} 命令, ${entities.parameters.length} 参数, ${entities.protocols.length} 协议`);
  } catch (error) {
    console.error('[KnowledgeGraph] 存储实体失败:', error.message);
    throw error;
  } finally {
    await session.close();
  }
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
    const results = [];

    // 1. 从查询中提取关键实体
    const queryEntities = extractEntities(query);

    // 2. 查找设备相关信息
    for (const device of queryEntities.devices.slice(0, 3)) {
      const result = await session.run(`
        MATCH (d:Device {name: $deviceName})
        OPTIONAL MATCH (d)-[r1:USES_COMMAND]->(c:Command)
        OPTIONAL MATCH (c)-[r2:HAS_PARAMETER]->(p:Parameter)
        OPTIONAL MATCH (d)-[r3:SUPPORTS_PROTOCOL]->(pr:Protocol)
        RETURN d,
               collect(DISTINCT c) as commands,
               collect(DISTINCT p) as parameters,
               collect(DISTINCT pr) as protocols
        LIMIT 1
      `, { deviceName: device.name });

      if (result.records.length > 0) {
        const record = result.records[0];
        results.push({
          type: 'device',
          device: record.get('d').properties,
          commands: record.get('commands').map(c => c.properties),
          parameters: record.get('parameters').map(p => p.properties),
          protocols: record.get('protocols').map(pr => pr.properties),
          relevance: 1.0
        });
      }
    }

    // 3. 查找命令相关信息
    for (const command of queryEntities.commands.slice(0, 3)) {
      const result = await session.run(`
        MATCH (c:Command {name: $commandName})
        OPTIONAL MATCH (d:Device)-[:USES_COMMAND]->(c)
        OPTIONAL MATCH (c)-[:HAS_PARAMETER]->(p:Parameter)
        RETURN c,
               collect(DISTINCT d) as devices,
               collect(DISTINCT p) as parameters
        LIMIT 1
      `, { commandName: command.name });

      if (result.records.length > 0) {
        const record = result.records[0];
        results.push({
          type: 'command',
          command: record.get('c').properties,
          devices: record.get('devices').map(d => d.properties),
          parameters: record.get('parameters').map(p => p.properties),
          relevance: 0.9
        });
      }
    }

    // 4. 查找协议相关信息
    for (const protocol of queryEntities.protocols.slice(0, 2)) {
      const result = await session.run(`
        MATCH (pr:Protocol {name: $protocolName})
        OPTIONAL MATCH (d:Device)-[:SUPPORTS_PROTOCOL]->(pr)
        OPTIONAL MATCH (d)-[:USES_COMMAND]->(c:Command)
        RETURN pr,
               collect(DISTINCT d) as devices,
               collect(DISTINCT c) as commands
        LIMIT 1
      `, { protocolName: protocol.name });

      if (result.records.length > 0) {
        const record = result.records[0];
        results.push({
          type: 'protocol',
          protocol: record.get('pr').properties,
          devices: record.get('devices').map(d => d.properties),
          commands: record.get('commands').map(c => c.properties),
          relevance: 0.8
        });
      }
    }

    // 5. 如果没有找到精确匹配，使用全文搜索
    if (results.length === 0) {
      const searchResult = await session.run(`
        CALL db.index.fulltext.queryNodes('device_search', $query)
        YIELD node, score
        MATCH (node)-[r]->(related)
        RETURN node, collect(DISTINCT related) as related, score
        ORDER BY score DESC
        LIMIT $limit
      `, { query: query, limit: limit });

      for (const record of searchResult.records) {
        results.push({
          type: 'search',
          node: record.get('node').properties,
          related: record.get('related').map(n => n.properties),
          relevance: record.get('score')
        });
      }
    }

    return results.slice(0, limit);
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
      return;
    }

    let totalEntities = { devices: 0, commands: 0, parameters: 0, protocols: 0 };

    for (const chunk of chunks) {
      const entities = extractEntities(chunk.text, {
        documentId: documentId,
        chunkId: chunk.id
      });

      if (entities.devices.length > 0 || entities.commands.length > 0 ||
          entities.parameters.length > 0 || entities.protocols.length > 0) {
        await storeEntities(entities, chunk);

        totalEntities.devices += entities.devices.length;
        totalEntities.commands += entities.commands.length;
        totalEntities.parameters += entities.parameters.length;
        totalEntities.protocols += entities.protocols.length;
      }
    }

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
      MATCH (d:Device) WITH count(d) as deviceCount
      MATCH (c:Command) WITH deviceCount, count(c) as commandCount
      MATCH (p:Parameter) WITH deviceCount, commandCount, count(p) as paramCount
      MATCH (pr:Protocol) WITH deviceCount, commandCount, paramCount, count(pr) as protocolCount
      MATCH ()-[r]->() WITH deviceCount, commandCount, paramCount, protocolCount, count(r) as relationshipCount
      RETURN deviceCount, commandCount, paramCount, protocolCount, relationshipCount
    `);

    if (result.records.length > 0) {
      const record = result.records[0];
      return {
        devices: record.get('deviceCount'),
        commands: record.get('commandCount'),
        parameters: record.get('paramCount'),
        protocols: record.get('protocolCount'),
        relationships: record.get('relationshipCount')
      };
    }

    return { devices: 0, commands: 0, parameters: 0, protocols: 0, relationships: 0 };
  } catch (error) {
    console.error('[KnowledgeGraph] 获取统计信息失败:', error.message);
    return { devices: 0, commands: 0, parameters: 0, protocols: 0, relationships: 0 };
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
