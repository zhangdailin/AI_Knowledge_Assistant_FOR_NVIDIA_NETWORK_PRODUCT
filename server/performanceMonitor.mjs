/**
 * 实时性能监控模块
 * 收集和分析系统运行时性能指标
 */

// 性能指标存储
const performanceMetrics = {
  // 搜索性能
  search: {
    totalRequests: 0,
    totalResponseTime: 0,
    requests: [], // 保留最近100次请求
    cacheHits: 0,
    cacheMisses: 0
  },

  // 缓存性能
  cache: {
    exactMatches: 0,
    semanticMatches: 0,
    misses: 0,
    avgSimilarity: 0
  },

  // 检索性能
  retrieval: {
    keywordSearchTime: [],
    vectorSearchTime: [],
    rerankTime: [],
    fusionTime: []
  },

  // 查询扩展
  expansion: {
    total: 0,
    avgVariants: 0,
    variantCounts: []
  },

  // 负样本学习
  negativeLearning: {
    totalPenalties: 0,
    avgPenalty: 0,
    penalties: []
  },

  // 系统资源
  system: {
    memoryUsage: [],
    timestamps: []
  },

  // 启动时间
  startTime: Date.now()
};

/**
 * 记录搜索请求
 */
export function recordSearchRequest(duration, cached, cacheType, variantCount = 1) {
  const now = Date.now();

  performanceMetrics.search.totalRequests++;
  performanceMetrics.search.totalResponseTime += duration;

  // 保留最近100次请求
  performanceMetrics.search.requests.push({
    timestamp: now,
    duration,
    cached,
    cacheType
  });

  if (performanceMetrics.search.requests.length > 100) {
    performanceMetrics.search.requests.shift();
  }

  // 缓存命中率
  if (cached) {
    performanceMetrics.search.cacheHits++;
    if (cacheType === 'exact') {
      performanceMetrics.cache.exactMatches++;
    } else if (cacheType === 'semantic') {
      performanceMetrics.cache.semanticMatches++;
    }
  } else {
    performanceMetrics.search.cacheMisses++;
    performanceMetrics.cache.misses++;
  }

  // 查询扩展统计
  if (variantCount > 1) {
    performanceMetrics.expansion.total++;
    performanceMetrics.expansion.variantCounts.push(variantCount);
    if (performanceMetrics.expansion.variantCounts.length > 100) {
      performanceMetrics.expansion.variantCounts.shift();
    }
  }
}

/**
 * 记录检索阶段性能
 */
export function recordRetrievalMetrics(stage, duration) {
  const metricKey = `${stage}Time`;
  if (performanceMetrics.retrieval[metricKey]) {
    performanceMetrics.retrieval[metricKey].push(duration);

    // 只保留最近50次
    if (performanceMetrics.retrieval[metricKey].length > 50) {
      performanceMetrics.retrieval[metricKey].shift();
    }
  }
}

/**
 * 记录负样本惩罚
 */
export function recordNegativePenalty(penalty) {
  performanceMetrics.negativeLearning.totalPenalties++;
  performanceMetrics.negativeLearning.penalties.push(Math.abs(penalty));

  if (performanceMetrics.negativeLearning.penalties.length > 100) {
    performanceMetrics.negativeLearning.penalties.shift();
  }
}

/**
 * 记录系统资源使用
 */
export function recordSystemMetrics() {
  const usage = process.memoryUsage();

  performanceMetrics.system.memoryUsage.push({
    rss: usage.rss / 1024 / 1024, // MB
    heapUsed: usage.heapUsed / 1024 / 1024, // MB
    heapTotal: usage.heapTotal / 1024 / 1024, // MB
    external: usage.external / 1024 / 1024 // MB
  });

  performanceMetrics.system.timestamps.push(Date.now());

  // 只保留最近50个数据点
  if (performanceMetrics.system.memoryUsage.length > 50) {
    performanceMetrics.system.memoryUsage.shift();
    performanceMetrics.system.timestamps.shift();
  }
}

/**
 * 获取性能摘要
 */
