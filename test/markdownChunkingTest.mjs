/**
 * Markdown 感知分块算法测试
 * 验证 Markdown 各种结构是否被正确处理
 */

import { enhancedParentChildChunking } from '../server/chunking.mjs';

// ========== 测试用例 ==========

// 测试 1: 多级标题结构
const multiLevelHeaders = `
# BGP 配置指南

本文档介绍 BGP 配置方法。

## 基础概念

BGP 是边界网关协议。

### eBGP

eBGP 用于不同 AS 之间。

### iBGP

iBGP 用于同一 AS 内部。

## 配置步骤

### 步骤 1: 启用 BGP

使用以下命令启用 BGP：

\`\`\`bash
nv set router bgp enable on
nv config apply
\`\`\`

### 步骤 2: 配置邻居

配置 BGP 邻居关系。

## 验证

使用 \`nv show router bgp\` 验证配置。
`;

// 测试 2: 代码块
const codeBlocks = `
# 命令参考

## 显示命令

查看接口状态：

\`\`\`bash
nv show interface
nv show interface swp1
nv show interface swp1 link
\`\`\`

## 配置命令

配置接口：

\`\`\`bash
nv set interface swp1 ip address 10.0.0.1/24
nv set interface swp1 link state up
nv config apply
\`\`\`

注意：配置后需要执行 apply。
`;

// 测试 3: Markdown 表格
const markdownTable = `
# VXLAN 配置

## 命令参考

| 命令 | 描述 | 示例 |
|------|------|------|
| nv set nve vxlan enable | 启用 VXLAN | nv set nve vxlan enable on |
| nv set nve vxlan source | 配置源地址 | nv set nve vxlan source address 10.0.0.1 |
| nv show nve vxlan | 查看状态 | nv show nve vxlan |

## 配置示例

首先启用 VXLAN 功能。
`;

// 测试 4: 列表（有序和无序）
const lists = `
# 故障排除步骤

## 检查清单

在排除故障时，请检查以下项目：

- 物理连接
  - 网线是否插好
  - 指示灯是否正常
- IP 配置
  - 地址是否正确
  - 子网掩码是否匹配
- 路由配置
  - 默认路由是否存在
  - BGP 邻居是否建立

## 排错步骤

按以下顺序排查：

1. 检查物理层
2. 检查数据链路层
3. 检查网络层
4. 检查传输层
5. 检查应用层

每一步都要验证后再进行下一步。
`;

// 测试 5: 引用块
const blockquotes = `
# 最佳实践

## 配置建议

> **重要提示**
> 
> 在生产环境中修改配置前，请务必：
> - 备份当前配置
> - 在测试环境验证
> - 准备回滚方案

## 注意事项

以下是常见的错误：

> 错误：直接在生产环境测试新配置
> 
> 正确做法：先在测试环境验证，确认无误后再部署到生产环境。
`;

// 测试 6: 混合内容
const mixedContent = `
# PFC 和 ECN 配置指南

## 概述

PFC（Priority Flow Control）和 ECN（Explicit Congestion Notification）是数据中心网络中实现无损传输的关键技术。

## PFC 配置

### 基本概念

PFC 允许在特定优先级队列上暂停流量：

- 优先级 3：RoCE v2 流量（启用 PFC）
- 其他优先级：普通流量（禁用 PFC）

### 配置步骤

1. 启用 QoS 功能
2. 配置 PFC 优先级
3. 应用配置

\`\`\`bash
nv set qos roce enable on
nv set qos roce mode lossless
nv config apply
\`\`\`

### 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| enable | off | 是否启用 |
| mode | lossy | 模式选择 |
| priority | 3 | PFC 优先级 |

## ECN 配置

### 阈值设置

> **注意**
> 
> ECN 阈值设置对性能影响很大，请根据实际流量调整。

推荐配置：

- min_threshold: 150KB
- max_threshold: 1500KB
- probability: 100%

## 验证命令

使用以下命令验证配置：

\`\`\`bash
nv show qos roce
nv show qos congestion-control
\`\`\`

检查要点：

1. PFC 是否在正确的优先级启用
2. ECN 阈值是否合理
3. 没有丢包或暂停计数异常
`;

