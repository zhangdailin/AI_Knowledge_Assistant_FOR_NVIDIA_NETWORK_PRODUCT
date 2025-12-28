import React, { useState, useCallback, useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Search, Copy, Check, Network, Server, Cpu } from 'lucide-react';

interface Connection {
  layer: string;
  sourceDevice: string;
  sourcePort: string;
  destDevice: string;
  destPort: string;
  cableType?: string;
  cableLength?: string;
}

interface TopologyResult {
  ok: boolean;
  server: {
    sn: string;
    hostname: string;
    rack: string;
    pod: string;
  };
  connections: Connection[];
  devices: {
    iblf: string[];
    spine: string[];
    core: string[];
    edge: string[];
    leaf: string[];
    oobSpine: string[];
    oobLeaf: string[];
  };
  totalConnections: number;
}

function getApiServerUrl(): string {
  const customUrl = localStorage.getItem('custom_api_server_url');
  if (customUrl) return customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  return `${protocol}//${hostname}:8787`;
}

// 自定义节点样式
const nodeStyles = {
  server: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: '2px solid #5a67d8',
    borderRadius: '12px',
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: 'bold',
    minWidth: '180px',
    textAlign: 'center' as const,
    boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)'
  },
  iblf: {
    background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    color: 'white',
    border: '2px solid #0d8a6f',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '11px',
    fontWeight: '600',
    minWidth: '160px',
    textAlign: 'center' as const,
    boxShadow: '0 4px 12px rgba(17, 153, 142, 0.3)'
  },
  spine: {
    background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    color: 'white',
    border: '2px solid #e84393',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '11px',
    fontWeight: '600',
    minWidth: '140px',
    textAlign: 'center' as const,
    boxShadow: '0 4px 12px rgba(245, 87, 108, 0.3)'
  },
  core: {
    background: 'linear-gradient(135deg, #ff9a56 0%, #ff6b6b 100%)',
    color: 'white',
    border: '2px solid #e55039',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '11px',
    fontWeight: '600',
    minWidth: '120px',
    textAlign: 'center' as const,
    boxShadow: '0 4px 12px rgba(255, 107, 107, 0.3)'
  },
  edge: {
    background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    color: 'white',
    border: '2px solid #0984e3',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '11px',
    fontWeight: '600',
    minWidth: '120px',
    textAlign: 'center' as const,
    boxShadow: '0 4px 12px rgba(79, 172, 254, 0.3)'
  },
  leaf: {
    background: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    color: '#333',
    border: '2px solid #74b9ff',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '11px',
    fontWeight: '600',
    minWidth: '120px',
    textAlign: 'center' as const,
    boxShadow: '0 4px 12px rgba(116, 185, 255, 0.3)'
  },
  oob: {
    background: 'linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%)',
    color: 'white',
    border: '2px solid #5f27cd',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '11px',
    fontWeight: '600',
    minWidth: '120px',
    textAlign: 'center' as const,
    boxShadow: '0 4px 12px rgba(108, 92, 231, 0.3)'
  }
};

