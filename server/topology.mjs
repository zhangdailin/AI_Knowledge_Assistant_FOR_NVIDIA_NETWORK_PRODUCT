/**
 * 通用CLOS拓扑解析框架
 * 支持多种命名规则和网络类型
 */

/**
 * 自动识别设备层级（基于拓扑度数）
 * Core层: 度数最低，连接度最高（>20）
 * Spine层: 度数中等（8-20）
 * Leaf层: 度数最高（<8）
 */
export function autoDetectLayers(portMap) {
  const degreeMap = new Map(); // device -> degree count
  const deviceSet = new Set();

  // 计算每个设备的度数
  for (const [key, val] of portMap) {
    const [sys] = key.split('|');
    const { peer } = val;
    deviceSet.add(sys);
    deviceSet.add(peer);
    degreeMap.set(sys, (degreeMap.get(sys) || 0) + 1);
    degreeMap.set(peer, (degreeMap.get(peer) || 0) + 1);
  }

  const devices = Array.from(deviceSet);
  const degrees = Array.from(degreeMap.values()).sort((a, b) => a - b);
  const avgDegree = degrees.reduce((a, b) => a + b, 0) / degrees.length;

  // 分类设备
  const layers = { core: [], spine: [], leaf: [] };
  for (const device of devices) {
    const degree = degreeMap.get(device);
    if (degree > avgDegree * 1.5) {
      layers.core.push(device);
    } else if (degree > avgDegree * 0.8) {
      layers.spine.push(device);
    } else {
      layers.leaf.push(device);
    }
  }

  // 如果自动识别失败，降级处理
  if (layers.core.length === 0) {
    const sorted = devices.sort((a, b) => degreeMap.get(b) - degreeMap.get(a));
    const coreCount = Math.max(1, Math.ceil(sorted.length * 0.05)); // 5%
    const spineCount = Math.max(1, Math.ceil(sorted.length * 0.25)); // 25%
    layers.core = sorted.slice(0, coreCount);
    layers.spine = sorted.slice(coreCount, coreCount + spineCount);
    layers.leaf = sorted.slice(coreCount + spineCount);
  }

  return {
    layers,
    degreeMap,
    detection: 'auto',
    stats: {
      totalDevices: devices.length,
      coreCount: layers.core.length,
      spineCount: layers.spine.length,
      leafCount: layers.leaf.length,
      avgDegree: avgDegree.toFixed(2)
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
    ? autoDetectLayers(portMap)
    : { layers: manualLayers, detection: 'manual' };

  const { layers, stats } = layerResult;
  const allDevices = [...layers.core, ...layers.spine, ...layers.leaf];

  // 步骤2: 提取POD标识
  const podResult = extractPodIdentifiers(allDevices, podExtraction);
  const { pods, deviceToPod } = podResult;

  // 步骤3: 追溯三层链路
  const chains = traceThreeLayerChains(portMap, layers);

  // 步骤4: 按POD和层级组织节点和边
  const nodesByPod = {};
  const edgesByPod = {};
  const hierarchyEdgesMap = {};  // core-spine, spine-leaf等跨层级边

  for (const pod of pods) {
    nodesByPod[pod] = [];
    edgesByPod[pod] = [];
    if (pod !== 'ALL') {
      hierarchyEdgesMap[pod] = {};
    }
  }

  // 生成节点
  for (const pod of pods) {
    if (pod === 'ALL') {
      // ALL视图包含所有节点
      for (const device of allDevices) {
        const layer = getDeviceLayer(device, layers);
        nodesByPod[pod].push({
          id: device,
          label: device,
          layer,
          pod: 'ALL'
        });
      }
    } else {
      // 单个POD只包含该POD内的设备
      const podDevices = deviceToPod.get(pod) || new Set();
      for (const device of podDevices) {
        const layer = getDeviceLayer(device, layers);
        if (layer) {
          nodesByPod[pod].push({
            id: device,
            label: device,
            layer,
            pod
          });
        }
      }
    }
  }

  // 生成边
  for (const chain of chains) {
    const { deviceA, deviceB, deviceC, portA, portB, portC, layerA, layerB, layerC } = chain;

    // A-B边
    for (const pod of pods) {
      const podDevices = nodesByPod[pod].map(n => n.id);
      if (podDevices.includes(deviceA) && podDevices.includes(deviceB)) {
        edgesByPod[pod].push({
          id: `${deviceA}|${portA}->${deviceB}|${portB}`,
          source: deviceA,
          target: deviceB,
          sourcePort: portA,
          targetPort: portB,
          layer: `${layerA}-${layerB}`
        });
      }
    }

    // B-C边
    for (const pod of pods) {
      const podDevices = nodesByPod[pod].map(n => n.id);
      if (podDevices.includes(deviceB) && podDevices.includes(deviceC)) {
        edgesByPod[pod].push({
          id: `${deviceB}|${portB}->${deviceC}|${portC}`,
          source: deviceB,
          target: deviceC,
          sourcePort: portB,
          targetPort: portC,
          layer: `${layerB}-${layerC}`
        });
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
    const coreDevices = layers.core;

    hierarchyEdgesMap[pod] = {};
    for (const spine of spineDevices) {
      hierarchyEdgesMap[pod][spine] = [];
    }

    // 从chains中提取core-spine边
    for (const chain of chains) {
      if (chain.layerA === 'core' && chain.layerB === 'spine') {
        if (deviceToPod.get(pod)?.has(chain.deviceB)) {
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
    nodes: nodesByPod,
    edges: edgesByPod,
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
    chainsCount: chains.length
  };
}
