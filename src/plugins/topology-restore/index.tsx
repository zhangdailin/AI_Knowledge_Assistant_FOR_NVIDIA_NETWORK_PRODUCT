import React, { useState, useCallback, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  MiniMap
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Search, Upload, RefreshCw, Layers, Zap } from 'lucide-react';
import { bundleEdges, collapseBundle, expandBundle } from '../../utils/edge-bundling';
import CytoscapeTopology from '../../components/CytoscapeTopology';
import useVirtualViewport from '../../hooks/useVirtualViewport';

type NetworkType = 'ib' | 'roce';

function getApiServerUrl(): string {
  const customUrl = localStorage.getItem('custom_api_server_url');
  if (customUrl) return customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
  return `${window.location.protocol}//${window.location.hostname}:8787`;
}

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

const TopologyRestoreTool: React.FC = () => {
  const [networkType, setNetworkType] = useState<NetworkType>('ib');
  const [file, setFile] = useState<File | null>(null);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const [pods, setPods] = useState<string[]>(['ALL']);
  const [selectedPod, setSelectedPod] = useState('ALL');
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

  // Configuration state
  const [config, setConfig] = useState<TopologyConfig>({
    layerDetection: 'auto',
    podExtraction: { method: 'regex', pattern: 'POD\\d+' }
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedNodeInfo, setSelectedNodeInfo] = useState<any>(null);
  const [selectedEdgeInfo, setSelectedEdgeInfo] = useState<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

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
      const validExts = networkType === 'ib' ? ['csv'] : ['xlsx', 'xls'];
      if (validExts.includes(ext || '')) {
        setFile(droppedFile);
        setError('');
        setMessage('');
      } else {
        setError(`请上传 ${validExts.join('/')} 格式的文件`);
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

      const res = await fetch(`${getApiServerUrl()}/api/topology-restore-v2`, {
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
                  const uniquePods = ['ALL', ...metaData.pods.filter((p: string) => p !== 'ALL')];
                  setPods(uniquePods);
                  setSelectedPod('ALL');
                }

                const initialVisibility: Record<string, boolean> = { core: true, spine: true, leaf: true };
                setLayerVisibility(initialVisibility);

              } else if (chunk.type === 'chunk') {
                if (chunk.dataType === 'edges') {
                  accumulatedEdges.push(...chunk.items);
                } else if (chunk.layer) {
                  const newNodes = chunk.nodes;
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
      setMessage(`加载完成: ${totalNodesReceived} 节点 (Lazy Mode: ${!!metaData?.isLazy})`);
      setLoadingProgress(100);

      // 初次渲染
      buildTopology(finalData, 'ALL', { core: true, spine: true, leaf: true });

    } catch (err: any) {
      console.error('[TopologyRestore] Error:', err);
      setError(err.message || '拓扑还原失败');
    } finally {
      setLoading(false);
    }
  };

  const buildTopology = useCallback((data: any, pod: string, visibility: Record<string, boolean>) => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    if (!data?.nodesByLayer) return;

    const { nodesByLayer, connections } = data;

    // 构建节点信息映射
    const nodeInfoMap = new Map<string, any>();

    // 获取每层的所有设备，用于计算坐标
    const allLayers = {
      core: (nodesByLayer.core || []).map((n: any) => n.id),
      spine: (nodesByLayer.spine || []).map((n: any) => n.id),
      leaf: (nodesByLayer.leaf || []).map((n: any) => n.id)
    };

    // 计算最大设备数，用于居中计算
    const maxCount = Math.max(
      allLayers.core.length || 0,
      allLayers.spine.length || 0,
      allLayers.leaf.length || 0
    );

    // 布局参数（参考参考项目的优化方案）
    const layerGap = 200; // 层级间距
    const nodeGap = 150; // Core 层节点间距
    const spineNodeGap = 130; // Spine 层节点间距
    const leafNodeGap = 120; // Leaf 层节点间距

    // 动态计算中心 X 坐标（用于水平居中）
    const centerX = maxCount > 0 ? ((maxCount - 1) * nodeGap) / 2 : 0;

    const layerYPositions: Record<string, number> = {
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
        filteredNodes = nodeList.filter((n: any) => n.pod === pod || n.id?.includes(pod) || !n.pod);
      }

      // 为该层的节点计算坐标
      const yPos = layerYPositions[layer];
      let xGap = nodeGap; // 默认使用 Core 间距

      if (layer === 'spine') {
        xGap = spineNodeGap;
      } else if (layer === 'leaf') {
        xGap = leafNodeGap;
      }

      // 计算该层节点的起始 X 坐标（用于居中对齐）
      const layerCenterX = filteredNodes.length > 0
        ? ((filteredNodes.length - 1) * xGap) / 2
        : 0;

      filteredNodes.forEach((node: any, nodeIdx: number) => {
        // 使用 nodeIdx 而非全局索引，确保 POD 过滤后也正确
        const xPos = nodeIdx * xGap - layerCenterX + centerX;

        nodeInfoMap.set(node.id, { ...node, layer });
        const isHighlighted = highlightedNodeId === node.id;
        const isSelected = selectedNodeInfo?.id === node.id;

        const nodeData = {
          id: node.id,
          type: 'default',
          position: { x: xPos, y: yPos },
          data: {
            label: (
              <div style={{
                ...getNodeStyle(layer),
                ...(isSelected ? { boxShadow: '0 0 15px rgba(59, 130, 246, 0.6)', border: '3px solid #3b82f6' } : {}),
                ...(isHighlighted ? { boxShadow: '0 0 20px rgba(255, 0, 0, 0.8)', border: '3px solid #ff0000' } : {})
              }}>
                <div>{layer.toUpperCase()}</div>
                <div style={{ fontSize: '8px', marginTop: '2px' }}>{node.label || node.id}</div>
              </div>
            )
          },
          style: { background: 'transparent', border: 'none', padding: 0 }
        };

        newNodes.push(nodeData);
      });
    });

    // 构建边
    const nodeIds = new Set(newNodes.map(n => n.id));
    const edgeInfoMap = new Map<string, any>();

    (connections || []).forEach((conn: any, idx: number) => {
      if (nodeIds.has(conn.source) && nodeIds.has(conn.target)) {
        const edgeId = `edge-${idx}`;
        edgeInfoMap.set(edgeId, {
          id: edgeId,
          source: conn.source,
          target: conn.target,
          srcPort: conn.srcPort,
          dstPort: conn.dstPort,
          sourceNode: nodeInfoMap.get(conn.source),
          targetNode: nodeInfoMap.get(conn.target)
        });

        const isSelected = selectedEdgeInfo?.id === edgeId;
        newEdges.push({
          id: edgeId,
          source: conn.source,
          target: conn.target,
          label: conn.srcPort && conn.dstPort ? `${conn.srcPort}-${conn.dstPort}` : undefined,
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
  }, [highlightedNodeId, selectedNodeInfo, selectedEdgeInfo, setNodes, setEdges]);

  const loadPodDetails = async (podName: string) => {
    if (!file || loadedPods.has(podName)) return;

    setLoading(true);
    try {
      console.log('[TopologyRestore] Loading POD details:', podName);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('networkType', networkType);
      formData.append('config', JSON.stringify(config));
      formData.append('podName', podName);

      const res = await fetch(`${getApiServerUrl()}/api/topology-pod-details`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.ok) {
        setRestoreResult((prev: any) => {
          if (!prev) return prev;
          const newState = { ...prev };

          // Merge Leaf Nodes
          const existingLeaves = newState.nodesByLayer.leaf || [];
          const newLeaves = data.nodes || [];
          // simple merge
          newState.nodesByLayer.leaf = [...existingLeaves, ...newLeaves];

          // Merge Edges
          newState.connections = [...(newState.connections || []), ...(data.edges || [])];
          return newState;
        });
        setLoadedPods(prev => {
          const next = new Set(prev);
          next.add(podName);
          return next;
        });
        setMessage(`已加载 POD: ${podName} 数据`);
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      console.error('Failed to load POD:', err);
      setError(`加载 POD ${podName} 失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePodChange = async (pod: string) => {
    setSelectedPod(pod);

    // Check Lazy Loading
    if (lazyMode && pod !== 'ALL' && !loadedPods.has(pod)) {
      await loadPodDetails(pod);
    }

    if (restoreResult) buildTopology(restoreResult, pod, layerVisibility);
  };

  const toggleLayerVisibility = (layer: string) => {
    const newVisibility = { ...layerVisibility, [layer]: !layerVisibility[layer] };
    setLayerVisibility(newVisibility);
    if (restoreResult) buildTopology(restoreResult, selectedPod, newVisibility);
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) { setHighlightedNodeId(null); return; }

    const upperSearch = searchTerm.toUpperCase();
    let targetNodeId: string | null = null;
    let targetPod: string | null = null;

    // 1. 本地搜索 (Local Search in visible nodes)
    const visibleNode = nodes.find(n =>
      n.id.toUpperCase().includes(upperSearch) ||
      (typeof n.data?.label === 'string' && n.data.label.toUpperCase().includes(upperSearch))
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

        const res = await fetch(`${getApiServerUrl()}/api/topology-search`, {
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
        // 这里我们不直接调用 handlePodChange，因为我们已经在上面可能加载了 POD
        // 直接设置 selectedPod 即可，useEffect 会处理重新渲染?
        // 不，useEffect logic is complex. 
        // handlePodChange logic: setSelectedPod -> buildTopology.
        // buildTopology depends on selectedPod.
        // User usually calls `handlePodChange`.
        // Let's call buildTopology manually.
        // Need latest restoreResult. If we just loaded POD, restoreResult is fresh.
        // But state update acts async. 
        // For safety, assume user might need to click search again or we rely on `loadPodDetails` triggering update.
        // But `setSelectedPod` is enough if we trigger build.
        setSelectedPod(targetPod);
        // The handlePodChange useEffect will pick this up and call buildTopology
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

  return (
    <div className="p-6">
      {/* 网络类型选择 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">选择网络类型</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" value="ib" checked={networkType === 'ib'} onChange={() => setNetworkType('ib')} className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium">IB 网络 (InfiniBand)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" value="roce" checked={networkType === 'roce'} onChange={() => setNetworkType('roce')} className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium">RoCE 网络 (以太网)</span>
          </label>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {networkType === 'ib' ? '解析UFM端口信息CSV，自动识别CLOS三层架构' : '解析NetQ接口信息Excel，自动识别网络层级'}
        </p>
      </div>

      {/* 高级配置 - 层级检测 */}
      <div className="mb-4 p-4 bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800 text-sm">拓扑检测配置</h3>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded"
          >
            {showAdvanced ? '隐藏' : '显示'} 高级选项
          </button>
        </div>

        {/* 性能优化选项 */}
        <div className="mb-4 pb-4 border-b border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-500" />
            性能优化
          </label>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edgeBundling"
                checked={enableEdgeBundling}
                onChange={(e) => setEnableEdgeBundling(e.target.checked)}
                className="w-4 h-4 text-blue-600"
              />
              <label htmlFor="edgeBundling" className="text-sm text-gray-700">
                启用边聚合（减少连接线混乱）
              </label>
            </div>

            {enableEdgeBundling && (
              <div className="ml-6 p-3 bg-gray-50 rounded border border-gray-200">
                <label className="text-xs font-medium text-gray-600 mb-2 block">
                  聚合阈值：至少 <span className="text-blue-600 font-bold">{edgeBundlingThreshold}</span> 条边触发聚合
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
                <div className="text-xs text-gray-500 mt-1">
                  ℹ️ 值越低，聚合越激进（减少更多边），但可能隐藏细节。推荐值：5-10
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mb-4 pb-4 border-b border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">层级检测方式</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="layerDetection"
                value="auto"
                checked={config.layerDetection === 'auto'}
                onChange={() => setConfig({ ...config, layerDetection: 'auto' })}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-sm">自动识别 (推荐)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="layerDetection"
                value="manual"
                checked={config.layerDetection === 'manual'}
                onChange={() => setConfig({ ...config, layerDetection: 'manual' })}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-sm">手动配置</span>
            </label>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            自动方式通过拓扑度数分析识别Core/Spine/Leaf层级，对绝大多数数据中心有效
          </p>

          {/* 手动配置 - 隐藏在高级选项中 */}
          {config.layerDetection === 'manual' && showAdvanced && (
            <div className="mt-3 p-3 bg-gray-50 rounded border border-gray-200">
              <p className="text-xs font-medium text-gray-600 mb-2">设备识别模式 (正则表达式)</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-600">Core 设备</label>
                  <input
                    type="text"
                    placeholder="如: IBCR|CORE"
                    value={config.manualLayers?.corePattern || ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        manualLayers: { ...config.manualLayers, corePattern: e.target.value }
                      })
                    }
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Spine 设备</label>
                  <input
                    type="text"
                    placeholder="如: IBSP|SPINE"
                    value={config.manualLayers?.spinePattern || ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        manualLayers: { ...config.manualLayers, spinePattern: e.target.value }
                      })
                    }
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Leaf 设备</label>
                  <input
                    type="text"
                    placeholder="如: IBLF|LEAF"
                    value={config.manualLayers?.leafPattern || ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        manualLayers: { ...config.manualLayers, leafPattern: e.target.value }
                      })
                    }
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded mt-1"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* POD 分组方式 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">POD 分组方式</label>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="podExtraction"
                value="regex"
                checked={config.podExtraction.method === 'regex'}
                onChange={() =>
                  setConfig({
                    ...config,
                    podExtraction: { method: 'regex', pattern: config.podExtraction.pattern || 'POD\\d+' }
                  })
                }
                className="w-4 h-4 text-blue-600"
              />
              <label className="text-sm text-gray-700">正则表达式匹配</label>
              {config.podExtraction.method === 'regex' && (
                <input
                  type="text"
                  placeholder="如: POD\\d+"
                  value={config.podExtraction.pattern || ''}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      podExtraction: { ...config.podExtraction, pattern: e.target.value }
                    })
                  }
                  className="ml-2 px-2 py-1 text-xs border border-gray-300 rounded flex-1"
                />
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="podExtraction"
                value="prefix"
                checked={config.podExtraction.method === 'prefix'}
                onChange={() =>
                  setConfig({
                    ...config,
                    podExtraction: { method: 'prefix', prefixLength: config.podExtraction.prefixLength || 2 }
                  })
                }
                className="w-4 h-4 text-blue-600"
              />
              <label className="text-sm text-gray-700">前缀匹配 (分隔符: -)</label>
              {config.podExtraction.method === 'prefix' && (
                <input
                  type="number"
                  min="1"
                  max="5"
                  placeholder="2"
                  value={config.podExtraction.prefixLength || 2}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      podExtraction: {
                        ...config.podExtraction,
                        prefixLength: parseInt(e.target.value) || 2
                      }
                    })
                  }
                  className="ml-2 px-2 py-1 text-xs border border-gray-300 rounded w-16"
                />
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="podExtraction"
                value="none"
                checked={config.podExtraction.method === 'none'}
                onChange={() =>
                  setConfig({
                    ...config,
                    podExtraction: { method: 'none' }
                  })
                }
                className="w-4 h-4 text-blue-600"
              />
              <label className="text-sm text-gray-700">无分组 (显示全部设备)</label>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            正则表达式：按照指定模式匹配 POD 标识 | 前缀匹配：按分隔符分割后取前 N 段
          </p>
        </div>
      </div>

      {/* 文件上传 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">上传数据文件</label>
        <div className="flex gap-3">
          <input ref={fileInputRef} type="file" accept={networkType === 'ib' ? '.csv' : '.xlsx,.xls'} onChange={handleFileChange} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg" />
          <button onClick={handleRestore} disabled={loading || !file} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            <Upload className="w-4 h-4" />
            {loading ? '解析中...' : '还原拓扑'}
          </button>
          <button onClick={() => restoreResult && buildTopology(restoreResult, selectedPod, layerVisibility)} disabled={!restoreResult} className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {file && <p className="text-xs text-gray-500 mt-1">已选择: {file.name}</p>}
      </div>

      {/* 控制面板 */}
      {restoreResult && (
        <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex flex-wrap items-center gap-4">
            {pods.length > 1 && (
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-gray-500" />
                <label className="text-sm font-medium text-gray-700">POD:</label>
                <select value={selectedPod} onChange={(e) => handlePodChange(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
                  {pods.map(pod => <option key={pod} value={pod}>{pod}</option>)}
                </select>
              </div>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-gray-700">显示:</span>
              {Object.keys(layerVisibility).map(layer => (
                <label key={layer} className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={layerVisibility[layer]} onChange={() => toggleLayerVisibility(layer)} className="w-4 h-4" />
                  <span className="text-xs font-medium text-gray-600">{layer.toUpperCase()}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="搜索设备..." className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-48" />
              <button onClick={handleSearch} className="p-2 bg-blue-600 text-white rounded-lg"><Search className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}

      {/* 图例 */}
      {restoreResult && (
        <div className="mb-4 p-3 bg-white border border-gray-200 rounded-lg">
          <div className="flex flex-wrap gap-4 text-xs">
            {Object.keys(layerVisibility).map(layer => (
              <div key={layer} className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ background: layerColors[layer] || layerColors.unknown }}></div>
                <span>{layer.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 错误/消息提示 */}
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">{error}</div>}
      {message && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm mb-4">{message}</div>}

      {/* 拓扑图 */}
      {/* 拓扑图区域 */}
      {restoreResult || loading ? (
        <div className="flex gap-4">
          <div className="flex-1 bg-white border border-gray-200 rounded-lg overflow-hidden relative" style={{ height: '600px' }}>

            {/* 加载进度条悬浮层 */}
            {loading && (
              <div className="absolute inset-0 z-50 bg-white/90 flex flex-col items-center justify-center backdrop-blur-sm">
                <div className="w-64 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600 transition-all duration-300 ease-out" style={{ width: `${loadingProgress}%` }} />
                </div>
                <p className="mt-3 text-sm font-medium text-gray-700">正在构建拓扑... {loadingProgress}%</p>
                <p className="mt-1 text-xs text-gray-400">
                  {renderMode === 'cytoscape' ? '检测到大规模拓扑，已切换至高性能引擎' : '正在加载节点和连接数据'}
                </p>
              </div>
            )}

            {renderMode === 'cytoscape' ? (
              <CytoscapeTopology
                data={restoreResult}
                selectedPod={selectedPod}
                layerVisibility={layerVisibility}
                onNodeClick={(node) => {
                  setSelectedNodeInfo(node);
                  setHighlightedNodeId(node.id);
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
                <MiniMap nodeColor={(node) => layerColors[node.id.split('-')[0]] || layerColors.unknown} style={{ background: '#f0f0f0' }} />
                <Background color="#f0f0f0" gap={20} />
              </ReactFlow>
            )}
          </div>

          {/* 右侧信息面板 */}
          <div className="w-64 bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
              <h4 className="font-semibold text-gray-800 text-sm">详细信息</h4>
              {(selectedNodeInfo || selectedEdgeInfo) && (
                <button
                  onClick={handleCanvasClick}
                  className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-200 rounded"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {selectedNodeInfo ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1">设备ID</p>
                    <p className="text-sm font-mono text-gray-900 break-all">{selectedNodeInfo.id}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1">层级</p>
                    <p className="text-sm">
                      <span className="inline-block px-2 py-1 rounded text-white text-xs font-medium" style={{ background: layerColors[selectedNodeInfo.id.split('-')[0]?.toLowerCase()] || layerColors.unknown }}>
                        {(selectedNodeInfo.layer || selectedNodeInfo.id.split('-')[0]).toUpperCase()}
                      </span>
                    </p>
                  </div>
                  {selectedNodeInfo.data?.label && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">标签</p>
                      <p className="text-sm text-gray-900">{selectedNodeInfo.data.label}</p>
                    </div>
                  )}
                  {renderMode !== 'cytoscape' && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">位置</p>
                      <p className="text-xs text-gray-600">X: {selectedNodeInfo.position?.x.toFixed(0)} | Y: {selectedNodeInfo.position?.y.toFixed(0)}</p>
                    </div>
                  )}

                  {/* 连接到此节点的边 */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase mb-2">连接关系</p>
                    <div className="space-y-1 text-xs">
                      {(() => {
                        const relatedEdges = renderMode === 'cytoscape'
                          ? (restoreResult?.connections || []).filter((e: any) => e.source === selectedNodeInfo.id || e.target === selectedNodeInfo.id)
                          : edges.filter(e => e.source === selectedNodeInfo.id || e.target === selectedNodeInfo.id);

                        return relatedEdges.length > 0 ? (
                          relatedEdges.slice(0, 50).map((edge: any, idx: number) => (
                            <div key={idx} className="p-1.5 bg-gray-50 rounded border border-gray-200">
                              <div className="font-mono text-gray-700">
                                {edge.source === selectedNodeInfo.id ? (
                                  <>→ {edge.target}</>
                                ) : (
                                  <>← {edge.source}</>
                                )}
                              </div>
                              {(edge.label || (edge.srcPort && edge.dstPort)) && (
                                <div className="text-gray-600 mt-0.5">
                                  端口: {edge.label || `${edge.srcPort}-${edge.dstPort}`}
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <p className="text-gray-500 italic">无连接</p>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              ) : selectedEdgeInfo ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1">源设备</p>
                    <p className="text-sm font-mono text-gray-900 break-all">{selectedEdgeInfo.source}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1">目标设备</p>
                    <p className="text-sm font-mono text-gray-900 break-all">{selectedEdgeInfo.target}</p>
                  </div>
                  {(selectedEdgeInfo.label || (selectedEdgeInfo.srcPort && selectedEdgeInfo.dstPort)) && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">端口信息</p>
                      <p className="text-sm font-mono text-gray-900">{selectedEdgeInfo.label || `${selectedEdgeInfo.srcPort}-${selectedEdgeInfo.dstPort}`}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-gray-500 pt-8">
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
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${isDragging ? 'border-blue-500 bg-blue-50' : 'bg-gray-50 border-gray-300'}`}
        >
          <Upload className={`w-12 h-12 mx-auto mb-4 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
          <p className={isDragging ? 'text-blue-600' : 'text-gray-500'}>
            {isDragging ? '释放文件以上传' : `请上传 ${networkType === 'ib' ? 'UFM端口信息CSV' : 'NetQ接口信息Excel'} 文件`}
          </p>
          <p className="text-xs text-gray-400 mt-2">支持拖拽上传</p>
        </div>
      )}
    </div>
  );
};

export const pluginMeta = {
  id: 'topology-restore',
  name: '拓扑还原',
  description: '上传UFM/NetQ数据文件，还原IB/RoCE网络拓扑',
  icon: 'Network',
  version: '1.0.0'
};

export default TopologyRestoreTool;