const SnTopologyTool: React.FC = () => {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<TopologyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const handleQuery = async () => {
    const sn = input.trim();
    if (!sn) {
      setError('请输入 SN');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch(`${getApiServerUrl()}/api/sn-to-topology`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sn })
      });

      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || '查询失败');
      }
      setResult(data);
      buildTopology(data);
    } catch (err: any) {
      setError(err.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const buildTopology = useCallback((data: TopologyResult) => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const { devices, connections } = data;

    // 层级 Y 坐标配置
    const layerY = {
      edge: 0,
      core: 100,
      spine: 200,
      iblf: 350,
      server: 500,
      oob: 600
    };

    // 服务器节点（底部中央）
    newNodes.push({
      id: 'server',
      type: 'default',
      position: { x: 400, y: layerY.server },
      data: {
        label: (
          <div style={nodeStyles.server}>
            <div style={{ marginBottom: '4px' }}>🖥️ 服务器</div>
            <div style={{ fontSize: '10px', opacity: 0.9 }}>{data.server.hostname}</div>
            <div style={{ fontSize: '9px', opacity: 0.7 }}>{data.server.sn}</div>
          </div>
        )
      },
      style: { background: 'transparent', border: 'none', padding: 0 }
    });

    // IBLF 节点
    devices.iblf.forEach((iblf, idx) => {
      const xPos = 150 + idx * 200;
      newNodes.push({
        id: `iblf-${iblf}`,
        type: 'default',
        position: { x: xPos, y: layerY.iblf },
        data: {
          label: (
            <div style={nodeStyles.iblf}>
              <div style={{ marginBottom: '2px' }}>🔀 IBLF</div>
              <div style={{ fontSize: '9px' }}>{iblf.split('-').slice(-3).join('-')}</div>
            </div>
          )
        },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // SPINE 节点
    devices.spine.forEach((spine, idx) => {
      const xPos = 200 + idx * 200;
      newNodes.push({
        id: `spine-${spine}`,
        type: 'default',
        position: { x: xPos, y: layerY.spine },
        data: {
          label: (
            <div style={nodeStyles.spine}>
              <div style={{ marginBottom: '2px' }}>📡 Spine</div>
              <div style={{ fontSize: '9px' }}>{spine}</div>
            </div>
          )
        },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // CORE 节点
    devices.core.forEach((core, idx) => {
      const xPos = 250 + idx * 180;
      newNodes.push({
        id: `core-${core}`,
        type: 'default',
        position: { x: xPos, y: layerY.core },
        data: {
          label: (
            <div style={nodeStyles.core}>
              <div style={{ marginBottom: '2px' }}>🔲 Core</div>
              <div style={{ fontSize: '9px' }}>{core}</div>
            </div>
          )
        },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // EDGE 节点
    devices.edge.forEach((edge, idx) => {
      const xPos = 100 + idx * 160;
      newNodes.push({
        id: `edge-${edge}`,
        type: 'default',
        position: { x: xPos, y: layerY.edge },
        data: {
          label: (
            <div style={nodeStyles.edge}>
              <div style={{ marginBottom: '2px' }}>🌐 Edge</div>
              <div style={{ fontSize: '9px' }}>{edge}</div>
            </div>
          )
        },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // LEAF 节点 (HSS-LEAF, STL-LEAF)
    devices.leaf.forEach((leaf, idx) => {
      const xPos = 500 + idx * 160;
      newNodes.push({
        id: `leaf-${leaf}`,
        type: 'default',
        position: { x: xPos, y: layerY.edge },
        data: {
          label: (
            <div style={nodeStyles.leaf}>
              <div style={{ marginBottom: '2px' }}>🍃 Leaf</div>
              <div style={{ fontSize: '9px' }}>{leaf}</div>
            </div>
          )
        },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // OOB 节点（带外管理网络）
    const oobDevices = [...devices.oobSpine, ...devices.oobLeaf];
    oobDevices.forEach((oob, idx) => {
      const xPos = 100 + idx * 150;
      newNodes.push({
        id: `oob-${oob}`,
        type: 'default',
        position: { x: xPos, y: layerY.oob },
        data: {
          label: (
            <div style={nodeStyles.oob}>
              <div style={{ marginBottom: '2px' }}>🔧 OOB</div>
              <div style={{ fontSize: '9px' }}>{oob}</div>
            </div>
          )
        },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // 创建节点 ID 集合用于验证边的有效性
    const nodeIds = new Set(newNodes.map(n => n.id));

    // 根据连接数据创建边
    const edgeColors: Record<string, string> = {
      'server-iblf': '#667eea',
      'iblf-spine': '#11998e',
      'spine-core': '#f5576c',
      'core-edge': '#ff6b6b',
      'oob': '#6c5ce7'
    };

    // 辅助函数：根据设备名称获取节点 ID
    const getNodeIdForEdge = (device: string): string => {
      const deviceUpper = device.toUpperCase();
      if (deviceUpper.includes('GPU') || (deviceUpper.startsWith('MDC-') && !deviceUpper.includes('IBLF') && !deviceUpper.includes('SPINE'))) {
        return 'server';
      }
      if (deviceUpper.includes('IBLF')) return `iblf-${device}`;
      if (deviceUpper.includes('SPINE') && !deviceUpper.includes('OOB')) return `spine-${device}`;
      if (deviceUpper.includes('CORE')) return `core-${device}`;
      if (deviceUpper.includes('EDGE') && !deviceUpper.includes('OOB')) return `edge-${device}`;
      if (deviceUpper.includes('LEAF') && !deviceUpper.includes('OOB')) return `leaf-${device}`;
      if (deviceUpper.includes('OOB')) return `oob-${device}`;
      return 'server';
    };

    connections.forEach((conn, idx) => {
      const sourceId = getNodeIdForEdge(conn.sourceDevice);
      const targetId = getNodeIdForEdge(conn.destDevice);
      const color = edgeColors[conn.layer] || '#999';

      // 只添加源和目标节点都存在的边
      if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
        newEdges.push({
          id: `edge-${idx}`,
          source: sourceId,
          target: targetId,
          label: conn.sourcePort && conn.destPort ? `${conn.sourcePort} → ${conn.destPort}` : undefined,
          labelStyle: { fontSize: '8px', fill: '#666' },
          style: { stroke: color, strokeWidth: conn.layer === 'server-iblf' ? 2 : 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color },
          animated: conn.layer === 'server-iblf'
        });
      }
    });

    console.log(`[Topology] Created ${newNodes.length} nodes, ${newEdges.length} edges from ${connections.length} connections`);

    setNodes(newNodes);
    setEdges(newEdges);
  }, [setNodes, setEdges]);

  const copyResult = () => {
    if (!result) return;

    let text = `SN 拓扑查询结果\n`;
    text += `服务器: ${result.server.hostname} (${result.server.sn})\n`;
    text += `机架: ${result.server.rack} | POD: ${result.server.pod}\n\n`;

    text += `设备统计:\n`;
    text += `  IBLF: ${result.devices.iblf.length} | SPINE: ${result.devices.spine.length}\n`;
    text += `  CORE: ${result.devices.core.length} | EDGE: ${result.devices.edge.length}\n`;
    if (result.devices.leaf.length > 0) text += `  LEAF: ${result.devices.leaf.length}\n`;
    if (result.devices.oobSpine.length > 0 || result.devices.oobLeaf.length > 0) {
      text += `  OOB: ${result.devices.oobSpine.length + result.devices.oobLeaf.length}\n`;
    }

    text += `\n连接详情 (${result.totalConnections} 条):\n`;
    result.connections.forEach(conn => {
      text += `  [${conn.layer}] ${conn.sourceDevice}:${conn.sourcePort} → ${conn.destDevice}:${conn.destPort}`;
      if (conn.cableType) text += ` (${conn.cableType})`;
      text += '\n';
    });

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          输入服务器 SN
        </label>
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="GOG4X8312A0131"
          />
          <button
            onClick={handleQuery}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Search className="w-4 h-4" />
            {loading ? '查询中...' : '查询'}
          </button>
          {result && (
            <button
              onClick={copyResult}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* 服务器信息 */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-bold text-blue-800 mb-2">服务器信息</h3>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="text-gray-500">SN:</span> {result.server.sn}</div>
              <div><span className="text-gray-500">主机名:</span> {result.server.hostname}</div>
              <div><span className="text-gray-500">机架:</span> {result.server.rack}</div>
              <div><span className="text-gray-500">POD:</span> {result.server.pod}</div>
            </div>
          </div>

          {/* 设备统计 */}
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <h3 className="font-bold text-gray-800 mb-2">设备统计</h3>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full">IBLF: {result.devices.iblf.length}</span>
              <span className="px-3 py-1 bg-pink-100 text-pink-800 rounded-full">SPINE: {result.devices.spine.length}</span>
              <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full">CORE: {result.devices.core.length}</span>
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full">EDGE: {result.devices.edge.length}</span>
              {result.devices.leaf.length > 0 && (
                <span className="px-3 py-1 bg-teal-100 text-teal-800 rounded-full">LEAF: {result.devices.leaf.length}</span>
              )}
              {(result.devices.oobSpine.length > 0 || result.devices.oobLeaf.length > 0) && (
                <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full">OOB: {result.devices.oobSpine.length + result.devices.oobLeaf.length}</span>
              )}
              <span className="px-3 py-1 bg-gray-200 text-gray-700 rounded-full">连接: {result.totalConnections}</span>
            </div>
          </div>

          {/* 拓扑图 */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" style={{ height: '650px' }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              fitView
              attributionPosition="bottom-left"
            >
              <Controls />
              <Background color="#f0f0f0" gap={20} />
            </ReactFlow>
          </div>

          {/* 连接详情表格 */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <h4 className="font-semibold text-gray-800">连接详情 ({result.connections.length} 条，共 {result.totalConnections} 条)</h4>
            </div>
            <div className="overflow-x-auto max-h-60">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left py-2 px-4 font-medium text-gray-600">层级</th>
                    <th className="text-left py-2 px-4 font-medium text-gray-600">源设备</th>
                    <th className="text-left py-2 px-4 font-medium text-gray-600">源端口</th>
                    <th className="text-left py-2 px-4 font-medium text-gray-600">目标设备</th>
                    <th className="text-left py-2 px-4 font-medium text-gray-600">目标端口</th>
                    <th className="text-left py-2 px-4 font-medium text-gray-600">类型</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.connections.map((conn, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="py-2 px-4 text-xs">
                        <span className="px-2 py-0.5 bg-gray-100 rounded">{conn.layer}</span>
                      </td>
                      <td className="py-2 px-4 font-mono text-xs">{conn.sourceDevice}</td>
                      <td className="py-2 px-4">{conn.sourcePort}</td>
                      <td className="py-2 px-4 font-mono text-xs">{conn.destDevice}</td>
                      <td className="py-2 px-4">{conn.destPort}</td>
                      <td className="py-2 px-4 text-gray-500">{conn.cableType || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 插件元数据
export const pluginMeta = {
  id: 'sn-topology',
  name: 'SN 拓扑查询',
  description: '根据服务器 SN 查询网络连线拓扑',
  icon: 'GitBranch',
  version: '1.0.0'
};

export default SnTopologyTool;
