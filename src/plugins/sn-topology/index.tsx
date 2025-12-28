import React, { useState, useCallback } from 'react';
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
import { Search, Copy, Check } from 'lucide-react';

interface Connection {
  layer: string;
  sourceDevice: string;
  sourcePort: string;
  destDevice: string;
  destPort: string;
}

interface TopologyResult {
  ok: boolean;
  server: { sn: string; hostname: string; rack: string; pod: string; };
  connections: Connection[];
  devices: {
    // IB 网络
    iblf: string[];
    spine: string[];
    core: string[];
    // RoCE 网络
    asw: string[];
    ssw: string[];
    csw: string[];
    lsw: string[];
    soob: string[];
    oob: string[];
  };
  totalConnections: number;
}

function getApiServerUrl(): string {
  const customUrl = localStorage.getItem('custom_api_server_url');
  if (customUrl) return customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
  return `${window.location.protocol}//${window.location.hostname}:8787`;
}

// 设备类型颜色
const layerColors: Record<string, string> = {
  // IB 网络
  server: '#667eea', iblf: '#27ae60', ibsp: '#3498db', ibcr: '#e74c3c',
  // RoCE 网络
  asw: '#2ca02c', ssw: '#1f77b4', csw: '#d62728', lsw: '#ff6b35', soob: '#8000ff', oob: '#ffcc00',
  // 兼容旧名称
  spine: '#3498db', core: '#e74c3c', leaf: '#27ae60',
  unknown: '#95a5a6'
};

