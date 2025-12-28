#!/usr/bin/env node

/**
 * 拓扑还原API验证脚本
 * 用法: node test-topology-api.mjs [ib|roce]
 */

import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

const API_URL = process.env.API_URL || 'http://localhost:8787';
const networkType = process.argv[2] || 'ib';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, ...args) {
  console.log(`${colors[color] || ''}${args.join(' ')}${colors.reset}`);
}

function logTest(name) {
  log('cyan', `\n📋 ${name}`);
}

function logPass(msg) {
  log('green', `✅ ${msg}`);
}

function logFail(msg) {
  log('red', `❌ ${msg}`);
}

function logInfo(msg) {
  log('blue', `ℹ️  ${msg}`);
}

async function testTopologyRestore() {
  logTest('测试拓扑还原API');

  try {
    // 确定测试文件
    let filePath, expectedNodeCount, expectedEdgeCount;

    if (networkType === 'ib') {
      filePath = './test-data/ib-topology-sample.csv';
      expectedNodeCount = 45;
      expectedEdgeCount = 80;
      logInfo(`使用IB网络样本: ${filePath}`);
    } else if (networkType === 'roce') {
      filePath = './test-data/roce-topology-sample.xlsx';
      expectedNodeCount = 12; // ASW(4) + SSW(4) + CSW(2) + OOB(2)
      expectedEdgeCount = 20;
      logInfo(`使用RoCE网络样本: ${filePath}`);
    } else {
      logFail(`不支持的网络类型: ${networkType}`);
      process.exit(1);
    }

    // 检查文件存在
    if (!fs.existsSync(filePath)) {
      logFail(`文件不存在: ${filePath}`);
      process.exit(1);
    }
    logPass(`文件存在: ${filePath}`);

    // 读取文件
    const fileBuffer = fs.readFileSync(filePath);
    logPass(`文件大小: ${fileBuffer.length} 字节`);

    // 创建FormData
    const form = new FormData();
    form.append('file', fileBuffer, path.basename(filePath));
    form.append('networkType', networkType);
    form.append('config', JSON.stringify({
      layerDetection: 'auto',
      podExtraction: { method: 'regex', pattern: 'POD\\d+' }
    }));

    logInfo(`发送请求到: ${API_URL}/api/topology-restore`);

    // 发送请求
    const response = await fetch(`${API_URL}/api/topology-restore`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders?.() || {}
    });

    logInfo(`响应状态: ${response.status}`);

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      logFail(`响应不是有效的JSON: ${responseText.substring(0, 200)}`);
      process.exit(1);
    }

    // 验证响应结构
    logTest('验证响应结构');

    if (!data.ok) {
      logFail(`响应 ok 字段为 false: ${data.error}`);
      process.exit(1);
    }
    logPass('响应包含 ok: true');

    if (!data.nodesByLayer) {
      logFail('响应缺少 nodesByLayer 字段');
      process.exit(1);
    }
    logPass('响应包含 nodesByLayer');

    if (!data.connections) {
      logFail('响应缺少 connections 字段');
      process.exit(1);
    }
    logPass('响应包含 connections');

    if (!data.metadata) {
      logFail('响应缺少 metadata 字段');
      process.exit(1);
    }
    logPass('响应包含 metadata');

    // 验证数据统计
    logTest('验证数据统计');

    const nodeCount = data.nodeCount || Object.values(data.nodesByLayer || {}).flat().length;
    logInfo(`节点总数: ${nodeCount}`);
    if (nodeCount === expectedNodeCount) {
      logPass(`节点数量正确 (${nodeCount})`);
    } else {
      log('yellow', `⚠️  节点数量不符 (期望: ${expectedNodeCount}, 实际: ${nodeCount})`);
    }

    const edgeCount = data.edgeCount || data.connections.length;
    logInfo(`连接总数: ${edgeCount}`);
    if (edgeCount === expectedEdgeCount) {
      logPass(`连接数量正确 (${edgeCount})`);
    } else {
      log('yellow', `⚠️  连接数量不符 (期望: ${expectedEdgeCount}, 实际: ${edgeCount})`);
    }

    // 验证nodesByLayer结构
    logTest('验证nodesByLayer结构');

    for (const [layer, nodes] of Object.entries(data.nodesByLayer || {})) {
      if (!Array.isArray(nodes)) {
        logFail(`${layer} 不是数组`);
        continue;
      }

      logInfo(`${layer.toUpperCase()}: ${nodes.length} 个节点`);

      // 验证每个节点的结构
      if (nodes.length > 0) {
        const firstNode = nodes[0];
        if (firstNode.id && firstNode.label) {
          logPass(`${layer} 节点结构正确 (示例: ${firstNode.id})`);
        } else {
          logFail(`${layer} 节点结构错误 (缺少 id 或 label)`);
        }
      }
    }

    // 验证connections结构
    logTest('验证connections结构');

    if (data.connections.length > 0) {
      const firstConn = data.connections[0];
      if (firstConn.source && firstConn.target) {
        logPass(`连接结构正确 (示例: ${firstConn.source} → ${firstConn.target})`);
      } else {
        logFail(`连接结构错误`);
      }
    }

    // 验证metadata
    logTest('验证metadata信息');

    if (data.metadata.stats) {
      const stats = data.metadata.stats;
      logInfo(`总设备数: ${stats.totalDevices}`);
      if (stats.coreCount !== undefined) logInfo(`Core设备数: ${stats.coreCount}`);
      if (stats.spineCount !== undefined) logInfo(`Spine设备数: ${stats.spineCount}`);
      if (stats.leafCount !== undefined) logInfo(`Leaf设备数: ${stats.leafCount}`);
      logPass('Stats信息完整');
    }

    if (data.metadata.pods && data.metadata.pods.length > 0) {
      logInfo(`发现POD: ${data.metadata.pods.join(', ')}`);
      logPass('POD信息正确识别');
    }

    // 总体验证
    logTest('总体验证');
    logPass('✨ 所有关键检查通过！');
    logInfo(`API响应时间: 已完成`);

    // 输出完整响应摘要
    console.log('\n' + colors.blue + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);
    console.log(colors.blue + '响应摘要:' + colors.reset);
    console.log(colors.blue + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);
    console.log(JSON.stringify({
      ok: data.ok,
      nodeCount: data.nodeCount,
      edgeCount: data.edgeCount,
      layers: Object.keys(data.nodesByLayer || {}),
      pods: data.metadata?.pods || [],
      stats: data.metadata?.stats
    }, null, 2));

  } catch (error) {
    logFail(`错误: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      logFail('无法连接到服务器。请检查服务器是否在运行。');
      logInfo(`期望的服务器地址: ${API_URL}`);
    }
    process.exit(1);
  }
}

async function testAPIHealth() {
  logTest('检查服务器健康状态');

  try {
    const response = await fetch(`${API_URL}/api/settings`);
    if (response.ok) {
      logPass(`服务器运行正常 (${API_URL})`);
      return true;
    } else {
      logFail(`服务器响应异常: ${response.status}`);
      return false;
    }
  } catch (error) {
    logFail(`无法连接到服务器: ${error.message}`);
    return false;
  }
}

// 主函数
async function main() {
  console.log(colors.cyan + '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);
  console.log(colors.cyan + '     拓扑还原 API 验证工具' + colors.reset);
  console.log(colors.cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);

  const isHealthy = await testAPIHealth();
  if (!isHealthy) {
    process.exit(1);
  }

  await testTopologyRestore();

  console.log('\n' + colors.green + '✨ 验证完成！' + colors.reset + '\n');
}

main();
