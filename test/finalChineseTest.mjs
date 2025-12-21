// 测试改进后的中文语言优化
import { optimizeChineseResponse } from '../src/lib/completeChineseOptimization.ts';

console.log('🧪 测试改进后的中文语言优化...\n');

// 测试用例
const testCases = [
  {
    name: "完整的英文回答",
    input: `Based on the reference content, here are the configuration commands:

**PFC Configuration** (from Reference 1):
\`\`\`bash
nv set qos pfc my_pfc_ports switch-priority 3,5
nv set interface swp1-4,swp6 qos pfc profile my_pfc_ports
nv config apply
\`\`\`

**ECN Configuration** (from Reference 2):
\`\`\`bash
nv set qos congestion-control my-ecn-profile traffic-class 1,2 min-threshold 40000
nv set interface swp1,swp2 qos congestion-control profile my-ecn-profile
nv config apply
\`\`\`

Please execute these commands in order. If the references don't contain complete information, quote specific commands from the documentation.`,
    expected: "完整的中文技术配置回答"
  },
  {
    name: "混合语言回答",
    input: `Based on the reference content, here is the PFC configuration. Please execute the following commands to enable PFC functionality.`,
    expected: "基于参考内容，以下是PFC配置。请执行以下命令来启用PFC功能。"
  }
];

// 运行测试
testCases.forEach((testCase, index) => {
  console.log(`测试 ${index + 1}: ${testCase.name}`);
  console.log('输入:', testCase.input.substring(0, 100) + '...');
  
  const result = optimizeChineseResponse(testCase.input, ['ref1', 'ref2']);
  console.log('输出:', result);
  console.log('期望:', testCase.expected);
  console.log('');
});

// 测试实际场景
console.log('🎯 实际场景测试：');

const realScenario = `Based on the reference content, here are the PFC and ECN configuration commands:

**PFC Configuration** (from Reference 1):
\`\`\`bash
nv set qos pfc my_pfc_ports switch-priority 3,5
nv set interface swp1-4,swp6 qos pfc profile my_pfc_ports
nv config apply
\`\`\`

**ECN Configuration** (from Reference 2):
\`\`\`bash
nv set qos congestion-control my-ecn-profile traffic-class 1,2 min-threshold 40000
nv set interface swp1,swp2 qos congestion-control profile my-ecn-profile
nv config apply
\`\`\`

Please execute these commands in order. The specific configuration is as follows. If the references don't contain complete information, never invent or hallucinate additional technical details. Quote specific commands from the documentation. According to your actual environment, adjust these parameters accordingly.`;

const optimizedResult = optimizeChineseResponse(realScenario, ['ref1', 'ref2']);
console.log('优化结果：');
console.log(optimizedResult);

console.log('\n✅ 中文语言优化测试完成！');
console.log('🎯 主要改进：');
console.log('• 完整的英文句子翻译');
console.log('• 保持代码块不变');
console.log('• 技术术语添加中文解释');
console.log('• 自然的中文表达习惯');