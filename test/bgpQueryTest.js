// test/bgpQueryTest.js
import { advancedKeywordExtractor } from '../src/lib/advancedKeywordExtractor.ts';
import { enhancedNetworkKeywordExtractor } from '../src/lib/enhancedNetworkKeywordExtractor.ts';
import { detectQueryIntent, extractCoreQueryEnhanced } from '../src/lib/retrievalEnhancements.ts';

// 模拟 QueryIntent 类型
const QueryIntent = {
  COMMAND: 'command',
  QUESTION: 'question',
  NETWORK_CONFIG: 'network_config',
  GENERAL: 'general'
};

const query = "我要和AS号100,IP地址1.1.1.1的邻居建立BGP邻居,给出nv命令配置";

console.log('🔍 分析查询:', query);

// 1. 意图检测
const intent = detectQueryIntent(query);
console.log('🎯 检测到的意图:', intent);

// 2. 关键词提取 (EnhancedNetworkKeywordExtractor)
const enhancedKeywords = enhancedNetworkKeywordExtractor.extractKeywords(query);
console.log('🔑 网络关键词提取结果:', enhancedKeywords);

// 3. 增强查询生成
const enhancedQuery = enhancedNetworkKeywordExtractor.generateEnhancedQuery(query);
console.log('🚀 增强后的查询:', enhancedQuery);

// 4. AdvancedKeywordExtractor 测试 (对比)
const advancedKeywords = advancedKeywordExtractor.extractKeywords(query);
console.log('🔑 通用关键词提取结果:', advancedKeywords);

console.log('\n--------------------------------------------------\n');

// 模拟检索逻辑 (Retreival.ts)
// 检查是否包含关键术语 BGP
if (!enhancedQuery.toLowerCase().includes('bgp')) {
    console.error('❌ 错误: 增强查询中未包含 BGP 关键词!');
} else {
    console.log('✅ BGP 关键词已包含。');
}

// 检查 AS 号和 IP 地址提取
// EnhancedNetworkKeywordExtractor 可能会忽略具体的数字和IP，除非专门处理
// 让我们看看它是否保留了 1.1.1.1 和 100

if (enhancedQuery.includes('1.1.1.1')) {
    console.log('✅ IP地址 1.1.1.1 已保留。');
} else {
    console.warn('⚠️ IP地址 1.1.1.1 未在增强查询中发现。');
}

if (enhancedQuery.includes('100')) {
    console.log('✅ AS号 100 已保留。');
} else {
    console.warn('⚠️ AS号 100 未在增强查询中发现。');
}
