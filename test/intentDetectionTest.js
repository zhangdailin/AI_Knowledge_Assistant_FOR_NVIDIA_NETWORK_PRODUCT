// 测试更新后的意图检测
console.log('🚀 测试更新后的意图检测...\n');

// 模拟detectQueryIntent函数
function detectQueryIntent(query) {
  const queryLower = query.toLowerCase();
  
  // 检测网络配置意图（包含网络技术术语）
  const networkTechTerms = ['pfc', 'ecn', 'roce', 'qos', 'priority flow control', 'explicit congestion notification', 
                           'rdma', 'traffic control', 'congestion control', 'flow control'];
  const hasNetworkTerms = networkTechTerms.some(term => queryLower.includes(term.toLowerCase()));
  
  // 检测网络配置命令
  const networkConfigKeywords = ['配置', 'configure', '设置', 'setup', 'enable', 'disable'];
  const hasNetworkConfig = networkConfigKeywords.some(keyword => queryLower.includes(keyword));
  
  if (hasNetworkTerms && hasNetworkConfig) {
    return 'network_config';
  }
  
  // 检测命令意图（包含命令关键词）
  const commandKeywords = ['如何', '怎么', '怎样', '命令', '配置', '设置', 'show', 'config', 'how to', 'how do'];
  if (commandKeywords.some(keyword => queryLower.includes(keyword))) {
    return 'command';
  }
  
  // 检测问题意图（包含疑问词）
  const questionKeywords = ['什么', '哪个', '哪些', '为什么', '是否', '能否', 'what', 'which', 'why', 'when', 'where'];
  if (questionKeywords.some(keyword => queryLower.includes(keyword))) {
    return 'question';
  }
  
  return 'general';
}

// 模拟getRetrievalParamsForIntent函数
function getRetrievalParamsForIntent(intent) {
  switch (intent) {
    case 'command':
      return {
        limit: 20,
        rerankCandidates: 60,
        minScore: 0.3
      };
    case 'question':
      return {
        limit: 20,
        rerankCandidates: 60,
        minScore: 0.4
      };
    case 'network_config':
      return {
        limit: 20,
        rerankCandidates: 60,
        minScore: 0.25  // 降低网络配置的阈值，确保能找到技术文档
      };
    default:
      return {
        limit: 20,
        rerankCandidates: 60,
        minScore: 0.35
      };
  }
}

// 测试您的查询
const testQuery = "英伟达怎么配置PFC和ECN功能，给出完整配置";

console.log('📋 测试查询:');
console.log(`输入: ${testQuery}`);
console.log('');

const intent = detectQueryIntent(testQuery);
const params = getRetrievalParamsForIntent(intent);

console.log('🔍 检测结果:');
console.log(`意图: ${intent}`);
console.log(`检索参数:`, params);
console.log('');

// 测试其他查询
const testCases = [
  "show ip route 命令的详细说明",
  "如何配置VLAN接口",
  "什么是BGP协议",
  "PFC和ECN有什么区别",
  "英伟达交换机配置PFC"
];

console.log('📊 测试多个查询:');
testCases.forEach(query => {
  const intent = detectQueryIntent(query);
  const params = getRetrievalParamsForIntent(intent);
  console.log(`查询: ${query}`);
  console.log(`意图: ${intent}, 最小分数: ${params.minScore}`);
  console.log('');
});

console.log('✅ 意图检测更新完成！');
console.log('💡 关键改进:');
console.log('- 专门识别网络配置意图');
console.log('- 为网络配置降低检索阈值（0.25）');
console.log('- 更好地处理PFC/ECN等技术术语');