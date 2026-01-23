/**
 * 知识图谱可视化组件
 * 使用 Cytoscape.js 展示知识图谱的节点和关系
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import {
  Network, RefreshCw, Download, Maximize2,
  Search, Filter, Info, Database, TrendingUp, Activity,
  Share2, AlertTriangle, Layers, GitBranch
} from 'lucide-react';
import { getApiServerUrl } from '../utils/apiUtils';

// 注册布局插件（仅注册一次）
/* eslint-disable react-hooks/rules-of-hooks */
if (typeof window !== 'undefined') {
  Cytoscape.use(coseBilkent);
}
/* eslint-enable react-hooks/rules-of-hooks */

// 节点类型颜色配置 - 使用更鲜艳的渐变色
const NODE_COLORS = {
  Vendor: '#3b82f6',      // 蓝色 - 厂商
  Function: '#10b981',    // 绿色 - 功能
  Command: '#f59e0b',     // 橙色 - 命令
  Parameter: '#8b5cf6',   // 紫色 - 参数
  default: '#6b7280'      // 灰色 - 默认
};

// 关系类型配置
const EDGE_STYLES = {
  HAS_FUNCTION: { color: '#3b82f6', width: 2 },
  HAS_COMMAND: { color: '#10b981', width: 2 },
  HAS_PARAMETER: { color: '#f59e0b', width: 1.5 },
  default: { color: '#9ca3af', width: 1 }
};

interface GraphStats {
  totalNodes?: number;
  totalRelationships?: number;
  vendors?: number;
  vendorsTotal?: number;
  functions?: number;
  functionsTotal?: number;
  commands?: number;
  commandsTotal?: number;
  parameters?: number;
  parametersTotal?: number;
  relationships?: number;
}

interface KnowledgeGraphStatus {
  status: 'success' | 'error' | 'idle';
  knowledgeGraph?: GraphStats;
  error?: string;
}

interface NodeData {
  id: string;
  label: string;
  type: string;
  properties?: Record<string, any>;
}

interface EdgeData {
  source: string;
  target: string;
  type: string;
}

