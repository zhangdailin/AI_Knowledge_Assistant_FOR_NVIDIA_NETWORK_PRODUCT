/**
 * 混合检索模块 - 结合 RAG 和知识图谱
 * 提升检索准确率和相关性
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as knowledgeGraph from './knowledgeGraph.mjs';
import { embedText } from './embedding.mjs';
import * as storage from './storage.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CATEGORIES_FILE = path.join(__dirname, '..', 'data', 'categories.json');
const DEFAULT_CATEGORY_NAMES = new Set(['default', '默认分类']);

let cachedVendorNames = null;
let cachedVendorMtime = 0;

function isDefaultCategoryName(name) {
  if (!name) return true;
  return DEFAULT_CATEGORY_NAMES.has(String(name).toLowerCase());
}

function collectVendorNames(nodes, names) {
  for (const node of nodes || []) {
    if (node?.name && !isDefaultCategoryName(node.name)) {
      names.push(node.name);
    }
    if (node.children) collectVendorNames(node.children, names);
  }
}

function loadVendorNamesFromCategories() {
  try {
    const stats = fs.statSync(CATEGORIES_FILE);
    if (cachedVendorNames && stats.mtimeMs === cachedVendorMtime) {
      return cachedVendorNames;
    }
    const raw = fs.readFileSync(CATEGORIES_FILE, 'utf-8');
    const data = JSON.parse(raw);
    const names = [];
    collectVendorNames(data?.tree || [], names);
    cachedVendorNames = names;
    cachedVendorMtime = stats.mtimeMs;
    return names;
  } catch (error) {
    if (!cachedVendorNames) {
      cachedVendorNames = [];
    }
    return cachedVendorNames;
  }
}

/**
 * 混合检索：结合向量检索和知识图谱
 * @param {string} query - 用户查询
 * @param {Array} vectorResults - 向量检索结果
 * @param {Object} options - 检索选项
 * @returns {Array} 增强后的检索结果
 */
export async function hybridRetrieval(query, vectorResults, options = {}) {
  const {
    enableKnowledgeGraph = true,
    kgWeight = 0.3,
    maxKgResults = 5
  } = options;

  if (!enableKnowledgeGraph) {
    return vectorResults;
  }

  try {
    // 1. 从知识图谱中检索相关实体
    const kgResults = await knowledgeGraph.queryKnowledgeGraph(query, maxKgResults);

    if (kgResults.length === 0) {
      console.log('[HybridRetrieval] 知识图谱未找到相关结果，使用纯向量检索');
      return vectorResults;
    }

    // 2. 将知识图谱结果转换为上下文信息
    const kgContext = formatKnowledgeGraphResults(kgResults);

    // 3. 增强向量检索结果
    const enhancedResults = await enhanceWithKnowledgeGraph(
      vectorResults,
      kgResults,
      kgContext,
      kgWeight
    );

    console.log(`[HybridRetrieval] ✅ 混合检索完成: ${vectorResults.length} 向量结果 + ${kgResults.length} 知识图谱结果`);

    return enhancedResults;
  } catch (error) {
    console.error('[HybridRetrieval] 混合检索失败:', error.message);
    // 降级到纯向量检索
    return vectorResults;
  }
}

/**
 * 格式化知识图谱结果为可读文本
 * @param {Array} kgResults - 知识图谱查询结果
 * @returns {string} 格式化的上下文信息
 */
function formatKnowledgeGraphResults(kgResults) {
  const contextParts = [];

  for (const result of kgResults) {
    if (result.type === 'vendor') {
      const vendor = result.vendor;
      const functions = result.functions.map(f => f.name).join(', ');
      const commands = result.commands.map(c => c.name).join(', ');

      contextParts.push(
        `厂商 ${vendor.name}:\n` +
        (functions ? `  - 功能: ${functions}\n` : '') +
        (commands ? `  - 相关命令: ${commands}\n` : '')
      );
    } else if (result.type === 'function') {
      const func = result.function;
      const vendors = result.vendors.map(v => v.name).join(', ');
      const commands = result.commands.map(c => c.name).join(', ');

      contextParts.push(
        `功能 ${func.name}:\n` +
        (vendors ? `  - 相关厂商: ${vendors}\n` : '') +
        (commands ? `  - 相关命令: ${commands}\n` : '')
      );
    } else if (result.type === 'command') {
      const command = result.command;
      const vendors = result.vendors.map(v => v.name).join(', ');
      const functions = result.functions.map(f => f.name).join(', ');
      const parameters = result.parameters.map(p => p.name).join(', ');

      contextParts.push(
        `命令 ${command.name} (类别: ${command.category}):\n` +
        (vendors ? `  - 相关厂商: ${vendors}\n` : '') +
        (functions ? `  - 相关功能: ${functions}\n` : '') +
        (parameters ? `  - 相关参数: ${parameters}\n` : '')
      );
    }
  }

  return contextParts.join('\n');
}

