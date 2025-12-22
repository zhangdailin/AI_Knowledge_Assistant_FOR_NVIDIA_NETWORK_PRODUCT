/**
 * 父子块分块算法测试 v2
 * 验证新的语义感知分块算法
 */

import { enhancedParentChildChunking } from '../server/chunking.mjs';

// 测试用例 1: 多级标题结构
const hierarchicalDoc = `
# BGP 配置指南

本文档介绍如何在 Cumulus Linux 上配置 BGP。

## 基础概念

BGP（Border Gateway Protocol）是一种路径向量协议，用于在自治系统之间交换路由信息。

### eBGP vs iBGP

- eBGP：用于不同 AS 之间的路由交换
- iBGP：用于同一 AS 内部的路由交换

## 配置步骤

### 步骤 1: 启用 BGP

\`\`\`bash
nv set router bgp enable on
nv set router bgp autonomous-system 65001
nv config apply
\`\`\`

### 步骤 2: 配置邻居

| 参数 | 说明 | 示例值 |
|------|------|--------|
| peer-group | 邻居组名称 | underlay |
| remote-as | 远端 AS 号 | external |
| address-family | 地址族 | ipv4-unicast |

配置命令：
\`\`\`bash
nv set vrf default router bgp peer swp1 peer-group underlay
nv set vrf default router bgp peer-group underlay remote-as external
nv config apply
\`\`\`

## 验证命令

使用以下命令验证 BGP 状态：

- \`nv show router bgp summary\` - 查看 BGP 摘要
- \`nv show router bgp neighbor\` - 查看邻居状态
- \`nv show vrf default router bgp\` - 查看 VRF 下的 BGP 配置

## 故障排除

如果 BGP 邻居无法建立，请检查：

1. 物理连接是否正常
2. IP 地址配置是否正确
3. AS 号是否匹配
4. 防火墙是否放行 TCP 179 端口
`;

// 测试用例 2: HTML 表格
const htmlTableDoc = `
# 网络命令参考

这是一个包含 HTML 表格的文档。

<table>
<tr><th>命令</th><th>描述</th><th>示例</th></tr>
<tr><td>nv show interface</td><td>显示接口状态</td><td>nv show interface swp1</td></tr>
<tr><td>nv show bgp</td><td>显示 BGP 邻居</td><td>nv show bgp neighbor</td></tr>
<tr><td>nv config apply</td><td>应用配置</td><td>nv config apply -y</td></tr>
</table>

更多内容在这里。
`;

// 测试用例 3: 无标题的纯文本
const plainTextDoc = `
VXLAN（Virtual Extensible LAN）是一种网络虚拟化技术，它通过在 UDP 数据包中封装二层以太网帧来扩展虚拟局域网。

VXLAN 的主要特点包括：
- 支持多达 1600 万个逻辑网络（24 位 VNI）
- 使用 VTEP（VXLAN Tunnel Endpoint）进行封装和解封装
- 可以跨越三层网络边界

在 Cumulus Linux 中配置 VXLAN 需要以下步骤：
1. 创建 VXLAN 接口
2. 配置 VNI 到 VLAN 的映射
3. 配置 VTEP 源地址
4. 可选：配置 EVPN 进行控制平面学习

常用命令：
nv set nve vxlan enable on
nv set nve vxlan source address 10.0.0.1
nv set bridge domain br_default vlan 100 vni 100100
nv config apply
`;

// 测试用例 4: 混合内容
const mixedDoc = `
# PFC 和 ECN 配置

## PFC（Priority Flow Control）

PFC 是一种基于优先级的流量控制机制，允许在特定优先级队列上暂停流量。

<table>
<tr><th>优先级</th><th>用途</th><th>PFC 状态</th></tr>
<tr><td>3</td><td>RoCE v2 流量</td><td>启用</td></tr>
<tr><td>0-2, 4-7</td><td>普通流量</td><td>禁用</td></tr>
</table>

## ECN（Explicit Congestion Notification）

ECN 通过标记数据包来通知端点发生拥塞，而不是直接丢弃数据包。

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| min_threshold | 150KB | 开始标记的阈值 |
| max_threshold | 1500KB | 必须标记的阈值 |
| probability | 100% | 标记概率 |

配置示例：

\`\`\`bash
nv set qos roce enable on
nv set qos roce mode lossless
nv config apply
\`\`\`
`;

console.log('========================================');
console.log('父子块分块算法测试 v2');
console.log('========================================\n');