const KnowledgeGraph: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<GraphStats>({});
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'all' | 'vendor-function'>('vendor-function'); // 新增：视图模式，默认为 Vendor-Function 视图
  const [layoutMode, setLayoutMode] = useState<'force' | 'hierarchy'>('hierarchy'); // 修改：默认使用分层布局
  const [kgStatus, setKgStatus] = useState<'idle' | 'active' | 'error'>('idle');
  const [kgMessage, setKgMessage] = useState('');
  const [kgLastUpdated, setKgLastUpdated] = useState<Date | null>(null);
  const [kgAction, setKgAction] = useState<'idle' | 'init' | 'build' | 'refresh'>('idle');

  /**
   * 获取知识图谱统计信息和状态
   */
  const fetchStats = useCallback(async (markAction: boolean = false) => {
    if (loading && !markAction) return;
    if (markAction) setKgAction('refresh');

    setLoading(true);
    setKgMessage('');

    try {
      const response = await fetch(`${getApiServerUrl()}/api/knowledge-graph/stats`);
      const data: KnowledgeGraphStatus = await response.json();

      console.log('[KnowledgeGraph] 状态响应:', data);

      if (!data || typeof data !== 'object') {
        throw new Error('无效的响应数据');
      }

      const graphStats = data.knowledgeGraph || {};
      setStats(graphStats);
      setKgStatus(data.status === 'success' ? 'active' : data.status === 'error' ? 'error' : 'idle');

      if (data.error) {
        setKgMessage(`警告: ${data.error}`);
        setError(data.error);
      } else {
        setKgMessage('');
        setError('');
      }

      setKgLastUpdated(new Date());
    } catch (err) {
      console.error('获取统计信息失败:', err);
      setKgStatus('error');
      const errorMsg = err instanceof Error ? err.message : '无法获取知识图谱状态';
      setKgMessage(errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
      setKgAction('idle');
    }
  }, [loading]);

  /**
   * 初始化知识图谱连接
   */
  const handleInitKnowledgeGraph = useCallback(async () => {
    setKgAction('init');
    setKgMessage('正在初始化知识图谱连接...');

    try {
      const response = await fetch(`${getApiServerUrl()}/api/knowledge-graph/init`, {
        method: 'POST'
      });
      const data = await response.json();

      if (data.ok) {
        setKgMessage('初始化完成');
        await fetchStats();
      } else {
        throw new Error(data.error || '初始化失败');
      }
    } catch (err: any) {
      setKgMessage(err.message || '初始化失败');
      setError(err.message || '初始化失败');
    } finally {
      setKgAction('idle');
    }
  }, [fetchStats]);

  /**
   * 构建知识图谱
   */
  const handleBuildKnowledgeGraph = useCallback(async () => {
    if (!window.confirm('确定要手动触发知识图谱构建吗？该操作可能需要一些时间。')) {
      return;
    }

    setKgAction('build');
    setKgMessage('正在构建知识图谱...');

    try {
      const response = await fetch(`${getApiServerUrl()}/api/knowledge-graph/build`, {
        method: 'POST'
      });
      const data = await response.json();

      if (data.ok) {
        setKgMessage('构建任务已启动');
        await fetchStats();
        // 构建完成后重新加载图谱
        setTimeout(() => loadGraph(), 2000);
      } else {
        throw new Error(data.error || '构建失败');
      }
    } catch (err: any) {
      setKgMessage(err.message || '构建失败');
      setError(err.message || '构建失败');
    } finally {
      setKgAction('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStats]);

  /**
   * 加载知识图谱数据
   */
  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      // 根据视图模式构建 API URL
      let apiUrl = `${getApiServerUrl()}/api/knowledge-graph/export`;

      if (viewMode === 'vendor-function') {
        // Vendor-Function 视图：只加载 Vendor 和 Function 节点及其关系
        apiUrl += '?nodeTypes=Vendor,Function&relationshipTypes=HAS_FUNCTION';
      }

      // 导出图谱数据
      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.ok) {
        throw new Error(data.error || '导出失败');
      }

      const { nodes, relationships } = data.data;

      // 转换为 Cytoscape 格式
      const elements = [
        // 节点
        ...nodes.map((node: any) => ({
          data: {
            id: node.id,
            label: node.properties.name || node.id,
            type: node.labels[0] || 'Unknown',
            properties: node.properties
          }
        })),
        // 边
        ...relationships.map((rel: any, idx: number) => ({
          data: {
            id: `edge-${idx}`,
            source: rel.startNode,
            target: rel.endNode,
            type: rel.type,
            label: rel.type
          }
        }))
      ];

      // 初始化或更新 Cytoscape
      if (cyRef.current) {
        cyRef.current.elements().remove();
        cyRef.current.add(elements);

        // 根据视图模式选择布局
        if (viewMode === 'vendor-function') {
          // Vendor-Function 视图：使用分层布局
          (cyRef.current.layout({
            name: 'breadthfirst',
            directed: true,
            spacingFactor: 2,
            animate: true,
            animationDuration: 800,
            avoidOverlap: true,
            nodeDimensionsIncludeLabels: true,
            roots: cyRef.current.nodes().filter((node: any) => node.data('type') === 'Vendor').map(node => node.id())
          } as any) as any).run();
        } else {
          // 完整视图：使用力导向布局
          (cyRef.current.layout({
            name: 'cose-bilkent',
            animate: elements.length < 100,
            animationDuration: 800,
            nodeDimensionsIncludeLabels: true,
            idealEdgeLength: 100,
            edgeElasticity: 0.45,
            gravity: 0.25,
            numIter: Math.min(2500, elements.length * 10),
            tile: true,
            randomize: false
          } as any) as any).run();
        }
      } else {
        initCytoscape(elements);
      }

      // 更新统计信息 - 不再重复调用 fetchStats
      // await fetchStats();

    } catch (err: any) {
      console.error('加载知识图谱失败:', err);
      setError(err.message || '加载失败，请检查 Neo4j 连接');
    } finally {
      setLoading(false);
    }
  }, [viewMode]); // 添加 viewMode 依赖

  /**
   * 初始化 Cytoscape 实例
   */
  const initCytoscape = (elements: any[]) => {
    if (!containerRef.current) return;

    const cy = Cytoscape({
      container: containerRef.current,
      elements: elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele: any) => NODE_COLORS[ele.data('type')] || NODE_COLORS.default,
            'label': 'data(label)',
            'color': '#fff',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '11px',
            'font-weight': 'bold',
            'font-family': 'system-ui, -apple-system, sans-serif',
            'width': 70,
            'height': 70,
            'border-width': 3,
            'border-color': '#fff',
            'text-outline-width': 2,
            'text-outline-color': (ele: any) => NODE_COLORS[ele.data('type')] || NODE_COLORS.default,
            'text-wrap': 'wrap',
            'text-max-width': '80px'
          }
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#fbbf24',
            'background-color': (ele: any) => NODE_COLORS[ele.data('type')] || NODE_COLORS.default
          }
        },
        {
          selector: 'node.highlighted',
          style: {
            'border-width': 5,
            'border-color': '#ef4444',
            'background-color': (ele: any) => NODE_COLORS[ele.data('type')] || NODE_COLORS.default,
            'z-index': 999
          }
        },
        {
          selector: 'edge',
          style: {
            'width': (ele: any) => EDGE_STYLES[ele.data('type')]?.width || EDGE_STYLES.default.width,
            'line-color': (ele: any) => EDGE_STYLES[ele.data('type')]?.color || EDGE_STYLES.default.color,
            'target-arrow-color': (ele: any) => EDGE_STYLES[ele.data('type')]?.color || EDGE_STYLES.default.color,
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'opacity': 0.6,
            // 移除边标签，让图谱更清晰
            // 'label': 'data(label)',
            // 'font-size': '10px',
            // 'text-rotation': 'autorotate',
            // 'text-margin-y': -10
          }
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#fbbf24',
            'target-arrow-color': '#fbbf24',
            'width': 3,
            'opacity': 1,
            // 选中时可以显示标签
            'label': 'data(label)',
            'font-size': '11px',
            'color': '#374151',
            'text-background-color': '#ffffff',
            'text-background-opacity': 0.8,
            'text-background-padding': '3px'
          }
        }
      ],
      layout: {
        name: 'cose-bilkent',
        animate: false, // 初始加载时禁用动画以提高性能
        animationDuration: 0,
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: 120,
        edgeElasticity: 0.45,
        gravity: 0.3,
        numIter: 2000, // 减少迭代次数提高性能
        tile: true,
        tilingPaddingVertical: 20,
        tilingPaddingHorizontal: 20,
        randomize: false
      } as any,
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 3
    });

    // 节点点击事件
    cy.on('tap', 'node', (event) => {
      const node = event.target;
      setSelectedNode({
        id: node.id(),
        label: node.data('label'),
        type: node.data('type'),
        properties: node.data('properties')
      });
    });

    // 画布点击事件（取消选择）
    cy.on('tap', (event) => {
      if (event.target === cy) {
        setSelectedNode(null);
      }
    });

    cyRef.current = cy;
  };

  /**
   * 搜索节点
   */
  const handleSearch = useCallback(() => {
    if (!cyRef.current || !searchTerm.trim()) return;

    const cy = cyRef.current;
    cy.elements().removeClass('highlighted');

    const searchLower = searchTerm.toLowerCase();
    const matchedNodes = cy.nodes().filter((node) => {
      const label = String(node.data('label') || '').toLowerCase();
      const type = String(node.data('type') || '').toLowerCase();
      return label.includes(searchLower) || type.includes(searchLower);
    });

    if (matchedNodes.length > 0) {
      matchedNodes.addClass('highlighted');
      cy.fit(matchedNodes, 50);
      cy.animate({
        zoom: Math.min(cy.zoom() * 1.2, 2),
        center: { eles: matchedNodes }
      }, {
        duration: 500
      });
    }
  }, [searchTerm]);

  /**
   * 切换布局模式
   */
  const handleLayoutChange = useCallback((mode: 'force' | 'hierarchy') => {
    setLayoutMode(mode);
    if (!cyRef.current) return;

    const cy = cyRef.current;

    if (mode === 'hierarchy') {
      // 分层布局 - 按节点类型分层
      (cy.layout({
        name: 'breadthfirst',
        directed: true,
        spacingFactor: 1.5,
        animate: true,
        animationDuration: 800,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        // 根据节点类型定义层级
        roots: cy.nodes().filter((node: any) => node.data('type') === 'Vendor').map(node => node.id())
      } as any) as any).run();
    } else {
      // 力导向布局
      (cy.layout({
        name: 'cose-bilkent',
        animate: true,
        animationDuration: 800,
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: 120,
        edgeElasticity: 0.45,
        gravity: 0.3,
        numIter: 2000,
        tile: true,
        randomize: false
      } as any) as any).run();
    }
  }, []);

  /**
   * 过滤节点类型
   */
  const handleFilter = useCallback((type: string) => {
    setFilterType(type);
    if (!cyRef.current) return;

    const cy = cyRef.current;

    if (type === 'all') {
      cy.elements().style('display', 'element');
    } else {
      cy.nodes().style('display', (ele: any) =>
        ele.data('type') === type ? 'element' : 'none'
      );
      cy.edges().style('display', (ele: any) => {
        const source = cy.$id(ele.data('source'));
        const target = cy.$id(ele.data('target'));
        return source.visible() && target.visible() ? 'element' : 'none';
      });
    }
  }, []);

  /**
   * 重置视图
   */
  const handleReset = useCallback(() => {
    if (!cyRef.current) return;
    cyRef.current.fit(undefined, 50);
    cyRef.current.zoom(1);
  }, []);

  /**
   * 导出图片
   */
  const handleExport = useCallback(() => {
    if (!cyRef.current) return;

    const png = cyRef.current.png({
      output: 'blob',
      bg: '#ffffff',
      full: true,
      scale: 2
    });

    const url = URL.createObjectURL(png);
    const link = document.createElement('a');
    link.href = url;
    link.download = `knowledge-graph-${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  // 初始化 - 只在组件挂载时执行一次
  useEffect(() => {
    fetchStats();
    loadGraph();

    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 空依赖数组，只在挂载时执行一次

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 知识图谱状态模块 */}
      <div className="bg-white border-b border-gray-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
              <Share2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                知识图谱状态
                {loading && <RefreshCw className="w-4 h-4 animate-spin text-gray-400" />}
              </h2>
              <p className="text-sm text-gray-500">
                {kgLastUpdated ? `最近更新：${kgLastUpdated.toLocaleString()}` : '尚未获取最新状态'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-3 py-1 text-xs font-medium rounded-full ${kgStatus === 'active'
                  ? 'bg-green-100 text-green-700'
                  : kgStatus === 'error'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-700'
                }`}
            >
              {kgStatus === 'active' ? '运行中' : kgStatus === 'error' ? '异常' : '待检测'}
            </span>
            <button
              onClick={() => fetchStats(true)}
              disabled={kgAction !== 'idle'}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              刷新状态
            </button>
            <button
              onClick={handleInitKnowledgeGraph}
              disabled={kgAction !== 'idle'}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-blue-100 text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
            >
              <Activity className="w-4 h-4" />
              初始化连接
            </button>
            <button
              onClick={handleBuildKnowledgeGraph}
              disabled={kgAction !== 'idle'}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Share2 className="w-4 h-4" />
              手动构建
            </button>
            <button
              onClick={loadGraph}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              <Network className="w-4 h-4" />
              加载图谱
            </button>
          </div>
        </div>

        {/* 统计信息卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {/* 厂商 */}
          <div className="p-3 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-medium text-gray-600">厂商</span>
            </div>
            <p className="text-xl font-semibold text-gray-900">
              {loading ? '...' : (stats.vendorsTotal ?? stats.vendors ?? 0)}
            </p>
          </div>

          {/* 功能 */}
          <div className="p-3 rounded-xl bg-gradient-to-br from-green-50 to-green-100">
            <div className="flex items-center gap-2 mb-1">
              <GitBranch className="w-4 h-4 text-green-600" />
              <span className="text-xs font-medium text-gray-600">功能</span>
            </div>
            <p className="text-xl font-semibold text-gray-900">
              {loading ? '...' : (stats.functionsTotal ?? stats.functions ?? 0)}
            </p>
          </div>

          {/* 命令 */}
          <div className="p-3 rounded-xl bg-gradient-to-br from-orange-50 to-orange-100">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-orange-600" />
              <span className="text-xs font-medium text-gray-600">命令</span>
            </div>
            <p className="text-xl font-semibold text-gray-900">
              {loading ? '...' : (stats.commandsTotal ?? stats.commands ?? 0)}
            </p>
          </div>

          {/* 参数 */}
          <div className="p-3 rounded-xl bg-gradient-to-br from-purple-50 to-purple-100">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-purple-600" />
              <span className="text-xs font-medium text-gray-600">参数</span>
            </div>
            <p className="text-xl font-semibold text-gray-900">
              {loading ? '...' : (stats.parametersTotal ?? stats.parameters ?? 0)}
            </p>
          </div>

          {/* 关系 */}
          <div className="p-3 rounded-xl bg-gradient-to-br from-pink-50 to-pink-100">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-pink-600" />
              <span className="text-xs font-medium text-gray-600">关系</span>
            </div>
            <p className="text-xl font-semibold text-gray-900">
              {loading ? '...' : (stats.relationships ?? 0)}
            </p>
          </div>
        </div>

        {/* 状态消息 */}
        {kgMessage && (
          <div className={`mt-4 flex items-center gap-2 text-sm ${kgStatus === 'error' ? 'text-red-600' : 'text-gray-600'}`}>
            <AlertTriangle className="w-4 h-4" />
            {kgMessage}
          </div>
        )}
      </div>

      {/* 搜索和过滤工具栏 */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* 视图模式切换 */}
          <div className="flex items-center gap-2 border-r pr-3 border-gray-300">
            <span className="text-sm font-medium text-gray-700 whitespace-nowrap">视图:</span>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                onClick={() => {
                  setViewMode('vendor-function');
                  setLayoutMode('hierarchy');
                }}
                className={`px-3 py-1.5 text-sm transition-colors ${viewMode === 'vendor-function'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
              >
                Vendor-Function
              </button>
              <button
                onClick={() => {
                  setViewMode('all');
                  setLayoutMode('force');
                }}
                className={`px-3 py-1.5 text-sm border-l border-gray-300 transition-colors ${viewMode === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
              >
                完整视图
              </button>
            </div>
          </div>

          <div className="flex-1 flex items-center gap-2 min-w-[300px]">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索节点..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              搜索
            </button>
          </div>

          {viewMode === 'all' && (
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={filterType}
                onChange={(e) => handleFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">全部类型</option>
                <option value="Vendor">厂商</option>
                <option value="Function">功能</option>
                <option value="Command">命令</option>
                <option value="Parameter">参数</option>
              </select>
            </div>
          )}

          {/* 布局模式切换 */}
          <div className="flex items-center gap-2 border-l pl-3 border-gray-300">
            <span className="text-sm text-gray-600 whitespace-nowrap">布局:</span>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                onClick={() => handleLayoutChange('force')}
                className={`px-3 py-1.5 text-sm transition-colors ${layoutMode === 'force'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
              >
                力导向
              </button>
              <button
                onClick={() => handleLayoutChange('hierarchy')}
                className={`px-3 py-1.5 text-sm border-l border-gray-300 transition-colors ${layoutMode === 'hierarchy'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
              >
                分层
              </button>
            </div>
          </div>

          <button
            onClick={handleReset}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="重置视图"
          >
            <Maximize2 className="w-5 h-5" />
          </button>

          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            导出图片
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-4 mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        {/* 图谱容器 */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div
            ref={containerRef}
            className="w-full h-full"
            style={{ minHeight: '500px' }}
          />
        </div>

        {/* 侧边栏 - 节点详情 */}
        {selectedNode && (
          <div className="w-80 bg-white rounded-lg border border-gray-200 shadow-sm p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-600" />
                节点详情
              </h3>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">类型</label>
                <div className="mt-1 flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: NODE_COLORS[selectedNode.type] || NODE_COLORS.default }}
                  />
                  <span className="text-sm font-medium text-gray-900">{selectedNode.type}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">名称</label>
                <p className="mt-1 text-sm text-gray-900 font-medium">{selectedNode.label}</p>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 uppercase">ID</label>
                <p className="mt-1 text-xs text-gray-600 font-mono break-all">{selectedNode.id}</p>
              </div>

              {selectedNode.properties && Object.keys(selectedNode.properties).length > 0 && (
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase mb-2 block">属性</label>
                  <div className="space-y-2">
                    {Object.entries(selectedNode.properties).map(([key, value]) => (
                      <div key={key} className="bg-gray-50 rounded p-2">
                        <span className="text-xs font-medium text-gray-600">{key}:</span>
                        <p className="text-sm text-gray-900 mt-1 break-all">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 图例 */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="flex items-center gap-6 text-sm">
          <span className="font-medium text-gray-700">图例：</span>
          {Object.entries(NODE_COLORS).filter(([key]) => key !== 'default').map(([type, color]) => (
            <div key={type} className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-gray-600">{type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default KnowledgeGraph;
