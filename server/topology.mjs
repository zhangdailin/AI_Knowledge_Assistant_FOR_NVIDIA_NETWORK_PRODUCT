import { inferLayersFromTopology } from './topology-inference.mjs';

/**
 * 自动识别设备层级 (优先拓扑推断,降级命名检测)
 * 支持多种网络类型:
 *
 * IB 网络（InfiniBand）:
 * - IBCR → Core
 * - IBSP → Spine
 * - IBLF → Leaf
 *
 * RoCE 网络（以太网）:
 * - CSW/CORE → Core
 * - SSW/SPINE → Spine
 * - ASW/ACCESS/LEAF → Leaf
 *
 * 支持自定义模式识别
 */
export function autoDetectLayers(portMap, manualPatterns = null, networkType = 'auto') {
  // 优先级1: 用户手动配置
  if (manualPatterns) {
    console.log('[AutoDetectLayers] 使用用户自定义规则');
    return applyManualPatterns(portMap, manualPatterns);
  }

  const deviceSet = new Set();

  // 收集所有设备
  for (const [key, val] of portMap) {
    const [sys] = key.split('|');
    const { peer } = val;
    deviceSet.add(sys);
    deviceSet.add(peer);
  }

  // 过滤掉 GPU/Compute 节点，只保留网络设备
  const allDevices = Array.from(deviceSet);
  // 使用宽泛的正则匹配计算节点: GPU, Compute, Worker, Node, Host
  // 增加 DGX, H100, A100, SRV 以覆盖更多情况
  const gpuRegex = /GPU|compute|worker|node|host|server|dgx|h100|a100|h800|a800|srv|-n\d+|psnode/i;
  const devices = allDevices.filter(d => !gpuRegex.test(d));

  // IB 网络命名优先：IBCR/IBSP/IBLF 覆盖率足够时，直接采用命名分类
  const ibNameLayers = { core: [], spine: [], leaf: [] };
  for (const device of devices) {
    if (/IBCR/i.test(device)) {
      ibNameLayers.core.push(device);
    } else if (/IBSP/i.test(device)) {
      ibNameLayers.spine.push(device);
    } else if (/IBLF/i.test(device)) {
      ibNameLayers.leaf.push(device);
    }
  }

  const ibMatchedCount = ibNameLayers.core.length + ibNameLayers.spine.length + ibNameLayers.leaf.length;
  const ibCoverage = devices.length > 0 ? ibMatchedCount / devices.length : 0;
  const ibHasAllLayers = ibNameLayers.core.length > 0 && ibNameLayers.spine.length > 0 && ibNameLayers.leaf.length > 0;
  const shouldUseIbName =
    ibCoverage >= 0.6 &&
    ibHasAllLayers &&
    (networkType === 'ib' || (networkType === 'auto' && ibMatchedCount > 0));

  if (shouldUseIbName) {
    console.log(`[AutoDetectLayers] ✅ IB 命名检测生效 (覆盖率: ${(ibCoverage * 100).toFixed(1)}%)`);
    return {
      layers: ibNameLayers,
      detection: 'ib-name',
      stats: {
        totalDevices: devices.length,
        coreCount: ibNameLayers.core.length,
        spineCount: ibNameLayers.spine.length,
        leafCount: ibNameLayers.leaf.length,
        coverage: ibCoverage
      }
    };
  }

  // 优先级2: 拓扑推断 (最可靠,命名无关)
  try {
    const topoResult = inferLayersFromTopology(portMap);
    if (topoResult.confidence >= 0.6) {
      console.log(`[AutoDetectLayers] ✅ 拓扑推断成功 (置信度: ${(topoResult.confidence * 100).toFixed(1)}%)`);
      return {
        layers: topoResult.layers,
        detection: topoResult.method,
        stats: {
          totalDevices: topoResult.stats.totalDevices,
          coreCount: topoResult.layers.core.length,
          spineCount: topoResult.layers.spine.length,
          leafCount: topoResult.layers.leaf.length,
          confidence: topoResult.confidence
        }
      };
    } else {
      console.log(`[AutoDetectLayers] ⚠️  拓扑推断置信度较低 (${(topoResult.confidence * 100).toFixed(1)}%), 降级使用命名检测`);
    }
  } catch (error) {
    console.log('[AutoDetectLayers] 拓扑推断失败:', error.message);
  }

  // 优先级3: 命名规则检测 (降级方案)
  console.log('[AutoDetectLayers] 使用命名规则检测');
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
      const hasRoCEDevices = devices.some(d => /(CSW|SSW|ASW)/i.test(d)); // 修复: 允许CSW/SSW/ASW在任意位置

      detectedType = hasIBDevices ? 'ib' : hasRoCEDevices ? 'roce' : 'roce';
    }

    console.log(`[AutoDetectLayers] 网络类型: ${detectedType}，样本设备: ${devices.slice(0, 3).join(', ')}`);

    // 根据网络类型应用不同的匹配规则
    if (detectedType === 'roce') {
      // RoCE 网络命名规则
      console.log('[AutoDetectLayers] 应用 RoCE 命名规则匹配');

      // 策略1: 标准 RoCE 命名 (CSW/SSW/ASW可能在名称中间,如: MDC-DH1E-POD1-ASW-002)
      const roceCoreDevices = devices.filter(d => /CSW|CORE/i.test(d));
      const roceSpineDevices = devices.filter(d => /SSW|SPINE/i.test(d));
      const roceLeafDevices = devices.filter(d => /ASW|ACCESS|LEAF/i.test(d));

      // 策略2: 基于关键词识别 (用于复杂命名,优先级更低)
      const oobDevices = devices.filter(d => /\bOOB\b|management|ctrl|control/i.test(d));
      const soobDevices = devices.filter(d => /\bSOOB\b|secondary|inter/i.test(d));
      const gpuComputeDevices = devices.filter(d => /GPU|compute|worker|node/i.test(d));

      // 选择更匹配的分类
      if (roceCoreDevices.length > 0 || roceSpineDevices.length > 0 || roceLeafDevices.length > 0) {
        // 标准命名规则优先
        layers.core.push(...roceCoreDevices);
        layers.spine.push(...roceSpineDevices);
        layers.leaf.push(...roceLeafDevices);
        console.log(`[AutoDetectLayers] 使用标准 RoCE 命名: CSW(Core)=${roceCoreDevices.length}, SSW(Spine)=${roceSpineDevices.length}, ASW(Leaf)=${roceLeafDevices.length}`);
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
      // 增强的命名规则检测 (Phase 1: 自适应改进)
      console.log('[AutoDetectLayers] 应用增强命名规则: 支持多种命名模式');

      // 定义多层级关键字模式 (优先级从高到低)
      const patterns = {
        core: [
          /IBCR/i,           // IB Core
          /CORE/i,           // 通用Core
          /CSW/i,            // RoCE Core Switch
          /ROUTER/i,         // 路由器
          /BORDER/i,         // 边界设备
          /GATEWAY/i,        // 网关
          /-CR-/i,           // 命名中包含CR
          /-CORE-/i          // 命名中包含CORE
        ],
        spine: [
          /IBSP/i,           // IB Spine
          /SPINE/i,          // 通用Spine
          /SSW/i,            // RoCE Spine Switch
          /AGG/i,            // 聚合层
          /DIST/i,           // 分布层
          /DISTRIBUTION/i,   // 分布层全称
          /-SP-/i,           // 命名中包含SP
          /-SPINE-/i         // 命名中包含SPINE
        ],
        leaf: [
          /IBLF/i,           // IB Leaf
          /LEAF/i,           // 通用Leaf
          /ASW/i,            // RoCE Access Switch
          /ACCESS/i,         // 接入层
          /TOR/i,            // Top of Rack
          /EDGE/i,           // 边缘设备
          /-LF-/i,           // 命名中包含LF
          /-LEAF-/i          // 命名中包含LEAF
        ]
      };

      // 分类设备
      const unclassified = [];
      for (const device of devices) {
        let classified = false;

        // 尝试Core模式
        if (patterns.core.some(pattern => pattern.test(device))) {
          layers.core.push(device);
          classified = true;
        }
        // 尝试Spine模式
        else if (patterns.spine.some(pattern => pattern.test(device))) {
          layers.spine.push(device);
          classified = true;
        }
        // 尝试Leaf模式
        else if (patterns.leaf.some(pattern => pattern.test(device))) {
          layers.leaf.push(device);
          classified = true;
        }

        if (!classified) {
          unclassified.push(device);
        }
      }

      // 处理未分类设备 (fallback: 基于数量比例推断)
      if (unclassified.length > 0) {
        console.log(`[AutoDetectLayers] 发现 ${unclassified.length} 个未分类设备，应用启发式分配`);

        // 如果有明确的Spine/Leaf,未分类设备倾向于Leaf
        if (layers.spine.length > 0 || layers.leaf.length > 0) {
          layers.leaf.push(...unclassified);
          console.log(`[AutoDetectLayers] 未分类设备归为Leaf (${unclassified.length}个)`);
        } else {
          // 全部未分类: 按比例分配
          const totalUnclass = unclassified.length;
          if (totalUnclass <= 5) {
            layers.leaf.push(...unclassified);
          } else {
            const coreCount = Math.max(1, Math.ceil(totalUnclass / 6));
            const spineCount = Math.max(1, Math.ceil(totalUnclass / 3));
            layers.core.push(...unclassified.slice(0, coreCount));
            layers.spine.push(...unclassified.slice(coreCount, coreCount + spineCount));
            layers.leaf.push(...unclassified.slice(coreCount + spineCount));
            console.log(`[AutoDetectLayers] 按比例分配未分类设备: Core=${coreCount}, Spine=${spineCount}, Leaf=${totalUnclass - coreCount - spineCount}`);
          }
        }
      }

      console.log(`[AutoDetectLayers] 检测完成: Core=${layers.core.length}, Spine=${layers.spine.length}, Leaf=${layers.leaf.length}`);
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
  const deviceToPods = new Map(); // device -> Set<pod>
  const podToDevices = new Map(); // pod -> Set<device>
  podToDevices.set('ALL', new Set(devices));
  for (const device of devices) {
    deviceToPods.set(device, new Set(['ALL']));
  }

  if (method === 'none') {
    return { pods: Array.from(pods), deviceToPods, podToDevices };
  }

  if (method === 'regex') {
    const regex = new RegExp(pattern, 'i');
    for (const device of devices) {
      const match = device.match(regex);
      if (match) {
        const pod = match[0].toUpperCase();
        pods.add(pod);
        if (!podToDevices.has(pod)) podToDevices.set(pod, new Set());
        podToDevices.get(pod).add(device);
        deviceToPods.get(device).add(pod);
      }
    }
  } else if (method === 'prefix') {
    for (const device of devices) {
      const parts = device.split(delimiter);
      if (parts.length > prefixLength) {
        const pod = parts.slice(0, prefixLength).join(delimiter).toUpperCase();
        pods.add(pod);
        if (!podToDevices.has(pod)) podToDevices.set(pod, new Set());
        podToDevices.get(pod).add(device);
        deviceToPods.get(device).add(pod);
      }
    }
  }

  // 为ALL添加所有设备
  podToDevices.set('ALL', new Set(devices));

  return {
    pods: Array.from(pods).sort((a, b) => {
      if (a === 'ALL') return -1;
      if (b === 'ALL') return 1;
      return a.localeCompare(b);
    }),
    deviceToPods,
    podToDevices
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
  const { pods, deviceToPods, podToDevices } = podResult;

  // 步骤3: 按层级组织节点，保持POD信息用于前端过滤
  const nodesByLayer = {};
  const allNodesList = [];

  // 确保 'unknown' 层的设备也被收集，默认归类为 'leaf' 以防止丢失
  if (layers.unknown && layers.unknown.length > 0) {
    console.log(`[BuildTopology] Found ${layers.unknown.length} unknown devices, merging to Leaf layer.`);
    layers.leaf.push(...layers.unknown);
  }

  // 组织节点：按层级分组，但保留POD信息
  // 仅包括存在的层级
  for (const layer of ['core', 'spine', 'leaf']) {
    if (!layers[layer] || layers[layer].length === 0) continue;

    nodesByLayer[layer] = [];

    for (const device of layers[layer]) {
      const podSet = deviceToPods.get(device) || new Set(['ALL']);
      const pod = Array.from(podSet).find(p => p !== 'ALL') || 'ALL';

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

  // 步骤3b: 按POD组织边
  const edgesByPod = {};
  const hierarchyEdgesMap = {};
  const allEdges = [];
  const seenEdges = new Set();

  for (const pod of pods) {
    edgesByPod[pod] = [];
    if (pod !== 'ALL') {
      hierarchyEdgesMap[pod] = {};
    }
  }

  for (const [key, val] of portMap) {
    const [sys, port] = key.split('|');
    const { peer, peerPort } = val;
    if (!sys || !peer) continue;

    const edgeKey = [`${sys}|${port}`, `${peer}|${peerPort}`].sort().join('<->');
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);

    const layerA = getDeviceLayer(sys, layers) || 'unknown';
    const layerB = getDeviceLayer(peer, layers) || 'unknown';

    const edge = {
      id: `${sys}|${port}->${peer}|${peerPort}`,
      source: sys,
      target: peer,
      srcPort: port,
      dstPort: peerPort,
      sourcePort: port,
      targetPort: peerPort,
      layer: `${layerA}-${layerB}`
    };

    allEdges.push(edge);

    for (const pod of pods) {
      const podDevices = podToDevices.get(pod);
      const inSamePod = pod === 'ALL' || (podDevices?.has(sys) && podDevices?.has(peer));
      if (!inSamePod) continue;

      edgesByPod[pod].push(edge);

      if (pod !== 'ALL') {
        const isCoreSpine =
          (layerA === 'core' && layerB === 'spine') ||
          (layerA === 'spine' && layerB === 'core');
        if (isCoreSpine) {
          const spine = layerA === 'spine' ? sys : peer;
          if (!hierarchyEdgesMap[pod][spine]) hierarchyEdgesMap[pod][spine] = [];
          hierarchyEdgesMap[pod][spine].push({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourcePort: edge.srcPort,
            targetPort: edge.dstPort
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
    connections: allEdges,  // 全量连接（去重）
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
    chainsCount: allEdges.length,
    nodeCount: allNodesList.length,
    edgeCount: allEdges.length
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
