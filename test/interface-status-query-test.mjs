/**
 * 接口状态查询测试用例
 * 目的：诊断并提升"如何查询接口状态"类查询的检索精度
 *
 * 测试内容：
 * 1. 端到端检索测试（通过API）
 * 2. 结果相关性分析
 * 3. 诊断建议生成
 *
 * 使用方法：
 * node test/interface-status-query-test.mjs [--url=http://your-api-url]
 */

// ANSI颜色代码
const COLORS = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  CYAN: '\x1b[36m',
  MAGENTA: '\x1b[35m',
  BOLD: '\x1b[1m'
};

const color = (str, colorCode) => `${colorCode}${str}${COLORS.RESET}`;

// 测试用例集合 - 接口状态相关查询
const TEST_QUERIES = [
  {
    query: "如何查询接口状态",
    expectedKeywords: ["接口", "状态", "interface", "status", "show", "nv show"],
    expectedCommands: ["nv show interface", "show interface status", "interface状态", "接口状态"],
    description: "基础接口状态查询",
    minRank: 5,
    category: "basic"
  },
  {
    query: "怎么查看端口状态",
    expectedKeywords: ["端口", "状态", "port", "status", "show"],
    expectedCommands: ["nv show interface", "show interface", "port status", "端口状态"],
    description: "端口状态查询（同义词）",
    minRank: 5,
    category: "basic"
  },
  {
    query: "查看swp1接口状态",
    expectedKeywords: ["swp1", "接口", "状态", "interface", "status"],
    expectedCommands: ["nv show interface swp1", "show interface swp1", "swp1"],
    description: "指定接口名称的查询",
    minRank: 3,
    category: "specific"
  },
  {
    query: "nv show interface",
    expectedKeywords: ["nv show", "interface"],
    expectedCommands: ["nv show interface"],
    description: "精确命令查询",
    minRank: 1,
    category: "exact"
  },
  {
    query: "接口up/down状态怎么看",
    expectedKeywords: ["接口", "up", "down", "状态"],
    expectedCommands: ["nv show interface", "operational status", "admin status", "link state"],
    description: "接口运行状态查询",
    minRank: 5,
    category: "advanced"
  },
  {
    query: "如何查看所有网口的链路状态",
    expectedKeywords: ["网口", "链路", "状态", "interface", "link"],
    expectedCommands: ["nv show interface", "link status", "链路状态"],
    description: "链路状态查询",
    minRank: 5,
    category: "advanced"
  },
  {
    query: "查看接口速率和带宽",
    expectedKeywords: ["接口", "速率", "带宽", "speed", "bandwidth"],
    expectedCommands: ["nv show interface", "speed", "bandwidth"],
    description: "接口速率查询",
    minRank: 5,
    category: "advanced"
  },
  {
    query: "show interface status",
    expectedKeywords: ["show", "interface", "status"],
    expectedCommands: ["show interface", "nv show interface", "interface status"],
    description: "传统命令查询",
    minRank: 3,
    category: "exact"
  }
];

console.log(color('\n╔════════════════════════════════════════════════════════════╗', COLORS.CYAN));
console.log(color('║        接口状态查询测试 - 精度诊断                         ║', COLORS.CYAN));
console.log(color('╚════════════════════════════════════════════════════════════╝\n', COLORS.CYAN));

/**
 * 端到端检索测试
 */
