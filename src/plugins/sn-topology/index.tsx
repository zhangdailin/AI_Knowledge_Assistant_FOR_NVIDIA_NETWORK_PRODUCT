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
import { Search, Copy, Check, Filter } from 'lucide-react';

type NetworkFilter = 'all' | 'ib' | 'roce';

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
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>('all');
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({
    iblf: true, ibsp: true, ibcr: true,
    asw: true, ssw: true, csw: true, lsw: true, soob: true, oob: true
  });

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

  const buildTopology = useCallback((data: TopologyResult, filter: NetworkFilter = networkFilter, visibility: Record<string, boolean> = layerVisibility) => {
    // Stringify data for easy debugging via copy-paste
    console.log('=== Topology API Debug Info ===');
    console.log('API Version:', (data as any)._version || 'UNKNOWN (Old Code)');
    console.log('API Debug Data:', (data as any)._debug);
    console.log('Raw API Response:', JSON.stringify(data, null, 2));

    console.log('buildTopology config:', {
      deviceCount: data.devices ? Object.values(data.devices).flat().length : 0,
      filter,
      visibility
    });

    if (!data.devices) {
      console.error('buildTopology: data.devices is missing!', data);
      return;
    }

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const { devices } = data;
    const showIB = filter === 'all' || filter === 'ib';
    const showRoCE = filter === 'all' || filter === 'roce';

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
    if (showIB && visibility.iblf) {
      console.log('[DEBUG] Creating IBLF nodes:', devices.iblf);
      devices.iblf.forEach((dev, idx) => {
        newNodes.push({
          id: `iblf-${dev}`,
          type: 'default',
          position: { x: ibX - 100 + idx * 150, y: layerY.iblf },
          data: { label: <div style={getNodeStyle('iblf')}><div>IBLF</div><div style={{ fontSize: '7px' }}>{dev.split('-').slice(-3).join('-')}</div></div> },
          style: { background: 'transparent', border: 'none', padding: 0 }
        });
      });
    }

    // RoCE 网络只显示ASW
    if (showRoCE && visibility.asw) {
      console.log('[DEBUG] Creating ASW nodes:', devices.asw);
      devices.asw.forEach((dev, idx) => {
        newNodes.push({
          id: `asw-${dev}`,
          type: 'default',
          position: { x: roceX - 100 + idx * 150, y: layerY.asw },
          data: { label: <div style={getNodeStyle('asw')}><div>ASW</div><div style={{ fontSize: '7px' }}>{dev.split('-').slice(-3).join('-')}</div></div> },
          style: { background: 'transparent', border: 'none', padding: 0 }
        });
      });
    }

    // ========== 构建边 ==========
    const nodeIds = new Set(newNodes.map(n => n.id));
    console.log('[DEBUG] Created nodes:', Array.from(nodeIds));

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

    const failedEdges: any[] = [];
    data.connections.forEach((conn, idx) => {
      const sourceId = getNodeId(conn.sourceDevice);
      const targetId = getNodeId(conn.destDevice);
      const color = edgeColors[conn.layer] || '#999';

      // 临时修复：检查设备是否在后端返回的devices中
      const allDevicesInList = [
        ...devices.iblf, ...devices.spine, ...devices.core,
        ...devices.asw, ...devices.ssw, ...devices.csw, ...devices.lsw,
        ...devices.soob, ...devices.oob
      ];
      const sourceExists = allDevicesInList.includes(conn.sourceDevice) || conn.sourceDevice === data.server.hostname;
      const targetExists = allDevicesInList.includes(conn.destDevice) || conn.destDevice === data.server.hostname;

      if (nodeIds.has(sourceId) && nodeIds.has(targetId) && sourceId !== targetId && sourceExists && targetExists) {
        newEdges.push({
          id: `edge-${idx}`,
          source: sourceId,
          target: targetId,
          label: conn.sourcePort && conn.destPort ? `${conn.sourcePort} - ${conn.destPort}` : undefined,
          labelStyle: { fontSize: '7px', fill: '#666' },
          style: { stroke: color, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color }
        });
      } else {
        // 记录失败的边，用于调试
        failedEdges.push({
          layer: conn.layer,
          sourceDevice: conn.sourceDevice,
          destDevice: conn.destDevice,
          sourceId,
          targetId,
          sourceExists: nodeIds.has(sourceId) && sourceExists,
          targetExists: nodeIds.has(targetId) && targetExists,
          sameNode: sourceId === targetId,
          reason: !sourceExists ? 'sourceNotInDevices' : !targetExists ? 'targetNotInDevices' : 'nodeNotInGraph'
        });
      }
    });

    if (failedEdges.length > 0) {
      console.warn('[DEBUG] 以下连接无法映射到节点（拓扑渲染问题的根本原因）:', failedEdges);

      // 详细分析失败原因
      const failureAnalysis = {
        sourceNotFound: failedEdges.filter(e => !e.sourceExists).length,
        targetNotFound: failedEdges.filter(e => !e.targetExists).length,
        sameNode: failedEdges.filter(e => e.sameNode).length,
        examples: failedEdges.slice(0, 5)  // 前5个例子
      };
      console.warn('[DEBUG] 失败原因统计:', failureAnalysis);

      // 打印失败的设备名，找出规律
      const failedSourceDevices = new Set(failedEdges.map(e => e.sourceDevice));
      const failedTargetDevices = new Set(failedEdges.map(e => e.destDevice));
      console.warn('[DEBUG] 失败的源设备:', Array.from(failedSourceDevices).slice(0, 10));
      console.warn('[DEBUG] 失败的目标设备:', Array.from(failedTargetDevices).slice(0, 10));

      // 对比devices中有什么
      const allDevicesInList = [
        ...devices.iblf, ...devices.spine, ...devices.core,
        ...devices.asw, ...devices.ssw, ...devices.csw, ...devices.lsw
      ];
      console.warn('[DEBUG] devices列表中的设备总数:', allDevicesInList.length);
      console.warn('[DEBUG] devices列表样本:', allDevicesInList.slice(0, 10));
    }

    console.log('Topology built:', { nodes: newNodes.length, edges: newEdges.length, failedEdges: failedEdges.length });
    setNodes(newNodes);
    setEdges(newEdges);
  }, [setNodes, setEdges, networkFilter, layerVisibility]);

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

          {/* 视图控制面板 */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex flex-col gap-4">
              {/* 网络过滤 */}
              <div className="flex items-center gap-4">
                <span className="text-sm font-semibold text-gray-700">网络视图:</span>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  <button
                    onClick={() => { setNetworkFilter('all'); buildTopology(result, 'all', layerVisibility); }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${networkFilter === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                  >
                    全部显示
                  </button>
                  <button
                    onClick={() => { setNetworkFilter('ib'); buildTopology(result, 'ib', layerVisibility); }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${networkFilter === 'ib' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                  >
                    IB 网络 Only
                  </button>
                  <button
                    onClick={() => { setNetworkFilter('roce'); buildTopology(result, 'roce', layerVisibility); }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${networkFilter === 'roce' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                  >
                    RoCE 网络 Only
                  </button>
                </div>
              </div>

              {/* 层级控制 */}
              <div className="flex flex-wrap gap-y-2 gap-x-6">
                <span className="text-sm font-semibold text-gray-700 w-full sm:w-auto">层级显示:</span>

                {/* IB 层级 */}
                {(networkFilter === 'all' || networkFilter === 'ib') && (
                  <div className="flex gap-3 items-center border-r border-gray-200 pr-6">
                    <span className="text-xs text-gray-500 font-medium">IB:</span>
                    {['iblf', 'ibsp', 'ibcr'].map(layer => (
                      <label key={layer} className="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-gray-50 px-1.5 py-0.5 rounded">
                        <input
                          type="checkbox"
                          checked={layerVisibility[layer]}
                          onChange={(e) => {
                            const newVisibility = { ...layerVisibility, [layer]: e.target.checked };
                            setLayerVisibility(newVisibility);
                            buildTopology(result, networkFilter, newVisibility);
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="uppercase">{layer.replace('ib', '')}</span>
                      </label>
                    ))}
                  </div>
                )}

                {/* RoCE 层级 */}
                {(networkFilter === 'all' || networkFilter === 'roce') && (
                  <div className="flex gap-3 items-center flex-wrap">
                    <span className="text-xs text-gray-500 font-medium">RoCE:</span>
                    {['asw', 'ssw', 'csw', 'lsw', 'oob', 'soob'].map(layer => (
                      <label key={layer} className="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-gray-50 px-1.5 py-0.5 rounded">
                        <input
                          type="checkbox"
                          checked={layerVisibility[layer]}
                          onChange={(e) => {
                            const newVisibility = { ...layerVisibility, [layer]: e.target.checked };
                            setLayerVisibility(newVisibility);
                            buildTopology(result, networkFilter, newVisibility);
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="uppercase">{layer}</span>
                      </label>
                    ))}
                  </div>
                )}
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
