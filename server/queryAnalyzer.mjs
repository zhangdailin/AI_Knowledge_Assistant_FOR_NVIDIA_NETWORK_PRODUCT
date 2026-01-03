/**
 * 查询日志分析工具
 * 提供数据驱动的优化建议
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUERY_LOGS_FILE = path.join(__dirname, '../data/query_logs.json');
const NEGATIVE_SAMPLES_FILE = path.join(__dirname, '../data/negative_samples.json');

/**
 * 加载查询日志
 */
async function loadQueryLogs() {
  try {
    const content = await fs.readFile(QUERY_LOGS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    return [];
  }
}

/**
 * 加载负样本数据
 */
async function loadNegativeSamples() {
  try {
    const content = await fs.readFile(NEGATIVE_SAMPLES_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    return {};
  }
}

/**
 * 分析查询模式
 */
function analyzeQueryPatterns(logs) {
  const patterns = {
    total: logs.length,
    byIntent: {
      command: 0,    // 命令查询（如何配置、怎么查看）
      concept: 0,    // 概念查询（是什么、原理）
      troubleshoot: 0, // 故障排查（报错、不工作）
      general: 0     // 一般查询
    },
    byComplexity: {
      simple: 0,     // 简单查询（<10字符）
      medium: 0,     // 中等查询（10-50字符）
      complex: 0     // 复杂查询（>50字符）
    },
    topQueries: {},
    commonKeywords: {},
    avgLength: 0,
    avgResponseTime: 0
  };

  let totalLength = 0;
  let totalResponseTime = 0;

  for (const log of logs) {
    const query = log.query || '';
    const queryLower = query.toLowerCase();

    // 查询次数统计
    patterns.topQueries[query] = (patterns.topQueries[query] || 0) + 1;

    // 意图分类
    if (/如何|怎么|怎样|怎么样|配置|设置|查看|检查|show|config/.test(queryLower)) {
      patterns.byIntent.command++;
    } else if (/是什么|什么是|原理|概念|定义/.test(queryLower)) {
      patterns.byIntent.concept++;
    } else if (/故障|错误|不工作|失败|报错|异常/.test(queryLower)) {
      patterns.byIntent.troubleshoot++;
    } else {
      patterns.byIntent.general++;
    }

    // 复杂度分类
    if (query.length < 10) {
      patterns.byComplexity.simple++;
    } else if (query.length < 50) {
      patterns.byComplexity.medium++;
    } else {
      patterns.byComplexity.complex++;
    }

    // 关键词提取
    const keywords = query.match(/[\u4e00-\u9fa5a-zA-Z]{2,}/g) || [];
    for (const kw of keywords) {
      patterns.commonKeywords[kw] = (patterns.commonKeywords[kw] || 0) + 1;
    }

    totalLength += query.length;
    totalResponseTime += log.responseTime || 0;
  }

  patterns.avgLength = logs.length > 0 ? (totalLength / logs.length).toFixed(1) : 0;
  patterns.avgResponseTime = logs.length > 0 ? (totalResponseTime / logs.length / 1000).toFixed(2) : 0;

  // 排序
  patterns.topQueries = Object.entries(patterns.topQueries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  patterns.commonKeywords = Object.entries(patterns.commonKeywords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  return patterns;
}

/**
 * 分析性能瓶颈
 */
function analyzePerformance(logs) {
  const performance = {
    fast: 0,      // <10s
    medium: 0,    // 10-30s
    slow: 0,      // 30-60s
    verySlow: 0,  // >60s
    slowQueries: []
  };

  for (const log of logs) {
    const time = (log.responseTime || 0) / 1000;

    if (time < 10) {
      performance.fast++;
    } else if (time < 30) {
      performance.medium++;
    } else if (time < 60) {
      performance.slow++;
      performance.slowQueries.push({ query: log.query, time: time.toFixed(2) });
    } else {
      performance.verySlow++;
      performance.slowQueries.push({ query: log.query, time: time.toFixed(2) });
    }
  }

  performance.slowQueries.sort((a, b) => b.time - a.time).slice(0, 10);

  return performance;
}

/**
 * 生成优化建议
 */
function generateRecommendations(patterns, performance, negativeSamples) {
  const recommendations = [];

  // 1. 基于查询意图的建议
  const commandRatio = patterns.byIntent.command / patterns.total;
  if (commandRatio > 0.5) {
    recommendations.push({
      category: '查询重写',
      priority: 'HIGH',
      message: `命令类查询占比${(commandRatio * 100).toFixed(1)}%，建议扩展查询重写规则`,
      action: '在storage.mjs中添加更多命令查询的重写模式'
    });
  }

  // 2. 基于性能的建议
  const slowRatio = (performance.slow + performance.verySlow) / patterns.total;
  if (slowRatio > 0.3) {
    recommendations.push({
      category: '性能优化',
      priority: 'CRITICAL',
      message: `${(slowRatio * 100).toFixed(1)}%的查询响应时间>30秒，需优化`,
      action: '检查embedding API延迟，考虑增加缓存大小或启用批处理'
    });
  }

  // 3. 基于关键词的建议
  const topKeyword = patterns.commonKeywords[0];
  if (topKeyword && topKeyword[1] > 5) {
    recommendations.push({
      category: '同义词扩展',
      priority: 'MEDIUM',
      message: `关键词"${topKeyword[0]}"出现${topKeyword[1]}次，建议添加同义词`,
      action: `在TERM_MAPPINGS中为"${topKeyword[0]}"添加更多同义词`
    });
  }

  // 4. 基于负样本的建议
  const negativeQueryCount = Object.keys(negativeSamples).length;
  if (negativeQueryCount > 10) {
    recommendations.push({
      category: '负样本学习',
      priority: 'HIGH',
      message: `已积累${negativeQueryCount}个负样本，建议定期清理或调整惩罚权重`,
      action: '检查negative_samples.json，清理过时的负样本数据'
    });
  }

  // 5. 基于复杂查询的建议
  const complexRatio = patterns.byComplexity.complex / patterns.total;
  if (complexRatio > 0.2) {
    recommendations.push({
      category: '查询理解',
      priority: 'MEDIUM',
      message: `${(complexRatio * 100).toFixed(1)}%的查询较长（>50字符），可能需要改进理解`,
      action: '考虑添加查询分段或多轮对话支持'
    });
  }

  return recommendations;
}

/**
 * 主分析函数
 */
export async function analyzeQueries() {
  console.log('='.repeat(60));
  console.log('📊 查询日志分析报告');
  console.log('='.repeat(60));
  console.log();

  const logs = await loadQueryLogs();
  const negativeSamples = await loadNegativeSamples();

  if (logs.length === 0) {
    console.log('❌ 没有查询日志数据');
    return;
  }

  // 1. 查询模式分析
  const patterns = analyzeQueryPatterns(logs);
  console.log('📋 查询模式统计');
  console.log('-'.repeat(60));
  console.log(`总查询数: ${patterns.total}`);
  console.log(`平均查询长度: ${patterns.avgLength} 字符`);
  console.log(`平均响应时间: ${patterns.avgResponseTime} 秒`);
  console.log();

  console.log('查询意图分布:');
  for (const [intent, count] of Object.entries(patterns.byIntent)) {
    const ratio = ((count / patterns.total) * 100).toFixed(1);
    console.log(`  ${intent}: ${count} (${ratio}%)`);
  }
  console.log();

  console.log('查询复杂度分布:');
  for (const [complexity, count] of Object.entries(patterns.byComplexity)) {
    const ratio = ((count / patterns.total) * 100).toFixed(1);
    console.log(`  ${complexity}: ${count} (${ratio}%)`);
  }
  console.log();

  console.log('🔥 高频查询 (Top 10):');
  for (const [query, count] of patterns.topQueries) {
    console.log(`  ${count}次: "${query}"`);
  }
  console.log();

  console.log('🔑 高频关键词 (Top 10):');
  for (const [keyword, count] of patterns.commonKeywords.slice(0, 10)) {
    console.log(`  ${count}次: "${keyword}"`);
  }
  console.log();

  // 2. 性能分析
  const performance = analyzePerformance(logs);
  console.log('⚡ 性能统计');
  console.log('-'.repeat(60));
  console.log(`快速 (<10s): ${performance.fast} (${((performance.fast / patterns.total) * 100).toFixed(1)}%)`);
  console.log(`中等 (10-30s): ${performance.medium} (${((performance.medium / patterns.total) * 100).toFixed(1)}%)`);
  console.log(`慢速 (30-60s): ${performance.slow} (${((performance.slow / patterns.total) * 100).toFixed(1)}%)`);
  console.log(`极慢 (>60s): ${performance.verySlow} (${((performance.verySlow / patterns.total) * 100).toFixed(1)}%)`);
  console.log();

  if (performance.slowQueries.length > 0) {
    console.log('🐌 最慢查询 (Top 5):');
    for (const { query, time } of performance.slowQueries.slice(0, 5)) {
      console.log(`  ${time}s: "${query}"`);
    }
    console.log();
  }

  // 3. 负样本统计
  const negativeQueryCount = Object.keys(negativeSamples).length;
  let totalNegativeFeedbacks = 0;
  for (const docs of Object.values(negativeSamples)) {
    totalNegativeFeedbacks += Object.values(docs).reduce((sum, count) => sum + count, 0);
  }

  console.log('👎 负样本统计');
  console.log('-'.repeat(60));
  console.log(`负样本查询数: ${negativeQueryCount}`);
  console.log(`总负反馈次数: ${totalNegativeFeedbacks}`);
  console.log();

  // 4. 优化建议
  const recommendations = generateRecommendations(patterns, performance, negativeSamples);
  console.log('💡 优化建议');
  console.log('-'.repeat(60));

  if (recommendations.length === 0) {
    console.log('✅ 系统运行良好，暂无优化建议');
  } else {
    for (const rec of recommendations) {
      const priorityIcon = rec.priority === 'CRITICAL' ? '🔴' :
                           rec.priority === 'HIGH' ? '🟡' : '🟢';
      console.log(`${priorityIcon} [${rec.category}] ${rec.message}`);
      console.log(`   → ${rec.action}`);
      console.log();
    }
  }

  console.log('='.repeat(60));
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  analyzeQueries().catch(console.error);
}