async function testEndToEndRetrieval(apiUrl = 'http://localhost:8787/api/chunks/search') {
  console.log(color('━━━ 端到端检索测试 ━━━\n', COLORS.BOLD));
  console.log(`API URL: ${apiUrl}\n`);

  let passedTests = 0;
  let totalTests = TEST_QUERIES.length;
  const detailedResults = [];
  const categoryStats = {};

  for (const testCase of TEST_QUERIES) {
    console.log(color(`\n查询 [${testCase.category}]: "${testCase.query}"`, COLORS.CYAN));
    console.log(color(`描述: ${testCase.description}`, COLORS.BLUE));

    // 初始化类别统计
    if (!categoryStats[testCase.category]) {
      categoryStats[testCase.category] = { total: 0, passed: 0 };
    }
    categoryStats[testCase.category].total++;

    try {
      // 调用检索API
      const url = `${apiUrl}?q=${encodeURIComponent(testCase.query)}&limit=20`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const chunks = data.chunks || [];

      console.log(`  返回结果数: ${color(chunks.length, COLORS.YELLOW)}`);

      if (chunks.length === 0) {
        console.log(color(`  ✗ 没有找到任何结果！`, COLORS.RED));
        console.log(color(`    → 知识库可能缺少相关文档`, COLORS.YELLOW));
        detailedResults.push({
          query: testCase.query,
          category: testCase.category,
          passed: false,
          reason: 'no_results',
          chunks: 0
        });
        continue;
      }

      // 查找匹配的结果
      let bestRank = -1;
      let matchedCommand = null;
      let matchedChunk = null;
      const allMatches = [];

      // 检查每个返回的chunk
      for (let i = 0; i < chunks.length; i++) {
        const content = chunks[i].content.toLowerCase();

        // 检查是否匹配期望的命令
        for (const expectedCmd of testCase.expectedCommands) {
          if (content.includes(expectedCmd.toLowerCase())) {
            if (bestRank === -1) {
              bestRank = i + 1;
              matchedCommand = expectedCmd;
              matchedChunk = chunks[i];
            }
            allMatches.push({ rank: i + 1, command: expectedCmd });
          }
        }
      }

      // 评估结果
      if (bestRank === -1) {
        console.log(color(`  ✗ 未找到匹配的内容`, COLORS.RED));
        console.log(color(`    期望找到: ${testCase.expectedCommands.slice(0, 3).join(', ')}`, COLORS.YELLOW));

        // 显示前3条结果的预览和分数
        console.log(color(`    前3条结果:`, COLORS.YELLOW));
        chunks.slice(0, 3).forEach((chunk, idx) => {
          const preview = chunk.content.substring(0, 120).replace(/\n/g, ' ');
          const score = chunk._score ? ` [分数: ${chunk._score.toFixed(4)}]` : '';
          console.log(color(`      [${idx + 1}]${score} ${preview}...`, COLORS.BLUE));
        });

        detailedResults.push({
          query: testCase.query,
          category: testCase.category,
          passed: false,
          reason: 'no_match',
          chunks: chunks.length,
          topScores: chunks.slice(0, 3).map(c => c._score),
          topResults: chunks.slice(0, 3).map(c => c.content.substring(0, 100))
        });
      } else {
        const passed = bestRank <= testCase.minRank;
        const statusColor = passed ? COLORS.GREEN : COLORS.YELLOW;
        const statusIcon = passed ? '✓' : '△';

        console.log(color(`  ${statusIcon} 找到匹配结果`, statusColor));
        console.log(`    匹配内容: ${color(matchedCommand, COLORS.MAGENTA)}`);
        console.log(`    排名: ${color(bestRank, statusColor)} / ${testCase.minRank} (${passed ? '符合要求' : '排名偏低'})`);

        if (allMatches.length > 1) {
          console.log(color(`    其他匹配: ${allMatches.slice(1, 3).map(m => `第${m.rank}位`).join(', ')}`, COLORS.BLUE));
        }

        if (matchedChunk._score !== undefined) {
          console.log(`    RRF分数: ${color(matchedChunk._score.toFixed(4), COLORS.YELLOW)}`);
        }

        if (matchedChunk._debug) {
          const kwScore = matchedChunk._debug.keywordScore || 'N/A';
          const vecScore = matchedChunk._debug.vectorScore?.toFixed(4) || 'N/A';
          console.log(`    详细分数: 关键词=${kwScore}, 向量=${vecScore}`);
        }

        if (passed) {
          passedTests++;
          categoryStats[testCase.category].passed++;
        }

        detailedResults.push({
          query: testCase.query,
          category: testCase.category,
          passed: passed,
          rank: bestRank,
          expectedRank: testCase.minRank,
          matchedCommand: matchedCommand,
          allMatches: allMatches.length,
          score: matchedChunk._score,
          chunks: chunks.length
        });
      }

    } catch (error) {
      console.log(color(`  ✗ 请求失败: ${error.message}`, COLORS.RED));

      if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
        console.log(color(`    → 确保后端服务运行在 ${apiUrl}`, COLORS.YELLOW));
      }

      detailedResults.push({
        query: testCase.query,
        category: testCase.category,
        passed: false,
        reason: 'api_error',
        error: error.message
      });
    }

    console.log(color('  ' + '─'.repeat(60), COLORS.BLUE));
  }

  // 分类统计
  console.log(color('\n━━━ 分类统计 ━━━\n', COLORS.BOLD));
  for (const [category, stats] of Object.entries(categoryStats)) {
    const rate = stats.total > 0 ? (stats.passed / stats.total * 100).toFixed(1) : 0;
    const rateColor = rate >= 80 ? COLORS.GREEN : rate >= 50 ? COLORS.YELLOW : COLORS.RED;
    console.log(`  ${category.padEnd(15)}: ${stats.passed}/${stats.total} (${color(rate + '%', rateColor)})`);
  }

  const overallRate = totalTests > 0 ? (passedTests / totalTests * 100).toFixed(1) : 0;
  const overallColor = overallRate >= 80 ? COLORS.GREEN : overallRate >= 50 ? COLORS.YELLOW : COLORS.RED;

  console.log(color(`\n总体通过率: ${passedTests}/${totalTests} (${overallRate}%)`, overallColor));

  return { passed: passedTests, total: totalTests, details: detailedResults, categoryStats };
}

