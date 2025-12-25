/**
 * 测试AI幻觉修复效果
 * 验证：
 * 1. 命令是否来自参考内容
 * 2. 回答精度是否提高
 * 3. 是否正确处理缺失信息
 */

import { validateCommandsInAnswer } from '../src/lib/chinesePrompts.ts';

// 测试用例
const testCases = [
  {
    name: "测试1：编造命令检测",
    answer: `根据参考文档，配置BGP的步骤如下：
1. 进入全局配置模式
2. 执行命令：nv set router bgp asn 65000
3. 执行命令：nv set router bgp router-id 10.0.0.1
4. 执行命令：nv set router bgp neighbor 10.0.0.2 remote-asn 65001
5. 执行命令：nv commit  # 这个命令在文档中不存在

完成后验证配置：
\`\`\`
nv show router bgp
nv show router bgp neighbor
\`\`\``,
    references: [
      `BGP配置指南：
nv set router bgp asn <asn>
nv set router bgp router-id <ip>
nv set router bgp neighbor <ip> remote-asn <asn>
nv apply
验证命令：nv show router bgp`
    ],
    expectedSuspicious: ["nv commit"]
  },
  {
    name: "测试2：正确的命令引用",
    answer: `根据参考文档，配置PFC的步骤：
1. 执行命令：nv set qos pfc on
2. 执行命令：nv set qos pfc priority 3
3. 验证配置：nv show qos pfc`,
    references: [
      `PFC配置：
nv set qos pfc on
nv set qos pfc priority <0-7>
验证：nv show qos pfc`
    ],
    expectedSuspicious: []
  },
  {
    name: "测试3：缺失信息处理",
    answer: `根据参考文档，未找到关于VXLAN配置的相关信息。
建议上传包含VXLAN配置的技术文档。`,
    references: [
      `BGP配置指南：
nv set router bgp asn <asn>`
    ],
    expectedSuspicious: []
  }
];

// 运行测试
console.log("=== AI幻觉修复测试 ===\n");

testCases.forEach((testCase, index) => {
  console.log(`\n${testCase.name}`);
  console.log("─".repeat(50));

  try {
    const result = validateCommandsInAnswer(testCase.answer, testCase.references);

    console.log(`✓ 验证完成`);
    console.log(`  - 有效性: ${result.isValid ? "✓ 通过" : "✗ 失败"}`);
    console.log(`  - 可疑命令数: ${result.suspiciousCommands.length}`);

    if (result.suspiciousCommands.length > 0) {
      console.log(`  - 可疑命令列表:`);
      result.suspiciousCommands.forEach(cmd => {
        console.log(`    • ${cmd}`);
      });
    }

    if (result.warnings.length > 0) {
      console.log(`  - 警告信息:`);
      result.warnings.forEach(warn => {
        console.log(`    ⚠ ${warn}`);
      });
    }

    // 验证预期结果
    const expectedCount = testCase.expectedSuspicious.length;
    const actualCount = result.suspiciousCommands.length;

    if (expectedCount === actualCount) {
      console.log(`\n✓ 测试通过：检测到${actualCount}个可疑命令（符合预期）`);
    } else {
      console.log(`\n✗ 测试失败：期望${expectedCount}个可疑命令，实际${actualCount}个`);
    }

  } catch (error) {
    console.log(`✗ 测试出错: ${error.message}`);
  }
});

console.log("\n" + "=".repeat(50));
console.log("测试完成");