function runTest(name, doc) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`测试: ${name}`);
  console.log('='.repeat(50));
  
  console.log('\n📄 原始文档 (前 200 字符):');
  console.log('-'.repeat(40));
  console.log(doc.substring(0, 200) + (doc.length > 200 ? '...' : ''));
  console.log('-'.repeat(40));
  
  const chunks = enhancedParentChildChunking(doc, 4000, 1500, 500);
  
  const parentChunks = chunks.filter(c => c.chunkType === 'parent');
  const childChunks = chunks.filter(c => c.chunkType === 'child');
  
  console.log(`\n📊 分块统计:`);
  console.log(`   总 chunks: ${chunks.length}`);
  console.log(`   父块: ${parentChunks.length} 个`);
  console.log(`   子块: ${childChunks.length} 个`);
  
  // 显示父块详情
  console.log('\n📦 父块详情:');
  parentChunks.forEach((chunk, idx) => {
    const header = chunk.metadata?.header || '(无标题)';
    const breadcrumbs = chunk.metadata?.breadcrumbs?.join(' > ') || '';
    const summary = chunk.metadata?.summary || '';
    
    console.log(`\n   [父块 ${idx + 1}] "${header}"`);
    if (breadcrumbs) console.log(`   面包屑: ${breadcrumbs}`);
    if (summary) console.log(`   摘要: ${summary.substring(0, 80)}...`);
    console.log(`   内容长度: ${chunk.content.length} 字符`);
    
    // 显示关联的子块数量
    const relatedChildren = childChunks.filter(c => c.parentId === chunk.id);
    console.log(`   关联子块: ${relatedChildren.length} 个`);
  });
  
  // 显示子块示例
  if (childChunks.length > 0) {
    console.log('\n📝 子块示例 (前 2 个):');
    childChunks.slice(0, 2).forEach((chunk, idx) => {
      console.log(`\n   [子块 ${idx + 1}]`);
      console.log(`   位置: ${chunk.metadata?.childIndex + 1}/${chunk.metadata?.totalChildren}`);
      console.log(`   内容预览: ${chunk.content.substring(0, 100).replace(/\n/g, ' ')}...`);
    });
  }
  
  // 检查质量指标
  const hasSemanticTable = chunks.some(c => 
    c.content.includes('[表格开始]') || c.content.includes('[表格内容]')
  );
  
  const hasRawHtml = chunks.some(c => 
    c.content.includes('<td>') || c.content.includes('<tr>')
  );
  
  const hasBreadcrumbs = parentChunks.some(c => 
    c.metadata?.breadcrumbs && c.metadata.breadcrumbs.length > 0
  );
  
  const hasSummary = parentChunks.some(c => 
    c.metadata?.summary && c.metadata.summary.length > 0
  );
  
  console.log('\n✅ 质量检查:');
  console.log(`   ${!hasRawHtml ? '✓' : '✗'} HTML 标签已清理: ${!hasRawHtml}`);
  console.log(`   ${hasBreadcrumbs ? '✓' : '○'} 包含面包屑导航: ${hasBreadcrumbs}`);
  console.log(`   ${hasSummary ? '✓' : '○'} 包含内容摘要: ${hasSummary}`);
  if (doc.includes('<table') || doc.includes('|---')) {
    console.log(`   ${hasSemanticTable ? '✓' : '✗'} 表格已语义化: ${hasSemanticTable}`);
  }
  
  return {
    name,
    parentCount: parentChunks.length,
    childCount: childChunks.length,
    hasRawHtml,
    hasBreadcrumbs,
    hasSummary,
    hasSemanticTable: doc.includes('<table') || doc.includes('|---') ? hasSemanticTable : true
  };
}

// 运行所有测试
const results = [];
results.push(runTest('多级标题结构', hierarchicalDoc));
results.push(runTest('HTML 表格', htmlTableDoc));
results.push(runTest('纯文本 (无标题)', plainTextDoc));
results.push(runTest('混合内容', mixedDoc));

// 汇总结果
console.log('\n\n========================================');
console.log('测试汇总');
console.log('========================================\n');

let allPassed = true;
results.forEach(r => {
  const passed = !r.hasRawHtml && r.hasSemanticTable && r.parentCount > 0;
  if (!passed) allPassed = false;
  
  const status = passed ? '✓ 通过' : '✗ 失败';
  console.log(`${status} | ${r.name}`);
  console.log(`        父块: ${r.parentCount}, 子块: ${r.childCount}`);
});

console.log(`\n总体结果: ${allPassed ? '✓ 全部通过' : '✗ 存在失败'}\n`);

process.exit(allPassed ? 0 : 1);

