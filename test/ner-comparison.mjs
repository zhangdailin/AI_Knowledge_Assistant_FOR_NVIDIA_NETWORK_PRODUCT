/**
 * 正则 vs LLM 实体抽取准确率对比测试
 * 运行: node test/ner-comparison.mjs
 */

import { extractEntities, extractEntitiesWithLLM, smartExtractEntities } from '../server/knowledgeGraph.mjs';

// 测试用例：包含已知实体的文本样本
const TEST_CASES = [
    {
        name: '基础网络配置',
        text: `NVIDIA Cumulus Linux 配置 MLAG 步骤：
1. 使用 nv set interface bond0 bond member swp1-4 配置 bond 接口
2. 配置 MLAG 域: nv set mlag mac-address 44:38:39:ff:00:01
3. 启用 VXLAN overlay: nv set nve vxlan enable on
4. 设置 BGP peer-group: nv set router bgp autonomous-system 65100`,
        expected: {
            vendors: ['NVIDIA', 'Cumulus'],
            functions: ['MLAG', 'VXLAN', 'BGP'],
            commands: ['nv set interface', 'nv set mlag', 'nv set nve', 'nv set router bgp'],
            parameters: ['bond member', 'mac-address', 'autonomous-system', 'peer-group']
        }
    },
    {
        name: 'RoCE 配置',
        text: `在 Mellanox ConnectX-6 网卡上配置 RoCEv2：
首先启用 PFC (Priority Flow Control) 确保无损网络:
# mlnx_qos -i eth0 --pfc 0,0,0,1,0,0,0,0
然后配置 ECN (Explicit Congestion Notification):
# echo 1 > /sys/class/net/eth0/ecn/enable
最后验证 RDMA 连接: ibstat`,
        expected: {
            vendors: ['Mellanox'],
            functions: ['RoCEv2', 'PFC', 'ECN', 'RDMA'],
            commands: ['mlnx_qos', 'ibstat'],
            parameters: ['--pfc']
        }
    },
    {
        name: 'Cisco vs NVIDIA 对比',
        text: `Cisco Nexus 使用 spanning-tree 命令配置 STP，
而 NVIDIA Spectrum 交换机使用 nv set bridge domain br_default stp enable。
两者都支持 EVPN-VXLAN overlay 网络架构。`,
        expected: {
            vendors: ['Cisco', 'NVIDIA'],
            functions: ['STP', 'EVPN-VXLAN', 'spanning-tree'],
            commands: ['nv set bridge', 'spanning-tree'],
            parameters: ['stp enable']
        }
    },
    {
        name: '简短命令文档',
        text: `show ip route - 显示路由表
show interface status - 查看接口状态
nv show system - 系统信息`,
        expected: {
            vendors: [],
            functions: ['Routing'],
            commands: ['show ip route', 'show interface status', 'nv show system'],
            parameters: []
        }
    },
    {
        name: '中文网络文档',
        text: `华为交换机配置 VLAN 的步骤：
1. 进入系统视图: system-view
2. 创建 VLAN: vlan 100
3. 配置接口: interface GigabitEthernet0/0/1
4. 加入 VLAN: port default vlan 100
该配置与思科的 switchport access vlan 100 命令效果类似。`,
        expected: {
            vendors: ['华为', '思科'],
            functions: ['VLAN'],
            commands: ['system-view', 'vlan', 'interface', 'port default vlan', 'switchport access vlan'],
            parameters: []
        }
    }
];

// 计算准确率、召回率、F1
function calculateMetrics(extracted, expected, fieldName) {
    const extractedSet = new Set((extracted || []).map(e =>
        typeof e === 'string' ? e.toLowerCase() : e.name?.toLowerCase()
    ).filter(Boolean));

    const expectedSet = new Set((expected || []).map(e => e.toLowerCase()));

    let truePositives = 0;
    for (const e of extractedSet) {
        // 部分匹配也算正确
        for (const exp of expectedSet) {
            if (e.includes(exp) || exp.includes(e)) {
                truePositives++;
                break;
            }
        }
    }

    const precision = extractedSet.size > 0 ? truePositives / extractedSet.size : 0;
    const recall = expectedSet.size > 0 ? truePositives / expectedSet.size : 1;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

    return {
        extracted: extractedSet.size,
        expected: expectedSet.size,
        truePositives,
        precision: (precision * 100).toFixed(1),
        recall: (recall * 100).toFixed(1),
        f1: (f1 * 100).toFixed(1)
    };
}

