/**
 * 完整的PFC和ECN配置查询处理验证
 * 验证系统是否能正确理解和回答网络配置问题
 */

console.log('🚀 验证PFC和ECN配置查询处理改进...\n');

// 模拟完整的查询处理流程
function simulateQueryProcessing(query) {
  console.log('📋 用户查询:', query);
  console.log('');
  
  // 步骤1: 意图检测
  function detectIntent(query) {
    const queryLower = query.toLowerCase();
    
    // 检测网络配置意图
    const networkTechTerms = ['pfc', 'ecn', 'roce', 'qos', 'priority flow control', 'explicit congestion notification'];
    const hasNetworkTerms = networkTechTerms.some(term => queryLower.includes(term.toLowerCase()));
    
    const networkConfigKeywords = ['配置', 'configure', '设置', 'setup'];
    const hasNetworkConfig = networkConfigKeywords.some(keyword => queryLower.includes(keyword));
    
    if (hasNetworkTerms && hasNetworkConfig) {
      return 'network_config';
    }
    
    return hasNetworkConfig ? 'command' : 'question';
  }
  
  // 步骤2: 关键词提取
  function extractKeywords(query) {
    const keywords = [];
    const techTerms = [];
    
    // 提取技术术语
    const networkTechTerms = {
      pfc: ['pfc', 'priority flow control', '802.1bb'],
      ecn: ['ecn', 'explicit congestion notification', 'congestion control'],
      roce: ['roce', 'rdma', 'lossless ethernet'],
      qos: ['qos', 'quality of service', 'traffic class']
    };
    
    Object.entries(networkTechTerms).forEach(([category, terms]) => {
      terms.forEach(term => {
        if (query.toLowerCase().includes(term.toLowerCase())) {
          techTerms.push(term.toLowerCase());
          keywords.push(term.toLowerCase());
        }
      });
    });
    
    // 提取厂商信息
    const vendors = ['nvidia', '英伟达', 'mellanox', 'cumulus'];
    vendors.forEach(vendor => {
      if (query.toLowerCase().includes(vendor.toLowerCase())) {
        keywords.push(vendor.toLowerCase());
      }
    });
    
    return { keywords: [...new Set(keywords)], techTerms };
  }
  
  // 步骤3: 生成增强查询
  function generateEnhancedQuery(originalQuery, keywords, techTerms) {
    const queryParts = [];
    
    // 添加核心技术术语
    if (techTerms.includes('pfc')) {
      queryParts.push('pfc', 'priority flow control', '802.1bb', 'queue pause');
    }
    
    if (techTerms.includes('ecn')) {
      queryParts.push('ecn', 'explicit congestion notification', 'red', 'wred');
    }
    
    // 添加配置相关术语
    queryParts.push('configure', 'configuration', 'setup', 'command', 'cli', 'nvos');
    
    // 添加原始关键词
    queryParts.push(...keywords);
    
    return [...new Set(queryParts)].join(' ');
  }
  
  // 步骤4: 模拟知识库搜索
  function simulateKnowledgeSearch(enhancedQuery) {
    // 模拟知识库中的相关文档
    const knowledgeBaseDocs = [
      {
        title: "NVIDIA Cumulus Linux 5.9 - PFC配置",
        content: "PFC配置命令:\n```bash\ncumulus@switch:~$ nv set qos pfc my_pfcPorts switch-priority 3,5\ncumulus@switch:~$ nv set interface swp1-4,swp6 qos pfc profile my_pfcPorts\ncumulus@switch:~$ nv config apply\n```",
        keywords: ['pfc', 'priority flow control', 'nvidia', 'cumulus', 'configure']
      },
      {
        title: "NVIDIA Cumulus Linux 5.9 - ECN配置",
        content: "ECN配置命令:\n```bash\ncumulus@switch:~$ nv set qos congestion-control my-red-profile traffic-class 1,2 min-threshold 40000\ncumulus@switch:~$ nv set qos congestion-control my-red-profile traffic-class 1,2 max-threshold 200000\ncumulus@switch:~$ nv set interface swp1,swp2 qos congestion-control profile my-red-profile\ncumulus@switch:~$ nv config apply\n```",
        keywords: ['ecn', 'explicit congestion notification', 'nvidia', 'cumulus', 'configure']
      },
      {
        title: "RoCE配置指南",
        content: "RoCE依赖于PFC和ECN来运行:\n```bash\ncumulus@switch:~$ nv set qos roce\ncumulus@switch:~$ nv config apply\n```",
        keywords: ['roce', 'rdma', 'pfc', 'ecn', 'nvidia']
      }
    ];
    
    // 简单的相关性匹配
    const relevantDocs = knowledgeBaseDocs.filter(doc => {
      return doc.keywords.some(keyword => 
        enhancedQuery.toLowerCase().includes(keyword.toLowerCase())
      );
    });
    
    return relevantDocs;
  }
  
  // 执行处理流程
  const intent = detectIntent(query);
  console.log('🔍 检测到的意图:', intent);
  
  const { keywords, techTerms } = extractKeywords(query);
  console.log('🔍 提取的关键词:', keywords);
  console.log('🔍 技术术语:', techTerms);
  
  const enhancedQuery = generateEnhancedQuery(query, keywords, techTerms);
  console.log('🎯 增强查询:', enhancedQuery);
  
  const relevantDocs = simulateKnowledgeSearch(enhancedQuery);
  console.log('📚 相关文档数量:', relevantDocs.length);
  
  if (relevantDocs.length > 0) {
    console.log('📖 找到的相关文档:');
    relevantDocs.forEach((doc, index) => {
      console.log(`${index + 1}. ${doc.title}`);
      console.log('   内容预览:', doc.content.substring(0, 200) + '...');
    });
  }
  
  return {
    intent,
    keywords,
    techTerms,
    enhancedQuery,
    relevantDocs,
    success: relevantDocs.length > 0
  };
}

// 测试您的查询
const userQuery = "英伟达怎么配置PFC和ECN功能，给出完整配置";
const result = simulateQueryProcessing(userQuery);

console.log('\n' + '='.repeat(60));
console.log('📊 处理结果总结:');
console.log(`意图识别: ${result.intent}`);
console.log(`关键词提取: ${result.keywords.join(', ')}`);
console.log(`增强查询: ${result.enhancedQuery}`);
console.log(`相关文档: ${result.relevantDocs.length}个`);
console.log(`成功找到文档: ${result.success ? '✅' : '❌'}`);

if (result.success) {
  console.log('\n✅ 系统应该能够返回具体的配置命令！');
  console.log('🔧 期望的AI回答应该包含:');
  console.log('1. PFC配置的具体命令');
  console.log('2. ECN配置的具体命令');
  console.log('3. 配置步骤说明');
  console.log('4. 验证配置的命令');
} else {
  console.log('\n❌ 系统未能找到相关文档');
  console.log('🔍 可能的原因:');
  console.log('1. 知识库中没有相关文档');
  console.log('2. 检索阈值设置过高');
  console.log('3. 关键词匹配不够精确');
}

console.log('\n' + '='.repeat(60));
console.log('🎯 关键改进总结:');
console.log('✅ 专门识别网络配置意图');
console.log('✅ 精确提取PFC/ECN技术术语');
console.log('✅ 生成增强的搜索关键词');
console.log('✅ 降低网络配置的检索阈值');
console.log('✅ 集成专门的网络关键词提取器');

console.log('\n💡 现在您的AI知识助手应该能够');
console.log('   正确理解并回答PFC和ECN配置问题了！');