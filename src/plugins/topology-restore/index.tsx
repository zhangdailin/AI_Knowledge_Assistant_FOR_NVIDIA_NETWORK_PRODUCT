import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
  MiniMap,
  ReactFlowInstance
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Search, Upload, RefreshCw, Layers, Zap } from 'lucide-react';
import { bundleEdges, collapseBundle, expandBundle } from '../../utils/edge-bundling';
import CytoscapeTopology from './CytoscapeTopology';
import { getApiServerUrl } from '../../utils/apiUtils';

type NetworkType = 'ib' | 'roce';


const layerColors: Record<string, string> = {
  core: '#e74c3c', spine: '#3498db', leaf: '#27ae60',
  csw: '#d62728', ssw: '#1f77b4', asw: '#2ca02c',
  oob: '#ffcc00', soob: '#8000ff', lsw: '#ff6b35',
  other: '#7f7f7f', unknown: '#95a5a6'
};

const getNodeStyle = (layer: string) => {
  const color = layerColors[layer] || layerColors.unknown;
  return {
    background: color,
    color: layer === 'oob' ? '#333' : 'white',
    border: `2px solid ${color}`,
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '9px',
    fontWeight: '600' as const,
    minWidth: '100px',
    textAlign: 'center' as const,
  };
};

const getHandlePositions = (layer: string, nodeId?: string) => {
  const normalized = layer.toLowerCase();
  const idUpper = (nodeId || '').toUpperCase();
  const isCore = normalized === 'core' || normalized === 'csw' || normalized.includes('core') || idUpper.includes('IBCR') || idUpper.includes('CSW');
  const isSpine = normalized === 'spine' || normalized === 'ssw' || normalized.includes('spine') || idUpper.includes('IBSP') || idUpper.includes('SSW');
  const isLeaf = normalized === 'leaf' || normalized === 'asw' || normalized === 'lsw' || normalized.includes('leaf') || idUpper.includes('IBLF') || idUpper.includes('ASW') || idUpper.includes('LSW');
  if (isCore) {
    return { sourcePosition: Position.Bottom, targetPosition: Position.Bottom };
  }
  if (isSpine) {
    return { sourcePosition: Position.Top, targetPosition: Position.Bottom };
  }
  if (isLeaf) {
    return { sourcePosition: Position.Top, targetPosition: Position.Top };
  }
  return {};
};

type LayerDetectionMethod = 'auto' | 'manual';
type PodExtractionMethod = 'regex' | 'prefix' | 'none';

interface TopologyConfig {
  layerDetection: LayerDetectionMethod;
  manualLayers?: {
    corePattern?: string;
    spinePattern?: string;
    leafPattern?: string;
  };
  podExtraction: {
    method: PodExtractionMethod;
    pattern?: string;
    prefixLength?: number;
  };
}

// 层级标签本地化: RoCE显示CSW/SSW/ASW, IB显示Core/Spine/Leaf
const getLayerLabel = (layer: string, networkType: NetworkType = 'ib'): string => {
  if (networkType === 'roce') {
    const roceLabels: Record<string, string> = {
      core: 'CSW',
      spine: 'SSW',
      leaf: 'ASW',
      podAggregate: 'POD'
    };
    return roceLabels[layer] || layer.toUpperCase();
  }
  // IB或其他网络类型
  return layer.charAt(0).toUpperCase() + layer.slice(1);
};

const getRailFromId = (id: string): string | null => {
  const match = id.match(/(?:^|[-_])(?:RAIL|R|Plane|P)[-_ ]*(\d+)(?:[-_]|$)/i);
  if (!match) return null;
  return String(parseInt(match[1], 10));
};

