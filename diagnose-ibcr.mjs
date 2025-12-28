#!/usr/bin/env node

/**
 * 拓扑还原诊断脚本 - 检查 IBCR 识别问题
 */

import fs from 'fs';
import FormData from 'form-data';

async function diagnoseIBCRIssue() {
  console.log('\n📋 拓扑还原诊断：IBCR 识别问题\n');

  try {
    // 读取样本数据
    const csvFile = './test-data/ib-topology-sample.csv';
    if (!fs.existsSync(csvFile)) {
      console.error('❌ 找不到样本文件：', csvFile);
      return;
    }

    const fileBuffer = fs.readFileSync(csvFile);
    const content = fileBuffer.toString('utf-8');

    console.log('📂 样本文件检查:');
    console.log(`   文件大小: ${fileBuffer.length} 字节`);

    // 检查 CSV 中的设备名称
    const lines = content.split('\n');
    const deviceNames = new Set();

    for (let i = 1; i < Math.min(lines.length, 20); i++) {
      const parts = lines[i].split(',');
      if (parts[0]) deviceNames.add(parts[0].trim());
      if (parts[2]) deviceNames.add(parts[2].trim());
    }

    console.log('\n📊 CSV 中的设备样本:');
    let hasCR = false, hasSP = false, hasLF = false;
    for (const dev of deviceNames) {
      if (dev.includes('IBCR')) { console.log(`   ✅ 找到 IBCR: ${dev}`); hasCR = true; }
      else if (dev.includes('IBSP')) { console.log(`   ✅ 找到 IBSP: ${dev}`); hasSP = true; }
      else if (dev.includes('IBLF')) { console.log(`   ✅ 找到 IBLF: ${dev}`); hasLF = true; }
    }

    if (!hasCR) console.log('   ⚠️  没有找到 IBCR 设备！');
    if (!hasSP) console.log('   ⚠️  没有找到 IBSP 设备！');
    if (!hasLF) console.log('   ⚠️  没有找到 IBLF 设备！');

    // 发送 API 请求
    console.log('\n🔄 发送 API 请求...');
    const form = new FormData();
    form.append('file', fileBuffer, 'ib-topology-sample.csv');
    form.append('networkType', 'ib');
    form.append('config', JSON.stringify({
      layerDetection: 'auto',
      podExtraction: { method: 'regex', pattern: 'POD\\d+' }
    }));

    const response = await fetch('http://localhost:8787/api/topology-restore', {
      method: 'POST',
      body: form,
      headers: form.getHeaders?.() || {}
    });

    if (!response.ok) {
      console.error(`❌ API 返回错误: ${response.status}`);
      const text = await response.text();
      console.error('响应:', text.substring(0, 200));
      return;
    }

    const data = await response.json();

    console.log('\n📊 后端响应分析:');
    console.log(`   ok: ${data.ok}`);
    console.log(`   nodeCount: ${data.nodeCount}`);
    console.log(`   edgeCount: ${data.edgeCount}`);

    console.log('\n🔍 nodesByLayer 结构:');
    for (const [layer, nodes] of Object.entries(data.nodesByLayer || {})) {
      const nodeArray = Array.isArray(nodes) ? nodes : [];
      console.log(`   ${layer.toUpperCase()}: ${nodeArray.length} 个节点`);
      if (nodeArray.length > 0) {
        console.log(`     示例: ${nodeArray[0].id}`);
      }
    }

    // 关键诊断
    console.log('\n⚙️  诊断结果:');
    const hasCore = data.nodesByLayer?.core && data.nodesByLayer.core.length > 0;
    const hasSpine = data.nodesByLayer?.spine && data.nodesByLayer.spine.length > 0;
    const hasLeaf = data.nodesByLayer?.leaf && data.nodesByLayer.leaf.length > 0;

    if (hasCore) {
      console.log('   ✅ Core 层正确识别');
    } else {
      console.log('   ❌ Core 层未识别或为空 - 这是问题所在！');
    }

    if (hasSpine) console.log('   ✅ Spine 层正确识别');
    else console.log('   ❌ Spine 层未识别或为空');

    if (hasLeaf) console.log('   ✅ Leaf 层正确识别');
    else console.log('   ❌ Leaf 层未识别或为空');

    // 如果有问题，提供建议
    if (!hasCore) {
      console.log('\n💡 可能的原因:');
      console.log('   1. CSV 文件中没有 IBCR 设备');
      console.log('   2. IBCR 设备名称不包含 "IBCR" 字符');
      console.log('   3. 后端层级检测算法有问题');
      console.log('\n   解决方案:');
      console.log('   - 检查 CSV 文件是否有 IBCR 设备');
      console.log('   - 如果没有，改用包含 IBCR 的样本数据');
      console.log('   - 如果使用自定义命名，使用手动配置层级');
    }

  } catch (error) {
    console.error('❌ 错误:', error.message);
  }
}

diagnoseIBCRIssue();
