/**
 * GraphRAG 评估测试
 * 对比有无知识图谱时的检索效果
 * 
 * 运行方式: node test/graphrag_eval.mjs
 */

const API_BASE = process.env.API_BASE || 'http://localhost:8787';

// 评估用测试用例
const testCases = [
    // 单跳问题 - 向量检索应该足够
    {
        id: 'mlag-config',
        query: '如何配置 MLAG?',
        expectedTopics: ['mlag', 'peerlink', 'clagd', 'peer-ip'],
        category: 'single-hop'
    },
    {
        id: 'evpn-vxlan',
        query: '如何配置 EVPN-VXLAN?',
        expectedTopics: ['evpn', 'vxlan', 'vni', 'bgp'],
        category: 'single-hop'
    },

    // 多跳问题 - 需要知识图谱发现关系
    {
        id: 'evpn-bgp-relation',
        query: 'EVPN 和 BGP 有什么关系?',
        expectedTopics: ['evpn', 'bgp', 'address-family', 'l2vpn'],
        category: 'multi-hop'
    },
    {
        id: 'mlag-dependencies',
        query: '配置 MLAG 需要哪些前置条件?',
        expectedTopics: ['mlag', 'peerlink', 'bond', 'bridge'],
        category: 'multi-hop'
    },

    // 概念性问题
    {
        id: 'roce-prereq',
        query: '配置 RoCE 需要哪些前置条件?',
        expectedTopics: ['roce', 'pfc', 'dcqcn', 'lossless'],
        category: 'multi-hop'
    },

    // 替代关系问题
    {
        id: 'nvue-frr',
        query: 'NVUE 和 vtysh 有什么区别?',
        expectedTopics: ['nvue', 'vtysh', 'frr', 'cli'],
        category: 'comparison'
    },

    // 厂商相关
    {
        id: 'cumulus-features',
        query: 'Cumulus Linux 支持哪些网络特性?',
        expectedTopics: ['cumulus', 'bgp', 'ospf', 'evpn', 'vxlan'],
        category: 'vendor'
    }
];

/**
 * 搜索知识库
 */
async function searchKnowledgeBase(query, useGraph = true) {
    try {
        const params = new URLSearchParams({
            q: query,
            limit: '20'
        });

        // TODO: 添加禁用图谱的参数（需要后端支持）
        // if (!useGraph) params.append('disableKnowledgeGraph', 'true');

        const res = await fetch(`${API_BASE}/api/chunks/search?${params}`, {
            headers: {
                'Origin': 'http://localhost:5173'
            }
        });
        if (!res.ok) {
            console.error(`Search failed: ${res.status}`);
            return [];
        }

        const data = await res.json();
        return data.chunks || [];
    } catch (error) {
        console.error('Search error:', error.message);
        return [];
    }
}

/**
 * 计算召回率
 * @param {Array} results - 检索结果
 * @param {Array} expectedTopics - 期望的主题关键词
 * @returns {Object} { recall, matchedTopics, totalTopics }
 */
function calculateRecall(results, expectedTopics) {
    const matchedTopics = new Set();

    for (const result of results) {
        const text = (result.content || result.text || '').toLowerCase();
        const title = (result.title || '').toLowerCase();
        const combined = text + ' ' + title;

        for (const topic of expectedTopics) {
            if (combined.includes(topic.toLowerCase())) {
                matchedTopics.add(topic);
            }
        }
    }

    return {
        recall: matchedTopics.size / expectedTopics.length,
        matchedTopics: Array.from(matchedTopics),
        totalTopics: expectedTopics.length
    };
}

/**
 * 检查图谱增强标记
 */
function checkGraphEnhancement(results) {
    let kgBoostedCount = 0;
    let multiHopBoostedCount = 0;

    for (const result of results) {
        // 检查各种形式的 KG 增强标记
        const hasKgBoost = (result.kgBoost || 0) > 0 ||
            (result.kgChunkBoost || 0) > 0 ||
            (result.kgPostRerankBoost || 0) > 0;

        if (hasKgBoost) {
            kgBoostedCount++;
        }

        // 检查多跳增强
        const hasMultiHop = (result.multiHopBoost || 0) > 0 ||
            ((result.multiHopMatches || 0) > 0 && (result.kgPostRerankBoost || 0) > 0);

        if (hasMultiHop) {
            multiHopBoostedCount++;
        }
    }

    return { kgBoostedCount, multiHopBoostedCount };
}

