/**
 * 调试脚本：验证PFC和ECN查询处理
 * 在浏览器控制台中运行此脚本来测试关键词提取
 */

(function() {
  console.log('🔍 调试PFC和ECN查询处理...');
  
  // 模拟查询处理函数
  function debugQueryProcessing(query) {
    console.log('📋 输入查询:', query);
    
    // 1. 检查是否包含关键技术术语
    const techTerms = {
      pfc: ['pfc', 'priority flow control', 'priority-based flow control'],
      ecn: ['ecn', 'explicit congestion notification', 'congestion control'],
      roce: ['roce', 'rdma over converged ethernet', 'rdma'],
      nvidia: ['nvidia', '英伟达', 'mellanox', 'cumulus']
    };
    
    const foundTerms = {};
    Object.entries(techTerms).forEach(([category, terms]) => {
      foundTerms[category] = terms.filter(term => 
        query.toLowerCase().includes(term.toLowerCase())
      );
    });
    
    console.log('🔍 发现的技术术语:', foundTerms);
    
    // 2. 生成增强搜索关键词
    const searchKeywords = [];
    
    if (foundTerms.pfc.length > 0) {
      searchKeywords.push('pfc', 'priority flow control', '802.1bb', 'queue pause');
    }
    
    if (foundTerms.ecn.length > 0) {
      searchKeywords.push('ecn', 'explicit congestion notification', 'red', 'wred');
    }
    
    if (foundTerms.roce.length > 0) {
      searchKeywords.push('roce', 'rdma', 'lossless ethernet');
    }
    
    if (foundTerms.nvidia.length > 0) {
      searchKeywords.push('nvidia', 'mellanox', 'cumulus', 'nvos');
    }
    
    // 添加通用配置术语
    searchKeywords.push('configure', 'configuration', 'setup', 'command', 'cli', 'qos');
    
    const uniqueKeywords = [...new Set(searchKeywords)];
    console.log('🎯 增强搜索关键词:', uniqueKeywords.join(' '));
    
    return {
      foundTerms,
      searchKeywords: uniqueKeywords,
      intent: foundTerms.pfc.length > 0 || foundTerms.ecn.length > 0 ? 'network_config' : 'general'
    };
  }
  
  // 测试您的查询
  const userQuery = "英伟达怎么配置PFC和ECN功能，给出完整配置";
  const result = debugQueryProcessing(userQuery);
  
  console.log('');
  console.log('💡 预期行为:');
  console.log('1. 系统应该识别PFC和ECN技术术语');
  console.log('2. 生成包含相关技术词汇的搜索关键词');
  console.log('3. 从知识库中检索NVIDIA PFC/ECN配置文档');
  console.log('4. 返回具体的配置命令和步骤');
  
  console.log('');
  console.log('🔧 如果系统仍然给出通用回答，可能的原因:');
  console.log('1. 知识库中没有相关的文档');
  console.log('2. 检索阈值设置过高');
  console.log('3. 关键词提取器没有正确集成');
  console.log('4. 文档embedding质量不够');
  
  // 建议的测试步骤
  console.log('');
  console.log('🧪 建议测试步骤:');
  console.log('1. 在聊天界面输入您的查询');
  console.log('2. 观察系统是否能返回具体配置命令');
  console.log('3. 如果仍然失败，检查知识库中的文档');
  console.log('4. 验证关键词提取器是否正确工作');
  
  return result;
})();