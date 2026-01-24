/**
 * 混合检索模块 - 结合 RAG 和知识图谱
 * 提升检索准确率和相关性
 *
 * v2.0 增强：
 * - 动态权重计算增加更多因子
 * - 策略路由支持更多意图类型
 * - 复杂查询检测与多跳支持
 */

import * as knowledgeGraph from './knowledgeGraph.mjs';
import { embedText } from './embedding.mjs';
import * as storage from './storage-adapter.mjs';
import {
  COMMAND_CONTENT_PATTERNS,
  COMMAND_BOOST,
  STRATEGY_CONFIG,
  DYNAMIC_WEIGHT_CONFIG,
  SIGNAL_THRESHOLDS,
  EXTENDED_TECHNICAL_KEYWORDS
} from './constants.mjs';

const DEFAULT_CATEGORY_NAMES = new Set(['default', '默认分类']);
const DEFAULT_VENDOR_NAME = process.env.DEFAULT_VENDOR || 'NVIDIA';

let cachedVendorNames = null;
let cachedVendorLoadedAt = 0;
let vendorRefreshPromise = null;
const VENDOR_CACHE_TTL = 60000;

// 反馈指标缓存（避免频繁数据库查询）
let cachedFeedbackMetrics = null;
let feedbackMetricsCacheTime = 0;
const FEEDBACK_CACHE_TTL = 60000; // 1分钟缓存TTL

/**
 * 获取缓存的反馈指标（带TTL）
 * @returns {Promise<{positivityRate: number, total: number}>}
 */
async function getCachedFeedbackMetrics() {
  const now = Date.now();
  if (cachedFeedbackMetrics && (now - feedbackMetricsCacheTime) < FEEDBACK_CACHE_TTL) {
    return cachedFeedbackMetrics;
  }

  try {
    const metrics = await storage.getFeedbackMetrics();
    cachedFeedbackMetrics = {
      positivityRate: metrics.positivityRate || 0,
      total: metrics.total || 0,
      positive: metrics.positive || 0,
      negative: metrics.negative || 0
    };
    feedbackMetricsCacheTime = now;
    return cachedFeedbackMetrics;
  } catch (error) {
    // 如果获取失败，返回默认值
    return { positivityRate: 0.5, total: 0, positive: 0, negative: 0 };
  }
}

/**
 * 计算历史效果加成
 * 基于用户反馈的正面率来调整检索权重
 * @param {string} query - 查询文本
 * @param {Array} vectorResults - 向量检索结果
 * @returns {Promise<number>} 历史加成值 (0-1)
 */
async function computeHistoricalBoost(query, vectorResults) {
  try {
    const metrics = await getCachedFeedbackMetrics();

    // 如果没有足够的反馈数据，返回中性值
    if (metrics.total < 5) {
      return 0;
    }

    // 基于正面率计算基础加成
    // positivityRate = 0.5 (50%) -> boost = 0
    // positivityRate = 0.8 (80%) -> boost = 0.3
    // positivityRate = 0.3 (30%) -> boost = -0.2
    const neutralRate = 0.5;
    const baseBoost = (metrics.positivityRate - neutralRate) * 0.6;

    // 如果有结果，检查是否有负样本惩罚
    if (vectorResults && vectorResults.length > 0) {
      const topResult = vectorResults[0];
      const docId = topResult.documentId || topResult.id;
      if (docId) {
        const penalty = await storage.getNegativePenalty(query, docId);
        if (penalty < 0) {
          // 如果有负样本惩罚，减少加成
          return Math.max(0, baseBoost + penalty);
        }
      }
    }

    return Math.max(0, Math.min(1, baseBoost));
  } catch (error) {
    // 发生错误时返回中性值
    return 0;
  }
}

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

async function refreshVendorNames() {
  try {
    const data = await storage.getCategories();
    const names = [];
    collectVendorNames(data?.tree || [], names);
    cachedVendorNames = names;
    cachedVendorLoadedAt = Date.now();
  } catch (error) {
    if (!cachedVendorNames) {
      cachedVendorNames = [];
    }
  }
}

