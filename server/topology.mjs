/**
 * 通用CLOS拓扑解析框架
 * 支持多种命名规则和网络类型
 */

/**
 * 自动识别设备层级（基于设备名称匹配）
 * 简单直接的方法：
 * - IBCR → Core
 * - IBSP → Spine
 * - IBLF → Leaf
 *
 * 支持自定义模式识别
 */
export function autoDetectLayers(portMap, manualPatterns = null) {
  const deviceSet = new Set();

  // 收集所有设备
  for (const [key, val] of portMap) {
    const [sys] = key.split('|');
    const { peer } = val;
    deviceSet.add(sys);
    deviceSet.add(peer);
  }

  const devices = Array.from(deviceSet);
  const layers = { core: [], spine: [], leaf: [] };

  // 如果提供了自定义模式，使用自定义模式
  if (manualPatterns && manualPatterns.corePattern) {
    const coreRegex = new RegExp(manualPatterns.corePattern, 'i');
    const spineRegex = new RegExp(manualPatterns.spinePattern || 'IBSP', 'i');
    const leafRegex = new RegExp(manualPatterns.leafPattern || 'IBLF', 'i');

    for (const device of devices) {
      if (coreRegex.test(device)) {
        layers.core.push(device);
      } else if (spineRegex.test(device)) {
        layers.spine.push(device);
      } else if (leafRegex.test(device)) {
        layers.leaf.push(device);
      }
    }
  } else {
    // 使用默认的简单名称匹配（参考参考项目的方法）
    for (const device of devices) {
      if (device.includes('IBCR')) {
        layers.core.push(device);
      } else if (device.includes('IBSP')) {
        layers.spine.push(device);
      } else if (device.includes('IBLF')) {
        layers.leaf.push(device);
      }
    }
  }

  // 排序使结果一致
  layers.core.sort();
  layers.spine.sort();
  layers.leaf.sort();

  return {
    layers,
    detection: 'auto',
    stats: {
      totalDevices: devices.length,
      coreCount: layers.core.length,
      spineCount: layers.spine.length,
      leafCount: layers.leaf.length,
      avgDegree: (devices.length > 0 ? 'N/A' : 'unknown')
    }
  };
}

/**
 * 提取POD标识（支持多种规则）
 */
export function extractPodIdentifiers(devices, config = {}) {
  const {
    method = 'regex',        // 'regex' | 'prefix' | 'none'
    pattern = 'POD\\d+',     // 正则表达式
    prefixLength = 0,        // 前缀长度
    delimiter = '-'          // 分隔符
  } = config;

  const pods = new Set(['ALL']);  // 始终包含ALL
  const deviceToPod = new Map();
  deviceToPod.set('ALL', new Set(devices));

  if (method === 'none') {
    return { pods: Array.from(pods), deviceToPod };
  }

  if (method === 'regex') {
    const regex = new RegExp(pattern, 'i');
    for (const device of devices) {
      const match = device.match(regex);
      if (match) {
        const pod = match[0].toUpperCase();
        pods.add(pod);
        if (!deviceToPod.has(pod)) deviceToPod.set(pod, new Set());
        deviceToPod.get(pod).add(device);
      }
    }
  } else if (method === 'prefix') {
    for (const device of devices) {
      const parts = device.split(delimiter);
      if (parts.length > prefixLength) {
        const pod = parts.slice(0, prefixLength).join(delimiter).toUpperCase();
        pods.add(pod);
        if (!deviceToPod.has(pod)) deviceToPod.set(pod, new Set());
        deviceToPod.get(pod).add(device);
      }
    }
  }

  // 为ALL添加所有设备
  deviceToPod.set('ALL', new Set(devices));

  return {
    pods: Array.from(pods).sort((a, b) => {
      if (a === 'ALL') return -1;
      if (b === 'ALL') return 1;
      return a.localeCompare(b);
    }),
    deviceToPod
  };
}

/**
 * 追溯三层链路（A -> B -> C）
 */
export function traceThreeLayerChains(portMap, layers) {
  const chains = [];
  const edgeSet = new Set();  // 去重

  // 遍历所有连接，查找三层链路
  for (const [key, val] of portMap) {
    const [sysA, portA] = key.split('|');
    const { peer: sysB, peerPort: portB } = val;

    // 查找B的下一跳C
    const bKey = `${sysB}|${portB}`;
    if (portMap.has(bKey)) {
      const { peer: sysC, peerPort: portC } = portMap.get(bKey);

      const layerA = getDeviceLayer(sysA, layers);
      const layerB = getDeviceLayer(sysB, layers);
      const layerC = getDeviceLayer(sysC, layers);

      // 记录三层链路
      if (layerA && layerB && layerC) {
        chains.push({
          deviceA: sysA,
          deviceB: sysB,
          deviceC: sysC,
          portA,
          portB,
          portC,
          layerA,
          layerB,
          layerC
        });

        // 记录边（去重）
        const edge1 = [sysA, sysB].sort().join('|');
        const edge2 = [sysB, sysC].sort().join('|');
        if (!edgeSet.has(edge1)) {
          edgeSet.add(edge1);
        }
        if (!edgeSet.has(edge2)) {
          edgeSet.add(edge2);
        }
      }
    }
  }

  return chains;
}

/**
 * 获取设备所属层级
 */
export function getDeviceLayer(device, layers) {
  if (layers.core.includes(device)) return 'core';
  if (layers.spine.includes(device)) return 'spine';
  if (layers.leaf.includes(device)) return 'leaf';
  return null;
}

/**
 * 构建完整的拓扑数据结构
 */
