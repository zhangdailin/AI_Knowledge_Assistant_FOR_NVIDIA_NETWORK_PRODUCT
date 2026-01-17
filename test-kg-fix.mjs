/**
 * 测试知识图谱修复 - 检查孤立节点问题
 */

import { extractEntities } from './server/knowledgeGraph.mjs';

// 测试用例 1: 包含厂商和功能的文本
console.log('\n=== 测试 1: 包含厂商和功能 ===');
const test1 = extractEntities(
  'NVIDIA Mellanox 网卡支持 BGP 和 EVPN 功能，可以配置 firewall 规则',
  { source: 'test1' }
);
console.log('厂商:', test1.vendors.map(v => v.name));
console.log('功能:', test1.functions.map(f => f.name));
console.log('关系数:', test1.relationships.length);
console.log('关系详情:');
test1.relationships.forEach(rel => {
  console.log(`  ${rel.fromType}:${rel.from} --[${rel.type}]--> ${rel.toType}:${rel.to}`);
});

// 测试用例 2: 只包含功能，带 metadata.vendorName
console.log('\n=== 测试 2: 只有功能，带 vendorName metadata ===');
const test2 = extractEntities(
  'BGP 路由协议配置，支持 EVPN overlay 网络',
  { source: 'test2', vendorName: 'NVIDIA' }
);
console.log('厂商:', test2.vendors.map(v => v.name));
console.log('功能:', test2.functions.map(f => f.name));
console.log('关系数:', test2.relationships.length);
console.log('关系详情:');
test2.relationships.forEach(rel => {
  console.log(`  ${rel.fromType}:${rel.from} --[${rel.type}]--> ${rel.toType}:${rel.to}`);
});

// 测试用例 3: 只包含功能，没有厂商信息
console.log('\n=== 测试 3: 只有功能，无厂商信息 ===');
const test3 = extractEntities(
  'firewall 和 gateway 配置，router 设置',
  { source: 'test3' }
);
console.log('厂商:', test3.vendors.map(v => v.name));
console.log('功能:', test3.functions.map(f => f.name));
console.log('关系数:', test3.relationships.length);
console.log('关系详情:');
test3.relationships.forEach(rel => {
  console.log(`  ${rel.fromType}:${rel.from} --[${rel.type}]--> ${rel.toType}:${rel.to}`);
});

// 测试用例 4: 包含中文厂商名
console.log('\n=== 测试 4: 中文厂商名 ===');
const test4 = extractEntities(
  '英伟达的网卡支持 BGP 和 OSPF 路由协议',
  { source: 'test4' }
);
console.log('厂商:', test4.vendors.map(v => v.name));
console.log('功能:', test4.functions.map(f => f.name));
console.log('关系数:', test4.relationships.length);
console.log('关系详情:');
test4.relationships.forEach(rel => {
  console.log(`  ${rel.fromType}:${rel.from} --[${rel.type}]--> ${rel.toType}:${rel.to}`);
});

// 测试用例 5: 包含命令的文本
console.log('\n=== 测试 5: 包含命令 ===');
const test5 = extractEntities(
  'NVIDIA 网卡配置 BGP：使用 nv set router bgp enable on 命令',
  { source: 'test5' }
);
console.log('厂商:', test5.vendors.map(v => v.name));
console.log('功能:', test5.functions.map(f => f.name));
console.log('命令:', test5.commands.map(c => c.name));
console.log('关系数:', test5.relationships.length);
console.log('关系详情:');
test5.relationships.forEach(rel => {
  console.log(`  ${rel.fromType}:${rel.from} --[${rel.type}]--> ${rel.toType}:${rel.to}`);
});

console.log('\n=== 测试完成 ===\n');