function loadVendorNamesFromCategories() {
  const now = Date.now();
  if (!cachedVendorNames) cachedVendorNames = [];
  if ((now - cachedVendorLoadedAt) > VENDOR_CACHE_TTL && !vendorRefreshPromise) {
    vendorRefreshPromise = refreshVendorNames().finally(() => {
      vendorRefreshPromise = null;
    });
  }
  return cachedVendorNames;
}

void refreshVendorNames();

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
 * 计算查询复杂度 (0-1)
 * @param {string} query - 查询文本
 * @returns {number} 复杂度分数
 */
function computeQueryComplexity(query) {
  if (!query) return 0;

  let complexity = 0;

  // 1. 长度因子
  const lengthScore = Math.min(query.length / 100, 1) * 0.25;
  complexity += lengthScore;

  // 2. 技术术语密度
  const techTerms = query.match(/\b(bgp|ospf|evpn|vxlan|mlag|vrrp|lacp|bond|vlan|vrf|acl|qos|bfd|ecmp|roce|rdma|pfc|ecn)\b/gi) || [];
  const techScore = Math.min(techTerms.length / 3, 1) * 0.25;
  complexity += techScore;

  // 3. 多实体检测
  const entities = new Set(techTerms.map(t => t.toLowerCase()));
  if (entities.size >= 2) {
    complexity += 0.2;
  }

  // 4. 多意图检测
  const intentPatterns = [
    /配置|设置|安装|部署|步骤|how to|configure/i,
    /查看|查询|显示|状态|show|display|status/i,
    /故障|异常|错误|问题|排错|troubleshoot|error/i,
    /什么是|含义|定义|原理|概念|what is/i
  ];
  const matchedIntents = intentPatterns.filter(p => p.test(query)).length;
  if (matchedIntents >= 2) {
    complexity += 0.15;
  }

  // 5. 复合句检测
  if (/和|以及|同时|另外|还有|并且|而且/.test(query)) {
    complexity += 0.15;
  }

  return Math.min(complexity, 1);
}

/**
 * 检测文档类型与意图匹配度
 * @param {string} query - 查询文本
 * @param {Array} results - 检索结果
 * @returns {number} 匹配度分数 (0-1)
 */