export function getPerformanceSummary() {
  const totalRequests = performanceMetrics.search.totalRequests;
  const totalHits = performanceMetrics.search.cacheHits;
  const cacheHitRate = totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;

  const avgResponseTime = totalRequests > 0
    ? performanceMetrics.search.totalResponseTime / totalRequests
    : 0;

  const avgVariants = performanceMetrics.expansion.variantCounts.length > 0
    ? performanceMetrics.expansion.variantCounts.reduce((a, b) => a + b, 0) / performanceMetrics.expansion.variantCounts.length
    : 0;

  const avgPenalty = performanceMetrics.negativeLearning.penalties.length > 0
    ? performanceMetrics.negativeLearning.penalties.reduce((a, b) => a + b, 0) / performanceMetrics.negativeLearning.penalties.length
    : 0;

  const uptime = Date.now() - performanceMetrics.startTime;

  const currentMemory = performanceMetrics.system.memoryUsage.length > 0
    ? performanceMetrics.system.memoryUsage[performanceMetrics.system.memoryUsage.length - 1]
    : null;

  return {
    uptime: Math.floor(uptime / 1000), // 秒
    search: {
      totalRequests,
      avgResponseTime: Math.round(avgResponseTime),
      cacheHitRate: Math.round(cacheHitRate * 10) / 10,
      exactCacheHits: performanceMetrics.cache.exactMatches,
      semanticCacheHits: performanceMetrics.cache.semanticMatches,
      cacheMisses: performanceMetrics.cache.misses
    },
    expansion: {
      totalExpanded: performanceMetrics.expansion.total,
      avgVariants: Math.round(avgVariants * 10) / 10
    },
    negativeLearning: {
      totalPenalties: performanceMetrics.negativeLearning.totalPenalties,
      avgPenalty: Math.round(avgPenalty * 1000) / 1000
    },
    memory: currentMemory,
    health: calculateHealthScore()
  };
}

/**
 * 获取详细性能数据
 */
export function getDetailedMetrics() {
  const recentSearches = performanceMetrics.search.requests.slice(-20);

  const retrievalStats = {};
  for (const [stage, times] of Object.entries(performanceMetrics.retrieval)) {
    if (times.length > 0) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const max = Math.max(...times);
      const min = Math.min(...times);

      retrievalStats[stage.replace('Time', '')] = {
        avg: Math.round(avg),
        max: Math.round(max),
        min: Math.round(min),
        samples: times.length
      };
    }
  }

  return {
    summary: getPerformanceSummary(),
    recentSearches,
    retrievalBreakdown: retrievalStats,
    memoryHistory: performanceMetrics.system.memoryUsage.map((mem, idx) => ({
      timestamp: performanceMetrics.system.timestamps[idx],
      ...mem
    }))
  };
}

/**
 * 计算健康评分（0-100）
 */
function calculateHealthScore() {
  let score = 100;

  // 缓存命中率（权重30%）
  const hitRate = performanceMetrics.search.totalRequests > 0
    ? (performanceMetrics.search.cacheHits / performanceMetrics.search.totalRequests) * 100
    : 50;

  if (hitRate < 30) score -= 30;
  else if (hitRate < 50) score -= 15;
  else if (hitRate < 70) score -= 5;

  // 平均响应时间（权重40%）
  const avgTime = performanceMetrics.search.totalRequests > 0
    ? performanceMetrics.search.totalResponseTime / performanceMetrics.search.totalRequests
    : 0;

  if (avgTime > 5000) score -= 40; // >5秒
  else if (avgTime > 3000) score -= 25; // >3秒
  else if (avgTime > 2000) score -= 15; // >2秒
  else if (avgTime > 1000) score -= 5;  // >1秒

  // 内存使用（权重30%）
  if (performanceMetrics.system.memoryUsage.length > 0) {
    const latestMem = performanceMetrics.system.memoryUsage[performanceMetrics.system.memoryUsage.length - 1];
    const heapUsedMB = latestMem.heapUsed;

    if (heapUsedMB > 1024) score -= 30; // >1GB
    else if (heapUsedMB > 768) score -= 20; // >768MB
    else if (heapUsedMB > 512) score -= 10; // >512MB
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * 重置性能指标
 */
export function resetMetrics() {
  performanceMetrics.search = {
    totalRequests: 0,
    totalResponseTime: 0,
    requests: [],
    cacheHits: 0,
    cacheMisses: 0
  };

  performanceMetrics.cache = {
    exactMatches: 0,
    semanticMatches: 0,
    misses: 0,
    avgSimilarity: 0
  };

  performanceMetrics.retrieval = {
    keywordSearchTime: [],
    vectorSearchTime: [],
    rerankTime: [],
    fusionTime: []
  };

  performanceMetrics.expansion = {
    total: 0,
    avgVariants: 0,
    variantCounts: []
  };

  performanceMetrics.negativeLearning = {
    totalPenalties: 0,
    avgPenalty: 0,
    penalties: []
  };

  performanceMetrics.system = {
    memoryUsage: [],
    timestamps: []
  };

  performanceMetrics.startTime = Date.now();
}

// 定期记录系统资源（每30秒）
setInterval(() => {
  recordSystemMetrics();
}, 30000);

// 初始记录
recordSystemMetrics();
