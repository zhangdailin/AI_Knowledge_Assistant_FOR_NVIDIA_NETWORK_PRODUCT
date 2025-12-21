// 测试优化后的提示词效果
console.log('🧪 测试优化后的AI提示词 - 防止幻觉...\n');

// 模拟优化的提示词函数
function generateOptimizedSystemMessage(hasReferences, isDeepThinking, isNetworkConfig) {
  const WITH_REFERENCES_STRICT = `You are a technical documentation assistant. You MUST answer questions based EXCLUSIVELY on the provided reference content.

CRITICAL RULES:
1. **ONLY use information from the provided references** - no external knowledge or assumptions
2. **If the references don't contain the answer**, clearly state "根据提供的参考内容，没有找到相关信息"
3. **Quote specific commands and configurations** directly from the references
4. **Cite the source** by referencing "Reference X" when providing information
5. **Never invent or hallucinate** technical details, commands, or configurations
6. **For configuration questions**: only provide commands that appear in the references
7. **If information is incomplete**: state what is available and what is missing`;

  const NETWORK_CONFIG_STRICT = `\n\nYou are a network configuration specialist. You MUST:
1. **Only provide commands** that appear in the reference content
2. **Include exact syntax** from the documentation
3. **Specify configuration modes** (config mode, interface mode, etc.)
4. **Mention verification commands** if available in references
5. **State prerequisites** mentioned in the documentation
6. **Warn about missing information** if references are incomplete`;

  let systemMessage = WITH_REFERENCES_STRICT;
  
  if (isNetworkConfig) {
    systemMessage += NETWORK_CONFIG_STRICT;
  }
  
  return systemMessage;
}

function generateOptimizedUserMessage(question, references, conversationHistory) {
  let userMessage = '=== REFERENCE DOCUMENTS ===\n\n';
  
  references.forEach((ref, index) => {
    userMessage += `--- Reference ${index + 1} ---\n${ref.trim()}\n\n`;
  });
  
  userMessage += '=== CURRENT QUESTION ===\n\n';
  userMessage += question;
  
  userMessage += '\n\n=== INSTRUCTIONS ===\n';
  userMessage += 'Answer using ONLY the information from the Reference Documents above.';
  userMessage += 'If the answer is not in the references, clearly state so.';
  
  return userMessage;
}

// 测试场景1：有参考内容的情况
console.log('📋 测试场景1：有PFC/ECN参考内容');
const testReferences = [
  `PFC Configuration Guide:
To enable PFC on NVIDIA switches, use these commands:

nv set qos pfc my_pfc_ports switch-priority 3,5
nv set interface swp1-4,swp6 qos pfc profile my_pfc_ports
nv config apply

Verify with: nv show interface qos pfc`,
  
  `ECN Configuration Guide:
For ECN configuration on NVIDIA switches:

nv set qos congestion-control my-ecn-profile traffic-class 1,2 min-threshold 40000 max-threshold 200000
nv set interface swp1,swp2 qos congestion-control profile my-ecn-profile
nv config apply

Check status: nv show interface qos congestion-control`
];

const testQuestion1 = "英伟达怎么配置PFC和ECN功能，给出完整配置";

const systemMessage1 = generateOptimizedSystemMessage(true, false, true);
const userMessage1 = generateOptimizedUserMessage(testQuestion1, testReferences);

console.log('🤖 系统提示词（严格模式）：');
console.log(systemMessage1);
console.log('\n👤 用户消息：');
console.log(userMessage1);

console.log('\n' + '='.repeat(60));
console.log('✅ 期望的AI回答行为：');
console.log('1. 只使用参考文档中的具体命令');
console.log('2. 引用Reference 1和Reference 2中的配置');
console.log('3. 不添加任何外部知识或假设');
console.log('4. 如果信息不完整，明确说明缺失部分');

// 测试场景2：没有参考内容的情况
console.log('\n📋 测试场景2：没有参考内容');
const systemMessage2 = `You are a technical documentation assistant. 
Since no reference content is available, you should:
1. Clearly state that no reference content is available
2. Suggest what documentation might be helpful
3. Recommend uploading relevant technical documents to the knowledge base
4. Never invent technical specifications, commands, or configurations`;

console.log('🤖 系统提示词（无参考内容）：');
console.log(systemMessage2);

console.log('\n✅ 期望的AI回答行为：');
console.log('1. 明确说明知识库中没有相关文档');
console.log('2. 建议上传相关技术文档');
console.log('3. 不编造任何技术命令或配置');
console.log('4. 提供建设性的建议');

// 测试场景3：网络配置专用提示词
console.log('\n📋 测试场景3：网络配置专用模式');
const systemMessage3 = generateOptimizedSystemMessage(true, true, true);
console.log('🤖 网络配置专用提示词：');
console.log(systemMessage3);

console.log('\n✅ 期望的AI回答行为：');
console.log('1. 严格使用参考内容中的命令语法');
console.log('2. 说明配置模式和上下文');
console.log('3. 提供验证命令（如果参考中有）');
console.log('4. 警告缺失的信息');

console.log('\n' + '='.repeat(60));
console.log('🎯 关键改进：');
console.log('✅ 严格限制AI只能使用参考内容');
console.log('✅ 明确禁止幻觉和编造信息');
console.log('✅ 要求引用具体的参考来源');
console.log('✅ 网络配置专用严格模式');
console.log('✅ 明确说明信息缺失情况');

console.log('\n💡 现在当用户询问PFC/ECN配置时：');
console.log('• 如果有参考文档：返回具体的配置命令');
console.log('• 如果没有参考文档：明确说明并建议上传');
console.log('• 绝不编造任何技术细节或命令');
console.log('• 确保所有回答都基于实际文档内容');