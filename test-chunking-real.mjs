import fs from 'fs';
import { enhancedParentChildChunking } from './server/chunking.mjs';

// 找一个实际的 Markdown 文档测试
const docsPath = 'data/documents.json';
const docs = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));

console.log('找到文档:', docs.map(d => d.filename).join(', '));

// 检查是否有原始 Markdown 文件可以测试
// 如果没有，我们用现有的 chunks 文件内容来模拟

// 创建一个测试用的长 Markdown 内容
const testContent = `
# Cumulus Linux MLAG Configuration

## Overview

Multi-Chassis Link Aggregation (MLAG) enables a server or switch with a two-port bond to connect those ports to different switches in an MLAG pair and remain up if one of the switches fails.

## Requirements

- Two Cumulus Linux switches
- Interconnect links between switches (peerlink)
- Matching configuration on both switches

## Configuration Steps

### Step 1: Configure the Peerlink

The peerlink is the bond between the two MLAG peer switches:

\`\`\`bash
cumulus@leaf01:~$ nv set interface peerlink bond member swp49-50
cumulus@leaf01:~$ nv set mlag mac-address 44:38:39:BE:EF:AA
cumulus@leaf01:~$ nv set mlag backup 10.10.10.2
cumulus@leaf01:~$ nv set mlag peer-ip linklocal
cumulus@leaf01:~$ nv set mlag priority 1000
cumulus@leaf01:~$ nv set mlag init-delay 10
cumulus@leaf01:~$ nv config apply
\`\`\`

On leaf02:

\`\`\`bash
cumulus@leaf02:~$ nv set interface peerlink bond member swp49-50
cumulus@leaf02:~$ nv set mlag mac-address 44:38:39:BE:EF:AA
cumulus@leaf02:~$ nv set mlag backup 10.10.10.1
cumulus@leaf02:~$ nv set mlag peer-ip linklocal
cumulus@leaf02:~$ nv set mlag priority 2000
cumulus@leaf02:~$ nv set mlag init-delay 10
cumulus@leaf02:~$ nv config apply
\`\`\`

### Step 2: Configure MLAG Bonds

Create bonds for dual-connected servers:

\`\`\`bash
cumulus@leaf01:~$ nv set interface bond1 bond member swp1
cumulus@leaf01:~$ nv set interface bond1 bond mlag id 1
cumulus@leaf01:~$ nv set interface bond1 bond lacp-bypass on
cumulus@leaf01:~$ nv set interface bond1 bridge domain br_default
cumulus@leaf01:~$ nv set bridge domain br_default vlan 10,20,30
cumulus@leaf01:~$ nv config apply
\`\`\`

### Step 3: Verify Configuration

\`\`\`bash
cumulus@leaf01:~$ nv show mlag
                operational              applied
--------------  -----------------------  -------------------
enable                                   on
debug                                    off
init-delay                               10
mac-address     44:38:39:BE:EF:AA        44:38:39:BE:EF:AA
peer-ip         fe80::4638:39ff:fe00:5a  linklocal
priority        1000                     1000
[backup]        10.10.10.2               10.10.10.2
anycast-ip      10.0.1.1
backup-active   True
backup-reason
local-id        44:38:39:00:00:59
local-role      primary
peer-alive      True
peer-id         44:38:39:00:00:5a
peer-interface  peerlink.4094
peer-priority   2000
peer-role       secondary
\`\`\`

## Troubleshooting MLAG

### Common Issues

1. **Peer not detected**
   - Check peerlink physical connectivity
   - Verify MAC addresses match on both switches
   - Check backup IP reachability

2. **Bond not forming**
   - Verify MLAG ID matches on both switches
   - Check LACP configuration
   - Verify physical connectivity to server

### Debug Commands

\`\`\`bash
cumulus@leaf01:~$ nv show mlag
cumulus@leaf01:~$ nv show interface peerlink
cumulus@leaf01:~$ clagctl -v
cumulus@leaf01:~$ journalctl -u clagd -f
\`\`\`

## Advanced Topics

### MLAG with VXLAN

When deploying VXLAN with MLAG, configure shared anycast VTEP:

\`\`\`bash
cumulus@leaf01:~$ nv set nve vxlan enable on
cumulus@leaf01:~$ nv set nve vxlan source address 10.0.1.1
cumulus@leaf01:~$ nv set nve vxlan mlag shared-address 10.0.1.100
cumulus@leaf01:~$ nv set bridge domain br_default vlan 10 vni 10010
cumulus@leaf01:~$ nv set evpn enable on
cumulus@leaf01:~$ nv config apply
\`\`\`

### MLAG with BGP

For spine-leaf topology with BGP unnumbered:

\`\`\`bash
cumulus@leaf01:~$ nv set router bgp autonomous-system 65101
cumulus@leaf01:~$ nv set router bgp router-id 10.10.10.1
cumulus@leaf01:~$ nv set vrf default router bgp neighbor swp51 remote-as external
cumulus@leaf01:~$ nv set vrf default router bgp neighbor swp52 remote-as external
cumulus@leaf01:~$ nv set vrf default router bgp neighbor peerlink.4094 remote-as external
cumulus@leaf01:~$ nv config apply
\`\`\`
`;

console.log('\n=== 测试更长的 Markdown 文档 ===\n');

const chunks = enhancedParentChildChunking(testContent, 2000);

console.log(`生成 ${chunks.length} 个 chunks\n`);

// 检查质量
let brokenCodeBlocks = 0;
let hasNvSetCommands = 0;

chunks.forEach((chunk, i) => {
  const codeBlockCount = (chunk.content.match(/\`\`\`/g) || []).length;
  if (codeBlockCount % 2 !== 0) brokenCodeBlocks++;
  if (/nv\s+set/.test(chunk.content)) hasNvSetCommands++;

  console.log(`[${i}] ${chunk.metadata.header || 'No header'} (${chunk.content.length} chars)`);
  console.log(`    Summary: ${chunk.metadata.summary.substring(0, 80)}...`);
  console.log(`    Code blocks: ${codeBlockCount / 2} (valid: ${codeBlockCount % 2 === 0})`);
});

console.log('\n=== 质量检查 ===');
console.log('代码块被切断:', brokenCodeBlocks);
console.log('包含 nv set 命令的 chunks:', hasNvSetCommands);
console.log('平均长度:', Math.round(chunks.reduce((a, c) => a + c.content.length, 0) / chunks.length));

// 验证搜索 "nv set mlag" 时应该能找到的内容
console.log('\n=== 搜索模拟: "nv set mlag" ===');
const searchResults = chunks.filter(c =>
  c.content.toLowerCase().includes('nv set') &&
  c.content.toLowerCase().includes('mlag')
);
console.log(`找到 ${searchResults.length} 个相关 chunks:`);
searchResults.slice(0, 3).forEach((c, i) => {
  console.log(`[${i}] ${c.metadata.header}`);
  // 显示包含 nv set mlag 的行
  const lines = c.content.split('\n').filter(l => l.toLowerCase().includes('nv set') && l.toLowerCase().includes('mlag'));
  lines.slice(0, 2).forEach(l => console.log('   ', l.trim()));
});
