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
const DEFAULT_VENDOR_NAME = process.env.DEFAULT_VENDOR || 'NVIDIA';

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
 * 计算数组方差
 * @param {Array<number>} arr - 数字数组
 * @returns {number} 方差值
 */
function computeVariance(arr) {
  if (!arr || arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const squaredDiffs = arr.map(x => Math.pow(x - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * 统计查询中的实体数量
 * @param {string} query - 查询文本
 * @returns {number} 实体数量
 */
function countQueryEntities(query) {
  if (!query) return 0;
  const vendorNames = loadVendorNamesFromCategories();
  const queryEntities = knowledgeGraph.extractEntities(query, {
    vendorNames,
    source: 'query',
    allowDefaultFunction: false,
    allowHeuristicVendors: false
  });

  return (queryEntities.vendors?.length || 0) +
    (queryEntities.functions?.length || 0) +
    (queryEntities.commands?.length || 0);
}

/**
 * 动态计算知识图谱权重
 * 根据查询特征、KG 结果置信度和向量检索分数分布自动调整权重
 * @param {string} query - 用户查询
 * @param {Array} kgResults - 知识图谱检索结果
 * @param {Array} vectorResults - 向量检索结果
 * @param {number} baseWeight - 基础权重
 * @returns {Object} { weight: number, factors: Object }
 */
function computeDynamicWeight(query, kgResults, vectorResults, baseWeight = 0.25) {
  const factors = {
    kgConfidence: 0,
    scoreVariance: 0,
    entityDensity: 0,
    adjustment: 0
  };

  // 1. KG 结果置信度因子
  // 高置信度结果（relevance > 0.9）越多，权重越高
  if (kgResults && kgResults.length > 0) {
    const highConfidenceCount = kgResults.filter(r => (r.relevance || 0) > 0.9).length;
    factors.kgConfidence = highConfidenceCount / kgResults.length;
  }

  // 2. 向量检索分数方差因子
  // 分数方差越大（不确定性高），KG 权重应该越高以帮助区分
  if (vectorResults && vectorResults.length > 1) {
    const scores = vectorResults.map(r => r.score || 0);
    factors.scoreVariance = Math.min(computeVariance(scores), 0.5); // 上限 0.5
  }

  // 3. 查询实体密度因子
  // 查询中实体越多，KG 越有价值
  const entityCount = countQueryEntities(query);
  factors.entityDensity = Math.min(entityCount * 0.1, 0.3); // 上限 0.3

  // 计算最终调整
  factors.adjustment =
    factors.kgConfidence * 0.3 +    // KG 置信度贡献 30%
    factors.scoreVariance * 0.4 +    // 向量分数方差贡献 40%
    factors.entityDensity * 0.3;     // 实体密度贡献 30%

  // 最终权重 = 基础权重 * (1 + 调整因子)，上限为 0.6
  const finalWeight = Math.min(baseWeight * (1 + factors.adjustment), 0.6);

  return {
    weight: finalWeight,
    factors
  };
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
    kgWeight = 0.25,
    maxKgResults = 5,
    useDynamicWeight = true
  } = options;

  if (!enableKnowledgeGraph) {
    return vectorResults;
  }

  try {
    // 1. 从知识图谱中检索相关实体
    const kgResults = await knowledgeGraph.queryKnowledgeGraph(query, maxKgResults);

    // 2. 获取基于实体的相关 chunks（使用 MENTIONS 关系）
    let kgChunks = [];
    try {
      kgChunks = await knowledgeGraph.getChunksFromQuery(query, 5);
    } catch (e) {
      // getChunksFromQuery 可能不存在于旧版本
      console.log('[HybridRetrieval] getChunksFromQuery 不可用，跳过 chunk 交叉引用');
    }

    if (kgResults.length === 0 && kgChunks.length === 0) {
      console.log('[HybridRetrieval] 知识图谱未找到相关结果，使用纯向量检索');
      return vectorResults;
    }

    // 3. 动态计算权重（如果启用）
    let effectiveWeight = kgWeight;
    let dynamicFactors = null;

    if (useDynamicWeight) {
      const dynamicResult = computeDynamicWeight(query, kgResults, vectorResults, kgWeight);
      effectiveWeight = dynamicResult.weight;
      dynamicFactors = dynamicResult.factors;

      if (Math.abs(effectiveWeight - kgWeight) > 0.05) {
        console.log(`[HybridRetrieval] 动态权重调整: ${kgWeight.toFixed(2)} → ${effectiveWeight.toFixed(2)} ` +
          `(confidence=${dynamicFactors.kgConfidence.toFixed(2)}, variance=${dynamicFactors.scoreVariance.toFixed(2)}, density=${dynamicFactors.entityDensity.toFixed(2)})`);
      }
    }

    // 4. 将知识图谱结果转换为上下文信息
    const kgContext = formatKnowledgeGraphResults(kgResults);

    // 5. 增强向量检索结果
    const enhancedResults = await enhanceWithKnowledgeGraph(
      vectorResults,
      kgResults,
      kgContext,
      effectiveWeight,
      kgChunks
    );

    console.log(`[HybridRetrieval] ✅ 混合检索完成: ${vectorResults.length} 向量结果 + ${kgResults.length} 实体结果 + ${kgChunks.length} chunk 交叉引用`);

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
 * @param {Array} kgChunks - 知识图谱相关的 chunks（可选）
 * @returns {Array} 增强后的结果
 */
async function enhanceWithKnowledgeGraph(vectorResults, kgResults, kgContext, kgWeight, kgChunks = []) {
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

  // 2. 构建 KG chunk ID 到权重的映射
  const kgChunkMap = new Map();
  for (const chunk of kgChunks) {
    if (chunk.chunkId) {
      kgChunkMap.set(chunk.chunkId, {
        weight: chunk.weight || 1,
        matchedEntities: chunk.matchedEntities || []
      });
    }
  }

  // 3. 为包含知识图谱实体的结果提升分数
  for (const result of enhancedResults) {
    let textContent = typeof result.text === 'string'
      ? result.text
      : (typeof result.content === 'string' ? result.content : '');
    if (!textContent && result.chunk) {
      textContent = typeof result.chunk.content === 'string'
        ? result.chunk.content
        : (typeof result.chunk.text === 'string' ? result.chunk.text : '');
    }

    // 获取结果的 chunk ID
    const resultChunkId = result.chunkId || result.id || result.chunk?.id;

    // 检查是否在 KG chunk 列表中（基于 MENTIONS 关系）
    if (resultChunkId && kgChunkMap.has(resultChunkId)) {
      const kgChunkInfo = kgChunkMap.get(resultChunkId);
      // 该 chunk 被知识图谱通过 MENTIONS 关系识别，给予额外提升
      const chunkBoost = Math.min(kgChunkInfo.weight * kgWeight * 0.15, kgWeight * 0.5);
      result.score = (result.score || 0) + chunkBoost;
      result.kgChunkBoost = chunkBoost;
      result.kgChunkMatches = kgChunkInfo.matchedEntities;
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
      result.kgBoost = (result.kgBoost || 0) + boost;
      result.kgMatches = entityMatchCount;
    }
  }

  // 4. 重新排序结果
  enhancedResults.sort((a, b) => (b.score || 0) - (a.score || 0));

  return enhancedResults;
}

/**
 * 智能路由：根据查询类型决定检索策略
 * @param {string} query - 用户查询
 * @returns {Object} 检索策略配置
 */
// 5. 默认策略 - 平衡权重
export function determineRetrievalStrategy(query) {
  const safeQuery = typeof query === 'string' ? query : '';
  const queryLower = safeQuery.toLowerCase();

  const vendorNames = loadVendorNamesFromCategories();
  const vendorDetection = knowledgeGraph.detectPreferredVendors(safeQuery, vendorNames, {
    defaultVendor: DEFAULT_VENDOR_NAME
  });
  const queryEntities = knowledgeGraph.extractEntities(safeQuery, {
    vendorNames,
    source: 'query',
    allowDefaultFunction: false,
    allowHeuristicVendors: false
  });

  const hasVendors = vendorDetection.explicitVendors.length > 0;
  const hasCommands = queryEntities.commands?.length > 0;
  const hasFunctions = queryEntities.functions?.length > 0;
  const usesDefaultVendor = vendorDetection.usedDefault === true;

  const vendorSignals = [
    /厂商|vendor|manufacturer|supplier|provider/i,
    /供应商|公司|集团|品牌/i
  ];
  const hasVendorSignal = vendorSignals.some(pattern => pattern.test(queryLower));

  const commandPatterns = [
    /\bnv\s+(set|show|config|unset)/i,
    /\b(show|display|list|get)\b\s+\w+/i,
    /命令|command|cli/i,
    /(如何|怎么|怎样).*(配置|设置|启用|禁用)/i,
    /(configure|enable|disable)\s+\w+/i
  ];
  const hasCommandSignal = hasCommands || commandPatterns.some(pattern => pattern.test(query));

  const functionPatterns = [
    /\b(BGP|OSPF|EVPN|VXLAN|MLAG|LACP|RoCE|ACL|VLAN|VRF)\b/i,
    /功能|feature|protocol|协议/i
  ];
  const hasFunctionSignal = hasFunctions || functionPatterns.some(pattern => pattern.test(query));

  const conceptPatterns = [
    /什么是|what is|介绍|explain/i,
    /原理|principle|工作方式/i
  ];
  const hasConceptSignal = conceptPatterns.some(pattern => pattern.test(query));

  /** @type {Object} */
  const finalStrategy = {
    strategy: 'balanced',
    enableKnowledgeGraph: false,
    kgWeight: 0.05,
    maxKgResults: 5,
    preferredVendors: vendorDetection.preferredVendors,
    defaultVendor: DEFAULT_VENDOR_NAME
  };

  // 1. 厂商相关查询
  if (hasVendors || hasVendorSignal) {
    Object.assign(finalStrategy, {
      strategy: 'vendor-focused',
      enableKnowledgeGraph: true,
      kgWeight: 0.4,
      maxKgResults: 8
    });
  }
  // 2. 命令相关查询
  else if (hasCommandSignal) {
    Object.assign(finalStrategy, {
      strategy: 'command-focused',
      enableKnowledgeGraph: true,
      kgWeight: usesDefaultVendor ? 0.25 : 0.35,
      maxKgResults: 6
    });
  }
  // 3. 功能相关查询
  else if (hasFunctionSignal) {
    Object.assign(finalStrategy, {
      strategy: 'function-focused',
      enableKnowledgeGraph: true,
      kgWeight: usesDefaultVendor ? 0.2 : 0.3,
      maxKgResults: 5
    });
  }
  // 4. 概念性查询
  else if (hasConceptSignal) {
    Object.assign(finalStrategy, {
      strategy: 'concept-focused',
      enableKnowledgeGraph: false,
      kgWeight: 0.1,
      maxKgResults: 3
    });
  }

  return finalStrategy;
}

/**
 * 包装函数：支持实验配置的增强版 determineRetrievalStrategy
 */
export function determineRetrievalStrategyWithAB(query, experimentConfig = null) {
  const strategy = determineRetrievalStrategy(query);

  if (experimentConfig && typeof experimentConfig.kgWeight === 'number') {
    strategy.kgWeight = experimentConfig.kgWeight;
    strategy.abTestApplied = true;
    console.log(`[HybridRetrieval] A/B 测试覆盖权重: ${strategy.kgWeight}`);
  }

  return strategy;
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

// ========== GraphRAG: 双模式检索 ==========

/**
 * 全局搜索 - 基于社区摘要的检索
 * 适用于需要理解整体关系的复杂问题
 * @param {string} query - 用户查询
 * @param {Object} options - 选项
 * @returns {Object} 全局搜索结果
 */
export async function globalSearch(query, options = {}) {
  const {
    maxCommunities = 5,
    includeMembers = true
  } = options;

  try {
    // 获取所有社区及其摘要
    const communities = await knowledgeGraph.getAllCommunitiesWithSummaries();

    if (!communities || communities.length === 0) {
      return {
        success: false,
        message: '没有可用的社区数据，请先运行 detectCommunities()',
        results: []
      };
    }

    // 简单的关键词匹配（后续可用向量相似度）
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length >= 2);

    const scoredCommunities = communities.map(community => {
      let score = 0;
      const summary = (community.summary || '').toLowerCase();
      const memberNames = community.members?.map(m => m.name?.toLowerCase()) || [];

      // 摘要匹配
      for (const term of queryTerms) {
        if (summary.includes(term)) score += 2;
      }

      // 成员名称匹配
      for (const term of queryTerms) {
        for (const name of memberNames) {
          if (name?.includes(term)) score += 1;
        }
      }

      return { ...community, relevanceScore: score };
    });

    // 过滤和排序
    const relevantCommunities = scoredCommunities
      .filter(c => c.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxCommunities);

    // 构建全局上下文
    const globalContext = relevantCommunities.map(c => {
      const memberList = includeMembers
        ? c.members?.slice(0, 5).map(m => m.name).join(', ')
        : '';
      return `[社区 ${c.id}] ${c.summary || '无摘要'}${memberList ? `\n成员: ${memberList}` : ''}`;
    }).join('\n\n');

    console.log(`[GraphRAG] 全局搜索: 匹配 ${relevantCommunities.length} 个社区`);

    return {
      success: true,
      mode: 'global',
      query,
      matchedCommunities: relevantCommunities.length,
      communities: relevantCommunities,
      globalContext
    };
  } catch (error) {
    console.error('[GraphRAG] 全局搜索失败:', error.message);
    return { success: false, error: error.message, results: [] };
  }
}

/**
 * GraphRAG 双模式检索
 * 自动选择或组合 Local（向量+KG）和 Global（社区摘要）策略
 * @param {string} query - 用户查询
 * @param {Array} vectorResults - 向量检索结果
 * @param {Object} options - 选项
 * @returns {Object} 检索结果
 */
export async function graphRAGSearch(query, vectorResults = [], options = {}) {
  const {
    mode = 'auto', // 'local' | 'global' | 'hybrid' | 'auto'
    enableKnowledgeGraph = true,
    kgWeight = 0.25
  } = options;

  // 判断查询类型
  const isGlobalQuery = detectGlobalQueryIntent(query);
  const effectiveMode = mode === 'auto'
    ? (isGlobalQuery ? 'hybrid' : 'local')
    : mode;

  console.log(`[GraphRAG] 检索模式: ${effectiveMode} (查询类型: ${isGlobalQuery ? '全局' : '局部'})`);

  const results = {
    mode: effectiveMode,
    local: null,
    global: null,
    combined: []
  };

  // Local 检索
  if (effectiveMode === 'local' || effectiveMode === 'hybrid') {
    results.local = await hybridRetrieval(query, vectorResults, {
      enableKnowledgeGraph,
      kgWeight,
      useDynamicWeight: true
    });
  }

  // Global 检索
  if (effectiveMode === 'global' || effectiveMode === 'hybrid') {
    results.global = await globalSearch(query);
  }

  // 合并结果
  if (effectiveMode === 'hybrid' && results.local && results.global?.success) {
    // 将全局上下文注入到结果中
    results.combined = results.local.map(doc => ({
      ...doc,
      graphRAGContext: results.global.globalContext
    }));

    // 如果本地结果少于预期，补充社区相关 chunks
    if (results.local.length < 5 && results.global.communities?.length > 0) {
      const communityChunks = await getChunksFromCommunities(results.global.communities);
      for (const chunk of communityChunks) {
        if (!results.combined.find(r => r.id === chunk.id)) {
          results.combined.push({
            ...chunk,
            source: 'community',
            graphRAGContext: results.global.globalContext
          });
        }
      }
    }
  } else if (effectiveMode === 'local') {
    results.combined = results.local || [];
  } else if (effectiveMode === 'global') {
    results.combined = results.global?.communities?.map(c => ({
      id: `community-${c.id}`,
      content: c.summary,
      type: 'community_summary',
      members: c.members,
      score: c.relevanceScore
    })) || [];
  }

  return results;
}

/**
 * 检测是否为全局查询（需要跨文档理解）
 */
function detectGlobalQueryIntent(query) {
  const globalPatterns = [
    /所有|全部|总体|整体|概述|汇总|比较|对比/,
    /哪些.*厂商|哪些.*功能|有多少|多少种/,
    /区别|差异|不同|相同|共同点/,
    /all|overall|summary|compare|comparison|difference|vs/i,
    /how many|which.*vendors|list.*all/i
  ];

  return globalPatterns.some(p => p.test(query));
}

/**
 * 从社区中获取相关 chunks
 */
async function getChunksFromCommunities(communities, limit = 10) {
  const chunks = [];

  for (const community of communities.slice(0, 3)) {
    for (const member of community.members?.slice(0, 3) || []) {
      if (member.labels?.includes('Function') || member.labels?.includes('Command')) {
        try {
          const entityChunks = await knowledgeGraph.getChunksByEntity(
            member.name,
            member.labels[0],
            3
          );
          chunks.push(...entityChunks);
        } catch (e) {
          // 忽略错误
        }
      }
    }
  }

  // 去重并限制数量
  const seen = new Set();
  return chunks.filter(c => {
    if (seen.has(c.chunkId)) return false;
    seen.add(c.chunkId);
    return true;
  }).slice(0, limit);
}
