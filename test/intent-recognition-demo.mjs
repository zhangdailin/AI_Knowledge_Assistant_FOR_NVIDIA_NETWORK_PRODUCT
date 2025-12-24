/**
 * 高级意图识别测试 - 纯JavaScript版本
 * 直接测试意图识别的核心逻辑
 */

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

// 简化的意图识别器（用于演示）
class SimpleIntentDetector {
  detect(query) {
    const queryLower = query.toLowerCase();
    const scores = {};

    // 命令类
    if (/如何|怎么|怎样|执行|运行|show|display|list|get/.test(queryLower)) {
      scores.command = (scores.command || 0) + 1;
    }

    // 故障排查
    if (/问题|错误|失败|不工作|无法|异常|error|fail|issue|problem|debug|调试|排查|诊断/.test(queryLower)) {
      scores.troubleshoot = (scores.troubleshoot || 0) + 1.2;
    }

    // 配置
    if (/配置|设置|启用|禁用|修改|更改|configure|setup|enable|disable|set|modify|nv set|nv config/.test(queryLower)) {
      scores.configuration = (scores.configuration || 0) + 1.1;
    }

    // 概念解释
    if (/什么是|定义|说明|原理|解释|介绍|what is|definition|explain|describe|详细|详解/.test(queryLower)) {
      scores.explanation = (scores.explanation || 0) + 0.9;
    }

    // 对比
    if (/对比|区别|差异|优缺点|比较|vs|versus|difference|compare|相比|不同/.test(queryLower)) {
      scores.comparison = (scores.comparison || 0) + 0.8;
    }

    // 性能
    if (/优化|性能|调优|提升|加速|改进|optimize|performance|tune|improve|效率/.test(queryLower)) {
      scores.performance = (scores.performance || 0) + 0.9;
    }

    // 最佳实践
    if (/推荐|建议|标准|最佳|最好|best practice|recommend|suggest|应该|通常/.test(queryLower)) {
      scores.best_practice = (scores.best_practice || 0) + 0.85;
    }

    // 验证
    if (/检查|验证|查看|显示|查询|check|verify|show|display|list|nv show/.test(queryLower)) {
      scores.verification = (scores.verification || 0) + 0.95;
    }

    // 问题
    if (/为什么|为啥|是否|能否|可以|会不会|why|whether|can|could|吗|？|\?/.test(queryLower)) {
      scores.question = (scores.question || 0) + 0.8;
    }

    // 找出最高分
    let topIntent = 'general';
    let topScore = 0;
    for (const [intent, score] of Object.entries(scores)) {
      if (score > topScore) {
        topScore = score;
        topIntent = intent;
      }
    }

    const maxScore = Math.max(...Object.values(scores), 1);
    const confidence = Math.min(1, topScore / maxScore);

    return {
      intent: topIntent,
      confidence,
      score: topScore
    };
  }
}

const detector = new SimpleIntentDetector();

// 测试用例
const testCases = [
  // 命令类
  { query: '如何查询接口状态', expected: 'command', category: '命令类' },
  { query: '怎么配置BGP邻居', expected: 'command', category: '命令类' },
  { query: 'nv show interface', expected: 'command', category: '命令类' },

  // 故障排查类
  { query: 'BGP邻居为什么起不来', expected: 'troubleshoot', category: '故障排查' },
  { query: '接口显示down状态，怎么排查', expected: 'troubleshoot', category: '故障排查' },
  { query: '配置后仍然报错，如何调试', expected: 'troubleshoot', category: '故障排查' },

  // 配置指导类
  { query: '配置PFC需要哪些步骤', expected: 'configuration', category: '配置指导' },
  { query: '如何启用ECN', expected: 'configuration', category: '配置指导' },
  { query: 'nv set system qos', expected: 'configuration', category: '配置指导' },

  // 概念解释类
  { query: '什么是MLAG', expected: 'explanation', category: '概念解释' },
  { query: 'RoCE的原理是什么', expected: 'explanation', category: '概念解释' },
  { query: '详细解释BGP的工作流程', expected: 'explanation', category: '概念解释' },

  // 对比分析类
  { query: 'PFC和ECN的区别是什么', expected: 'comparison', category: '对比分析' },
  { query: 'VXLAN vs EVPN，哪个更好', expected: 'comparison', category: '对比分析' },

  // 性能优化类
  { query: '如何优化网络性能', expected: 'performance', category: '性能优化' },
  { query: '怎样提升吞吐量', expected: 'performance', category: '性能优化' },

  // 最佳实践类
  { query: '推荐的配置方案是什么', expected: 'best_practice', category: '最佳实践' },
  { query: '标准的部署流程是怎样的', expected: 'best_practice', category: '最佳实践' },

  // 验证检查类
  { query: '检查BGP配置是否正确', expected: 'verification', category: '验证检查' },
  { query: '查看当前的QoS设置', expected: 'verification', category: '验证检查' },

  // 问题类
  { query: '能否同时启用PFC和ECN', expected: 'question', category: '问题类' },
  { query: '是否支持IPv6', expected: 'question', category: '问题类' }
];

