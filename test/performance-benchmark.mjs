#!/usr/bin/env node

/**
 * 检索系统性能基准测试
 * 测试意图识别、检索精度和响应时间
 */

import { advancedIntentDetector } from '../src/lib/advancedIntentDetector.ts';

const COLORS = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  CYAN: '\x1b[36m',
  BOLD: '\x1b[1m'
};

const color = (str, colorCode) => `${colorCode}${str}${COLORS.RESET}`;

// 性能测试用例
const performanceTests = [
  {
    name: '简单命令查询',
    query: 'nv show interface',
    expectedIntent: 'command',
    complexity: 'simple'
  },
  {
    name: '复杂故障排查',
    query: 'BGP邻居为什么起不来，配置后仍然报错，如何调试',
    expectedIntent: 'troubleshoot',
    complexity: 'complex'
  },
  {
    name: '配置指导',
    query: '如何启用ECN并配置PFC',
    expectedIntent: 'configuration',
    complexity: 'medium'
  },
  {
    name: '概念解释',
    query: 'RoCE的原理是什么',
    expectedIntent: 'explanation',
    complexity: 'simple'
  },
  {
    name: '性能优化',
    query: '怎样提升网络吞吐量和性能',
    expectedIntent: 'performance',
    complexity: 'medium'
  },
  {
    name: '对比分析',
    query: 'PFC和ECN的区别是什么，哪个更好',
    expectedIntent: 'comparison',
    complexity: 'medium'
  },
  {
    name: '最佳实践',
    query: '推荐的BGP配置方案是什么',
    expectedIntent: 'best_practice',
    complexity: 'simple'
  },
  {
    name: '验证检查',
    query: '查看当前的QoS设置',
    expectedIntent: 'verification',
    complexity: 'simple'
  },
  {
    name: '问题查询',
    query: '能否同时启用PFC和ECN',
    expectedIntent: 'question',
    complexity: 'simple'
  }
];

console.log(color('\n╔════════════════════════════════════════════════════════════╗', COLORS.CYAN));
console.log(color('║          检索系统性能基准测试                             ║', COLORS.CYAN));
console.log(color('╚════════════════════════════════════════════════════════════╝\n', COLORS.CYAN));

let totalTests = 0;
let passedTests = 0;
let totalTime = 0;
const timings = [];

for (const test of performanceTests) {
  const startTime = performance.now();
  const result = advancedIntentDetector.detect(test.query);
  const endTime = performance.now();
  const duration = endTime - startTime;

  totalTime += duration;
  timings.push({ name: test.name, duration });

  const passed = result.intent === test.expectedIntent;
  if (passed) passedTests++;
  totalTests++;

  const statusIcon = passed ? '✓' : '✗';
  const statusColor = passed ? COLORS.GREEN : COLORS.RED;

  console.log(color(`${statusIcon} ${test.name}`, statusColor));
  console.log(`  查询: "${test.query}"`);
  console.log(`  识别: ${color(result.intent, statusColor)} (置信度: ${(result.confidence * 100).toFixed(1)}%)`);
  console.log(`  期望: ${test.expectedIntent}`);
  console.log(`  耗时: ${duration.toFixed(2)}ms`);
  console.log(color('  ' + '─'.repeat(60), COLORS.BLUE));
}

// 性能统计
console.log(color('\n━━━ 性能统计 ━━━\n', COLORS.BOLD));

const avgTime = totalTime / totalTests;
const minTime = Math.min(...timings.map(t => t.duration));
const maxTime = Math.max(...timings.map(t => t.duration));

console.log(`  总体准确率: ${passedTests}/${totalTests} (${(passedTests / totalTests * 100).toFixed(1)}%)`);
console.log(`  平均耗时: ${avgTime.toFixed(2)}ms`);
console.log(`  最小耗时: ${minTime.toFixed(2)}ms`);
console.log(`  最大耗时: ${maxTime.toFixed(2)}ms`);
console.log(`  总耗时: ${totalTime.toFixed(2)}ms`);

// 按耗时排序
console.log(color('\n━━━ 耗时排序 (从快到慢) ━━━\n', COLORS.BOLD));
timings.sort((a, b) => a.duration - b.duration);
for (const timing of timings) {
  const speedColor = timing.duration < avgTime ? COLORS.GREEN : COLORS.YELLOW;
  console.log(`  ${timing.name.padEnd(20)}: ${color(timing.duration.toFixed(2) + 'ms', speedColor)}`);
}

// 性能评级
console.log(color('\n━━━ 性能评级 ━━━\n', COLORS.BOLD));

let grade = 'A';
let gradeColor = COLORS.GREEN;

if (avgTime > 10) {
  grade = 'C';
  gradeColor = COLORS.RED;
} else if (avgTime > 5) {
  grade = 'B';
  gradeColor = COLORS.YELLOW;
}

console.log(`  平均响应时间: ${color(avgTime.toFixed(2) + 'ms', gradeColor)}`);
console.log(`  性能等级: ${color(grade, gradeColor)}`);

if (grade === 'A') {
  console.log(`  ${color('✓ 性能优秀，满足生产环境要求', COLORS.GREEN)}`);
} else if (grade === 'B') {
  console.log(`  ${color('⚠ 性能良好，可进一步优化', COLORS.YELLOW)}`);
} else {
  console.log(`  ${color('✗ 性能需要改进', COLORS.RED)}`);
}

console.log(color('\n╔════════════════════════════════════════════════════════════╗', COLORS.CYAN));
console.log(color('║                    测试完成                                 ║', COLORS.CYAN));
console.log(color('╚════════════════════════════════════════════════════════════╝\n', COLORS.CYAN));

process.exit(passedTests >= totalTests * 0.8 ? 0 : 1);