export function buildTopologyStructure(portMap, config = {}) {
  const {
    layerDetection = 'auto',
    manualLayers = null,
    podExtraction = { method: 'regex', pattern: 'POD\\d+' }
  } = config;

  // 步骤1: 识别层级
  const layerResult = layerDetection === 'auto'
    ? autoDetectLayers(portMap, null)
    : autoDetectLayers(portMap, manualLayers);

  const { layers, stats } = layerResult;

  // 处理没有 Core 层的情况（两层或三层组网）
  const hasCore = layers.core && layers.core.length > 0;
  const allDevices = [
    ...(layers.core || []),
    ...(layers.spine || []),
    ...(layers.leaf || [])
  ];

  // 步骤2: 提取POD标识
  const podResult = extractPodIdentifiers(allDevices, podExtraction);
  const { pods, deviceToPod } = podResult;

  // 步骤3: 追溯三层链路
  const chains = traceThreeLayerChains(portMap, layers);

  // 步骤4: 按层级组织节点，保持POD信息用于前端过滤
  const nodesByLayer = {};
  const allNodesList = [];

  // 组织节点：按层级分组，但保留POD信息
  // 仅包括存在的层级
  for (const layer of ['core', 'spine', 'leaf']) {
    if (!layers[layer] || layers[layer].length === 0) continue;

    nodesByLayer[layer] = [];

    for (const device of layers[layer]) {
      const podSet = deviceToPod.get(device) || new Set();
      const pod = podSet.size > 0 ? Array.from(podSet)[0] : 'ALL';

      const node = {
        id: device,
        label: device,
        layer,
        pod,
        x: 0,  // 占位符，实际坐标由前端决定
        y: 0
      };

      nodesByLayer[layer].push(node);
      allNodesList.push(node);
    }
  }

  // 步骤4b: 按POD组织边
  const edgesByPod = {};
  const hierarchyEdgesMap = {};  // core-spine, spine-leaf等跨层级边

  for (const pod of pods) {
    edgesByPod[pod] = [];
    if (pod !== 'ALL') {
      hierarchyEdgesMap[pod] = {};
    }
  }

  // 生成边
  for (const chain of chains) {
    const { deviceA, deviceB, deviceC, portA, portB, portC, layerA, layerB, layerC } = chain;

    // A-B边
    const edgeAB = {
      id: `${deviceA}|${portA}->${deviceB}|${portB}`,
      source: deviceA,
      target: deviceB,
      srcPort: portA,
      dstPort: portB,
      sourcePort: portA,
      targetPort: portB,
      layer: `${layerA}-${layerB}`
    };

    // B-C边
    const edgeBC = {
      id: `${deviceB}|${portB}->${deviceC}|${portC}`,
      source: deviceB,
      target: deviceC,
      srcPort: portB,
      dstPort: portC,
      sourcePort: portB,
      targetPort: portC,
      layer: `${layerB}-${layerC}`
    };

    // 添加到所有POD的边集合
    for (const pod of pods) {
      // 检查AB设备是否都在这个POD中
      const deviceAPod = deviceToPod.get(deviceA)?.has(pod) || pod === 'ALL';
      const deviceBPod = deviceToPod.get(deviceB)?.has(pod) || pod === 'ALL';
      if (deviceAPod && deviceBPod) {
        edgesByPod[pod].push(edgeAB);
      }

      // 检查BC设备是否都在这个POD中
      const deviceCPod = deviceToPod.get(deviceC)?.has(pod) || pod === 'ALL';
      if (deviceBPod && deviceCPod) {
        edgesByPod[pod].push(edgeBC);
      }
    }
  }

  // 去重边
  for (const pod of pods) {
    const seen = new Set();
    edgesByPod[pod] = edgesByPod[pod].filter(edge => {
      const key = [edge.source, edge.target].sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // 提取跨层级边（用于动态加载）
  for (const pod of Object.keys(pods).filter(p => p !== 'ALL')) {
    const spineDevices = layers.spine.filter(d => deviceToPod.get(pod)?.has(d));

    hierarchyEdgesMap[pod] = {};
    for (const spine of spineDevices) {
      hierarchyEdgesMap[pod][spine] = [];
    }

    // 从chains中提取core-spine边
    for (const chain of chains) {
      if (chain.layerA === 'core' && chain.layerB === 'spine') {
        if (deviceToPod.get(chain.deviceB)?.has(pod)) {
          hierarchyEdgesMap[pod][chain.deviceB] = hierarchyEdgesMap[pod][chain.deviceB] || [];
          hierarchyEdgesMap[pod][chain.deviceB].push({
            id: `${chain.deviceA}|${chain.portA}->${chain.deviceB}|${chain.portB}`,
            source: chain.deviceA,
            target: chain.deviceB,
            sourcePort: chain.portA,
            targetPort: chain.portB
          });
        }
      }
    }
  }

  return {
    success: true,
    nodesByLayer: nodesByLayer,    // 按网络层分组的节点，前端用于渲染
    nodes: nodesByLayer,            // 同时返回新名称兼容
    connections: Object.values(edgesByPod).flat(),  // 展平所有边供前端使用
    edges: edgesByPod,            // 按POD分组的边
    hierarchyEdges: hierarchyEdgesMap,
    metadata: {
      layerDetection: layerDetection,
      layers: {
        core: layers.core,
        spine: layers.spine,
        leaf: layers.leaf
      },
      pods,
      coreDevices: layers.core,
      stats
    },
    chainsCount: chains.length,
    nodeCount: allNodesList.length,
    edgeCount: Object.values(edgesByPod).flat().length
  };
}