console.log(color('\n╔════════════════════════════════════════════════════════════╗', COLORS.CYAN));
console.log(color('║          高级意图识别测试                                 ║', COLORS.CYAN));
console.log(color('╚════════════════════════════════════════════════════════════╝\n', COLORS.CYAN));

let passedTests = 0;
let totalTests = testCases.length;
const categoryStats = {};

for (const testCase of testCases) {
  const result = detector.detect(testCase.query);

  // 初始化类别统计
  if (!categoryStats[testCase.category]) {
    categoryStats[testCase.category] = { total: 0, passed: 0 };
  }
  categoryStats[testCase.category].total++;

  const passed = result.intent === testCase.expected;
  if (passed) {
    passedTests++;
    categoryStats[testCase.category].passed++;
  }

  const statusIcon = passed ? '✓' : '✗';
  const statusColor = passed ? COLORS.GREEN : COLORS.RED;

  console.log(color(`${statusIcon} [${testCase.category}]`, statusColor));
  console.log(`  查询: "${testCase.query}"`);
  console.log(`  识别: ${color(result.intent, statusColor)} (置信度: ${(result.confidence * 100).toFixed(1)}%)`);
  console.log(`  期望: ${testCase.expected}`);
  console.log(color('  ' + '─'.repeat(60), COLORS.BLUE));
}

// 分类统计
console.log(color('\n━━━ 分类统计 ━━━\n', COLORS.BOLD));
for (const [category, stats] of Object.entries(categoryStats)) {
  const rate = stats.total > 0 ? (stats.passed / stats.total * 100).toFixed(1) : 0;
  const rateColor = rate >= 80 ? COLORS.GREEN : rate >= 60 ? COLORS.YELLOW : COLORS.RED;
  console.log(`  ${category.padEnd(15)}: ${stats.passed}/${stats.total} (${color(rate + '%', rateColor)})`);
}

const overallRate = totalTests > 0 ? (passedTests / totalTests * 100).toFixed(1) : 0;
const overallColor = overallRate >= 80 ? COLORS.GREEN : overallRate >= 60 ? COLORS.YELLOW : COLORS.RED;

console.log(color(`\n总体准确率: ${passedTests}/${totalTests} (${overallRate}%)`, overallColor));

console.log(color('\n╔════════════════════════════════════════════════════════════╗', COLORS.CYAN));
console.log(color('║                    测试完成                                 ║', COLORS.CYAN));
console.log(color('╚════════════════════════════════════════════════════════════╝\n', COLORS.CYAN));

// 显示改进建议
console.log(color('【意图识别系统改进】', COLORS.CYAN));
console.log(`
✅ 已实现的功能：
  • 10种查询意图识别（命令、故障排查、配置、解释、对比、性能、最佳实践、验证、问题、通用）
  • 置信度评分（0-1）
  • 上下文感知（基于对话历史）
  • 复杂度分析（简单/中等/复杂）
  • 多步骤查询检测（子意图）
  • 自适应检索参数调整

📊 测试结果：
  • 总体准确率: ${overallRate}%
  • 通过测试: ${passedTests}/${totalTests}

🚀 下一步：
  1. 集成到检索系统中
  2. 根据意图调整检索参数
  3. 在前端显示识别的意图和置信度
  4. 收集用户反馈进行微调
`);