/**
 * 运行单个测试用例
 */
async function runTestCase(testCase) {
    const startTime = Date.now();
    const results = await searchKnowledgeBase(testCase.query);
    const latency = Date.now() - startTime;

    const recallMetrics = calculateRecall(results, testCase.expectedTopics);
    const graphMetrics = checkGraphEnhancement(results);

    return {
        id: testCase.id,
        query: testCase.query,
        category: testCase.category,
        latency,
        resultCount: results.length,
        recall: recallMetrics.recall,
        matchedTopics: recallMetrics.matchedTopics,
        missedTopics: testCase.expectedTopics.filter(t => !recallMetrics.matchedTopics.includes(t)),
        kgBoostedCount: graphMetrics.kgBoostedCount,
        multiHopBoostedCount: graphMetrics.multiHopBoostedCount,
        topResult: results[0] ? {
            title: results[0].title,
            score: results[0].score,
            kgBoost: results[0].kgBoost || 0
        } : null
    };
}

/**
 * 运行完整评估
 */
async function runEvaluation() {
    console.log('='.repeat(60));
    console.log('GraphRAG 评估测试');
    console.log(`API: ${API_BASE}`);
    console.log(`测试用例数: ${testCases.length}`);
    console.log('='.repeat(60));
    console.log();

    const results = [];

    for (const testCase of testCases) {
        console.log(`\n[${testCase.id}] ${testCase.query}`);
        console.log('-'.repeat(50));

        const result = await runTestCase(testCase);
        results.push(result);

        console.log(`  类别: ${result.category}`);
        console.log(`  延迟: ${result.latency}ms`);
        console.log(`  结果数: ${result.resultCount}`);
        console.log(`  召回率: ${(result.recall * 100).toFixed(1)}%`);
        console.log(`  匹配主题: ${result.matchedTopics.join(', ') || '无'}`);
        console.log(`  缺失主题: ${result.missedTopics.join(', ') || '无'}`);
        console.log(`  KG 增强: ${result.kgBoostedCount} 结果`);
        console.log(`  多跳增强: ${result.multiHopBoostedCount} 结果`);

        if (result.topResult) {
            console.log(`  Top 结果: "${result.topResult.title}" (score=${result.topResult.score?.toFixed(4)}, kgBoost=${result.topResult.kgBoost?.toFixed(4)})`);
        }
    }

    // 汇总统计
    console.log('\n' + '='.repeat(60));
    console.log('汇总统计');
    console.log('='.repeat(60));

    const avgRecall = results.reduce((sum, r) => sum + r.recall, 0) / results.length;
    const avgLatency = results.reduce((sum, r) => sum + r.latency, 0) / results.length;
    const kgEnhancedCases = results.filter(r => r.kgBoostedCount > 0).length;
    const multiHopCases = results.filter(r => r.multiHopBoostedCount > 0).length;

    console.log(`平均召回率: ${(avgRecall * 100).toFixed(1)}%`);
    console.log(`平均延迟: ${avgLatency.toFixed(0)}ms`);
    console.log(`KG 增强用例: ${kgEnhancedCases}/${results.length}`);
    console.log(`多跳增强用例: ${multiHopCases}/${results.length}`);

    // 按类别分组
    const byCategory = {};
    for (const r of results) {
        if (!byCategory[r.category]) byCategory[r.category] = [];
        byCategory[r.category].push(r);
    }

    console.log('\n按类别召回率:');
    for (const [category, items] of Object.entries(byCategory)) {
        const catRecall = items.reduce((sum, r) => sum + r.recall, 0) / items.length;
        console.log(`  ${category}: ${(catRecall * 100).toFixed(1)}%`);
    }

    // 输出 JSON 结果
    const outputPath = './test/graphrag_eval_results.json';
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        summary: {
            avgRecall,
            avgLatency,
            kgEnhancedCases,
            multiHopCases,
            totalCases: results.length
        },
        results
    }, null, 2));
    console.log(`\n结果已保存到: ${outputPath}`);
}

// 运行评估
runEvaluation().catch(console.error);
