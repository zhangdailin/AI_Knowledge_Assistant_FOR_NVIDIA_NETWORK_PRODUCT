/**
 * 混合检索模块 - 结合 RAG 和知识图谱
 * 提升检索准确率和相关性
 */

import * as knowledgeGraph from './knowledgeGraph.mjs';
import { embedText } from './embedding.mjs';
import * as storage from './storage.mjs';

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
    if (result.type === 'device') {
      const device = result.device;
      const commands = result.commands.map(c => c.name).join(', ');
      const protocols = result.protocols.map(p => p.name).join(', ');

      contextParts.push(
        `设备 ${device.name} (类型: ${device.type}):\n` +
        (commands ? `  - 支持命令: ${commands}\n` : '') +
        (protocols ? `  - 支持协议: ${protocols}\n` : '')
      );
    } else if (result.type === 'command') {
      const command = result.command;
      const devices = result.devices.map(d => d.name).join(', ');
      const parameters = result.parameters.map(p => p.name).join(', ');

      contextParts.push(
        `命令 ${command.name} (类别: ${command.category}):\n` +
        (devices ? `  - 适用设备: ${devices}\n` : '') +
        (parameters ? `  - 相关参数: ${parameters}\n` : '')
      );
    } else if (result.type === 'protocol') {
      const protocol = result.protocol;
      const devices = result.devices.map(d => d.name).join(', ');

      contextParts.push(
        `协议 ${protocol.name}:\n` +
        (devices ? `  - 支持设备: ${devices}\n` : '')
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
    if (result.type === 'device' && result.device) {
      kgEntities.add(result.device.name.toLowerCase());
    } else if (result.type === 'command' && result.command) {
      kgEntities.add(result.command.name.toLowerCase());
    } else if (result.type === 'protocol' && result.protocol) {
      kgEntities.add(result.protocol.name.toLowerCase());
    }
  }

  // 2. 为包含知识图谱实体的结果提升分数
  for (const result of enhancedResults) {
    const textLower = result.text.toLowerCase();
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

  // 3. 添加知识图谱上下文作为额外的结果项（如果有价值）
  if (kgContext && kgContext.length > 50) {
    enhancedResults.push({
      text: `【知识图谱相关信息】\n${kgContext}`,
      score: kgWeight * 0.5,
      source: 'knowledge_graph',
      isKnowledgeGraph: true,
      metadata: {
        type: 'knowledge_graph_context',
        resultCount: kgResults.length
      }
    });
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
export function determineRetrievalStrategy(query) {
  const queryLower = query.toLowerCase();

  // 1. 设备相关查询 - 高权重知识图谱
  const devicePatterns = [
    /\b(IBCR|IBSP|IBLF|CSW|SSW|ASW)[-_]?\w*\d+/i,
    /设备|device|switch|router/i,
    /拓扑|topology/i
  ];

  for (const pattern of devicePatterns) {
    if (pattern.test(query)) {
      return {
        strategy: 'device-focused',
        enableKnowledgeGraph: true,
        kgWeight: 0.4,
        maxKgResults: 8
      };
    }
  }

  // 2. 命令相关查询 - 中等权重知识图谱
  const commandPatterns = [
    /\bnv\s+(set|show|config|unset)/i,
    /命令|command|配置|config/i,
    /如何|怎么|how to/i
  ];

  for (const pattern of commandPatterns) {
    if (pattern.test(query)) {
      return {
        strategy: 'command-focused',
        enableKnowledgeGraph: true,
        kgWeight: 0.35,
        maxKgResults: 6
      };
    }
  }

  // 3. 协议相关查询 - 中等权重知识图谱
  const protocolPatterns = [
    /\b(BGP|OSPF|EVPN|VXLAN|MLAG|LACP|RoCE)\b/i,
    /协议|protocol/i
  ];

  for (const pattern of protocolPatterns) {
    if (pattern.test(query)) {
      return {
        strategy: 'protocol-focused',
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
        devices: 0,
        commands: 0,
        parameters: 0,
        protocols: 0
      }
    };

    for (const docId of documentIds) {
      try {
        const result = await knowledgeGraph.processDocument(docId);
        stats.processedDocuments++;
        stats.totalEntities.devices += result.devices;
        stats.totalEntities.commands += result.commands;
        stats.totalEntities.parameters += result.parameters;
        stats.totalEntities.protocols += result.protocols;
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
      knowledgeGraph: { devices: 0, commands: 0, parameters: 0, protocols: 0, relationships: 0 },
      status: 'error',
      error: error.message
    };
  }
}