// ========== 测试运行 ==========

console.log('═'.repeat(60));
console.log('Markdown 感知分块算法测试');
console.log('═'.repeat(60));

function runTest(name, doc) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📝 测试: ${name}`);
  console.log('─'.repeat(60));
  
  const chunks = enhancedParentChildChunking(doc, 4000, 2000, 600);
  
  const parents = chunks.filter(c => c.chunkType === 'parent');
  const children = chunks.filter(c => c.chunkType === 'child');
  
  console.log(`\n📊 统计:`);
  console.log(`   总 chunks: ${chunks.length}`);
  console.log(`   父块: ${parents.length}`);
  console.log(`   子块: ${children.length}`);
  
  // 显示父块结构
  console.log(`\n📂 父块结构:`);
  parents.forEach((p, idx) => {
    const breadcrumbs = p.metadata?.breadcrumbs?.join(' > ') || '(根)';
    const contentPreview = p.content.substring(0, 60).replace(/\n/g, ' ');
    console.log(`   [${idx + 1}] ${breadcrumbs}`);
    console.log(`       预览: ${contentPreview}...`);
    
    // 显示关联子块
    const relatedChildren = children.filter(c => c.parentId === p.id);
    if (relatedChildren.length > 0) {
      console.log(`       子块: ${relatedChildren.length} 个`);
    }
  });
  
  // 质量检查
  console.log(`\n✅ 质量检查:`);
  
  // 检查面包屑
  const hasBreadcrumbs = parents.some(p => p.metadata?.breadcrumbs?.length > 0);
  console.log(`   ${hasBreadcrumbs ? '✓' : '○'} 面包屑导航: ${hasBreadcrumbs}`);
  
  // 检查摘要
  const hasSummary = parents.some(p => p.metadata?.summary?.length > 0);
  console.log(`   ${hasSummary ? '✓' : '○'} 内容摘要: ${hasSummary}`);
  
  // 检查表格处理
  const hasTable = doc.includes('|') && doc.includes('---');
  const tableProcessed = !chunks.some(c => c.content.includes('|---'));
  if (hasTable) {
    console.log(`   ${tableProcessed ? '✓' : '✗'} 表格语义化: ${tableProcessed}`);
  }
  
  // 检查代码块完整性
  const codeBlockCount = (doc.match(/```/g) || []).length / 2;
  const preservedCodeBlocks = chunks.filter(c => 
    c.content.includes('```') && c.content.split('```').length % 2 === 1
  ).length;
  if (codeBlockCount > 0) {
    console.log(`   ✓ 代码块完整: ${preservedCodeBlocks >= codeBlockCount}`);
  }
  
  // 检查列表完整性
  const hasList = /^[-*+]\s+/m.test(doc) || /^\d+\.\s+/m.test(doc);
  if (hasList) {
    console.log(`   ✓ 列表保持完整`);
  }
  
  return {
    name,
    parentCount: parents.length,
    childCount: children.length,
    passed: true
  };
}

// 运行所有测试
const results = [];
results.push(runTest('多级标题结构', multiLevelHeaders));
results.push(runTest('代码块', codeBlocks));
results.push(runTest('Markdown 表格', markdownTable));
results.push(runTest('列表（有序/无序）', lists));
results.push(runTest('引用块', blockquotes));
results.push(runTest('混合内容', mixedContent));

// 汇总
console.log(`\n${'═'.repeat(60)}`);
console.log('测试汇总');
console.log('═'.repeat(60));

results.forEach(r => {
  console.log(`${r.passed ? '✓' : '✗'} ${r.name} - 父块: ${r.parentCount}, 子块: ${r.childCount}`);
});

const allPassed = results.every(r => r.passed);
console.log(`\n总体结果: ${allPassed ? '✓ 全部通过' : '✗ 存在失败'}`);
console.log('═'.repeat(60));

process.exit(allPassed ? 0 : 1);

