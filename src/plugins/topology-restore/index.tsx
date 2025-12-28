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
import { Search, Upload, RefreshCw, Layers } from 'lucide-react';

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
    setError('');
    setMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('networkType', networkType);
      formData.append('config', JSON.stringify(config));

      console.log('[TopologyRestore] Config:', config);

      const res = await fetch(`${getApiServerUrl()}/api/topology-restore`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '拓扑还原失败');

      console.log('[TopologyRestore] Result:', data);
      console.log('[TopologyRestore] nodesByLayer 内容:', {
        keys: Object.keys(data.nodesByLayer || {}),
        structure: data.nodesByLayer ? Object.entries(data.nodesByLayer).map(([k, v]: any) => ({
          layer: k,
          nodeCount: Array.isArray(v) ? v.length : 0,
          sampleNode: Array.isArray(v) ? v[0] : null
        })) : null
      });

      setRestoreResult(data);
      setMessage(`成功解析 ${data.nodeCount} 个节点, ${data.edgeCount} 条连接`);

      // 从nodesByLayer获取可见的层级
      const visibleLayers = Object.keys(data.nodesByLayer || {});
      const visibility: Record<string, boolean> = {};
      visibleLayers.forEach((layer: string) => { visibility[layer] = true; });
      setLayerVisibility(visibility);

      console.log('[TopologyRestore] 初始化可见层级:', visibleLayers, visibility);

      if (data.metadata?.pods?.length > 0) {
        setPods(['ALL', ...data.metadata.pods]);
        setSelectedPod('ALL');
      }

      console.log('[TopologyRestore] 准备调用buildTopology，参数：', {
        hasData: !!data,
        pod: 'ALL',
        visibility: visibility,
        nodesByLayerKeys: Object.keys(data.nodesByLayer || {})
      });

      buildTopology(data, 'ALL', visibility);
    } catch (err: any) {
      setError(err.message || '拓扑还原失败');
    } finally {
      setLoading(false);
    }
  };

  const buildTopology = useCallback((data: any, pod: string, visibility: Record<string, boolean>) => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    if (!data?.nodesByLayer) return;

    const { nodesByLayer, connections, layerY: serverLayerY } = data;

    // 构建节点信息映射
    const nodeInfoMap = new Map<string, any>();

    // 预先计算层级的Y坐标和水平布局
    const layerOrder = ['core', 'spine', 'leaf'];
    const layerYPositions: Record<string, number> = {};
    const layerXGaps: Record<string, number> = { core: 150, spine: 130, leaf: 120 };
    const baseY = 100;
    const layerGap = 200;

    layerOrder.forEach((layer, idx) => {
      layerYPositions[layer] = baseY + idx * layerGap;
    });

    // 按层级组织节点，计算位置
    const nodesByLayerWithPos = new Map<string, any[]>();

    Object.entries(nodesByLayer).forEach(([layer, layerNodes]: [string, any]) => {
      if (!visibility[layer]) return;

      const nodeList = Array.isArray(layerNodes) ? layerNodes : [];
      let filteredNodes = nodeList;
      if (pod !== 'ALL') {
        filteredNodes = nodeList.filter((n: any) => n.pod === pod || n.id?.includes(pod) || !n.pod);
      }

      // 为该层的节点计算x坐标
      const xGap = layerXGaps[layer] || 120;
      const startX = 100;
      const yPos = layerYPositions[layer];

      filteredNodes.forEach((node: any, nodeIdx: number) => {
        const xPos = startX + nodeIdx * xGap;

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

        if (!nodesByLayerWithPos.has(layer)) {
          nodesByLayerWithPos.set(layer, []);
        }
        nodesByLayerWithPos.get(layer)!.push(nodeData);
      });
    });

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

    if (newNodes.length === 0) {
      console.warn('[TopologyRestore] 警告：没有生成任何节点！', {
        nodesByLayer: Object.keys(nodesByLayer),
        visibility,
        pod
      });
    }

    setNodes(newNodes);
    setEdges(newEdges);

    console.log('[TopologyRestore] 拓扑渲染完成:', {
      nodeCount: newNodes.length,
      edgeCount: newEdges.length,
      sampleNodes: newNodes.slice(0, 3),
      sampleEdges: newEdges.slice(0, 3),
      nodesByLayerKeys: Object.keys(nodesByLayer),
      visibility,
      layerCounts: {
        core: newNodes.filter(n => n.id.toLowerCase().includes('core')).length,
        spine: newNodes.filter(n => n.id.toLowerCase().includes('spine')).length,
        leaf: newNodes.filter(n => n.id.toLowerCase().includes('leaf')).length
      }
    });
  }, [highlightedNodeId, selectedNodeInfo, selectedEdgeInfo, setNodes, setEdges]);

  const handlePodChange = (pod: string) => {
    setSelectedPod(pod);
    if (restoreResult) buildTopology(restoreResult, pod, layerVisibility);
  };

  const toggleLayerVisibility = (layer: string) => {
    const newVisibility = { ...layerVisibility, [layer]: !layerVisibility[layer] };
    setLayerVisibility(newVisibility);
    if (restoreResult) buildTopology(restoreResult, selectedPod, newVisibility);
  };

  const handleSearch = () => {
    if (!searchTerm.trim()) { setHighlightedNodeId(null); return; }
    const foundNode = nodes.find(n => n.id.toLowerCase().includes(searchTerm.toLowerCase()));
    if (foundNode) {
      setHighlightedNodeId(foundNode.id);
      setMessage(`找到设备: ${foundNode.id}`);
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

        {/* 层级检测方式 */}
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
      {nodes.length > 0 ? (
        <div className="flex gap-4">
          <div className="flex-1 bg-white border border-gray-200 rounded-lg overflow-hidden" style={{ height: '600px' }}>
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
            >
              <Controls />
              <MiniMap nodeColor={(node) => layerColors[node.id.split('-')[0]] || layerColors.unknown} style={{ background: '#f0f0f0' }} />
              <Background color="#f0f0f0" gap={20} />
            </ReactFlow>
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
                      <span className="inline-block px-2 py-1 rounded text-white text-xs font-medium" style={{ background: layerColors[selectedNodeInfo.id.split('-')[0]] || layerColors.unknown }}>
                        {selectedNodeInfo.id.split('-')[0].toUpperCase()}
                      </span>
                    </p>
                  </div>
                  {selectedNodeInfo.data?.label && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">标签</p>
                      <p className="text-sm text-gray-900">{selectedNodeInfo.data.label}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1">位置</p>
                    <p className="text-xs text-gray-600">X: {selectedNodeInfo.position?.x.toFixed(0)} | Y: {selectedNodeInfo.position?.y.toFixed(0)}</p>
                  </div>

                  {/* 连接到此节点的边 */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase mb-2">连接关系</p>
                    <div className="space-y-1 text-xs">
                      {edges.filter(e => e.source === selectedNodeInfo.id || e.target === selectedNodeInfo.id).length > 0 ? (
                        edges.filter(e => e.source === selectedNodeInfo.id || e.target === selectedNodeInfo.id).map((edge, idx) => (
                          <div key={idx} className="p-1.5 bg-gray-50 rounded border border-gray-200">
                            <div className="font-mono text-gray-700">
                              {edge.source === selectedNodeInfo.id ? (
                                <>→ {edge.target}</>
                              ) : (
                                <>← {edge.source}</>
                              )}
                            </div>
                            {edge.label && <div className="text-gray-600 mt-0.5">端口: {edge.label}</div>}
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-500 italic">无连接</p>
                      )}
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
                  {selectedEdgeInfo.label && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">端口信息</p>
                      <p className="text-sm font-mono text-gray-900">{selectedEdgeInfo.label}</p>
                    </div>
                  )}
                  <div className="pt-2 border-t border-gray-200">
                    <p className="text-xs font-medium text-gray-500 uppercase mb-2">链路概览</p>
                    <div className="space-y-1 text-xs">
                      <div className="p-1.5 bg-gray-50 rounded border border-gray-200">
                        <div className="text-gray-600">{selectedEdgeInfo.source}</div>
                        <div className="text-center text-gray-400 my-1">↓</div>
                        <div className="text-gray-600">{selectedEdgeInfo.target}</div>
                      </div>
                    </div>
                  </div>
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
