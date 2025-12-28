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

const TopologyRestoreTool: React.FC = () => {
  const [networkType, setNetworkType] = useState<NetworkType>('ib');
  const [file, setFile] = useState<File | null>(null);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const [pods, setPods] = useState<string[]>(['ALL']);
  const [selectedPod, setSelectedPod] = useState('ALL');
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);

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

      const res = await fetch(`${getApiServerUrl()}/api/topology-restore`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '拓扑还原失败');

      setRestoreResult(data);
      setMessage(`成功解析 ${data.nodeCount} 个节点, ${data.edgeCount} 条连接`);

      const visibility: Record<string, boolean> = {};
      (data.layers || []).forEach((layer: string) => { visibility[layer] = true; });
      setLayerVisibility(visibility);

      if (data.pods?.length > 0) {
        setPods(['ALL', ...data.pods]);
        setSelectedPod('ALL');
      }

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

    Object.entries(nodesByLayer).forEach(([layer, layerNodes]: [string, any]) => {
      if (!visibility[layer]) return;

      const nodeList = Array.isArray(layerNodes) ? layerNodes : [];
      let filteredNodes = nodeList;
      if (pod !== 'ALL') {
        filteredNodes = nodeList.filter((n: any) => n.pod === pod || n.id?.includes(pod) || !n.pod);
      }

      filteredNodes.forEach((node: any) => {
        const isHighlighted = highlightedNodeId === node.id;
        newNodes.push({
          id: node.id,
          type: 'default',
          position: { x: node.x || 0, y: node.y || 0 },
          data: {
            label: (
              <div style={{
                ...getNodeStyle(layer),
                ...(isHighlighted ? { boxShadow: '0 0 20px rgba(255, 0, 0, 0.8)', border: '3px solid #ff0000' } : {})
              }}>
                <div>{layer.toUpperCase()}</div>
                <div style={{ fontSize: '8px', marginTop: '2px' }}>{node.label || node.id}</div>
              </div>
            )
          },
          style: { background: 'transparent', border: 'none', padding: 0 }
        });
      });
    });

    const nodeIds = new Set(newNodes.map(n => n.id));
    (connections || []).forEach((conn: any, idx: number) => {
      if (nodeIds.has(conn.source) && nodeIds.has(conn.target)) {
        newEdges.push({
          id: `edge-${idx}`,
          source: conn.source,
          target: conn.target,
          label: conn.srcPort && conn.dstPort ? `${conn.srcPort} - ${conn.dstPort}` : undefined,
          labelStyle: { fontSize: '8px', fill: '#666' },
          style: { stroke: '#666', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#666' }
        });
      }
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [highlightedNodeId, setNodes, setEdges]);

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
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" style={{ height: '600px' }}>
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView attributionPosition="bottom-left">
            <Controls />
            <MiniMap nodeColor={(node) => layerColors[node.id.split('-')[0]] || layerColors.unknown} style={{ background: '#f0f0f0' }} />
            <Background color="#f0f0f0" gap={20} />
          </ReactFlow>
        </div>
      ) : (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">请上传 {networkType === 'ib' ? 'UFM端口信息CSV' : 'NetQ接口信息Excel'} 文件</p>
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
