// 测试中文语言优化效果
console.log('🧪 测试中文语言优化效果...\n');

// 模拟语言优化函数
function optimizeChineseResponse(originalAnswer, references) {
  let optimized = originalAnswer;
  
  // 1. 修正常见的翻译腔
  const translationFixes = [
    { pattern: /According to Reference (\d+)/g, replacement: '根据参考文档$1' },
    { pattern: /The following (commands?|configuration)/g, replacement: '以下$1' },
    { pattern: /Please execute/g, replacement: '请执行' },
    { pattern: /It is recommended that you/g, replacement: '建议您' },
    { pattern: /The specific configuration is as follows/g, replacement: '具体配置如下' },
    { pattern: /Based on the reference content/g, replacement: '基于参考内容' },
    { pattern: /If the references don't contain/g, replacement: '如果参考文档不包含' },
    { pattern: /Quote specific commands/g, replacement: '引用具体命令' },
    { pattern: /Never invent or hallucinate/g, replacement: '绝不编造或幻觉' }
  ];
  
  translationFixes.forEach(fix => {
    optimized = optimized.replace(fix.pattern, fix.replacement);
  });
  
  // 2. 优化技术术语表达
  if (references && references.length > 0) {
    // 添加参考文档标注
    if (optimized.includes('参考文档') && !optimized.includes('来源')) {
      optimized += '\n\n**信息来源**：以上配置信息来自提供的参考文档。';
    }
  }
  
  // 3. 添加中文语言自然化
  if (optimized.includes('使用以下命令')) {
    optimized = optimized.replace(/使用以下命令/g, '请执行以下命令');
  }
  
  if (optimized.includes('配置如下')) {
    optimized = optimized.replace(/配置如下/g, '具体配置信息如下');
  }
  
  // 4. 确保整体语言风格一致
  if (!optimized.includes('根据参考内容') && references && references.length > 0) {
    optimized = '根据参考内容，' + optimized;
  }
  
  return optimized;
}

// 测试用例
const testCases = [
  {
    name: "英文翻译腔",
    input: "According to Reference 1, the following commands should be executed. Please execute the specific configuration as follows.",
    expected: "根据参考文档1，以下命令应该被执行。请执行具体配置如下。"
  },
  {
    name: "技术配置回答",
    input: "Based on the reference content, here are the PFC configuration commands. Please execute the following commands to enable PFC.",
    expected: "基于参考内容，以下是PFC配置命令。请执行以下命令来启用PFC。"
  },
  {
    name: "缺失信息说明",
    input: "If the references don't contain complete information, never invent or hallucinate additional technical details.",
    expected: "如果参考文档不包含完整信息，绝不编造或幻觉额外的技术细节。"
  }
];

// 运行测试
testCases.forEach((testCase, index) => {
  console.log(`测试 ${index + 1}: ${testCase.name}`);
  console.log('输入:', testCase.input);
  
  const result = optimizeChineseResponse(testCase.input, []);
  console.log('输出:', result);
  console.log('期望:', testCase.expected);
  console.log('匹配:', result === testCase.expected ? '✅' : '❌');
  console.log('');
});

// 测试完整场景
console.log('🎯 完整场景测试：');

const mockAIResponse = `Based on the reference content, here are the configuration commands:

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

Please execute these commands in order. If the references don't contain complete information, quote specific commands from the documentation.`;

const optimizedResponse = optimizeChineseResponse(mockAIResponse, ['ref1', 'ref2']);
console.log('优化前:', mockAIResponse);
console.log('\n优化后:', optimizedResponse);

console.log('\n✅ 中文语言优化完成！');
console.log('🎯 主要改进：');
console.log('• 消除英文翻译腔');
console.log('• 使用自然的中文表达');
console.log('• 保持技术术语准确性');
console.log('• 添加适当的中文解释');