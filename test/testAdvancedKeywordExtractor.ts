/**
 * 高级关键词提取器测试
 * 测试网络配置命令的语义理解能力
 */

import { advancedKeywordExtractor } from '../src/lib/advancedKeywordExtractor';

function testKeywordExtraction() {
  console.log('🚀 开始测试高级关键词提取器...\n');

  // 测试用例1：您提供的复杂网络配置命令
  const testQuery1 = "配置 acl 允许192.168.1.1这个地址:24.1.0/24地址段,只允许访问8.8.8.8.8.8/32这个公网地址,不允许访问10.24.100.0/24地址段,给出nv命令";
  
  console.log('📋 测试用例1：复杂网络配置命令');
  console.log(`输入: ${testQuery1}`);
  
  const result1 = advancedKeywordExtractor.extractKeywords(testQuery1);
  console.log('提取结果:');
  console.log('关键词:', result1.keywords);
  console.log('网络地址:', result1.networkAddresses);
  console.log('命令信息:', result1.commands);
  console.log('语义组:', result1.semanticGroups);
  console.log('意图:', result1.intent);
  console.log('增强查询:', advancedKeywordExtractor.generateEnhancedQuery(testQuery1));
  console.log('---\n');

  // 测试用例2：简单的ACL配置
  const testQuery2 = "如何配置访问控制列表允许192.168.1.0/24网段";
  
  console.log('📋 测试用例2：简单ACL配置');
  console.log(`输入: ${testQuery2}`);
  
  const result2 = advancedKeywordExtractor.extractKeywords(testQuery2);
  console.log('提取结果:');
  console.log('关键词:', result2.keywords);
  console.log('网络地址:', result2.networkAddresses);
  console.log('命令信息:', result2.commands);
  console.log('语义组:', result2.semanticGroups);
  console.log('意图:', result2.intent);
  console.log('---\n');

  // 测试用例3：路由配置
  const testQuery3 = "show ip route 命令显示什么信息";
  
  console.log('📋 测试用例3：路由查询');
  console.log(`输入: ${testQuery3}`);
  
  const result3 = advancedKeywordExtractor.extractKeywords(testQuery3);
  console.log('提取结果:');
  console.log('关键词:', result3.keywords);
  console.log('网络地址:', result3.networkAddresses);
  console.log('命令信息:', result3.commands);
  console.log('语义组:', result3.semanticGroups);
  console.log('意图:', result3.intent);
  console.log('---\n');

  // 测试用例4：IPv6配置
  const testQuery4 = "配置IPv6地址 2001:db8::1/64 在接口上";
  
  console.log('📋 测试用例4：IPv6配置');
  console.log(`输入: ${testQuery4}`);
  
  const result4 = advancedKeywordExtractor.extractKeywords(testQuery4);
  console.log('提取结果:');
  console.log('关键词:', result4.keywords);
  console.log('网络地址:', result4.networkAddresses);
  console.log('命令信息:', result4.commands);
  console.log('语义组:', result4.semanticGroups);
  console.log('意图:', result4.intent);
  console.log('---\n');

  // 对比测试：原始提取器 vs 高级提取器
  console.log('🔍 对比测试：原始提取器 vs 高级提取器');
  console.log(`测试查询: ${testQuery1}`);
  
  // 模拟原始提取器
  function originalExtractKeywords(query: string): string[] {
    const keywords: string[] = [];
    
    // 1. 提取连续大写字母的缩写
    const acronyms = query.match(/\b[A-Z]{2,}\b/g);
    if (acronyms) {
      keywords.push(...acronyms.map(a => a.toLowerCase()));
    }
    
    // 2. 提取大写字母开头的专有名词
    const properNouns = query.match(/\b[A-Z][a-z]+\b/g);
    if (properNouns) {
      keywords.push(...properNouns.map(n => n.toLowerCase()));
    }
    
    // 3. 提取技术术语模式
    const techTerms = query.match(/\b(?:[A-Z]+[a-z]*|[a-z]+[A-Z]+)\d*\b/g);
    if (techTerms) {
      keywords.push(...techTerms.map(t => t.toLowerCase()));
    }
    
    // 4. 提取普通词汇
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      '如何', '怎么', '怎样', '什么', '哪个', '哪些', '为什么', '是否', '能否', '可以', '应该',
      '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '些', '个', '只', '现在', '请', '问']);
    
    const words = query.toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stopWords.has(w));
    
    keywords.push(...words);
    
    return Array.from(new Set(keywords));
  }
  
  const originalResult = originalExtractKeywords(testQuery1);
  const advancedResult = result1.keywords;
  
  console.log('原始提取器结果:', originalResult);
  console.log('高级提取器结果:', advancedResult);
  console.log('网络地址识别:', result1.networkAddresses);
  console.log('命令识别:', result1.commands);
  
  console.log('\n✅ 测试完成！');
}

// 运行测试
testKeywordExtraction();