const getNodeStyle = (layer: string) => {
  const color = layerColors[layer] || layerColors.unknown;
  return {
    background: color,
    color: ['oob', 'soob'].includes(layer) ? '#333' : 'white',
    border: `2px solid ${color}`,
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '9px',
    fontWeight: '600' as const,
    minWidth: '100px',
    textAlign: 'center' as const,
  };
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
    if (!sn) { setError('请输入 SN'); return; }

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
      if (!data.ok) throw new Error(data.error || '查询失败');
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
    const { devices } = data;

    // 布局：左侧 IB 网络，右侧 RoCE 网络
    const ibX = 200;  // IB 网络 X 基准
    const roceX = 700; // RoCE 网络 X 基准
    const serverX = 450; // 服务器居中

    // Y 坐标层级
    const layerY: Record<string, number> = {
      ibcr: 0, csw: 0,           // 顶层
      ibsp: 120, ssw: 120,       // 第二层
      iblf: 240, asw: 240,       // 第三层
      server: 400,               // 服务器
      oob: 520, soob: 520, lsw: 520  // 底层
    };

    // 服务器节点
    newNodes.push({
      id: 'server',
      type: 'default',
      position: { x: serverX, y: layerY.server },
      data: {
        label: (
          <div style={getNodeStyle('server')}>
            <div>🖥️ GPU Server</div>
            <div style={{ fontSize: '8px', marginTop: '2px' }}>{data.server.hostname}</div>
          </div>
        )
      },
      style: { background: 'transparent', border: 'none', padding: 0 }
    });

    // ========== IB 网络节点 ==========
    // IBLF
    devices.iblf.forEach((dev, idx) => {
      newNodes.push({
        id: `iblf-${dev}`,
        type: 'default',
        position: { x: ibX - 100 + idx * 150, y: layerY.iblf },
        data: { label: <div style={getNodeStyle('iblf')}><div>IBLF</div><div style={{ fontSize: '7px' }}>{dev.split('-').slice(-3).join('-')}</div></div> },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // IBSP (Spine)
    devices.spine.forEach((dev, idx) => {
      newNodes.push({
        id: `ibsp-${dev}`,
        type: 'default',
        position: { x: ibX - 50 + idx * 120, y: layerY.ibsp },
        data: { label: <div style={getNodeStyle('ibsp')}><div>IBSP</div><div style={{ fontSize: '7px' }}>{dev.split('-').slice(-3).join('-')}</div></div> },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // IBCR (Core)
    devices.core.forEach((dev, idx) => {
      newNodes.push({
        id: `ibcr-${dev}`,
        type: 'default',
        position: { x: ibX + idx * 100, y: layerY.ibcr },
        data: { label: <div style={getNodeStyle('ibcr')}><div>IBCR</div><div style={{ fontSize: '7px' }}>{dev.split('-').slice(-3).join('-')}</div></div> },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // ========== RoCE 网络节点 ==========
    // ASW
    devices.asw.forEach((dev, idx) => {
      newNodes.push({
        id: `asw-${dev}`,
        type: 'default',
        position: { x: roceX - 100 + idx * 150, y: layerY.asw },
        data: { label: <div style={getNodeStyle('asw')}><div>ASW</div><div style={{ fontSize: '7px' }}>{dev.split('-').slice(-3).join('-')}</div></div> },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // SSW
    devices.ssw.forEach((dev, idx) => {
      newNodes.push({
        id: `ssw-${dev}`,
        type: 'default',
        position: { x: roceX - 50 + idx * 120, y: layerY.ssw },
        data: { label: <div style={getNodeStyle('ssw')}><div>SSW</div><div style={{ fontSize: '7px' }}>{dev.split('-').slice(-3).join('-')}</div></div> },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // CSW
    devices.csw.forEach((dev, idx) => {
      newNodes.push({
        id: `csw-${dev}`,
        type: 'default',
        position: { x: roceX + idx * 100, y: layerY.csw },
        data: { label: <div style={getNodeStyle('csw')}><div>CSW</div><div style={{ fontSize: '7px' }}>{dev.split('-').slice(-3).join('-')}</div></div> },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // LSW
    devices.lsw.forEach((dev, idx) => {
      newNodes.push({
        id: `lsw-${dev}`,
        type: 'default',
        position: { x: roceX + 200 + idx * 100, y: layerY.lsw },
        data: { label: <div style={getNodeStyle('lsw')}><div>LSW</div><div style={{ fontSize: '7px' }}>{dev.split('-').slice(-3).join('-')}</div></div> },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // OOB
    devices.oob.forEach((dev, idx) => {
      newNodes.push({
        id: `oob-${dev}`,
        type: 'default',
        position: { x: serverX - 100 + idx * 120, y: layerY.oob },
        data: { label: <div style={getNodeStyle('oob')}><div>OOB</div><div style={{ fontSize: '7px' }}>{dev.split('-').slice(-3).join('-')}</div></div> },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // SOOB
    devices.soob.forEach((dev, idx) => {
      newNodes.push({
        id: `soob-${dev}`,
        type: 'default',
        position: { x: serverX + 150 + idx * 120, y: layerY.soob },
        data: { label: <div style={getNodeStyle('soob')}><div>SOOB</div><div style={{ fontSize: '7px' }}>{dev.split('-').slice(-3).join('-')}</div></div> },
        style: { background: 'transparent', border: 'none', padding: 0 }
      });
    });

    // ========== 构建边 ==========
    const nodeIds = new Set(newNodes.map(n => n.id));
    const edgeColors: Record<string, string> = {
      'gpu-iblf': '#27ae60', 'iblf-ibsp': '#3498db', 'ibsp-ibcr': '#e74c3c',
      'gpu-asw': '#2ca02c', 'asw-ssw': '#1f77b4', 'ssw-csw': '#d62728',
      'csw-lsw': '#ff6b35', 'to-oob': '#ffcc00', 'to-soob': '#8000ff'
    };

    const getNodeId = (device: string): string => {
      const upper = device.toUpperCase();
      if (upper.includes('GPU') || upper.includes('MDC-')) {
        if (!upper.includes('IBLF') && !upper.includes('IBSP') && !upper.includes('ASW') && !upper.includes('SSW')) return 'server';
      }
      if (upper.includes('IBLF')) return `iblf-${device}`;
      if (upper.includes('IBSP')) return `ibsp-${device}`;
      if (upper.includes('IBCR')) return `ibcr-${device}`;
      if (upper.includes('ASW')) return `asw-${device}`;
      if (upper.includes('SSW')) return `ssw-${device}`;
      if (upper.includes('CSW')) return `csw-${device}`;
      if (upper.includes('LSW')) return `lsw-${device}`;
      if (upper.includes('SOOB')) return `soob-${device}`;
      if (upper.includes('OOB')) return `oob-${device}`;
      return 'server';
    };

    data.connections.forEach((conn, idx) => {
      const sourceId = getNodeId(conn.sourceDevice);
      const targetId = getNodeId(conn.destDevice);
      const color = edgeColors[conn.layer] || '#999';

      if (nodeIds.has(sourceId) && nodeIds.has(targetId) && sourceId !== targetId) {
        newEdges.push({
          id: `edge-${idx}`,
          source: sourceId,
          target: targetId,
          label: conn.sourcePort && conn.destPort ? `${conn.sourcePort} - ${conn.destPort}` : undefined,
          labelStyle: { fontSize: '7px', fill: '#666' },
          style: { stroke: color, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color }
        });
      }
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [setNodes, setEdges]);

  const copyResult = () => {
    if (!result) return;
    let text = `SN 拓扑查询结果\n服务器: ${result.server.hostname} (${result.server.sn})\n`;
    text += `机架: ${result.server.rack} | POD: ${result.server.pod}\n\n`;
    text += `=== IB 网络 ===\nIBLF: ${result.devices.iblf.length}, IBSP: ${result.devices.spine.length}, IBCR: ${result.devices.core.length}\n\n`;
    text += `=== RoCE 网络 ===\nASW: ${result.devices.asw.length}, SSW: ${result.devices.ssw.length}, CSW: ${result.devices.csw.length}\n\n`;
    text += `连接详情 (${result.totalConnections} 条):\n`;
    result.connections.forEach(conn => {
      text += `  [${conn.layer}] ${conn.sourceDevice}:${conn.sourcePort} → ${conn.destDevice}:${conn.destPort}\n`;
    });
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const ibCount = (result?.devices.iblf.length || 0) + (result?.devices.spine.length || 0) + (result?.devices.core.length || 0);
  const roceCount = (result?.devices.asw.length || 0) + (result?.devices.ssw.length || 0) + (result?.devices.csw.length || 0);

  return (
    <div className="p-6">
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">输入服务器 SN</label>
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder="GOG4X8312A0131"
          />
          <button onClick={handleQuery} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            <Search className="w-4 h-4" />
            {loading ? '查询中...' : '查询'}
          </button>
          {result && (
            <button onClick={copyResult} className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-bold text-blue-800 mb-2">服务器信息</h3>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="text-gray-500">SN:</span> {result.server.sn}</div>
              <div><span className="text-gray-500">主机名:</span> {result.server.hostname}</div>
              <div><span className="text-gray-500">机架:</span> {result.server.rack}</div>
              <div><span className="text-gray-500">POD:</span> {result.server.pod}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* IB 网络统计 */}
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="font-bold text-green-800 mb-2">IB 网络 (InfiniBand)</h3>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="px-2 py-1 bg-green-100 text-green-800 rounded">IBLF: {result.devices.iblf.length}</span>
                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">IBSP: {result.devices.spine.length}</span>
                <span className="px-2 py-1 bg-red-100 text-red-800 rounded">IBCR: {result.devices.core.length}</span>
              </div>
            </div>
            {/* RoCE 网络统计 */}
            <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <h3 className="font-bold text-purple-800 mb-2">RoCE 网络 (以太网)</h3>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="px-2 py-1 bg-green-100 text-green-800 rounded">ASW: {result.devices.asw.length}</span>
                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">SSW: {result.devices.ssw.length}</span>
                <span className="px-2 py-1 bg-red-100 text-red-800 rounded">CSW: {result.devices.csw.length}</span>
                {result.devices.oob.length > 0 && <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded">OOB: {result.devices.oob.length}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {nodes.length > 0 && (
        <div className="mt-4 bg-white border border-gray-200 rounded-lg overflow-hidden" style={{ height: '550px' }}>
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView attributionPosition="bottom-left">
            <Controls />
            <MiniMap style={{ background: '#f0f0f0' }} />
            <Background color="#f0f0f0" gap={20} />
          </ReactFlow>
        </div>
      )}

      {result && result.connections.length > 0 && (
        <div className="mt-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h4 className="font-semibold text-gray-800">连接详情 ({result.connections.length} 条)</h4>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.connections.map((conn, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="py-2 px-4 text-xs"><span className="px-2 py-0.5 bg-gray-100 rounded">{conn.layer}</span></td>
                    <td className="py-2 px-4 font-mono text-xs">{conn.sourceDevice}</td>
                    <td className="py-2 px-4">{conn.sourcePort}</td>
                    <td className="py-2 px-4 font-mono text-xs">{conn.destDevice}</td>
                    <td className="py-2 px-4">{conn.destPort}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export const pluginMeta = {
  id: 'sn-topology',
  name: 'SN 拓扑查询',
  description: '根据SN查询服务器的IB和RoCE双网络拓扑链路',
  icon: 'GitBranch',
  version: '3.0.0'
};

export default SnTopologyTool;
