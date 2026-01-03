/**
 * 文档质量评分系统
 * 基于多维度指标评估文档质量，优先推荐高质量内容
 */

/**
 * 计算文档质量分数
 * @param {Object} document - 文档对象
 * @param {Array} chunks - 文档的所有 chunks
 * @param {Object} stats - 统计数据（可选）
 * @returns {Object} - 质量评分结果
 */
export function calculateDocumentQuality(document, chunks, stats = {}) {
  const scores = {
    completeness: 0,    // 完整性（0-20分）
    structure: 0,       // 结构性（0-20分）
    techContent: 0,     // 技术内容密度（0-25分）
    userFeedback: 0,    // 用户反馈（0-20分）
    freshness: 0,       // 时效性（0-15分）
    total: 0            // 总分（0-100分）
  };

  const insights = [];

  // 1. 完整性评分（20分）
  scores.completeness = evaluateCompleteness(document, chunks, insights);

  // 2. 结构性评分（20分）
  scores.structure = evaluateStructure(chunks, insights);

  // 3. 技术内容密度（25分）
  scores.techContent = evaluateTechnicalContent(chunks, insights);

  // 4. 用户反馈（20分）
  scores.userFeedback = evaluateUserFeedback(document, stats, insights);

  // 5. 时效性（15分）
  scores.freshness = evaluateFreshness(document, insights);

  // 计算总分
  scores.total = Math.round(
    scores.completeness +
    scores.structure +
    scores.techContent +
    scores.userFeedback +
    scores.freshness
  );

  return {
    documentId: document.id,
    filename: document.filename,
    scores,
    insights,
    grade: getQualityGrade(scores.total),
    timestamp: new Date().toISOString()
  };
}

/**
 * 评估完整性（是否包含足够的信息）
 */
function evaluateCompleteness(document, chunks, insights) {
  let score = 0;

  // 文件大小
  const fileSizeKB = (document.fileSize || 0) / 1024;
  if (fileSizeKB > 500) {
    score += 8;
    insights.push('文档内容丰富（>500KB）');
  } else if (fileSizeKB > 100) {
    score += 5;
  } else if (fileSizeKB > 10) {
    score += 2;
  }

  // Chunk 数量
  const chunkCount = chunks.length;
  if (chunkCount > 50) {
    score += 7;
    insights.push(`包含大量内容片段（${chunkCount}个）`);
  } else if (chunkCount > 20) {
    score += 5;
  } else if (chunkCount > 5) {
    score += 3;
  }

  // 平均 chunk 长度
  const avgChunkLength = chunks.reduce((sum, c) => sum + (c.content?.length || 0), 0) / (chunkCount || 1);
  if (avgChunkLength > 2000) {
    score += 5;
    insights.push('详细的内容描述（平均>2000字符/段）');
  } else if (avgChunkLength > 1000) {
    score += 3;
  } else if (avgChunkLength > 500) {
    score += 1;
  }

  return Math.min(score, 20);
}

/**
 * 评估结构性（是否有良好的组织结构）
 */
function evaluateStructure(chunks, insights) {
  let score = 0;

  // 检查标题层级
  const withHeaders = chunks.filter(c => c.metadata?.breadcrumbs?.length > 0);
  const headerRatio = withHeaders.length / (chunks.length || 1);

  if (headerRatio > 0.8) {
    score += 10;
    insights.push('结构清晰，标题层级完整');
  } else if (headerRatio > 0.5) {
    score += 7;
  } else if (headerRatio > 0.3) {
    score += 4;
  }

  // 检查标题深度
  const maxDepth = Math.max(...chunks.map(c => c.metadata?.sectionDepth || 0));
  if (maxDepth >= 3) {
    score += 5;
    insights.push(`多层级组织（${maxDepth}级标题）`);
  } else if (maxDepth >= 2) {
    score += 3;
  }

  // 检查是否有代码块
  const hasCodeBlocks = chunks.some(c => c.content?.includes('```'));
  if (hasCodeBlocks) {
    score += 5;
    insights.push('包含代码示例');
  }

  return Math.min(score, 20);
}

/**
 * 评估技术内容密度
 */