/**
 * 生成诊断报告
 */
function generateDiagnosticReport(testResults) {
  console.log(color('\n━━━ 诊断报告 ━━━\n', COLORS.BOLD));

  const accuracy = testResults.passed / testResults.total;
  const details = testResults.details;

  console.log(color('【测试总结】', COLORS.CYAN));
  console.log(`  总测试数: ${testResults.total}`);
  console.log(`  通过数: ${testResults.passed}`);
  console.log(`  准确率: ${color((accuracy * 100).toFixed(1) + '%', accuracy >= 0.8 ? COLORS.GREEN : accuracy >= 0.5 ? COLORS.YELLOW : COLORS.RED)}`);

  // 分析问题
  const noResults = details.filter(r => r.reason === 'no_results');
  const noMatch = details.filter(r => r.reason === 'no_match');
  const lowRank = details.filter(r => r.rank && r.rank > r.expectedRank);
  const apiErrors = details.filter(r => r.reason === 'api_error');

  console.log(color('\n【问题分析】', COLORS.CYAN));

  if (apiErrors.length > 0) {
    console.log(color(`\n❌ API连接问题 (${apiErrors.length}个查询)`, COLORS.RED));
    console.log(color('   原因: 无法连接到后端API服务', COLORS.YELLOW));
    console.log(color('   建议:', COLORS.GREEN));
    console.log('   1. 确保后端服务正在运行: npm run server');
    console.log('   2. 检查API端点配置是否正确');
    console.log('   3. 验证端口8787是否被占用');
  }

  if (noResults.length > 0) {
    console.log(color(`\n❌ 无结果问题 (${noResults.length}个查询)`, COLORS.RED));
    console.log(color('   原因: 知识库中没有相关内容', COLORS.YELLOW));
    console.log(color('   受影响查询:', COLORS.YELLOW));
    noResults.forEach(r => console.log(`     - "${r.query}"`));
    console.log(color('   建议:', COLORS.GREEN));
    console.log('   1. 上传包含以下内容的文档到知识库:');
    console.log('      • NVIDIA Cumulus Linux 接口管理文档');
    console.log('      • nv show interface 命令参考手册');
    console.log('      • 接口状态查询操作指南');
    console.log('   2. 确保文档已经完成embedding处理');
    console.log('   3. 检查文档分块是否合理（包含完整的命令说明）');
  }

  if (noMatch.length > 0) {
    console.log(color(`\n⚠️  结果不相关问题 (${noMatch.length}个查询)`, COLORS.YELLOW));
    console.log(color('   原因: 检索到了结果但内容不相关', COLORS.YELLOW));
    console.log(color('   受影响查询:', COLORS.YELLOW));
    noMatch.forEach(r => {
      console.log(`     - "${r.query}" (返回${r.chunks}条结果)`);
      if (r.topScores && r.topScores.length > 0) {
        console.log(`       最高分数: ${r.topScores[0]?.toFixed(4) || 'N/A'}`);
      }
    });
    console.log(color('   建议:', COLORS.GREEN));
    console.log('   1. 关键词提取优化 (src/lib/enhancedNetworkKeywordExtractor.ts):');
    console.log('      • 将 "接口"、"interface"、"端口"、"port" 添加到强关键词列表');
    console.log('      • 保留 "状态"、"status"、"链路"、"link" 等词，不要作为停用词过滤');
    console.log('   2. 检索权重调整 (server/index.mjs):');
    console.log('      • 为包含 "interface" 的查询提高关键词搜索权重');
    console.log('      • 添加特殊规则: if (query.includes("接口状态")) bonusScore += 0.15');
    console.log('   3. 向量模型优化:');
    console.log('      • 对查询进行中英文扩展: "接口状态" → "接口状态 interface status"');
  }

  if (lowRank.length > 0) {
    console.log(color(`\n⚠️  排名偏低问题 (${lowRank.length}个查询)`, COLORS.YELLOW));
    console.log(color('   原因: 找到了相关内容但排名靠后', COLORS.YELLOW));
    console.log(color('   受影响查询:', COLORS.YELLOW));
    lowRank.forEach(r => {
      console.log(`     - "${r.query}" (排名: 第${r.rank}位，期望: ≤${r.expectedRank}位)`);
    });
    console.log(color('   建议:', COLORS.GREEN));
    console.log('   1. Rerank 权重调整:');
    console.log('      • 增加命令类查询的 Rerank 权重');
    console.log('      • 考虑使用更强的 Rerank 模型');
    console.log('   2. RRF 融合优化:');
    console.log('      • 调整关键词搜索和向量搜索的权重比例');
    console.log('      • 对精确匹配给予更高的加分');
    console.log('   3. 父子块策略:');
    console.log('      • 确保父块包含完整的命令上下文');
    console.log('      • 优化子块到父块的替换逻辑');
  }

  console.log(color('\n【具体优化建议】', COLORS.CYAN));

  console.log(color('\n1. 紧急修复 (如果 no_results > 0):', COLORS.RED));
  console.log('   → 立即上传相关文档到知识库');
  console.log('   → 运行文档处理确保embedding完成');

  console.log(color('\n2. 关键词提取器优化:', COLORS.GREEN));
  console.log('   文件: src/lib/enhancedNetworkKeywordExtractor.ts');
  console.log('   修改点:');
  console.log('   ```typescript');
  console.log('   // 添加接口相关的强关键词');
  console.log('   const interfaceKeywords = [');
  console.log('     "接口", "interface", "端口", "port",');
  console.log('     "状态", "status", "链路", "link",');
  console.log('     "up", "down", "swp", "eth"');
  console.log('   ];');
  console.log('   ```');

  console.log(color('\n3. 检索权重优化:', COLORS.GREEN));
  console.log('   文件: server/index.mjs (搜索 "/api/chunks/search")');
  console.log('   修改点:');
  console.log('   ```javascript');
  console.log('   // 为接口状态查询添加加分');
  console.log('   const isInterfaceQuery = query.includes("接口") || ');
  console.log('                           query.includes("interface");');
  console.log('   const isStatusQuery = query.includes("状态") || ');
  console.log('                        query.includes("status");');
  console.log('   if (isInterfaceQuery && isStatusQuery) {');
  console.log('     bonusScore += 0.15;');
  console.log('   }');
  console.log('   ```');

  console.log(color('\n4. 查询增强:', COLORS.GREEN));
  console.log('   文件: src/lib/retrievalEnhancements.ts');
  console.log('   在 extractCoreQueryEnhanced 中添加同义词扩展:');
  console.log('   ```typescript');
  console.log('   const synonyms = {');
  console.log('     "接口": ["interface", "port", "端口"],');
  console.log('     "状态": ["status", "state", "link"]');
  console.log('   };');
  console.log('   ```');

  console.log(color('\n5. 添加到基准测试集:', COLORS.GREEN));
  console.log('   文件: test/benchmark_precision.mjs');
  console.log('   添加测试用例:');
  console.log('   ```javascript');
  console.log('   {');
  console.log('     query: "如何查询接口状态",');
  console.log('     expected: ["nv show interface", "interface status"],');
  console.log('     minRank: 5,');
  console.log('     type: "command"');
  console.log('   }');
  console.log('   ```');

  // 计算优化优先级
  console.log(color('\n【优化优先级】', COLORS.CYAN));

  if (noResults.length > 0) {
    console.log(color('  🔴 P0 (紧急): 补充知识库内容', COLORS.RED));
  }
  if (noMatch.length > 0) {
    console.log(color('  🟡 P1 (重要): 优化关键词提取和检索权重', COLORS.YELLOW));
  }
  if (lowRank.length > 0) {
    console.log(color('  🟢 P2 (优化): 调整排序和Rerank参数', COLORS.GREEN));
  }
  if (accuracy >= 0.8) {
    console.log(color('  ✓ 系统表现良好，可以进行细微调整', COLORS.GREEN));
  }
}

