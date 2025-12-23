import fs from 'fs';
import { enhancedParentChildChunking } from './server/chunking.mjs';

// 读取一个示例 Markdown 文件进行测试
const testMarkdown = `
# MLAG Configuration Guide

This document describes how to configure MLAG on Cumulus Linux.

## Prerequisites

Before configuring MLAG, ensure you have:
- Two switches with Cumulus Linux installed
- Connectivity between the switches

## Basic MLAG Configuration

### Step 1: Configure the Peer Link

The peer link connects the two MLAG switches. Configure it using NVUE:

\`\`\`txt
cumulus@leaf01:~$ nv set interface peerlink bond member swp49-50
cumulus@leaf01:~$ nv set mlag mac-address 44:38:39:BE:EF:AA
cumulus@leaf01:~$ nv set mlag backup 10.10.10.2
cumulus@leaf01:~$ nv set mlag peer-ip linklocal
cumulus@leaf01:~$ nv set mlag priority 1000
cumulus@leaf01:~$ nv set mlag init-delay 10
cumulus@leaf01:~$ nv config apply
\`\`\`

### Step 2: Configure the MLAG Bonds

Configure the bonds that connect to your servers:

\`\`\`txt
cumulus@leaf01:~$ nv set interface bond1 bond member swp1
cumulus@leaf01:~$ nv set interface bond1 bond mlag id 1
cumulus@leaf01:~$ nv set interface bond1 bond lacp-bypass on
cumulus@leaf01:~$ nv config apply
\`\`\`

### Step 3: Verify MLAG Status

Use these commands to verify your configuration:

\`\`\`txt
cumulus@leaf01:~$ nv show mlag
cumulus@leaf01:~$ nv show interface bond1
\`\`\`

## Troubleshooting

If MLAG is not working, check:
1. Peer link connectivity
2. MAC address configuration
3. Backup IP reachability

## Advanced Configuration

### VXLAN with MLAG

When using VXLAN with MLAG:

\`\`\`txt
cumulus@leaf01:~$ nv set nve vxlan enable on
cumulus@leaf01:~$ nv set nve vxlan source address 10.0.1.1
cumulus@leaf01:~$ nv set bridge domain br_default vlan 10 vni 10010
cumulus@leaf01:~$ nv config apply
\`\`\`
`;

console.log('=== 测试新的 Chunking 算法 ===\n');

const chunks = enhancedParentChildChunking(testMarkdown, 2000);

console.log(`\n生成 ${chunks.length} 个 chunks:\n`);

chunks.forEach((chunk, i) => {
  console.log(`--- Chunk ${i} ---`);
  console.log('Type:', chunk.chunkType);
  console.log('Breadcrumbs:', chunk.metadata.breadcrumbs.join(' > ') || 'None');
  console.log('Length:', chunk.content.length);
  console.log('Summary:', chunk.metadata.summary);

  // 检查代码块完整性
  const codeBlockCount = (chunk.content.match(/\`\`\`/g) || []).length;
  console.log('Code blocks valid:', codeBlockCount % 2 === 0 ? 'YES' : 'NO (broken!)');

  console.log('Content preview:');
  console.log(chunk.content.substring(0, 200) + '...\n');
});

// 统计
console.log('\n=== 统计 ===');
const totalCodeBlocks = chunks.reduce((acc, c) => acc + (c.content.match(/\`\`\`/g) || []).length, 0);
const brokenCodeBlocks = chunks.filter(c => (c.content.match(/\`\`\`/g) || []).length % 2 !== 0).length;
console.log('总代码块标记数:', totalCodeBlocks);
console.log('代码块被切断的 chunk 数:', brokenCodeBlocks);
console.log('平均 chunk 长度:', Math.round(chunks.reduce((a, c) => a + c.content.length, 0) / chunks.length));