const TopologyRestoreTool: React.FC = () => {
  const [networkType, setNetworkType] = useState<NetworkType>('ib');
  const [file, setFile] = useState<File | null>(null);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const [pods, setPods] = useState<string[]>([]);
  const [selectedPod, setSelectedPod] = useState<string>('');
  const [rails, setRails] = useState<string[]>([]);
  const [selectedRail, setSelectedRail] = useState<string>('');
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [renderMode, setRenderMode] = useState<'reactflow' | 'cytoscape' | 'virtual-reactflow'>('reactflow');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [lazyMode, setLazyMode] = useState(false);
  const [loadedPods, setLoadedPods] = useState<Set<string>>(new Set());

  // 边聚合配置
  const [enableEdgeBundling, setEnableEdgeBundling] = useState(true);
  const [edgeBundlingThreshold, setEdgeBundlingThreshold] = useState(5);
  const bundleMapRef = useRef<Map<string, any>>(new Map());
  const expandedBundlesRef = useRef<Set<string>>(new Set());

  // Configuration: keep topology detection smart and minimal
  const config: TopologyConfig = {
    layerDetection: 'auto',
    podExtraction: { method: 'regex', pattern: 'POD\\d+' }
  };
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedNodeInfo, setSelectedNodeInfo] = useState<any>(null);
  const [selectedEdgeInfo, setSelectedEdgeInfo] = useState<any>(null);
  const [activeCoreFilter, setActiveCoreFilter] = useState<string[] | null>(null); // Core 节点过滤器
  const [focusedSpineId, setFocusedSpineId] = useState<string | null>(null);

  // Phase 2: LOD System State
  const [collapsedPods, setCollapsedPods] = useState<Set<string>>(new Set());
  const [focusedPod, setFocusedPod] = useState<string | null>(null);
  const [viewLevel, setViewLevel] = useState<'overview' | 'group' | 'detail'>('group'); // Default to 'group' for backward compat
  const railRequired = networkType === 'ib' && rails.length > 0;
  const podRequired = pods.length > 0;
  const selectionTargets = [
    podRequired ? 'POD' : null,
    railRequired ? 'Rail' : null
  ].filter(Boolean).join(' 和 ');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);

  // 缓存节点 ID 到 Layer 的映射，用于快速查找对端设备层级
  const nodeLayerMap = useMemo(() => {
    const map = new Map<string, string>();
    if (restoreResult?.nodesByLayer) {
      Object.entries(restoreResult.nodesByLayer).forEach(([layer, layerNodes]: [string, any[]]) => {
        layerNodes.forEach(n => map.set(n.id, layer));
      });
    }
    return map;
  }, [restoreResult]);

  const applyViewLevel = useCallback((level: 'overview' | 'group' | 'detail') => {
    setViewLevel(level);
    if (level === 'overview') {
      setCollapsedPods(new Set(pods));
      setFocusedPod(null);
      setMessage('已切换到概览视图');
      return;
    }
    setCollapsedPods(new Set());
    setFocusedPod(null);
    setMessage(level === 'group' ? '已切换到分组视图' : '已切换到细节视图');
  }, [pods]);

  // Phase 2 V2: Auto-collapse large topologies (POD >= 5)
  // 使用 ref 避免无限循环
  const hasAutoSwitchedRef = useRef(false);
  useEffect(() => {
    if (pods.length >= 5 && viewLevel === 'group' && !hasAutoSwitchedRef.current) {
      console.log(`[LOD] Auto-switching to overview for ${pods.length} PODs`);
      hasAutoSwitchedRef.current = true;
      setViewLevel('overview');
      setCollapsedPods(new Set(pods));
      setFocusedPod(null);
      setMessage('已切换到概览视图');
    }
  }, [pods, viewLevel]);

  // 重置 auto-switch 标记当 pods 变化时
  useEffect(() => {
    hasAutoSwitchedRef.current = false;
  }, [pods]);

  useEffect(() => {
    if (viewLevel === 'overview') {
      setCollapsedPods(new Set(pods));
    }
  }, [pods, viewLevel]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError('');
      setMessage('');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      const ext = droppedFile.name.toLowerCase().split('.').pop();
      const validExts = ['csv', 'xlsx', 'xls'];
      if (validExts.includes(ext || '')) {
        setFile(droppedFile);
        setError('');
        setMessage('');
      } else {
        setError('请上传 CSV 或 Excel 格式的文件');
      }
    }
  };

  const handleRestore = async () => {
    if (!file) {
      setError('请先选择文件');
      return;
    }

    setLoading(true);
    setLoadingProgress(0);
    setError('');
    setMessage('');
    setLoadedPods(new Set());
    setLazyMode(false);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('networkType', networkType);
      formData.append('config', JSON.stringify(config));
      // 启用 Lazy Mode if > 500 nodes? Or always request?
      // For V2, let's request lazy mode by default to optimize performance
      formData.append('mode', 'lazy');

      console.log('[TopologyRestore] Requesting V2 API for streaming (Lazy Mode)...');

      const res = await fetch(`${getApiServerUrl()}/api/topology/restore-v2`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP Error ${res.status}`);
      }

      if (!res.body) throw new Error('您的浏览器不支持流式传输');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // 数据累加器
      let metaData: any = null;
      const accumulatedNodes: Record<string, any[]> = { core: [], spine: [], leaf: [] };
      const accumulatedEdges: any[] = [];
      let totalNodesReceived = 0;
      let totalNodesExpected = 0;

      // 读取流
      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 保留未完成的行

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line);

              if (chunk.type === 'meta') {
                metaData = chunk.data;
                setRenderMode(metaData.renderMode);
                setLazyMode(!!metaData.isLazy);
                totalNodesExpected = metaData.nodeCount;
                console.log('[TopologyStream] Meta:', metaData);

                // 初始化 POD 和 可见性
                if (metaData.pods?.length > 0) {
                  // 不再添加 ALL，强制选择
                  const uniquePods = metaData.pods.filter((p: string) => p !== 'ALL');
                  setPods(uniquePods);
                  // 如果只有一个 POD，自动选中
                  if (uniquePods.length === 1) setSelectedPod(uniquePods[0]);
                  else setSelectedPod(''); // 强制用户选择
                }

                // 提取 Rails
                // 从 metaData stats 或 accumulatedNodes 中提取？
                // 注意：这里 accumulatedNodes 还是空的，因为流才刚开始。
                // Rails extraction should happen AFTER all data is loaded or progressively?
                // Let's do it at the end (Step 248) to be safe, or progressively if we want.
                // For now, simpler to do it at the end.

                // 初始化层级可见性: 所有层默认可见(支持RoCE等多种网络类型)
                const initialVisibility: Record<string, boolean> = {};
                if (metaData.layers) {
                  const layers = Array.isArray(metaData.layers) ? metaData.layers : Object.keys(metaData.layers);
                  layers.forEach((layer: string) => {
                    initialVisibility[layer] = true;  // 所有层默认显示
                  });
                }
                setLayerVisibility(initialVisibility);

              } else if (chunk.type === 'chunk') {
                if (chunk.dataType === 'edges') {
                  accumulatedEdges.push(...chunk.items);
                } else if (chunk.layer) {
                  const newNodes = chunk.nodes;
                  if (!accumulatedNodes[chunk.layer]) accumulatedNodes[chunk.layer] = [];
                  accumulatedNodes[chunk.layer].push(...newNodes);
                  totalNodesReceived += newNodes.length;
                }

                // 更新进度
                if (totalNodesExpected > 0) {
                  setLoadingProgress(Math.round(((totalNodesReceived + (accumulatedEdges.length / 5)) / (totalNodesExpected + (totalNodesExpected * 2))) * 100)); // 估算进度
                }

              } else if (chunk.type === 'error') {
                throw new Error(chunk.error);
              }
            } catch (e) {
              console.error('[TopologyStream] Parse Error:', e);
            }
          }
        }

        if (done) break;
      }

      // 组装最终数据
      const finalData = {
        ...metaData,
        nodesByLayer: accumulatedNodes,
        connections: accumulatedEdges,
        success: true
      };

      console.log('[TopologyStream] 完成:', finalData);
      setRestoreResult(finalData);

      // 提取所有 Rails
      const allNodes = [
        ...(accumulatedNodes.core || []),
        ...(accumulatedNodes.spine || []),
        ...(accumulatedNodes.leaf || [])
      ];
      const extractedRails = extractRails(allNodes);
      setRails(extractedRails);

      // 如果只有一个 Rail，自动选中；否则强制选择
      if (extractedRails.length === 1) setSelectedRail(extractedRails[0]);
      else setSelectedRail('');

      const podOptions = Array.isArray(metaData?.pods) ? metaData.pods.filter((p: string) => p !== 'ALL') : [];
      const requiredLabels = [];
      if (podOptions.length > 0) requiredLabels.push('POD');
      if (networkType === 'ib' && extractedRails.length > 0) requiredLabels.push('Rail');
      const selectionHint = requiredLabels.length > 0
        ? `请选择 ${requiredLabels.join(' 和 ')} 以查看拓扑。`
        : '可直接查看拓扑。';
      setMessage(`加载完成: ${totalNodesReceived} 节点。${selectionHint}`);
      setLoadingProgress(100);

      // 不再自动 buildTopology('ALL')，因为需要用户选择
      // buildTopology(finalData, 'ALL', { core: true, spine: true, leaf: true });

    } catch (err: any) {
      console.error('[TopologyRestore] Error:', err);
      setError(err.message || '拓扑还原失败');
    } finally {
      setLoading(false);
    }
  };

  const buildTopology = useCallback((data: any, pod: string, visibility: Record<string, boolean>, rail: string) => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    if (!data?.nodesByLayer) return;

    const { nodesByLayer, connections, layerY } = data;

    // 构建节点信息映射
    const nodeInfoMap = new Map<string, any>();

    // 获取每层的所有设备，用于计算坐标
    const allLayers = Object.values(nodesByLayer).map((layerArr: any) => layerArr.length);
    const maxCount = Math.max(...allLayers, 0);

    // 布局参数（参考参考项目的优化方案）
    const layerGap = 200; // 层级间距
    const nodeGap = 150; // Core 层节点间距
    const spineNodeGap = 130; // Spine 层节点间距
    const leafNodeGap = 170; // Leaf 层节点间距

    // 动态计算中心 X 坐标（用于水平居中）
    const centerX = maxCount > 0 ? ((maxCount - 1) * nodeGap) / 2 : 0;

    const layerYPositions: Record<string, number> = data.layerY || {
      core: 0,
      spine: layerGap,
      leaf: layerGap * 2
    };

    // 处理每一层的节点
    Object.entries(nodesByLayer).forEach(([layer, layerNodes]: [string, any]) => {
      if (!visibility[layer]) return;

      const nodeList = Array.isArray(layerNodes) ? layerNodes : [];
      let filteredNodes = nodeList;

      // POD 过滤
      if (pod !== 'ALL') {
        filteredNodes = nodeList.filter((n: any) =>
          n.pod === pod || n.pod === 'ALL' || n.id?.includes(pod) || !n.pod
        );
      }

      // Rail 过滤（IB 网络）
      if (networkType === 'ib' && rail && rail !== 'ALL') {
        filteredNodes = filteredNodes.filter((n: any) => {
          const nodeRail = getRailFromId(n.id);
          if (nodeRail) return nodeRail === rail;
          return layer === 'core';
        });
      }

      const expandRoceLeafSpacing = networkType === 'roce' && (layer === 'asw' || layer === 'lsw');
      let presetCenterX: number | null = null;
      if (expandRoceLeafSpacing) {
        const presetXs = filteredNodes
          .map((n: any) => (n.position?.x ?? n.x))
          .filter((x: any) => typeof x === 'number') as number[];
        if (presetXs.length > 0) {
          presetCenterX = presetXs.reduce((sum, x) => sum + x, 0) / presetXs.length;
        }
      }

      // 为该层的节点计算坐标
      const yPos = layerYPositions[layer] ?? (Object.keys(nodesByLayer).indexOf(layer) * layerGap);
      let xGap = nodeGap; // 默认使用 Core 间距

      if (layer === 'spine' || layer.includes('ssw')) {
        xGap = spineNodeGap;
      } else if (layer === 'leaf' || layer.includes('asw')) {
        xGap = leafNodeGap;
      }

      // 计算该层节点的起始 X 坐标（用于居中对齐）
      const layerCenterX = filteredNodes.length > 0
        ? ((filteredNodes.length - 1) * xGap) / 2
        : 0;

      filteredNodes.forEach((node: any, nodeIdx: number) => {
        // 使用 nodeIdx 而非全局索引，确保 POD 过滤后也正确
        const xPos = nodeIdx * xGap - layerCenterX + centerX;
        const presetPosition = node.position ||
          (typeof node.x === 'number' && typeof node.y === 'number' ? { x: node.x, y: node.y } : null);
        const position = presetPosition && expandRoceLeafSpacing && typeof presetCenterX === 'number'
          ? { x: presetCenterX + (presetPosition.x - presetCenterX) * 1.35, y: presetPosition.y }
          : (presetPosition || { x: xPos, y: yPos });

        nodeInfoMap.set(node.id, { ...node, layer });
        const isHighlighted = highlightedNodeId === node.id;
        const isSelected = selectedNodeInfo?.id === node.id;
        const textLabel = node.label || node.id;

        const nodeData = {
          id: node.id,
          type: 'default',
          position,
          data: {
            label: (
              <div style={{
                ...getNodeStyle(layer),
                ...(isSelected ? { boxShadow: '0 0 15px rgba(59, 130, 246, 0.6)', border: '3px solid #3b82f6' } : {}),
                ...(isHighlighted ? { boxShadow: '0 0 20px rgba(255, 0, 0, 0.8)', border: '3px solid #ff0000' } : {})
              }}>
                <div>{layer.toUpperCase()}</div>
                <div style={{ fontSize: '8px', marginTop: '2px' }}>{textLabel}</div>
              </div>
            ),
            searchLabel: textLabel
          },
          ...getHandlePositions(layer, node.id),
          style: { background: 'transparent', border: 'none', padding: 0 }
        };

        newNodes.push(nodeData);
      });
    });

    // 构建边
    const nodeIds = new Set(newNodes.map(n => n.id));
    const edgeInfoMap = new Map<string, any>();
    const getLayerRank = (layer?: string) => {
      const normalized = (layer || '').toLowerCase();
      const ranks: Record<string, number> = {
        core: 0, csw: 0,
        spine: 1, ssw: 1,
        leaf: 2, asw: 2,
        lsw: 3,
        oob: 4,
        soob: 5,
        other: 6,
        unknown: 7
      };
      return ranks[normalized] ?? null;
    };

    (connections || []).forEach((conn: any, idx: number) => {
      if (nodeIds.has(conn.source) && nodeIds.has(conn.target)) {
        const sourceInfo = nodeInfoMap.get(conn.source);
        const targetInfo = nodeInfoMap.get(conn.target);
        let sourceId = conn.source;
        let targetId = conn.target;
        let srcPort = conn.srcPort;
        let dstPort = conn.dstPort;

        const sourceRank = getLayerRank(sourceInfo?.layer);
        const targetRank = getLayerRank(targetInfo?.layer);
        const shouldSwap = sourceRank !== null && targetRank !== null && sourceRank > targetRank;

        if (shouldSwap) {
          sourceId = conn.target;
          targetId = conn.source;
          srcPort = conn.dstPort;
          dstPort = conn.srcPort;
        }

        const edgeId = `edge-${idx}`;
        edgeInfoMap.set(edgeId, {
          id: edgeId,
          source: sourceId,
          target: targetId,
          srcPort,
          dstPort,
          sourceNode: nodeInfoMap.get(sourceId),
          targetNode: nodeInfoMap.get(targetId)
        });

        const isSelected = selectedEdgeInfo?.id === edgeId;
        newEdges.push({
          id: edgeId,
          source: sourceId,
          target: targetId,
          label: srcPort && dstPort ? `${srcPort}-${dstPort}` : undefined,
          labelStyle: { fontSize: '8px', fill: '#666', backgroundColor: '#fff', padding: '2px 4px' },
          style: {
            stroke: isSelected ? '#3b82f6' : '#999',
            strokeWidth: isSelected ? 2.5 : 1.5
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: isSelected ? '#3b82f6' : '#999' }
        });
      }
    });

    // 应用边聚合优化
    let finalEdges = newEdges;
    if (enableEdgeBundling && newEdges.length > edgeBundlingThreshold * 2) {
      const { bundledEdges, bundleMap, stats } = bundleEdges(newEdges, {
        threshold: edgeBundlingThreshold,
        keepOriginal: true,
        hideOriginal: true
      });
      finalEdges = bundledEdges;
      bundleMapRef.current = bundleMap;

      console.log('[TopologyRestore] 边聚合结果:', stats);
      setMessage(`拓扑已优化：${stats.bundleCount} 个聚合边，减少 ${stats.reduction} 的渲染压力`);
    }

    if (newNodes.length === 0) {
      console.warn('[TopologyRestore] 警告：没有生成任何节点！', {
        nodesByLayer: Object.keys(nodesByLayer),
        visibility,
        pod
      });
    }

    setNodes(newNodes);
    setEdges(finalEdges);

    console.log('[TopologyRestore] 拓扑渲染完成:', {
      nodeCount: newNodes.length,
      edgeCount: finalEdges.length,
      sampleNodes: newNodes.slice(0, 3),
      sampleEdges: finalEdges.slice(0, 3),
      nodesByLayerKeys: Object.keys(nodesByLayer),
      visibility,
      layoutInfo: {
        maxCount,
        centerX: centerX.toFixed(2),
        layerGap,
        nodeGap,
        spineNodeGap,
        leafNodeGap
      },
      layerCounts: {
        core: newNodes.filter(n => n.id.toUpperCase().includes('IBCR')).length,
        spine: newNodes.filter(n => n.id.toUpperCase().includes('IBSP')).length,
        leaf: newNodes.filter(n => n.id.toUpperCase().includes('IBLF')).length
      }
    });
  }, [
    highlightedNodeId,
    selectedNodeInfo,
    selectedEdgeInfo,
    enableEdgeBundling,
    edgeBundlingThreshold,
    networkType,
    setNodes,
    setEdges
  ]);

  const loadPodDetails = async (podName: string): Promise<any> => {
    if (!file || loadedPods.has(podName)) return null;

    setLoading(true);
    try {
      console.log('[TopologyRestore] Loading POD details:', podName);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('networkType', networkType);
      formData.append('config', JSON.stringify(config));
      formData.append('podName', podName);

      const res = await fetch(`${getApiServerUrl()}/api/topology/pod-details`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.ok) {
        let updatedResult: any = null;
        setRestoreResult((prev: any) => {
          if (!prev) return prev;
          const newState = { ...prev };

          // Merge nodes by layer when available, fallback to leaf
          const incomingNodes = Array.isArray(data.nodes) ? data.nodes : [];
          incomingNodes.forEach((node: any) => {
            const layerKey = node.layer || 'leaf';
            if (!newState.nodesByLayer[layerKey]) newState.nodesByLayer[layerKey] = [];
            newState.nodesByLayer[layerKey].push(node);
          });

          // Merge Edges
          newState.connections = [...(newState.connections || []), ...(data.edges || [])];
          updatedResult = newState;
          return newState;
        });
        setLoadedPods(prev => {
          const next = new Set(prev);
          next.add(podName);
          return next;
        });
        setMessage(`已加载 POD: ${podName} 数据`);
        return updatedResult;
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      console.error('Failed to load POD:', err);
      setError(`加载 POD ${podName} 失败: ${err.message}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handlePodChange = async (pod: string) => {
    setSelectedPod(pod);

    // Check Lazy Loading - 使用返回值避免竞态条件
    let dataToUse = restoreResult;
    if (lazyMode && pod !== 'ALL' && !loadedPods.has(pod)) {
      const loadedData = await loadPodDetails(pod);
      if (loadedData) dataToUse = loadedData;
    }

    if (dataToUse) buildTopology(dataToUse, pod, layerVisibility, selectedRail);
  };

  const handleRailChange = (rail: string) => {
    setSelectedRail(rail);
    if (restoreResult && renderMode !== 'cytoscape') {
      buildTopology(restoreResult, selectedPod, layerVisibility, rail);
    }
  };

  const toggleLayerVisibility = (layer: string) => {
    const newVisibility = { ...layerVisibility, [layer]: !layerVisibility[layer] };
    setLayerVisibility(newVisibility);
    if (restoreResult) buildTopology(restoreResult, selectedPod, newVisibility, selectedRail);
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) { setHighlightedNodeId(null); return; }

    const upperSearch = searchTerm.toUpperCase();
    let targetNodeId: string | null = null;
    let targetPod: string | null = null;

    // 1. 本地搜索 (Local Search in visible nodes)
    const visibleNode = nodes.find(n =>
      n.id.toUpperCase().includes(upperSearch) ||
      (n.data?.searchLabel && n.data.searchLabel.toUpperCase().includes(upperSearch))
    );

    if (visibleNode) {
      targetNodeId = visibleNode.id;
      // Try to find pod from node data if possible, or assume it's loaded
    } else if (restoreResult) {
      // Search in raw data (including lazy loaded but not currently rendered parts?)
      // Currently restoreResult has everything loaded so far.
      Object.entries(restoreResult.nodesByLayer || {}).forEach(([layer, layerNodes]: [string, any]) => {
        if (targetNodeId) return;
        const match = Array.isArray(layerNodes) ? layerNodes.find((n: any) => n.id.toUpperCase().includes(upperSearch)) : null;
        if (match) {
          targetNodeId = match.id;
          targetPod = match.pod;
        }
      });
    }

    // 2. 服务端 Deep Search (如果本地没找到 且 是 Lazy Mode)
    if (!targetNodeId && lazyMode && file) {
      try {
        setLoading(true);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('query', searchTerm);
        formData.append('networkType', networkType);
        formData.append('config', JSON.stringify(config));

        const res = await fetch(`${getApiServerUrl()}/api/topology/search`, {
          method: 'POST',
          body: formData
        });
        const data = await res.json();

        if (data.ok && data.matches && data.matches.length > 0) {
          const match = data.matches[0];
          targetNodeId = match.id;
          targetPod = match.pod;
          setMessage(`已找到远程节点: ${match.id} (POD: ${match.pod})`);
        } else {
          setMessage('未找到相关节点');
        }
      } catch (e) {
        console.error('Search error:', e);
      } finally {
        setLoading(false);
      }
    }

    // 3. 处理结果
    if (targetNodeId) {
      // 如果节点在未加载的 POD 中，先加载 POD
      if (targetPod && lazyMode && !loadedPods.has(targetPod)) {
        await loadPodDetails(targetPod);
        // 加载后，restoreResult 更新，buildTopology 也会更新
      }

      setHighlightedNodeId(targetNodeId);

      // 切换 POD 视图
      if (targetPod && targetPod !== 'ALL' && selectedPod !== targetPod && selectedPod !== 'ALL') {
        await handlePodChange(targetPod);
      }
      setMessage(`找到设备: ${targetNodeId}`);
    } else {
      setHighlightedNodeId(null);
      setMessage('未找到匹配的设备');
    }
  };

  const handleNodeClick = (event: any, node: Node) => {
    setSelectedNodeInfo({ id: node.id, data: node.data, position: node.position });
    setSelectedEdgeInfo(null);
  };

  const handleEdgeClick = (event: any, edge: Edge) => {
    // 处理聚合边的展开/收起
    if (edge.data?.type === 'bundle') {
      const bundleId = edge.id;
      const isExpanded = expandedBundlesRef.current.has(bundleId);

      let newEdges = edges;
      if (isExpanded) {
        // 收起
        newEdges = collapseBundle(bundleId, edges, bundleMapRef.current);
        expandedBundlesRef.current.delete(bundleId);
        setMessage(`收起了 ${edge.data?.originalCount} 条连接`);
      } else {
        // 展开
        newEdges = expandBundle(bundleId, edges, bundleMapRef.current);
        expandedBundlesRef.current.add(bundleId);
        setMessage(`展开了 ${edge.data?.originalCount} 条连接`);
      }

      setEdges(newEdges);
      return;
    }

    // 常规边的选择
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    setSelectedEdgeInfo({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      sourceNode,
      targetNode
    });
    setSelectedNodeInfo(null);
  };

  const handleCanvasClick = () => {
    setSelectedNodeInfo(null);
    setSelectedEdgeInfo(null);
  };

  useEffect(() => {
    if (renderMode !== 'reactflow') return;
    if (!reactFlowInstanceRef.current) return;
    if (nodes.length === 0) return;
    reactFlowInstanceRef.current.fitView({ padding: 0.2, duration: 0 });
  }, [nodes.length, edges.length, renderMode]);

  return (
    <div
      className="min-h-screen p-6"
      style={{
        ['--ink' as any]: '#0f172a',
        ['--muted' as any]: '#5b6472',
        ['--line' as any]: 'rgba(15,23,42,0.12)',
        ['--panel' as any]: '#ffffff',
        ['--panelMuted' as any]: '#f5f7fb',
        ['--accent' as any]: '#0f766e',
        ['--accentSoft' as any]: '#e7f5f3',
        ['--warning' as any]: '#b45309',
        fontFamily: '"IBM Plex Sans","Source Sans 3","Noto Sans",sans-serif',
        background:
          'radial-gradient(1200px circle at 10% -10%, #e6f3ff 0%, rgba(230,243,255,0) 60%), radial-gradient(900px circle at 90% 0%, #eefbf5 0%, rgba(238,251,245,0) 55%), #f6f7fb'
      }}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Topology Restore</p>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">网络拓扑还原</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">面向生产环境的网络拓扑复原、过滤与分析视图</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
            引擎: {renderMode === 'cytoscape' ? 'Cytoscape' : renderMode === 'virtual-reactflow' ? 'Virtual RF' : 'ReactFlow'}
          </span>
          <span className="rounded-full bg-[var(--accentSoft)] px-3 py-1 text-xs text-[var(--accent)]">
            网络: {networkType.toUpperCase()}
          </span>
        </div>
      </div>
      {/* 网络类型选择 */}
      <div className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
        <label className="block text-sm font-semibold text-[var(--ink)] mb-3">网络类型</label>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panelMuted)] px-3 py-2 text-sm text-[var(--ink)]">
            <input type="radio" value="ib" checked={networkType === 'ib'} onChange={() => setNetworkType('ib')} className="w-4 h-4 text-[var(--accent)]" />
            IB 网络 (InfiniBand)
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panelMuted)] px-3 py-2 text-sm text-[var(--ink)]">
            <input type="radio" value="roce" checked={networkType === 'roce'} onChange={() => setNetworkType('roce')} className="w-4 h-4 text-[var(--accent)]" />
            RoCE 网络 (以太网)
          </label>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {networkType === 'ib' ? '解析 UFM 端口信息 CSV，自动识别 CLOS 三层架构' : '解析 NetQ 接口信息 Excel，自动识别网络层级'}
        </p>
      </div>

      {/* 拓扑检测配置 */}
      <div className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--ink)]">拓扑检测配置</h3>
        </div>

        {/* 性能优化选项 */}
        <div className="mb-4 pb-4 border-b border-[var(--line)]">
          <label className="block text-sm font-semibold text-[var(--ink)] mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-[var(--warning)]" />
            性能优化
          </label>

          <div className="space-y-4">
            <div className="mb-3 pb-3 border-b border-[var(--line)]">
              <label className="text-xs font-semibold text-[var(--muted)] block mb-2">渲染引擎</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="renderEngine"
                    value="reactflow"
                    checked={renderMode === 'reactflow'}
                    onChange={() => setRenderMode('reactflow')}
                    className="w-4 h-4 text-[var(--accent)]"
                  />
                  <span className="text-sm text-[var(--ink)]">标准 (ReactFlow)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="renderEngine"
                    value="cytoscape"
                    checked={renderMode === 'cytoscape' || renderMode === 'virtual-reactflow'}
                    onChange={() => setRenderMode('cytoscape')}
                    className="w-4 h-4 text-[var(--accent)]"
                  />
                  <span className="text-sm font-semibold text-[var(--accent)]">高性能 (Cytoscape) <span className="ml-2 text-xs font-normal text-[var(--muted)]">推荐 500+ 节点</span></span>
                </label>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edgeBundling"
                checked={enableEdgeBundling}
                onChange={(e) => setEnableEdgeBundling(e.target.checked)}
                className="w-4 h-4 text-[var(--accent)]"
              />
              <label htmlFor="edgeBundling" className="text-sm text-[var(--ink)]">
                启用边聚合（减少连接线混乱）
              </label>
            </div>

            {enableEdgeBundling && (
              <div className="ml-6 rounded-lg border border-[var(--line)] bg-[var(--panelMuted)] p-3">
                <label className="text-xs font-medium text-[var(--muted)] mb-2 block">
                  聚合阈值：至少 <span className="font-bold text-[var(--accent)]">{edgeBundlingThreshold}</span> 条边触发聚合
                </label>
                <input
                  type="range"
                  min="2"
                  max="20"
                  step="1"
                  value={edgeBundlingThreshold}
                  onChange={(e) => setEdgeBundlingThreshold(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <div className="text-xs text-[var(--muted)] mt-1">
                  ℹ️ 值越低，聚合越激进（减少更多边），但可能隐藏细节。推荐值：5-10
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mb-4 pb-4 border-b border-[var(--line)]">
          <label className="block text-sm font-medium text-[var(--ink)] mb-2">层级检测方式</label>
          <div className="text-sm text-[var(--muted)]">自动识别（根据设备层级自适应）</div>
          <p className="text-xs text-[var(--muted)] mt-1">
            自动方式通过拓扑度数分析识别 Core/Spine/Leaf 层级，对绝大多数数据中心有效
          </p>
        </div>

        {/* POD 分组方式 */}
        <div>
          <label className="block text-sm font-medium text-[var(--ink)] mb-2">POD 分组方式</label>
          <div className="text-sm text-[var(--muted)]">自动按 POD 标识分组</div>
          <p className="text-xs text-[var(--muted)] mt-2">
            系统会基于设备命名中的 POD 标识进行分组展示
          </p>
        </div>
      </div>

      {/* 文件上传 */}
      <div className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
        <label className="block text-sm font-semibold text-[var(--ink)] mb-3">上传数据文件</label>
        <div className="flex gap-3">
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="flex-1 rounded-lg border border-[var(--line)] bg-white px-4 py-2 text-sm" />
          <button onClick={handleRestore} disabled={loading || !file} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-white hover:brightness-110 disabled:opacity-50">
            <Upload className="w-4 h-4" />
            {loading ? '解析中...' : '还原拓扑'}
          </button>
          <button onClick={() => restoreResult && buildTopology(restoreResult, selectedPod, layerVisibility, selectedRail)} disabled={!restoreResult} className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panelMuted)] px-4 py-2 text-[var(--ink)] hover:bg-white disabled:opacity-50">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {file && <p className="mt-2 text-xs text-[var(--muted)]">已选择: {file.name}</p>}
      </div>

      {/* 控制面板 */}
      {restoreResult && (
        <div className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap items-center gap-4">
            {pods.length > 0 && (
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[var(--muted)]" />
                <label className="text-sm font-semibold text-[var(--ink)]">POD:</label>
                <select value={selectedPod} onChange={(e) => handlePodChange(e.target.value)} className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-[var(--accent)]">
                  <option value="" disabled>请选择 POD</option>
                  {pods.map(pod => <option key={pod} value={pod}>{pod}</option>)}
                </select>
              </div>
            )}

            {/* Rail 选择器 (仅IB网络) */}
            {railRequired && (
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[var(--muted)]" />
                <label className="text-sm font-semibold text-[var(--ink)]">Rail:</label>
                <select value={selectedRail} onChange={(e) => handleRailChange(e.target.value)} className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-[var(--accent)]">
                  <option value="" disabled>请选择 Rail</option>
                  {rails.map(rail => <option key={rail} value={rail}>{rail === 'ALL' ? '全部' : `Rail ${rail}`}</option>)}
                </select>
              </div>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold text-[var(--ink)]">显示:</span>
              {Object.keys(layerVisibility).map(layer => (
                <label key={layer} className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={layerVisibility[layer]} onChange={() => toggleLayerVisibility(layer)} className="w-4 h-4 text-[var(--accent)]" />
                  <span className="text-xs font-medium text-[var(--muted)]">{layer.toUpperCase()}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="搜索设备..." className="w-52 rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-[var(--accent)]" />
              <button onClick={handleSearch} className="rounded-lg bg-[var(--accent)] p-2 text-white"><Search className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}

      {/* 图例 */}
      {restoreResult && (
        <div className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
          <div className="flex flex-wrap gap-4 text-xs">
            {Object.keys(layerVisibility).map(layer => (
              <div key={layer} className="flex items-center gap-2 text-[var(--muted)]">
                <div className="w-4 h-4 rounded" style={{ background: layerColors[layer] || layerColors.unknown }}></div>
                <span>{layer.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 错误/消息提示 */}
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

      {/* 拓扑图 */}
      {/* 拓扑图区域 */}
      {restoreResult || loading ? (
        <div className="flex gap-4">
          <div className="flex-1 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[0_10px_28px_rgba(15,23,42,0.06)] relative" style={{ height: '640px' }}>

            {/* 强制选择提示 */}
            {!loading && ((podRequired && !selectedPod) || (railRequired && !selectedRail)) && (
              <div className="absolute inset-0 z-40 bg-[rgba(15,23,42,0.06)] backdrop-blur-sm flex flex-col items-center justify-center">
                <div className="bg-white p-8 rounded-xl shadow-lg border border-[var(--line)] text-center max-w-md">
                  <Layers className="w-16 h-16 text-[var(--accent)] mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-[var(--ink)] mb-2">请选择视图范围</h3>
                  <p className="text-[var(--muted)] mb-6">
                    检测到大规模网络拓扑。为了获得最佳性能和清晰度，请先在上方工具栏选择目标
                    <span className="font-bold text-[var(--ink)] mx-1">{selectionTargets}</span>。
                  </p>
                  <div className="flex gap-3 justify-center">
                    {podRequired && (
                      <div className="text-xs text-[var(--muted)] bg-[var(--panelMuted)] px-3 py-1 rounded-full">
                        POD: {selectedPod || '未选择'}
                      </div>
                    )}
                    {railRequired && (
                      <div className="text-xs text-[var(--muted)] bg-[var(--panelMuted)] px-3 py-1 rounded-full">
                        Rail: {selectedRail || '未选择'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 加载进度条悬浮层 */}
            {/* Phase 2 V3: LOD Toolbar */}
            {renderMode === 'cytoscape' && restoreResult && pods.length > 0 && (
              <div className="mb-3 p-3 bg-[var(--panelMuted)] border border-[var(--line)] rounded-lg flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--ink)]">LOD:</span>
                  <div className="inline-flex rounded-md border border-indigo-200 bg-white overflow-hidden">
                    <button
                      onClick={() => applyViewLevel('overview')}
                      className={`px-3 py-1.5 text-sm ${viewLevel === 'overview' ? 'bg-[var(--accent)] text-white' : 'text-[var(--accent)] hover:bg-white'}`}
                      title="POD 聚合概览"
                    >
                      概览
                    </button>
                    <button
                      onClick={() => applyViewLevel('group')}
                      className={`px-3 py-1.5 text-sm ${viewLevel === 'group' ? 'bg-[var(--accent)] text-white' : 'text-[var(--accent)] hover:bg-white'}`}
                      title="按 POD 分组显示"
                    >
                      分组
                    </button>
                    <button
                      onClick={() => applyViewLevel('detail')}
                      className={`px-3 py-1.5 text-sm ${viewLevel === 'detail' ? 'bg-[var(--accent)] text-white' : 'text-[var(--accent)] hover:bg-white'}`}
                      title="显示所有设备与连接"
                    >
                      细节
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex items-center gap-2 min-w-[220px]">
                  <label className="text-sm font-medium text-[var(--ink)]">快速聚焦:</label>
                  <select
                    className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)]"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        const otherPods = pods.filter(p => p !== e.target.value);
                        setCollapsedPods(new Set(otherPods));
                        setFocusedPod(e.target.value);
                        setViewLevel('group');
                        setMessage(`已聚焦到 ${e.target.value}`);
                      }
                    }}
                  >
                    <option value="">选择POD...</option>
                    {pods.map(pod => (
                      <option key={pod} value={pod}>{pod}</option>
                    ))}
                  </select>
                </div>

                <div className="text-sm text-[var(--muted)]">
                  视图: <span className="font-medium">{viewLevel === 'overview' ? '概览' : viewLevel === 'group' ? '分组' : '细节'}</span>
                </div>
              </div>
            )}

            {loading && (
              <div className="absolute inset-0 z-50 bg-white/90 flex flex-col items-center justify-center backdrop-blur-sm">
                <div className="w-64 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--accent)] transition-all duration-300 ease-out" style={{ width: `${loadingProgress}%` }} />
                </div>
                <p className="mt-3 text-sm font-medium text-[var(--ink)]">正在构建拓扑... {loadingProgress}%</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {renderMode === 'cytoscape' ? '检测到大规模拓扑，已切换至高性能引擎' : '正在加载节点和连接数据'}
                </p>
              </div>
            )}

            {renderMode === 'cytoscape' || renderMode === 'virtual-reactflow' ? (
              <CytoscapeTopology
                data={restoreResult}
                selectedPod={selectedPod}
                selectedRail={selectedRail}
                layerVisibility={layerVisibility}
                activeCoreFilter={activeCoreFilter}
                focusedSpineId={focusedSpineId}
                collapsedPods={collapsedPods}
                viewLevel={viewLevel}
                onViewLevelChange={applyViewLevel}
                networkType={networkType}  // RoCE网络跳过Rail过滤
                height="800px" // Increased height for better visibility
                onNodeClick={(node) => {
                  setSelectedNodeInfo(node);
                  setHighlightedNodeId(node.id);
                  const rawLayer = (node as any).rawLayer || node.layer;

                  // Phase 2: Toggle collapse for POD aggregate nodes
                  if (rawLayer === 'podAggregate') {
                    const originalPod = (node as any).data?.originalPod || node.id.replace('-aggregate', '');
                    setCollapsedPods(prev => {
                      const next = new Set(prev);
                      if (next.has(originalPod)) {
                        next.delete(originalPod); // Expand
                        setMessage(`展开 ${originalPod}`);
                      } else {
                        next.add(originalPod); // Collapse (shouldn't happen from aggregate click)
                      }
                      return next;
                    });
                    return; // Skip other logic for aggregate nodes
                  }

                  // 交互优化: 点击 Spine 节点时，自动显示 Core 层，并只显示连接的 Core 设备
                  if (networkType === 'ib' && (rawLayer === 'spine' || rawLayer === 'ssw')) {
                    setFocusedSpineId(node.id);
                    // 1. 自动开启 Core 层
                    const coreLayerKey = restoreResult?.nodesByLayer?.core
                      ? 'core'
                      : (restoreResult?.nodesByLayer?.csw ? 'csw' : 'core');
                    if (!layerVisibility[coreLayerKey]) {
                      setLayerVisibility(prev => ({ ...prev, [coreLayerKey]: true }));
                      setMessage(`已显示连接到 ${node.id} 的 Core 设备`);
                    }

                    // 2. 计算连接的 Core 节点
                    if (restoreResult && restoreResult.connections) {
                      const connectedCoreIds = restoreResult.connections
                        .filter((edge: any) => {
                          // 找到与当前 Spine 连接的边
                          const isConnected = edge.source === node.id || edge.target === node.id;
                          if (!isConnected) return false;

                          // 确认对端是 Core 节点
                          const peerId = edge.source === node.id ? edge.target : edge.source;
                          const peerLayer = nodeLayerMap.get(peerId)?.toLowerCase();
                          const isPeerCore = peerLayer === 'core' || peerLayer === 'csw'
                            || peerId.includes('IBCR') || peerId.includes('CORE');
                          return isPeerCore;
                        })
                        .map((edge: any) => edge.source === node.id ? edge.target : edge.source);

                      setActiveCoreFilter(connectedCoreIds.length > 0 ? connectedCoreIds : null);
                    }
                  } else {
                    // 点击其他节点 (如 Leaf 或 Core)，清除 Core 过滤器
                    setActiveCoreFilter(null);
                    setFocusedSpineId(null);
                  }
                }}
                onEdgeClick={(edge) => setSelectedEdgeInfo({ ...edge, label: `${edge.srcPort}-${edge.dstPort}` })}
                highlightedNodeId={highlightedNodeId}
              />
            ) : (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onInit={(instance) => {
                  reactFlowInstanceRef.current = instance;
                }}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
                onPaneClick={handleCanvasClick}
                fitView
                attributionPosition="bottom-left"
                onlyRenderVisibleElements={true}
                selectNodesOnDrag={false}
                edgesFocusable={false}
                elementsSelectable={true}
                minZoom={0.1}
              >
                <Controls />
                <MiniMap nodeColor={(node) => {
                  // 从 nodeLayerMap 获取层级，或通过 ID 模式匹配
                  const layer = nodeLayerMap.get(node.id);
                  if (layer) return layerColors[layer] || layerColors.unknown;
                  // 回退：通过 ID 模式匹配
                  const id = node.id.toUpperCase();
                  if (id.includes('IBCR') || id.includes('CORE') || id.includes('CSW')) return layerColors.core;
                  if (id.includes('IBSP') || id.includes('SPINE') || id.includes('SSW')) return layerColors.spine;
                  if (id.includes('IBLF') || id.includes('LEAF') || id.includes('ASW') || id.includes('LSW')) return layerColors.leaf;
                  return layerColors.unknown;
                }} style={{ background: '#f0f0f0' }} />
                <Background color="#f0f0f0" gap={20} />
              </ReactFlow>
            )}
          </div>

          {/* 右侧信息面板 */}
          <div className="w-72 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[0_10px_28px_rgba(15,23,42,0.06)] flex flex-col">
            <div className="px-4 py-3 bg-[var(--panelMuted)] border-b border-[var(--line)] flex justify-between items-center">
              <h4 className="text-sm font-semibold text-[var(--ink)]">详细信息</h4>
              {(selectedNodeInfo || selectedEdgeInfo) && (
                <button
                  onClick={handleCanvasClick}
                  className="rounded-md border border-[var(--line)] bg-white px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--panelMuted)]"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {selectedNodeInfo ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)] uppercase mb-1">设备ID</p>
                    <p className="text-sm font-mono text-gray-900 break-all">{selectedNodeInfo.id}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)] uppercase mb-1">层级</p>
                    <p className="text-sm">
                      <span className="inline-block px-2 py-1 rounded text-white text-xs font-medium" style={{ background: layerColors[selectedNodeInfo.id.split('-')[0]?.toLowerCase()] || layerColors.unknown }}>
                        {(selectedNodeInfo.layer || selectedNodeInfo.id.split('-')[0]).toUpperCase()}
                      </span>
                    </p>
                  </div>
                  {selectedNodeInfo.data?.label && (
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)] uppercase mb-1">标签</p>
                      {typeof selectedNodeInfo.data.label === 'string' ? (
                        <p className="text-sm text-gray-900">{selectedNodeInfo.data.label}</p>
                      ) : (
                        <div className="text-sm text-gray-900">{selectedNodeInfo.data.label}</div>
                      )}
                    </div>
                  )}
                  {renderMode !== 'cytoscape' && (
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)] uppercase mb-1">位置</p>
                      <p className="text-xs text-[var(--muted)]">X: {selectedNodeInfo.position?.x.toFixed(0)} | Y: {selectedNodeInfo.position?.y.toFixed(0)}</p>
                    </div>
                  )}

                  {/* 连接到此节点的边 */}
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)] uppercase mb-2">连接关系</p>
                    <div className="space-y-1 text-xs">
                      {(() => {
                        const relatedEdges = renderMode === 'cytoscape'
                          ? (restoreResult?.connections || []).filter((e: any) => e.source === selectedNodeInfo.id || e.target === selectedNodeInfo.id)
                          : edges.filter(e => e.source === selectedNodeInfo.id || e.target === selectedNodeInfo.id);

                        if (relatedEdges.length === 0) {
                          return <p className="text-[var(--muted)] italic">无连接</p>;
                        }

                        // 分类连接：上行 (Uplink) 和 下行 (Downlink)
                        // 假设：对于 Spine 来说，Core 是上行 (Target/Peer is IBCR)，Leaf 是下行
                        // 层级定义 (数值越小越核心)
                        const LAYER_RANK: Record<string, number> = {
                          'core': 0,
                          'spine': 1,
                          'leaf': 2,
                          'oob': 99,
                          'unknown': 100
                        };

                        const uplinks: any[] = [];
                        const downlinks: any[] = [];

                        relatedEdges.forEach((edge: any) => {
                          const peerId = edge.source === selectedNodeInfo.id ? edge.target : edge.source;

                          // 动态查找对端层级 (不依赖 ID 硬编码)
                          const peerLayer = (nodeLayerMap.get(peerId) || 'unknown').toLowerCase();
                          const peerRank = LAYER_RANK[peerLayer] ?? 100;

                          // Legacy vars removed


                          // 定义当前层级 (临时修复作用域问题)
                          const currentLayer = (nodeLayerMap.get(selectedNodeInfo.id) || selectedNodeInfo.layer || 'unknown').toLowerCase();
                          const currentRank = LAYER_RANK[currentLayer] ?? 100;

                          // 逻辑: 如果对端层级 比 当前层级 "高" (Rank数值小)，则是 Uplink
                          if (peerRank < currentRank) {
                            uplinks.push(edge);
                          } else {
                            // 否则视为直连或下行
                            downlinks.push(edge);
                          }
                        });

                        // 渲染函数
                        const renderEdgeItem = (edge: any, idx: number, isUplink: boolean) => (
                          <div key={`${isUplink ? 'up' : 'down'}-${idx}`} className={`p-1.5 rounded border mb-1 ${isUplink ? 'bg-blue-50 border-blue-200' : 'bg-[var(--panelMuted)] border-[var(--line)]'}`}>
                            <div className="font-mono text-[var(--ink)] flex justify-between">
                              <span>
                                {edge.source === selectedNodeInfo.id ? (
                                  <>→ {edge.target}</>
                                ) : (
                                  <>← {edge.source}</>
                                )}
                              </span>
                              {isUplink && <span className="text-[10px] bg-blue-100 text-[var(--accent)] px-1 rounded">UPLINK</span>}
                            </div>
                            {(edge.label || (edge.srcPort && edge.dstPort)) && (
                              <div className="text-[var(--muted)] mt-0.5 text-[10px]">
                                端口: {edge.label || `${edge.srcPort}-${edge.dstPort}`}
                              </div>
                            )}
                          </div>
                        );

                        return (
                          <div className="space-y-4">
                            {uplinks.length > 0 && (
                              <div>
                                <p className="text-[10px] font-bold text-[var(--accent)] uppercase mb-1">
                                  上行连接 (Uplinks) · {uplinks.length}
                                </p>
                                {uplinks.map((e, i) => renderEdgeItem(e, i, true))}
                              </div>
                            )}
                            {downlinks.length > 0 && (
                              <div>
                                <p className="text-[10px] font-bold text-[var(--muted)] uppercase mb-1">
                                  下行连接 (Downlinks) · {downlinks.length}
                                </p>
                                {downlinks.slice(0, 40).map((e, i) => renderEdgeItem(e, i, false))}
                                {downlinks.length > 40 && <p className="text-[10px] text-[var(--muted)] text-center">... 还有 {downlinks.length - 40} 条连接</p>}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              ) : selectedEdgeInfo ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)] uppercase mb-1">源设备</p>
                    <p className="text-sm font-mono text-gray-900 break-all">{selectedEdgeInfo.source}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[var(--muted)] uppercase mb-1">目标设备</p>
                    <p className="text-sm font-mono text-gray-900 break-all">{selectedEdgeInfo.target}</p>
                  </div>
                  {(selectedEdgeInfo.label || (selectedEdgeInfo.srcPort && selectedEdgeInfo.dstPort)) && (
                    <div>
                      <p className="text-xs font-medium text-[var(--muted)] uppercase mb-1">端口信息</p>
                      <p className="text-sm font-mono text-gray-900">{selectedEdgeInfo.label || `${selectedEdgeInfo.srcPort}-${selectedEdgeInfo.dstPort}`}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-[var(--muted)] pt-8">
                  <p className="text-sm">点击设备或连接线</p>
                  <p className="text-xs mt-2">查看详细信息</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${isDragging ? 'border-blue-500 bg-blue-50' : 'bg-[var(--panelMuted)] border-gray-300'}`}
        >
          <Upload className={`w-12 h-12 mx-auto mb-4 ${isDragging ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`} />
          <p className={isDragging ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}>
            {isDragging ? '释放文件以上传' : '请上传 CSV 或 Excel 格式文件'}
          </p>
          <p className="text-xs text-[var(--muted)] mt-2">支持拖拽上传</p>
        </div>
      )}
    </div>
  );
};

// 辅助函数：从节点列表提取 Rails
function extractRails(nodes: any[]): string[] {
  const railSet = new Set<string>();
  // railSet.add('ALL'); // 移除 ALL，强制选择具体 Rail
  nodes.forEach(node => {
    const rail = getRailFromId(node.id);
    if (rail) railSet.add(rail);
  });

  // 如果没提取到，返回空，让 UI 处理
  if (railSet.size === 0) return [];

  // sort numeric
  return Array.from(railSet).sort((a, b) => {
    if (a === 'ALL') return -1;
    if (b === 'ALL') return 1;
    return parseInt(a) - parseInt(b);
  });
}

export default TopologyRestoreTool;
// eslint-disable-next-line react-refresh/only-export-components
export { pluginMeta } from './plugin-meta';