/**
 * 主测试流程
 */
async function runFullTest() {
  const startTime = Date.now();

  // 获取API URL (可通过环境变量或命令行参数配置)
  let apiUrl = process.env.API_URL || 'http://localhost:8787/api/chunks/search';

  // 解析命令行参数
  const urlArg = process.argv.find(arg => arg.startsWith('--url='));
  if (urlArg) {
    apiUrl = urlArg.split('=')[1];
  }

  // 运行端到端检索测试
  const testResults = await testEndToEndRetrieval(apiUrl);

  // 生成诊断报告
  generateDiagnosticReport(testResults);

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(color('\n╔════════════════════════════════════════════════════════════╗', COLORS.CYAN));
  console.log(color('║                    测试完成                                 ║', COLORS.CYAN));
  console.log(color(`║  总耗时: ${duration}秒${' '.repeat(48 - duration.length)}║`, COLORS.CYAN));
  console.log(color('╚════════════════════════════════════════════════════════════╝\n', COLORS.CYAN));

  // 返回退出码 (如果准确率低于50%则返回失败)
  const accuracy = testResults.passed / testResults.total;
  process.exit(accuracy >= 0.5 ? 0 : 1);
}

// 执行测试
runFullTest().catch(error => {
  console.error(color(`\n测试执行失败: ${error.message}`, COLORS.RED));
  console.error(error.stack);
  process.exit(1);
});