function evaluateTechnicalContent(chunks, insights) {
  let score = 0;

  // 技术术语密度
  const techTerms = [
    // 协议
    'bgp', 'ospf', 'evpn', 'vxlan', 'mlag', 'clag', 'stp', 'lacp', 'lldp',
    'vlan', 'vrf', 'acl', 'bfd', 'ptp', 'snmp', 'ntp', 'dhcp', 'dns',
    // RoCE/RDMA
    'roce', 'rdma', 'pfc', 'ecn', 'qos', 'dcqcn', 'infiniband',
    // 命令
    'nv set', 'nv show', 'nv config', 'netq', 'cumulus',
    // 网络设备
    'switch', 'router', 'interface', 'port', 'swp', 'eth', 'bond'
  ];

  const allContent = chunks.map(c => c.content || '').join(' ').toLowerCase();
  const foundTerms = new Set();

  for (const term of techTerms) {
    if (allContent.includes(term)) {
      foundTerms.add(term);
    }
  }

  const termDensity = foundTerms.size;
  if (termDensity > 20) {
    score += 15;
    insights.push(`丰富的技术内容（${foundTerms.size}个技术术语）`);
  } else if (termDensity > 10) {
    score += 10;
  } else if (termDensity > 5) {
    score += 6;
  } else if (termDensity > 0) {
    score += 3;
  }

  // 检查是否有命令示例
  const commandPatterns = [
    /nv\s+(set|show|config|unset)/gi,
    /netq\s+(show|check|trace)/gi,
    /ip\s+(route|link|addr)/gi
  ];

  let commandCount = 0;
  for (const pattern of commandPatterns) {
    const matches = allContent.match(pattern) || [];
    commandCount += matches.length;
  }

  if (commandCount > 20) {
    score += 10;
    insights.push(`大量命令示例（${commandCount}个）`);
  } else if (commandCount > 10) {
    score += 7;
  } else if (commandCount > 5) {
    score += 4;
  } else if (commandCount > 0) {
    score += 2;
  }

  return Math.min(score, 25);
}

/**
 * 评估用户反馈
 */
function evaluateUserFeedback(document, stats = {}, insights) {
  let score = 10; // 基础分（无反馈时为中性）

  const positive = stats.positiveCount || 0;
  const negative = stats.negativeCount || 0;
  const total = positive + negative;

  if (total === 0) {
    // 无反馈，返回中性分数
    return score;
  }

  const positiveRatio = positive / total;

  if (positiveRatio > 0.9) {
    score = 20;
    insights.push(`用户高度认可（${Math.round(positiveRatio * 100)}%好评）`);
  } else if (positiveRatio > 0.7) {
    score = 16;
    insights.push(`用户评价良好（${Math.round(positiveRatio * 100)}%好评）`);
  } else if (positiveRatio > 0.5) {
    score = 12;
  } else if (positiveRatio > 0.3) {
    score = 6;
    insights.push(`用户评价偏低（${Math.round(positiveRatio * 100)}%好评）`);
  } else {
    score = 2;
    insights.push(`用户评价很低（${Math.round(positiveRatio * 100)}%好评）`);
  }

  return score;
}

/**
 * 评估时效性
 */
function evaluateFreshness(document, insights) {
  let score = 0;

  const uploadedAt = new Date(document.uploadedAt);
  const now = new Date();
  const ageInDays = (now - uploadedAt) / (1000 * 60 * 60 * 24);

  if (ageInDays < 30) {
    score = 15;
    insights.push('最新文档（<30天）');
  } else if (ageInDays < 90) {
    score = 12;
  } else if (ageInDays < 180) {
    score = 9;
  } else if (ageInDays < 365) {
    score = 6;
  } else {
    score = 3;
    insights.push(`文档较旧（${Math.round(ageInDays)}天前）`);
  }

  return score;
}

/**
 * 获取质量等级
 */
function getQualityGrade(totalScore) {
  if (totalScore >= 90) return 'S'; // 优秀
  if (totalScore >= 80) return 'A'; // 良好
  if (totalScore >= 70) return 'B'; // 中等偏上
  if (totalScore >= 60) return 'C'; // 中等
  if (totalScore >= 50) return 'D'; // 及格
  return 'E'; // 不及格
}

/**
 * 批量评估多个文档
 */
export async function batchEvaluateDocuments(documents, chunksMap, feedbackStats = {}) {
  const results = [];

  for (const doc of documents) {
    const chunks = chunksMap.get(doc.id) || [];
    const stats = feedbackStats[doc.id] || {};

    const quality = calculateDocumentQuality(doc, chunks, stats);
    results.push(quality);
  }

  // 按分数降序排序
  results.sort((a, b) => b.scores.total - a.scores.total);

  return results;
}

/**
 * 生成质量报告
 */
export function generateQualityReport(qualityResults) {
  const gradeDistribution = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0 };
  let totalScore = 0;

  qualityResults.forEach(r => {
    gradeDistribution[r.grade]++;
    totalScore += r.scores.total;
  });

  const avgScore = qualityResults.length > 0 ? totalScore / qualityResults.length : 0;

  return {
    summary: {
      total: qualityResults.length,
      avgScore: Math.round(avgScore),
      gradeDistribution
    },
    topDocuments: qualityResults.slice(0, 10).map(r => ({
      filename: r.filename,
      grade: r.grade,
      score: r.scores.total,
      insights: r.insights
    })),
    lowQualityDocuments: qualityResults
      .filter(r => r.scores.total < 60)
      .slice(0, 10)
      .map(r => ({
        filename: r.filename,
        grade: r.grade,
        score: r.scores.total,
        insights: r.insights
      }))
  };
}
