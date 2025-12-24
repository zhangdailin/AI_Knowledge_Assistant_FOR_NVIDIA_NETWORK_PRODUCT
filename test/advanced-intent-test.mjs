/**
 * 高级意图识别测试
 * 测试各种查询类型的意图识别准确性
 */

import { advancedIntentDetector } from '../src/lib/advancedIntentDetector.ts';

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

// 测试用例
const testCases = [
  // 命令类
  {
    query: '如何查询接口状态',
    expectedIntent: 'command',
    category: '命令类',
    description: '基础命令查询'
  },
  {
    query: '怎么配置BGP邻居',
    expectedIntent: 'command',
    category: '命令类',
    description: '配置命令'
  },
  {
    query: 'nv show interface',
    expectedIntent: 'command',
    category: '命令类',
    description: '精确命令'
  },

  // 故障排查类
  {
    query: 'BGP邻居为什么起不来',
    expectedIntent: 'troubleshoot',
    category: '故障排查',
    description: '故障诊断'
  },
  {
    query: '接口显示down状态，怎么排查',
    expectedIntent: 'troubleshoot',
    category: '故障排查',
    description: '问题排查'
  },
  {
    query: '配置后仍然报错，如何调试',
    expectedIntent: 'troubleshoot',
    category: '故障排查',
    description: '错误调试'
  },

  // 配置指导类
  {
    query: '配置PFC需要哪些步骤',
    expectedIntent: 'configuration',
    category: '配置指导',
    description: '配置步骤'
  },
  {
    query: '如何启用ECN',
    expectedIntent: 'configuration',
    category: '配置指导',
    description: '启用功能'
  },
  {
    query: 'nv set system qos',
    expectedIntent: 'configuration',
    category: '配置指导',
    description: '配置命令'
  },

  // 概念解释类
  {
    query: '什么是MLAG',
    expectedIntent: 'explanation',
    category: '概念解释',
    description: '概念定义'
  },
  {
    query: 'RoCE的原理是什么',
    expectedIntent: 'explanation',
    category: '概念解释',
    description: '原理说明'
  },
  {
    query: '详细解释BGP的工作流程',
    expectedIntent: 'explanation',
    category: '概念解释',
    description: '详细解释'
  },

  // 对比分析类
  {
    query: 'PFC和ECN的区别是什么',
    expectedIntent: 'comparison',
    category: '对比分析',
    description: '功能对比'
  },
  {
    query: 'VXLAN vs EVPN，哪个更好',
    expectedIntent: 'comparison',
    category: '对比分析',
    description: '方案对比'
  },

  // 性能优化类
  {
    query: '如何优化网络性能',
    expectedIntent: 'performance',
    category: '性能优化',
    description: '性能调优'
  },
  {
    query: '怎样提升吞吐量',
    expectedIntent: 'performance',
    category: '性能优化',
    description: '性能提升'
  },

  // 最佳实践类
  {
    query: '推荐的配置方案是什么',
    expectedIntent: 'best_practice',
    category: '最佳实践',
    description: '推荐方案'
  },
  {
    query: '标准的部署流程是怎样的',
    expectedIntent: 'best_practice',
    category: '最佳实践',
    description: '标准流程'
  },

  // 验证检查类
  {
    query: '检查BGP配置是否正确',
    expectedIntent: 'verification',
    category: '验证检查',
    description: '配置验证'
  },
  {
    query: '查看当前的QoS设置',
    expectedIntent: 'verification',
    category: '验证检查',
    description: '状态查看'
  },

  // 问题类
  {
    query: '能否同时启用PFC和ECN',
    expectedIntent: 'question',
    category: '问题类',
    description: '可行性问题'
  },
  {
    query: '是否支持IPv6',
    expectedIntent: 'question',
    category: '问题类',
    description: '支持性问题'
  }
];

console.log(color('\n╔════════════════════════════════════════════════════════════╗', COLORS.CYAN));
console.log(color('║          高级意图识别测试                                 ║', COLORS.CYAN));
console.log(color('╚════════════════════════════════════════════════════════════╝\n', COLORS.CYAN));

let passedTests = 0;
let totalTests = testCases.length;
const categoryStats = {};

for (const testCase of testCases) {
  const result = advancedIntentDetector.detect(testCase.query);

  // 初始化类别统计
  if (!categoryStats[testCase.category]) {
    categoryStats[testCase.category] = { total: 0, passed: 0 };
  }
  categoryStats[testCase.category].total++;

  const passed = result.intent === testCase.expectedIntent;
  if (passed) {
    passedTests++;
    categoryStats[testCase.category].passed++;
  }

  const statusIcon = passed ? '✓' : '✗';
  const statusColor = passed ? COLORS.GREEN : COLORS.RED;

  console.log(color(`${statusIcon} [${testCase.category}]`, statusColor) + ` ${testCase.description}`);
  console.log(`  查询: "${testCase.query}"`);
  console.log(`  识别: ${color(result.intent, statusColor)} (置信度: ${(result.confidence * 100).toFixed(1)}%)`);
  console.log(`  期望: ${testCase.expectedIntent}`);

  if (result.reasons.length > 0) {
    console.log(`  原因: ${result.reasons.join('; ')}`);
  }

  if (result.subIntents && result.subIntents.length > 0) {
    console.log(`  子意图: ${result.subIntents.join(', ')}`);
  }

  if (result.context) {
    const ctx = [];
    if (result.context.hasError) ctx.push('有错误');
    if (result.context.hasCommand) ctx.push('有命令');
    if (result.context.hasParameter) ctx.push('有参数');
    if (result.context.complexity) ctx.push(`复杂度:${result.context.complexity}`);
    if (ctx.length > 0) {
      console.log(`  上下文: ${ctx.join(', ')}`);
    }
  }

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

// 测试上下文感知
console.log(color('\n━━━ 上下文感知测试 ━━━\n', COLORS.BOLD));

const contextTests = [
  {
    query: '然后怎么验证配置',
    history: ['我想配置BGP', '需要哪些步骤'],
    expectedContext: 'configuration'
  },
  {
    query: '为什么还是不工作',
    history: ['配置完成了', '启动服务'],
    expectedContext: 'troubleshoot'
  }
];

for (const test of contextTests) {
  const result = advancedIntentDetector.detect(test.query, test.history);
  const passed = result.intent === test.expectedContext;
  const statusIcon = passed ? '✓' : '✗';
  const statusColor = passed ? COLORS.GREEN : COLORS.RED;

  console.log(color(`${statusIcon} 上下文测试`, statusColor));
  console.log(`  历史: ${test.history.join(' → ')}`);
  console.log(`  查询: "${test.query}"`);
  console.log(`  识别: ${color(result.intent, statusColor)}`);
  console.log(`  期望: ${test.expectedContext}`);
  console.log(color('  ' + '─'.repeat(60), COLORS.BLUE));
}

console.log(color('\n╔════════════════════════════════════════════════════════════╗', COLORS.CYAN));
console.log(color('║                    测试完成                                 ║', COLORS.CYAN));
console.log(color('╚════════════════════════════════════════════════════════════╝\n', COLORS.CYAN));

process.exit(passedTests >= totalTests * 0.8 ? 0 : 1);