/**
 * 使用知识图谱信息增强向量检索结果
 * @param {Array} vectorResults - 向量检索结果
 * @param {Array} kgResults - 知识图谱结果
 * @param {string} kgContext - 格式化的知识图谱上下文
 * @param {number} kgWeight - 知识图谱权重
 * @returns {Array} 增强后的结果
 */
async function enhanceWithKnowledgeGraph(vectorResults, kgResults, kgContext, kgWeight) {
  const enhancedResults = [...vectorResults];

  // 1. 提取知识图谱中的关键实体
  const kgEntities = new Set();
  for (const result of kgResults) {
    if (result.type === 'vendor' && result.vendor?.name) {
      kgEntities.add(result.vendor.name.toLowerCase());
    } else if (result.type === 'function' && result.function?.name) {
      kgEntities.add(result.function.name.toLowerCase());
    } else if (result.type === 'command' && result.command?.name) {
      kgEntities.add(result.command.name.toLowerCase());
    } else if (result.type === 'parameter' && result.parameter?.name) {
      kgEntities.add(result.parameter.name.toLowerCase());
    }
  }

  // 2. 为包含知识图谱实体的结果提升分数
  for (const result of enhancedResults) {
    let textContent = typeof result.text === 'string'
      ? result.text
      : (typeof result.content === 'string' ? result.content : '');
    if (!textContent && result.chunk) {
      textContent = typeof result.chunk.content === 'string'
        ? result.chunk.content
        : (typeof result.chunk.text === 'string' ? result.chunk.text : '');
    }
    if (!textContent) {
      continue;
    }

    const textLower = textContent.toLowerCase();
    let entityMatchCount = 0;

    for (const entity of kgEntities) {
      if (textLower.includes(entity)) {
        entityMatchCount++;
      }
    }

    if (entityMatchCount > 0) {
      // 根据匹配的实体数量提升分数
      const boost = Math.min(entityMatchCount * kgWeight * 0.1, kgWeight);
      result.score = (result.score || 0) + boost;
      result.kgBoost = boost;
      result.kgMatches = entityMatchCount;
    }
  }

  // 3. 重新排序结果
  enhancedResults.sort((a, b) => (b.score || 0) - (a.score || 0));

  return enhancedResults;
}

/**
 * 智能路由：根据查询类型决定检索策略
 * @param {string} query - 用户查询
 * @returns {Object} 检索策略配置
 */
