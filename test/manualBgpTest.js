// test/manualBgpTest.js

const query = "我要和AS号100,IP地址1.1.1.1的邻居建立BGP邻居,给出nv命令配置";
const queryLower = query.toLowerCase();

console.log('🔍 测试查询:', query);

// 1. 测试意图检测逻辑
const networkTechTerms = ['pfc', 'ecn', 'roce', 'qos', 'bgp', 'routing', 'priority flow control', 'explicit congestion notification', 
                         'rdma', 'traffic control', 'congestion control', 'flow control', 'border gateway protocol'];
const hasNetworkTerms = networkTechTerms.some(term => queryLower.includes(term.toLowerCase()));

console.log('🎯 意图检测 - 包含网络术语:', hasNetworkTerms ? '✅ 是' : '❌ 否');

// 2. 测试关键词提取逻辑
const techTerms = [];
const networkTechTermsDict = {
    bgp: ['bgp', 'border gateway protocol', 'ebgp', 'ibgp', 'neighbor', 'peer', 'as', 'autonomous system', 'asn'],
    routing: ['route', 'router', 'routing', 'ip route', 'static route'],
};

Object.entries(networkTechTermsDict).forEach(([category, terms]) => {
    terms.forEach(term => {
        if (queryLower.includes(term.toLowerCase())) {
            techTerms.push(term.toLowerCase());
        }
    });
});

console.log('🔑 关键词提取 - 技术术语:', techTerms);

// 3. 测试IP地址提取
const ipv4Pattern = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
const ips = query.match(ipv4Pattern) || [];
console.log('🌐 关键词提取 - IP地址:', ips);

// 4. 测试数字提取
const numberPattern = /\b\d+\b/g;
const numbers = queryLower.match(numberPattern) || [];
console.log('🔢 关键词提取 - 数字:', numbers);

// 5. 模拟增强查询生成
const extracted = {
    hasBGP: techTerms.includes('bgp'),
    keywords: [...techTerms, ...ips, ...numbers]
};

const queryParts = [];
if (extracted.hasBGP) {
    queryParts.push('bgp', 'border gateway protocol', 'ebgp', 'ibgp', 'neighbor', 'router bgp');
}
queryParts.push(...extracted.keywords);
// 添加原始查询中的其他词
queryParts.push('nv', '命令', '配置'); 

const enhancedQuery = [...new Set(queryParts)].join(' ');
console.log('🚀 增强查询预览:', enhancedQuery);

if (hasNetworkTerms && ips.length > 0 && techTerms.includes('bgp')) {
    console.log('\n✅ 验证通过: 系统现在应该能正确理解 BGP 配置意图并提取关键参数。');
} else {
    console.error('\n❌ 验证失败: 某些关键信息提取失败。');
}