function computeDocumentTypeMatch(query, results) {
  if (!results || results.length === 0) return 0;

  const queryLower = query.toLowerCase();

  // 检测查询意图
  const isConfigQuery = /配置|设置|安装|部署|步骤|how to|configure|setup/i.test(query);
  const isShowQuery = /查看|查询|显示|状态|show|display|status|state/i.test(query);
  const isTroubleshootQuery = /故障|异常|错误|问题|排错|troubleshoot|error|fail|issue/i.test(query);
  const isConceptQuery = /什么是|含义|定义|原理|概念|what is|overview|introduction/i.test(query);

  let matchScore = 0;
  let totalWeight = 0;

  for (const result of results.slice(0, 5)) {
    const content = (result.content || '').toLowerCase();
    const weight = result.score || 0.5;
    totalWeight += weight;

    let docTypeMatch = 0;

    if (isConfigQuery) {
      // 配置类查询：检查是否包含配置步骤或命令
      if (/nv set|configure|配置步骤|follow these steps|step \d+/i.test(content)) {
        docTypeMatch = 1;
      } else if (/```|command|命令/i.test(content)) {
        docTypeMatch = 0.7;
      }
    } else if (isShowQuery) {
      // 查看类查询：检查是否包含查看命令或状态信息
      if (/nv show|show |display|状态|output/i.test(content)) {
        docTypeMatch = 1;
      }
    } else if (isTroubleshootQuery) {
      // 故障类查询：检查是否包含故障排查内容
      if (/troubleshoot|故障|error|排查|解决方案|solution/i.test(content)) {
        docTypeMatch = 1;
      }
    } else if (isConceptQuery) {
      // 概念类查询：检查是否包含概念解释
      if (/overview|introduction|概述|简介|是.*一种|定义/i.test(content)) {
        docTypeMatch = 1;
      }
    } else {
      docTypeMatch = 0.5; // 默认
    }

    matchScore += docTypeMatch * weight;
  }

  return totalWeight > 0 ? matchScore / totalWeight : 0;
}

/**
 * 动态计算知识图谱权重（增强版）
 * 根据查询特征、KG 结果置信度、向量检索分数分布和新增因子自动调整权重
 * @param {string} query - 用户查询
 * @param {Array} kgResults - 知识图谱检索结果
 * @param {Array} vectorResults - 向量检索结果
 * @param {number} baseWeight - 基础权重
 * @param {Object} options - 额外选项
 * @returns {Object} { weight: number, factors: Object }
 */
async function computeDynamicWeight(query, kgResults, vectorResults, baseWeight = 0.25, options = {}) {
  const { queryComplexity: precomputedComplexity = null } = options;

  const config = DYNAMIC_WEIGHT_CONFIG || {
    factors: {
      kgConfidence: 0.20,
      scoreVariance: 0.25,
      entityDensity: 0.20,
      queryComplexity: 0.15,
      documentTypeMatch: 0.15,
      historicalBoost: 0.05
    },
    minWeight: 0.1,
    maxWeight: 0.6,
    maxWeightComplex: 0.7,
    baseWeight: 0.25,
    varianceMax: 0.5,
    entityDensityCoeff: 0.1,
    entityDensityMax: 0.3
  };

  const factors = {
    kgConfidence: 0,
    scoreVariance: 0,
    entityDensity: 0,
    queryComplexity: 0,
    documentTypeMatch: 0,
    historicalBoost: 0,
    adjustment: 0
  };

  // 1. KG 结果置信度因子
  if (kgResults && kgResults.length > 0) {
    const highConfidenceCount = kgResults.filter(r => (r.relevance || 0) > 0.9).length;
    factors.kgConfidence = highConfidenceCount / kgResults.length;
  }

  // 2. 向量检索分数方差因子
  if (vectorResults && vectorResults.length > 1) {
    const scores = vectorResults.map(r => r.score || 0);
    factors.scoreVariance = Math.min(computeVariance(scores), config.varianceMax);
  }

  // 3. 查询实体密度因子
  const entityCount = countQueryEntities(query);
  factors.entityDensity = Math.min(entityCount * config.entityDensityCoeff, config.entityDensityMax);

  // 4. 查询复杂度因子（新增）
  const complexity = precomputedComplexity !== null
    ? precomputedComplexity
    : computeQueryComplexity(query);
  factors.queryComplexity = complexity;

  // 5. 文档类型匹配度因子（新增）
  factors.documentTypeMatch = computeDocumentTypeMatch(query, vectorResults);

  // 6. 历史效果加成因子（基于用户反馈）
  factors.historicalBoost = await computeHistoricalBoost(query, vectorResults);

  // 计算最终调整值（使用配置的因子权重）
  const factorWeights = config.factors;
  factors.adjustment =
    factors.kgConfidence * (factorWeights.kgConfidence || 0.20) +
    factors.scoreVariance * (factorWeights.scoreVariance || 0.25) +
    factors.entityDensity * (factorWeights.entityDensity || 0.20) +
    factors.queryComplexity * (factorWeights.queryComplexity || 0.15) +
    factors.documentTypeMatch * (factorWeights.documentTypeMatch || 0.15) +
    factors.historicalBoost * (factorWeights.historicalBoost || 0.05);

  // 动态上限：复杂查询允许更高的 KG 权重
  const maxWeight = complexity > 0.6 ? config.maxWeightComplex : config.maxWeight;

  // 最终权重 = 基础权重 * (1 + 调整因子)
  const finalWeight = Math.max(
    config.minWeight,
    Math.min(baseWeight * (1 + factors.adjustment), maxWeight)
  );

  // 调试日志
  if (process.env.DEBUG_HYBRID_RETRIEVAL === 'true') {
    console.log('[DynamicWeight] 因子详情:', {
      query: query.substring(0, 50),
      factors,
      baseWeight,
      finalWeight
    });
  }

  return {
    weight: finalWeight,
    factors,
    complexity
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
    useDynamicWeight = true,
    enableMultiHop = true,
    maxHops = 2
  } = options;

  if (!enableKnowledgeGraph) {
    return vectorResults;
  }

  try {
    // 并行执行三个独立的知识图谱查询
    const [kgResults, multiHopResults, kgChunks] = await Promise.all([
      // 1. 从知识图谱中检索相关实体（单跳）
      knowledgeGraph.queryKnowledgeGraph(query, maxKgResults).catch(e => {
        console.warn('[HybridRetrieval] KG查询失败:', e.message);
        return [];
      }),

      // 2. 多跳图谱遍历（发现间接关系）
      (enableMultiHop && knowledgeGraph.multiHopQuery)
        ? knowledgeGraph.multiHopQuery(query, { maxHops, limit: 15 }).catch(e => {
            console.log('[HybridRetrieval] 多跳查询不可用:', e.message);
            return { entities: [], paths: [], context: '' };
          })
        : Promise.resolve({ entities: [], paths: [], context: '' }),

      // 3. 获取基于实体的相关 chunks（使用 MENTIONS 关系）
      knowledgeGraph.getChunksFromQuery
        ? knowledgeGraph.getChunksFromQuery(query, 5).catch(e => {
            console.log('[HybridRetrieval] getChunksFromQuery 不可用，跳过 chunk 交叉引用');
            return [];
          })
        : Promise.resolve([])
    ]);

    if (multiHopResults.entities?.length > 0) {
      console.log(`[HybridRetrieval] 多跳查询发现 ${multiHopResults.entities.length} 个相关实体`);
    }

    const hasKgResults = kgResults.length > 0 || kgChunks.length > 0 || (multiHopResults.entities?.length || 0) > 0;
    if (!hasKgResults) {
      console.log('[HybridRetrieval] 知识图谱未找到相关结果，使用纯向量检索');
      return vectorResults;
    }

    // 4. 动态计算权重（如果启用）
    let effectiveWeight = kgWeight;
    let dynamicFactors = null;

    if (useDynamicWeight) {
      const dynamicResult = await computeDynamicWeight(query, kgResults, vectorResults, kgWeight);
      effectiveWeight = dynamicResult.weight;
      dynamicFactors = dynamicResult.factors;

      // 如果多跳查询有结果，额外提升权重
      if (multiHopResults.entities.length > 0) {
        const multiHopBoost = Math.min(multiHopResults.entities.length * 0.02, 0.1);
        effectiveWeight = Math.min(effectiveWeight + multiHopBoost, 0.5);
      }

      if (Math.abs(effectiveWeight - kgWeight) > 0.05) {
        console.log(`[HybridRetrieval] 动态权重调整: ${kgWeight.toFixed(2)} → ${effectiveWeight.toFixed(2)} ` +
          `(confidence=${dynamicFactors.kgConfidence.toFixed(2)}, variance=${dynamicFactors.scoreVariance.toFixed(2)}, density=${dynamicFactors.entityDensity.toFixed(2)})`);
      }
    }

    // 5. 将知识图谱结果转换为上下文信息（包含多跳结果）
    let kgContext = formatKnowledgeGraphResults(kgResults);
    if (multiHopResults.context) {
      kgContext += '\n\n相关实体（多跳发现）:\n' + multiHopResults.context;
    }

    // 6. 增强向量检索结果
    const enhancedResults = await enhanceWithKnowledgeGraph(
      vectorResults,
      kgResults,
      kgContext,
      effectiveWeight,
      kgChunks,
      multiHopResults.entities // 传递多跳实体用于额外评分
    );

    console.log(`[HybridRetrieval] ✅ 混合检索完成: ${vectorResults.length} 向量结果 + ${kgResults.length} 实体结果 + ${kgChunks.length} chunk 交叉引用 + ${multiHopResults.entities.length} 多跳实体`);

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
 * @param {Array} multiHopEntities - 多跳查询发现的实体（可选）
 * @returns {Array} 增强后的结果
 */
async function enhanceWithKnowledgeGraph(vectorResults, kgResults, kgContext, kgWeight, kgChunks = [], multiHopEntities = []) {
  const enhancedResults = [...vectorResults];

  // 1. 提取知识图谱中的关键实体（包括所有相关实体）
  const kgEntities = new Set();
  for (const result of kgResults) {
    // 主实体
    if (result.type === 'vendor' && result.vendor?.name) {
      kgEntities.add(result.vendor.name.toLowerCase());
      // 相关功能
      if (result.functions) {
        result.functions.forEach(f => f?.name && kgEntities.add(f.name.toLowerCase()));
      }
    } else if (result.type === 'function' && result.function?.name) {
      kgEntities.add(result.function.name.toLowerCase());
      // 相关厂商和命令
      if (result.vendors) {
        result.vendors.forEach(v => v?.name && kgEntities.add(v.name.toLowerCase()));
      }
      if (result.commands) {
        result.commands.forEach(c => c?.name && kgEntities.add(c.name.toLowerCase()));
      }
    } else if (result.type === 'command' && result.command?.name) {
      kgEntities.add(result.command.name.toLowerCase());
      // 相关参数
      if (result.parameters) {
        result.parameters.forEach(p => p?.name && kgEntities.add(p.name.toLowerCase()));
      }
    } else if (result.type === 'parameter' && result.parameter?.name) {
      kgEntities.add(result.parameter.name.toLowerCase());
    }
  }

  console.log(`[HybridRetrieval] KG 实体池: ${kgEntities.size} 个 (${Array.from(kgEntities).slice(0, 5).join(', ')}${kgEntities.size > 5 ? '...' : ''})`);

  // 1.5. 准备多跳实体及其分数
  const multiHopKeywords = [];
  for (const entity of multiHopEntities) {
    if (entity.name) {
      multiHopKeywords.push({
        name: entity.name.toLowerCase(),
        score: entity.score || 1.0,
        intentMatch: entity.intentMatch || false
      });
    }
  }

  // 1.8. 确定分数基准 - 用于自适应 Boost
  // 如果分数是 logits (e.g. 70-100)，需要按比例放大 boost
  // 如果分数是概率 (0-1) 或 RRF，保持原状
  let maxScore = 0;
  let avgScore = 0;
  if (enhancedResults.length > 0) {
    const scores = enhancedResults.map(r => r.score || 0);
    maxScore = Math.max(...scores);
    avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  // 计算缩放因子：假设标准 boost 是针对 0-1 范围设计的
  // 如果 maxScore > 2，我们认为它不是 0-1 范围，需要缩放
  // Logits 通常在 0-100 之间，或者负数。BGE Reranker v2 可能是 0-10 或更高
  let scoreScale = 1;
  if (maxScore > 2) {
    // 使用平均分的 10% 作为基准 boost 单位，或者至少 1
    scoreScale = Math.max(1, avgScore * 0.1);
  }

  console.log(`[HybridRetrieval] 分数自适应: Max=${maxScore.toFixed(2)}, Avg=${avgScore.toFixed(2)}, Scale=${scoreScale.toFixed(2)}`);

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
      // 基准 boost * scale
      const rawBoost = Math.min(kgChunkInfo.weight * kgWeight * 0.15, kgWeight * 0.5);
      const chunkBoost = rawBoost * scoreScale * 5.0; // 放大系数，确保可见

      result.score = (result.score || 0) + chunkBoost;
      result.kgChunkBoost = chunkBoost;
      result.kgChunkMatches = kgChunkInfo.matchedEntities;
    }

    if (!textContent) {
      continue;
    }

    const textLower = textContent.toLowerCase();
    let entityMatchCount = 0;

    // 多跳实体使用累积分数而不是简单计数
    let multiHopScoreSum = 0;

    // 匹配直接实体
    for (const entityName of kgEntities) {
      if (textLower.includes(entityName)) {
        entityMatchCount++;
      }
    }

    // 匹配多跳实体（排除已匹配的直接实体）
    for (const item of multiHopKeywords) {
      if (textLower.includes(item.name) && !kgEntities.has(item.name)) {
        multiHopScoreSum += item.score;
      }
    }

    if (entityMatchCount > 0) {
      // 根据匹配的实体数量提升分数
      // 原公式: Math.min(entityMatchCount * kgWeight * 0.1, kgWeight);
      const rawBoost = Math.min(entityMatchCount * kgWeight * 0.1, kgWeight);
      const boost = rawBoost * scoreScale * 3.0; // 适当放大

      result.score = (result.score || 0) + boost;
      result.kgBoost = (result.kgBoost || 0) + boost;
      result.kgMatches = entityMatchCount;
    }

    // 多跳实体匹配给予较低提升，但包含语义权重
    if (multiHopScoreSum > 0) {
      // 基础系数 0.05，但 score 现在可能是 2.0 或 3.0，所以乘积更大
      // 例如 Intent Match (score=3) -> 3 * 0.05 = 0.15 (比以前 1 * 0.05 = 0.05 高3倍)
      // 设置上限为 kgWeight * 0.5
      const rawBoost = Math.min(multiHopScoreSum * kgWeight * 0.05, kgWeight * 0.5);
      const multiHopBoost = rawBoost * scoreScale * 3.0;

      result.score = (result.score || 0) + multiHopBoost;
      result.multiHopBoost = multiHopBoost;
      // 这里的 multiHopMatches 现在存储分数和，以便 SearchPipeline 重新应用时使用
      result.multiHopMatches = multiHopScoreSum;
    }

    // 4. 命令内容加分（使用 COMMAND_CONTENT_PATTERNS）
    // 检测并提升包含实际命令语法的结果
    let commandContentBoost = 0;
    let commandMatchCount = 0;

    // 检测代码块
    if (/```[\s\S]*?```/.test(textContent)) {
      commandContentBoost += COMMAND_BOOST.CODE_BLOCK_BOOST * scoreScale;
      result.hasCodeBlock = true;
    }

    // 检测命令语法模式
    for (const pattern of COMMAND_CONTENT_PATTERNS) {
      const matches = textContent.match(pattern);
      if (matches) {
        commandMatchCount += matches.length;
      }
    }

    if (commandMatchCount > 0) {
      // 根据命令匹配数量增加分数，设置上限
      const syntaxBoost = Math.min(
        commandMatchCount * 0.03 * scoreScale,
        COMMAND_BOOST.COMMAND_SYNTAX_BOOST * scoreScale
      );
      commandContentBoost += syntaxBoost;
      result.commandMatchCount = commandMatchCount;
    }

    // 检测 nv 命令（高优先级）
    if (/nv\s+(set|show|config|unset|action)\s+\S+/i.test(textContent)) {
      commandContentBoost += COMMAND_BOOST.KG_COMMAND_BOOST * scoreScale;
      result.hasNvCommand = true;
    }

    if (commandContentBoost > 0) {
      result.score = (result.score || 0) + commandContentBoost;
      result.commandContentBoost = commandContentBoost;
    }
  }

  // 4. 重新排序结果
  enhancedResults.sort((a, b) => (b.score || 0) - (a.score || 0));

  return enhancedResults;
}

/**
 * 检测查询信号
 * @param {string} query - 查询文本
 * @returns {Object} 信号检测结果
 */
function detectQuerySignals(query) {
  const safeQuery = typeof query === 'string' ? query : '';
  const queryLower = safeQuery.toLowerCase();

  const signals = {
    vendor: { detected: false, score: 0, matches: [] },
    command: { detected: false, score: 0, matches: [] },
    function: { detected: false, score: 0, matches: [] },
    concept: { detected: false, score: 0, matches: [] },
    troubleshoot: { detected: false, score: 0, matches: [] },
    comparison: { detected: false, score: 0, matches: [] },
    list: { detected: false, score: 0, matches: [] }
  };

  // 厂商信号
  const vendorPatterns = [
    /厂商|vendor|manufacturer|supplier|provider/i,
    /供应商|公司|集团|品牌/i,
    /\b(nvidia|cumulus|cisco|juniper|arista|mellanox)\b/i
  ];
  for (const pattern of vendorPatterns) {
    const match = safeQuery.match(pattern);
    if (match) {
      signals.vendor.detected = true;
      signals.vendor.score += 0.3;
      signals.vendor.matches.push(match[0]);
    }
  }

  // 命令信号
  const commandPatterns = [
    { pattern: /\bnv\s+(set|show|config|unset|action)\b/i, weight: 0.5 },
    { pattern: /\b(show|display|list|get)\b\s+\w+/i, weight: 0.3 },
    { pattern: /命令|command|cli/i, weight: 0.2 },
    { pattern: /(如何|怎么|怎样).*(配置|设置|启用|禁用)/i, weight: 0.6 },  // 提高权重，使其覆盖功能信号
    { pattern: /(configure|enable|disable)\s+\w+/i, weight: 0.3 },
    { pattern: /```[\s\S]*?```/, weight: 0.3 } // 代码块
  ];
  for (const { pattern, weight } of commandPatterns) {
    const match = safeQuery.match(pattern);
    if (match) {
      signals.command.detected = true;
      signals.command.score += weight;
      signals.command.matches.push(match[0]);
    }
  }

  // 功能信号
  const functionPatterns = [
    { pattern: /\b(BGP|OSPF|EVPN|VXLAN|MLAG|LACP|RoCE|ACL|VLAN|VRF|VRRP|BFD|ECMP|PFC|ECN)\b/i, weight: 0.3 },
    { pattern: /功能|feature|protocol|协议/i, weight: 0.2 }
  ];
  for (const { pattern, weight } of functionPatterns) {
    const match = safeQuery.match(pattern);
    if (match) {
      signals.function.detected = true;
      signals.function.score += weight;
      signals.function.matches.push(match[0]);
    }
  }

  // 概念信号
  const conceptPatterns = [
    { pattern: /什么是|what is|介绍|explain/i, weight: 0.4 },
    { pattern: /原理|principle|工作方式|机制/i, weight: 0.3 },
    { pattern: /概念|概述|overview|introduction|定义/i, weight: 0.3 }
  ];
  for (const { pattern, weight } of conceptPatterns) {
    const match = safeQuery.match(pattern);
    if (match) {
      signals.concept.detected = true;
      signals.concept.score += weight;
      signals.concept.matches.push(match[0]);
    }
  }

  // 故障排查信号
  const troubleshootPatterns = [
    { pattern: /故障|异常|错误|问题|排错|排查/i, weight: 0.4 },
    { pattern: /troubleshoot|debug|diagnose|error|fail|issue/i, weight: 0.4 },
    { pattern: /不工作|无法|cannot|unable|doesn't work/i, weight: 0.3 },
    { pattern: /为什么.{0,6}不|why.{0,6}not/i, weight: 0.3 }
  ];
  for (const { pattern, weight } of troubleshootPatterns) {
    const match = safeQuery.match(pattern);
    if (match) {
      signals.troubleshoot.detected = true;
      signals.troubleshoot.score += weight;
      signals.troubleshoot.matches.push(match[0]);
    }
  }

  // 比较信号
  const comparisonPatterns = [
    { pattern: /区别|差异|不同|对比|比较|vs|versus/i, weight: 0.4 },
    { pattern: /哪个更好|which is better|优缺点|pros and cons/i, weight: 0.3 },
    { pattern: /和.{1,10}(区别|对比|比较)/i, weight: 0.3 }
  ];
  for (const { pattern, weight } of comparisonPatterns) {
    const match = safeQuery.match(pattern);
    if (match) {
      signals.comparison.detected = true;
      signals.comparison.score += weight;
      signals.comparison.matches.push(match[0]);
    }
  }

  // 列表信号
  const listPatterns = [
    { pattern: /有哪些|列出|列举|所有|全部|list all/i, weight: 0.4 },
    { pattern: /支持哪些|都有什么|有多少/i, weight: 0.3 }
  ];
  for (const { pattern, weight } of listPatterns) {
    const match = safeQuery.match(pattern);
    if (match) {
      signals.list.detected = true;
      signals.list.score += weight;
      signals.list.matches.push(match[0]);
    }
  }

  // 限制分数上限
  for (const key in signals) {
    signals[key].score = Math.min(signals[key].score, 1);
  }

  return signals;
}

/**
 * 智能路由：根据查询类型决定检索策略（增强版）
 * @param {string} query - 用户查询
 * @returns {Object} 检索策略配置
 */
// 5. 默认策略 - 平衡权重
export function determineRetrievalStrategy(query) {
  const safeQuery = typeof query === 'string' ? query : '';
  const queryLower = safeQuery.toLowerCase();

  // 检测所有信号
  const signals = detectQuerySignals(safeQuery);

  // 计算查询复杂度
  const complexity = computeQueryComplexity(safeQuery);

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

  // 更新信号状态
  if (hasVendors) signals.vendor.detected = true;
  if (hasCommands) {
    signals.command.detected = true;
    signals.command.score += 0.3;
  }
  if (hasFunctions) {
    signals.function.detected = true;
    signals.function.score += 0.2;
  }

  /** @type {Object} */
  const defaultConfig = STRATEGY_CONFIG?.['balanced'] || {
    enableKnowledgeGraph: false,
    kgWeight: 0.1,
    maxKgResults: 5,
    keywordBoost: 1.0,
    vectorBoost: 1.0,
    enableMultiHop: false
  };

  const finalStrategy = {
    strategy: 'balanced',
    ...defaultConfig,
    preferredVendors: vendorDetection.preferredVendors,
    defaultVendor: DEFAULT_VENDOR_NAME,
    complexity,
    signals
  };

  // 使用信号分数排序确定主策略（映射到4种核心策略）
  const signalScores = [
    {
      type: 'command-focused',
      score: Math.max(signals.vendor.score, signals.command.score),
      detected: signals.command.detected || signals.vendor.detected || hasVendors
    },
    {
      type: 'concept-focused',
      score: Math.max(signals.function.score, signals.concept.score),
      detected: signals.function.detected || signals.concept.detected
    },
    {
      type: 'troubleshoot-focused',
      score: signals.troubleshoot.score,
      detected: signals.troubleshoot.detected
    },
    {
      type: 'balanced',
      score: signals.comparison.score,
      detected: signals.comparison.detected
    }
  ];

  // 按分数排序，选择最强信号
  signalScores.sort((a, b) => b.score - a.score);

  const threshold = SIGNAL_THRESHOLDS?.strategyConfidence || 0.3;
  const topSignal = signalScores.find(s => s.detected && s.score >= threshold);

  if (topSignal) {
    const strategyName = topSignal.type;
    const strategyConfig = STRATEGY_CONFIG?.[strategyName];

    if (strategyConfig) {
      Object.assign(finalStrategy, {
        strategy: strategyName,
        ...strategyConfig
      });

      // 复杂查询调整
      if (complexity > (SIGNAL_THRESHOLDS?.complexityThreshold || 0.6)) {
        // 复杂查询：增加 KG 权重和结果数量
        if (strategyConfig.kgWeightComplex) {
          finalStrategy.kgWeight = strategyConfig.kgWeightComplex;
        }
        if (strategyConfig.maxKgResultsComplex) {
          finalStrategy.maxKgResults = strategyConfig.maxKgResultsComplex;
        }
        // 复杂查询启用多跳
        if (complexity > 0.7 && !finalStrategy.enableMultiHop) {
          finalStrategy.enableMultiHop = true;
        }
      }

      // 使用默认厂商时降低权重
      if (usesDefaultVendor && finalStrategy.kgWeight > 0.2) {
        finalStrategy.kgWeight *= 0.8;
      }
    }
  }

  // 特殊处理：故障排查总是启用多跳
  if (signals.troubleshoot.detected && signals.troubleshoot.score > 0.3) {
    finalStrategy.enableMultiHop = true;
  }

  // 命令查询的额外优化
  if (signals.command.detected && signals.command.score > 0.4) {
    // 判断是否是强命令查询
    const strongCommandPatterns = [
      /\bnv\s+(set|show|config|unset|action)\b/i,
      /```[\s\S]*?```/,
      /如何.*(配置|设置|启用|禁用|查看)/i,
      /怎么.*(配置|设置|启用|禁用|查看)/i
    ];
    const isStrongCommandQuery = strongCommandPatterns.some(p => p.test(safeQuery));

    if (isStrongCommandQuery) {
      finalStrategy.prioritizeCommands = true;
      finalStrategy.commandBoostMultiplier = 1.5;
      if (finalStrategy.kgWeight < 0.4) {
        finalStrategy.kgWeight = 0.4;
      }
      if (finalStrategy.maxKgResults < 8) {
        finalStrategy.maxKgResults = 8;
      }
    } else {
      finalStrategy.prioritizeCommands = true;
      finalStrategy.commandBoostMultiplier = 1.2;
    }
  }

  console.log(`[Strategy] ${finalStrategy.strategy} (complexity=${complexity.toFixed(2)}, kgWeight=${finalStrategy.kgWeight})`);

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
      status: 'success'
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