export function determineRetrievalStrategy(query) {
  const safeQuery = typeof query === 'string' ? query : '';
  const queryLower = safeQuery.toLowerCase();

  const vendorNames = loadVendorNamesFromCategories();
  const queryEntities = knowledgeGraph.extractEntities(safeQuery, {
    vendorNames,
    source: 'query',
    allowDefaultFunction: false
  });

  const hasVendors = queryEntities.vendors?.length > 0;
  const hasCommands = queryEntities.commands?.length > 0;
  const hasFunctions = queryEntities.functions?.length > 0;

  const vendorSignals = [
    /厂商|vendor|manufacturer|supplier|provider/i,
    /供应商|公司|集团|品牌/i
  ];

  // 1. 厂商相关查询 - 高权重知识图谱
  if (hasVendors || vendorSignals.some(pattern => pattern.test(queryLower))) {
    return {
      strategy: 'vendor-focused',
      enableKnowledgeGraph: true,
      kgWeight: 0.4,
      maxKgResults: 8
    };
  }

  // 2. 命令相关查询 - 中等权重知识图谱
  const commandPatterns = [
    /\bnv\s+(set|show|config|unset)/i,
    /\b(show|display|list|get)\b\s+\w+/i,
    /命令|command|cli/i,
    /(如何|怎么|怎样).*(配置|设置|启用|禁用)/i,
    /(configure|enable|disable)\s+\w+/i
  ];

  for (const pattern of commandPatterns) {
    if (hasCommands || pattern.test(query)) {
      return {
        strategy: 'command-focused',
        enableKnowledgeGraph: true,
        kgWeight: 0.35,
        maxKgResults: 6
      };
    }
  }

  // 3. 功能相关查询 - 中等权重知识图谱
  const functionPatterns = [
    /\b(BGP|OSPF|EVPN|VXLAN|MLAG|LACP|RoCE|ACL|VLAN|VRF)\b/i,
    /功能|feature|protocol|协议/i
  ];

  for (const pattern of functionPatterns) {
    if (hasFunctions || pattern.test(query)) {
      return {
        strategy: 'function-focused',
        enableKnowledgeGraph: true,
        kgWeight: 0.3,
        maxKgResults: 5
      };
    }
  }

  // 4. 概念性查询 - 低权重知识图谱
  const conceptPatterns = [
    /什么是|what is|介绍|explain/i,
    /原理|principle|工作方式/i
  ];

  for (const pattern of conceptPatterns) {
    if (pattern.test(query)) {
      return {
        strategy: 'concept-focused',
        enableKnowledgeGraph: true,
        kgWeight: 0.2,
        maxKgResults: 3
      };
    }
  }

  // 5. 默认策略 - 平衡权重
  return {
    strategy: 'balanced',
    enableKnowledgeGraph: true,
    kgWeight: 0.25,
    maxKgResults: 5
  };
}

/**
 * 批量处理文档以构建知识图谱
 * @param {Array} documentIds - 文档 ID 列表
 * @returns {Object} 处理统计信息
 */
export async function buildKnowledgeGraphFromDocuments(documentIds = null) {
  try {
    // 如果没有指定文档，处理所有文档
    if (!documentIds) {
      const allDocuments = await storage.getAllDocuments();
      documentIds = allDocuments.map(doc => doc.id);
    }

    console.log(`[HybridRetrieval] 开始构建知识图谱，处理 ${documentIds.length} 个文档...`);

    const stats = {
      totalDocuments: documentIds.length,
      processedDocuments: 0,
      failedDocuments: 0,
      totalEntities: {
        vendors: 0,
        functions: 0,
        commands: 0,
        parameters: 0
      }
    };

    for (const docId of documentIds) {
      try {
        const result = await knowledgeGraph.processDocument(docId);
        stats.processedDocuments++;
        stats.totalEntities.vendors += result.vendors;
        stats.totalEntities.functions += result.functions;
        stats.totalEntities.commands += result.commands;
        stats.totalEntities.parameters += result.parameters;
      } catch (error) {
        console.error(`[HybridRetrieval] 处理文档 ${docId} 失败:`, error.message);
        stats.failedDocuments++;
      }
    }

    // 获取最终的图谱统计
    const graphStats = await knowledgeGraph.getGraphStats();

    console.log('[HybridRetrieval] ✅ 知识图谱构建完成:', {
      ...stats,
      graphStats
    });

    return {
      ...stats,
      graphStats
    };
  } catch (error) {
    console.error('[HybridRetrieval] 构建知识图谱失败:', error.message);
    throw error;
  }
}

/**
 * 获取混合检索统计信息
 */
export async function getHybridRetrievalStats() {
  try {
    const graphStats = await knowledgeGraph.getGraphStats();
    return {
      knowledgeGraph: graphStats,
      status: 'active'
    };
  } catch (error) {
    console.error('[HybridRetrieval] 获取统计信息失败:', error.message);
    return {
      knowledgeGraph: {
        vendors: 0,
        vendorsTotal: 0,
        functions: 0,
        functionsTotal: 0,
        commands: 0,
        commandsTotal: 0,
        parameters: 0,
        parametersTotal: 0,
        relationships: 0
      },
      status: 'error',
      error: error.message
    };
  }
}