// 主测试函数
async function runComparison() {
    console.log('='.repeat(80));
    console.log('📊 正则 vs LLM 实体抽取准确率对比测试');
    console.log('='.repeat(80));
    console.log();

    const results = {
        regex: { vendors: [], functions: [], commands: [], parameters: [], times: [] },
        llm: { vendors: [], functions: [], commands: [], parameters: [], times: [] }
    };

    for (const testCase of TEST_CASES) {
        console.log(`\n📝 测试用例: ${testCase.name}`);
        console.log('-'.repeat(60));

        // 正则方式
        const regexStart = Date.now();
        const regexResult = extractEntities(testCase.text, {
            allowDefaultFunction: false,
            allowHeuristicVendors: true
        });
        const regexTime = Date.now() - regexStart;
        results.regex.times.push(regexTime);

        // LLM 方式
        const llmStart = Date.now();
        const llmResult = await extractEntitiesWithLLM(testCase.text);
        const llmTime = Date.now() - llmStart;
        results.llm.times.push(llmTime);

        // 计算各字段指标
        for (const field of ['vendors', 'functions', 'commands', 'parameters']) {
            const regexMetrics = calculateMetrics(regexResult[field], testCase.expected[field], field);
            const llmMetrics = llmResult ? calculateMetrics(llmResult[field], testCase.expected[field], field) : null;

            results.regex[field].push(regexMetrics);
            if (llmMetrics) results.llm[field].push(llmMetrics);

            console.log(`  ${field}:`);
            console.log(`    正则: P=${regexMetrics.precision}% R=${regexMetrics.recall}% F1=${regexMetrics.f1}% (${regexMetrics.extracted}/${regexMetrics.expected})`);
            if (llmMetrics) {
                console.log(`    LLM:  P=${llmMetrics.precision}% R=${llmMetrics.recall}% F1=${llmMetrics.f1}% (${llmMetrics.extracted}/${llmMetrics.expected})`);
            } else {
                console.log(`    LLM:  (跳过 - API 不可用)`);
            }
        }

        console.log(`  ⏱️  正则: ${regexTime}ms | LLM: ${llmTime}ms`);
    }

    // 汇总统计
    console.log('\n' + '='.repeat(80));
    console.log('📈 汇总统计');
    console.log('='.repeat(80));

    for (const field of ['vendors', 'functions', 'commands', 'parameters']) {
        const avgRegexF1 = results.regex[field].reduce((sum, m) => sum + parseFloat(m.f1), 0) / results.regex[field].length;
        const avgLlmF1 = results.llm[field].length > 0
            ? results.llm[field].reduce((sum, m) => sum + parseFloat(m.f1), 0) / results.llm[field].length
            : 0;

        const winner = avgLlmF1 > avgRegexF1 ? '🏆 LLM' : avgRegexF1 > avgLlmF1 ? '🏆 正则' : '🤝 平手';
        console.log(`\n${field.toUpperCase()}:`);
        console.log(`  正则 平均 F1: ${avgRegexF1.toFixed(1)}%`);
        console.log(`  LLM  平均 F1: ${avgLlmF1.toFixed(1)}%`);
        console.log(`  获胜: ${winner}`);
    }

    // 时间统计
    const avgRegexTime = results.regex.times.reduce((a, b) => a + b, 0) / results.regex.times.length;
    const avgLlmTime = results.llm.times.reduce((a, b) => a + b, 0) / results.llm.times.length;

    console.log('\n⏱️ 平均响应时间:');
    console.log(`  正则: ${avgRegexTime.toFixed(0)}ms`);
    console.log(`  LLM:  ${avgLlmTime.toFixed(0)}ms`);
    console.log(`  差距: LLM 慢 ${(avgLlmTime / avgRegexTime).toFixed(1)}x`);

    console.log('\n' + '='.repeat(80));
    console.log('✅ 测试完成');
    console.log('='.repeat(80));
}

// 运行测试
runComparison().catch(console.error);
