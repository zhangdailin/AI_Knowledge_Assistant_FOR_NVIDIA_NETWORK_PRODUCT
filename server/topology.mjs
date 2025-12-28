/**
 * 通用CLOS拓扑解析框架
 * 支持多种命名规则和网络类型
 */

/**
 * 自动识别设备层级（基于设备名称匹配）
 * 支持多种网络类型：
 *
 * IB 网络（InfiniBand）：
 * - IBCR → Core
 * - IBSP → Spine
 * - IBLF → Leaf
 *
 * RoCE 网络（以太网）：
 * - CSW/CORE → Core
 * - SSW/SPINE → Spine
 * - ASW/ACCESS/LEAF → Leaf
 *
 * 支持自定义模式识别
 */
export function autoDetectLayers(portMap, manualPatterns = null, networkType = 'auto') {
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
    const spineRegex = new RegExp(manualPatterns.spinePattern || 'SPINE', 'i');
    const leafRegex = new RegExp(manualPatterns.leafPattern || 'LEAF', 'i');

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
    // 自动检测网络类型（基于设备名称）
    let detectedType = networkType;
    if (detectedType === 'auto') {
      const hasIBDevices = devices.some(d => d.includes('IB'));
      const hasRoCEDevices = devices.some(d => /^(CSW|SSW|ASW)/i.test(d));

      detectedType = hasIBDevices ? 'ib' : hasRoCEDevices ? 'roce' : 'roce';
    }

    console.log(`[AutoDetectLayers] 网络类型: ${detectedType}，样本设备: ${devices.slice(0, 3).join(', ')}`);

    // 根据网络类型应用不同的匹配规则
    if (detectedType === 'roce') {
      // RoCE 网络命名规则
      console.log('[AutoDetectLayers] 应用 RoCE 命名规则匹配');

      // 策略1：标准 RoCE 命名（CSW/SSW/ASW）
      const roceCoreDevices = devices.filter(d => /^CSW|CORE/i.test(d));
      const roceSpineDevices = devices.filter(d => /^SSW|SPINE/i.test(d));
      const roceLeafDevices = devices.filter(d => /^ASW|ACCESS|LEAF/i.test(d));

      // 策略2：基于关键词识别（用于复杂命名）
      const oobDevices = devices.filter(d => /OOB|management|ctrl|control/i.test(d));
      const gpuComputeDevices = devices.filter(d => /GPU|compute|worker|node/i.test(d));
      const soobDevices = devices.filter(d => /SOOB|secondary|inter/i.test(d));

      // 选择更匹配的分类
      if (roceCoreDevices.length > 0 || roceSpineDevices.length > 0 || roceLeafDevices.length > 0) {
        // 标准命名规则
        layers.core.push(...roceCoreDevices);
        layers.spine.push(...roceSpineDevices);
        layers.leaf.push(...roceLeafDevices);
        console.log('[AutoDetectLayers] 使用标准 RoCE 命名规则');
      } else if (oobDevices.length > 0) {
        // 基于关键词的规则
        // OOB 通常是管理设备（Core）
        layers.core.push(...oobDevices);
        // GPU/Compute 是计算节点（Leaf）
        layers.leaf.push(...gpuComputeDevices);
        // SOOB/Secondary 是辅助管理（Spine）
        layers.spine.push(...soobDevices);
        // 其他设备作为 Spine（交换机等）
        const otherDevices = devices.filter(d =>
          !oobDevices.includes(d) &&
          !gpuComputeDevices.includes(d) &&
          !soobDevices.includes(d)
        );
        layers.spine.push(...otherDevices);
        console.log(`[AutoDetectLayers] 使用关键词规则: OOB(Core)=${layers.core.length}, Spine=${layers.spine.length}, GPU(Leaf)=${layers.leaf.length}`);
      } else if (gpuComputeDevices.length > 0) {
        // 只有 GPU/Compute 设备时
        layers.leaf.push(...gpuComputeDevices);
        const otherDevices = devices.filter(d => !gpuComputeDevices.includes(d));
        layers.spine.push(...otherDevices);
        console.log(`[AutoDetectLayers] 基于 GPU 分类: Spine=${layers.spine.length}, Leaf=${layers.leaf.length}`);
      } else {
        // 兜底方案：按设备名模式分类，或平均分配
        if (devices.length < 20) {
          // 小规模拓扑：全部分为 leaf
          layers.leaf.push(...devices);
          console.log('[AutoDetectLayers] 小规模拓扑，全部设备分为 Leaf');
        } else {
          // 大规模拓扑：按比例分配（1/3 core, 1/3 spine, 1/3 leaf）
          const coreCount = Math.max(1, Math.ceil(devices.length / 6));
          const spineCount = Math.max(1, Math.ceil(devices.length / 3));
          const leafCount = devices.length - coreCount - spineCount;

          layers.core.push(...devices.slice(0, coreCount));
          layers.spine.push(...devices.slice(coreCount, coreCount + spineCount));
          layers.leaf.push(...devices.slice(coreCount + spineCount));
          console.log(`[AutoDetectLayers] 按比例分配: Core=${layers.core.length}, Spine=${layers.spine.length}, Leaf=${layers.leaf.length}`);
        }
      }
    } else {
      // IB 网络命名规则（默认）
      console.log('[AutoDetectLayers] 应用 IB 命名规则: IBCR/CORE→Core, IBSP/SPINE→Spine, IBLF/LEAF→Leaf');
      for (const device of devices) {
        if (device.includes('IBCR') || device.includes('CORE')) {
          layers.core.push(device);
        } else if (device.includes('IBSP') || device.includes('SPINE')) {
          layers.spine.push(device);
        } else if (device.includes('IBLF') || device.includes('LEAF')) {
          layers.leaf.push(device);
        }
      }
    }

    console.log(`[AutoDetectLayers] 检测结果: Core=${layers.core.length}, Spine=${layers.spine.length}, Leaf=${layers.leaf.length}`);
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
 * 优化：支持单向链路，自动补全反向映射
 */
export function traceThreeLayerChains(portMap, layers) {
  const chains = [];
  const edgeSet = new Set();  // 去重

  // 首先建立反向链路映射（处理单向链接）
  const completePortMap = new Map(portMap);
  for (const [key, val] of portMap) {
    const [sysA, portA] = key.split('|');
    const { peer: sysB, peerPort: portB } = val;

    // 检查反向链接是否存在
    const reverseKey = `${sysB}|${portB}`;
    if (!completePortMap.has(reverseKey)) {
      // 添加反向映射
      completePortMap.set(reverseKey, { peer: sysA, peerPort: portA });
    }
  }

  console.log(`[TraceChains] 原始端口映射: ${portMap.size}, 完成后: ${completePortMap.size}`);

  // 遍历所有连接，查找三层链路
  for (const [key, val] of completePortMap) {
    const [sysA, portA] = key.split('|');
    const { peer: sysB, peerPort: portB } = val;

    // 查找 B 的下一跳 C
    const bKey = `${sysB}|${portB}`;
    if (completePortMap.has(bKey)) {
      const { peer: sysC, peerPort: portC } = completePortMap.get(bKey);

      const layerA = getDeviceLayer(sysA, layers);
      const layerB = getDeviceLayer(sysB, layers);
      const layerC = getDeviceLayer(sysC, layers);

      // 记录三层链路（即使设备未被分类，也记录）
      if (layerA || layerB || layerC) {
        chains.push({
          deviceA: sysA,
          deviceB: sysB,
          deviceC: sysC,
          portA,
          portB,
          portC,
          layerA: layerA || 'unknown',
          layerB: layerB || 'unknown',
          layerC: layerC || 'unknown'
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

  console.log(`[TraceChains] 找到 ${chains.length} 条三层链路，${edgeSet.size} 条边`);

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
    podExtraction = { method: 'regex', pattern: 'POD\\d+' },
    networkType = 'auto'  // 新增：网络类型参数
  } = config;

  // 步骤1: 识别层级
  const layerResult = layerDetection === 'auto'
    ? autoDetectLayers(portMap, null, networkType)  // 传递 networkType
    : autoDetectLayers(portMap, manualLayers, networkType);

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

  // 步骤4c: 预计算布局坐标
  calculateLayoutPositions(nodesByLayer);

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

/**
 * 预计算节点布局坐标
 * 减少前端计算压力，确保布局一致性
 */
function calculateLayoutPositions(nodesByLayer) {
  const layerYPositions = {
    core: 0,
    spine: 300,
    leaf: 600
  };

  const layerXGaps = {
    core: 200,
    spine: 150,
    leaf: 120
  };

  // 计算每层的宽度，用于居中对齐
  const layerWidths = {};
  let maxLayerWidth = 0;

  for (const [layer, nodes] of Object.entries(nodesByLayer)) {
    const xGap = layerXGaps[layer] || 150;
    const width = Math.max(0, (nodes.length - 1) * xGap);
    layerWidths[layer] = width;
    maxLayerWidth = Math.max(maxLayerWidth, width);
  }

  const centerX = maxLayerWidth / 2;

  // 为每个节点分配坐标
  for (const [layer, nodes] of Object.entries(nodesByLayer)) {
    const yPos = layerYPositions[layer] || 0;
    const xGap = layerXGaps[layer] || 150;

    // 计算该层的起始 X 坐标（使其居中）
    const startX = centerX - (layerWidths[layer] / 2);

    nodes.forEach((node, index) => {
      node.position = {
        x: Math.round(startX + index * xGap),
        y: yPos
      };
      // 同时也保留 x, y 字段兼容旧逻辑（如果有的话）
      node.x = node.position.x;
      node.y = node.position.y;
    });
  }
}
