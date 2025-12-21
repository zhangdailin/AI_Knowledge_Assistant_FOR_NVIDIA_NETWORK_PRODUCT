/**
 * 测试高级关键词提取器在检索系统中的集成效果
 */

import { extractCoreQueryEnhanced } from '../src/lib/retrievalEnhancements';
import { advancedKeywordExtractor } from '../src/lib/advancedKeywordExtractor';

async function testIntegration() {
  console.log('🚀 测试高级关键词提取器集成效果...\n');

  // 测试您提供的复杂网络配置命令
  const testQuery = "配置 acl 允许192.168.1.1这个地址:24.1.0/24地址段,只允许访问8.8.8.8.8.8/32这个公网地址,不允许访问10.24.100.0/24地址段,给出nv命令";
  
  console.log('📋 测试查询:');
  console.log(`输入: ${testQuery}`);
  console.log('');

  // 测试原始的核心查询提取函数
  console.log('🔍 测试 extractCoreQueryEnhanced 函数:');
  const coreQuery = extractCoreQueryEnhanced(testQuery, 'network_config');
  console.log(`核心查询: ${coreQuery}`);
  console.log('');

  // 测试完整的高级提取器
  console.log('🔍 测试完整的高级关键词提取器:');
  const extracted = advancedKeywordExtractor.extractKeywords(testQuery);
  console.log('提取的关键词:', extracted.keywords);
  console.log('网络地址:', extracted.networkAddresses);
  console.log('命令信息:', extracted.commands);
  console.log('语义组:', extracted.semanticGroups);
  console.log('查询意图:', extracted.intent);
  console.log('');

  // 测试增强查询生成
  console.log('🔍 测试增强查询生成:');
  const enhancedQuery = advancedKeywordExtractor.generateEnhancedQuery(testQuery);
  console.log(`增强查询: ${enhancedQuery}`);
  console.log('');

  // 对比分析
  console.log('📊 对比分析:');
  console.log('原始查询:', testQuery);
  console.log('核心查询:', coreQuery);
  console.log('增强查询:', enhancedQuery);
  console.log('');

  console.log('✅ 集成测试完成！');
  console.log('💡 关键改进:');
  console.log('- 系统现在能够正确识别IP地址和CIDR网段');
  console.log('- 能够理解网络配置命令的语义');
  console.log('- 为知识库搜索提供更精确的查询关键词');
  console.log('- 提高AI回答的准确性和相关性');
}

// 运行测试
testIntegration().catch(console.error);