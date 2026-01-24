/**
 * 知识图谱可视化组件
 * 使用 Cytoscape.js 展示知识图谱的节点和关系
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import {
  Network, RefreshCw, Download, Maximize2,
  Search, Info, Database, TrendingUp, Activity,
  Share2, AlertTriangle, Layers, GitBranch,
  Eye, EyeOff, Filter, Link2, Target, ArrowUpRight
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

const LABEL_ZOOM_THRESHOLD = 0.6;
const MAX_SEARCH_RESULTS = 8;
const MAX_NEIGHBOR_ITEMS = 10;
const OVERVIEW_VENDOR_KEY = '__overview__';

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
  degree?: number;
  properties?: Record<string, any>;
}

interface EdgeData {
  source: string;
  target: string;
  type: string;
}

interface GraphIndexItem {
  id: string;
  label: string;
  type: string;
  degree: number;
  labelLower: string;
}

interface VendorOption {
  id: string;
  name: string;
}

interface VendorSelectOption {
  value: string;
  label: string;
}

const KnowledgeGraph: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const graphCacheRef = useRef<{ nodes: any[]; relationships: any[] } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<GraphStats>({});
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [selectedNeighbors, setSelectedNeighbors] = useState<GraphIndexItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [layoutMode, setLayoutMode] = useState<'force' | 'hierarchy'>('hierarchy'); // 布局模式：力导向或分层
  const [graphIndex, setGraphIndex] = useState<GraphIndexItem[]>([]);
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string>('');
  const [showLabels, setShowLabels] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [focusNeighbors, setFocusNeighbors] = useState(true);
  const [typeFilters, setTypeFilters] = useState({ Vendor: true, Function: true });
  const [graphVersion, setGraphVersion] = useState(0);
  const [forceStrength, setForceStrength] = useState(1);
  const [forceProfile, setForceProfile] = useState({ label: '稀疏', nodeCount: 0 });
  const [kgStatus, setKgStatus] = useState<'idle' | 'active' | 'error'>('idle');
  const [kgMessage, setKgMessage] = useState('');
  const [kgLastUpdated, setKgLastUpdated] = useState<Date | null>(null);
  const [kgAction, setKgAction] = useState<'idle' | 'init' | 'build' | 'refresh'>('idle');

  const searchResults = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return [];
    const enabledTypes = new Set<string>();
    if (typeFilters.Vendor) enabledTypes.add('Vendor');
    if (typeFilters.Function) enabledTypes.add('Function');
    return graphIndex
      .filter(item => enabledTypes.has(item.type) && item.labelLower.includes(term))
      .slice(0, MAX_SEARCH_RESULTS);
  }, [searchTerm, graphIndex, typeFilters]);

  const vendorSelectOptions: VendorSelectOption[] = React.useMemo(() => ([
    { value: '', label: '请选择厂商' },
    { value: OVERVIEW_VENDOR_KEY, label: '概览（仅厂商）' },
    ...vendorOptions.map(option => ({ value: option.name, label: option.name }))
  ]), [vendorOptions]);

  const runHierarchyLayout = useCallback((cy: cytoscape.Core, animate: boolean) => {
    (cy.layout({
      name: 'concentric',
      concentric: (node: any) => {
        return node.data('type') === 'Vendor' ? 100 : 1;
      },
      levelWidth: () => 1,
      minNodeSpacing: 120,
      animate,
      avoidOverlap: true,
      nodeDimensionsIncludeLabels: true,
      spacingFactor: 1.5,
      fit: true,
      padding: 50
    } as any) as any).run();
  }, []);

  const runForceLayout = useCallback((cy: cytoscape.Core, animate: boolean) => {
    const nodeCount = cy.nodes().length;
    const isDense = nodeCount > 220;
    const strength = Math.min(1.6, Math.max(0.6, forceStrength));
    const shouldAnimate = animate && nodeCount <= 180;
    const baseEdgeLength = isDense ? 90 : 120;
    const baseElasticity = isDense ? 0.35 : 0.45;
    const baseRepulsion = isDense ? 6000 : 8200;
    const baseGravity = isDense ? 0.22 : 0.3;

    setForceProfile({ label: isDense ? '密集' : '稀疏', nodeCount });

    (cy.layout({
      name: 'cose-bilkent',
      animate: shouldAnimate,
      animationDuration: shouldAnimate ? 650 : 0,
      nodeDimensionsIncludeLabels: true,
      idealEdgeLength: baseEdgeLength * strength,
      edgeElasticity: baseElasticity / strength,
      nodeRepulsion: baseRepulsion * strength * strength,
      gravity: baseGravity / strength,
      numIter: isDense ? 1000 : 1400,
      tile: true,
      randomize: true,
      fit: true,
      padding: isDense ? 35 : 50
    } as any) as any).run();
  }, [forceStrength]);

  const clearGraph = useCallback(() => {
    if (cyRef.current) {
      cyRef.current.elements().remove();
    }
    setSelectedNode(null);
    setSelectedNeighbors([]);
    setGraphIndex([]);
  }, []);

  const loadVendors = useCallback(async () => {
    try {
      const response = await fetch(`${getApiServerUrl()}/api/categories`);
      if (!response.ok) {
        throw new Error(`获取分类失败: ${response.statusText}`);
      }
      const data = await response.json();
      const tree = data?.categories?.tree || [];
      const options: VendorOption[] = [];
      const stack = [...tree];

      while (stack.length > 0) {
        const node = stack.shift();
        if (!node) continue;
        const name = String(node.name || '');
        const isDefault = name.toLowerCase() === 'default' || name === '默认分类';
        if (name && !isDefault) {
          options.push({ id: node.id, name });
        }
        if (Array.isArray(node.children) && node.children.length > 0) {
          stack.push(...node.children);
        }
      }

      const unique = Array.from(
        new Map(options.map(opt => [opt.name, opt])).values()
      ).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      setVendorOptions(unique);
    } catch (error) {
      console.error('获取厂商列表失败:', error);
      setVendorOptions([]);
    }
  }, []);

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
    if (!selectedVendor) {
      clearGraph();
      setError('');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const apiUrl = selectedVendor === OVERVIEW_VENDOR_KEY
        ? `${getApiServerUrl()}/api/knowledge-graph/export?nodeTypes=Vendor`
        : `${getApiServerUrl()}/api/knowledge-graph/export?nodeTypes=Vendor,Function&relationshipTypes=HAS_FUNCTION`;

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
      let filteredNodes = nodes;
      let filteredRelationships = relationships;

      if (selectedVendor !== OVERVIEW_VENDOR_KEY) {
        const targetVendorNodes = nodes.filter((node: any) => {
          const isVendor = node.labels.includes('Vendor');
          const name = String(node.properties?.name || '');
          return isVendor && name.toLowerCase() === selectedVendor.toLowerCase();
        });

        const vendorIds = new Set(targetVendorNodes.map((node: any) => node.id));
        if (vendorIds.size === 0) {
          clearGraph();
          setError(`未找到厂商 "${selectedVendor}" 的图谱数据`);
          setLoading(false);
          return;
        }

        const relevantRelationships = relationships.filter((rel: any) => (
          vendorIds.has(rel.startNode) || vendorIds.has(rel.endNode)
        ));
        const functionIds = new Set(
          relevantRelationships.map((rel: any) => (
            vendorIds.has(rel.startNode) ? rel.endNode : rel.startNode
          ))
        );

        filteredNodes = nodes.filter((node: any) => (
          vendorIds.has(node.id) || functionIds.has(node.id)
        ));
        filteredRelationships = relevantRelationships;
      }
      graphCacheRef.current = { nodes, relationships };

      const degreeMap = new Map<string, number>();
      filteredRelationships.forEach((rel: any) => {
        const start = rel.startNode;
        const end = rel.endNode;
        degreeMap.set(start, (degreeMap.get(start) || 0) + 1);
        degreeMap.set(end, (degreeMap.get(end) || 0) + 1);
      });

      // 创建节点ID集合用于验证边的有效性
      const nodeIds = new Set(filteredNodes.map((node: any) => node.id));

      // 过滤掉引用不存在节点的边
      const validRelationships = filteredRelationships.filter((rel: any) => {
        const hasValidSource = nodeIds.has(rel.startNode);
        const hasValidTarget = nodeIds.has(rel.endNode);

        if (!hasValidSource || !hasValidTarget) {
          console.warn(`[KnowledgeGraph] 跳过无效边: source=${rel.startNode} (存在:${hasValidSource}), target=${rel.endNode} (存在:${hasValidTarget})`);
          return false;
        }
        return true;
      });

      // 转换为 Cytoscape 格式
      const elements = [
        // 节点
        ...filteredNodes.map((node: any) => ({
          data: {
            id: node.id,
            label: node.properties.name || node.id,
            type: node.labels[0] || 'Unknown',
            degree: degreeMap.get(node.id) || 0,
            properties: node.properties
          }
        })),
        // 边（仅包含有效的边）
        ...validRelationships.map((rel: any, idx: number) => ({
          data: {
            id: `edge-${idx}`,
            source: rel.startNode,
            target: rel.endNode,
            type: rel.type,
            label: rel.type
          }
        }))
      ];

      // 更新统计信息 - 当前视图数据（区分视图统计和全库统计）
      const vendorCount = filteredNodes.filter((n: any) => n.labels.includes('Vendor')).length;
      const functionCount = filteredNodes.filter((n: any) => n.labels.includes('Function')).length;
      setGraphIndex(filteredNodes.map((node: any) => {
        const label = node.properties.name || node.id;
        return {
          id: node.id,
          label,
          type: node.labels[0] || 'Unknown',
          degree: degreeMap.get(node.id) || 0,
          labelLower: String(label).toLowerCase()
        };
      }));
      setSelectedNode(null);
      setSelectedNeighbors([]);

      // 保存全库统计，更新当前视图统计
      setStats(prev => ({
        ...prev,
        vendors: vendorCount,           // 当前视图厂商数
        functions: functionCount,       // 当前视图功能数
        relationships: validRelationships.length,
        // 保留全库统计（如果存在）
        vendorsTotal: prev.vendorsTotal || prev.vendors,
        functionsTotal: prev.functionsTotal || prev.functions
      }));

      // 初始化或更新 Cytoscape（批量操作优化）
      if (cyRef.current) {
        // 使用 batch 批量更新以减少DOM操作
        cyRef.current.batch(() => {
          cyRef.current!.elements().remove();
          cyRef.current!.add(elements);
        });

        // 根据当前布局模式重新布局
        if (layoutMode === 'hierarchy') {
          runHierarchyLayout(cyRef.current, false);
        } else {
          runForceLayout(cyRef.current, true);
        }
        setGraphVersion(prev => prev + 1);
      } else {
        initCytoscape(elements);
        setGraphVersion(prev => prev + 1);
      }

      // 更新统计信息 - 不再重复调用 fetchStats
      // await fetchStats();

    } catch (err: any) {
      console.error('加载知识图谱失败:', err);
      setError(err.message || '加载失败，请检查 Neo4j 连接');
    } finally {
      setLoading(false);
    }
  }, [layoutMode, runForceLayout, runHierarchyLayout, selectedVendor, clearGraph]); // 依赖布局配置

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
            'shape': 'ellipse',
            'background-color': (ele: any) => NODE_COLORS[ele.data('type')] || NODE_COLORS.default,
            'label': 'data(label)',
            'color': '#fff',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '14px',
            'font-weight': 600,
            'font-family': '"IBM Plex Sans", "Noto Sans", system-ui, sans-serif',
            'width': (ele: any) => {
              const degree = Number(ele.data('degree') || 0);
              const isVendor = ele.data('type') === 'Vendor';
              const base = isVendor ? 120 : 90;
              const bump = Math.min(36, degree * (isVendor ? 2 : 1.5));
              return base + bump;
            },
            'height': (ele: any) => {
              const degree = Number(ele.data('degree') || 0);
              const isVendor = ele.data('type') === 'Vendor';
              const base = isVendor ? 120 : 90;
              const bump = Math.min(36, degree * (isVendor ? 2 : 1.5));
              return base + bump;
            },
            'border-width': 3,
            'border-color': '#ffffff',
            'text-outline-width': 3,
            'text-outline-color': (ele: any) => NODE_COLORS[ele.data('type')] || NODE_COLORS.default,
            'text-wrap': 'wrap',
            'text-max-width': '130px',
            'overlay-opacity': 0
          }
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 6,
            'border-color': '#fbbf24',
            'z-index': 999
          }
        },
        {
          selector: 'node.highlighted',
          style: {
            'border-width': 6,
            'border-color': '#ef4444',
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
            'arrow-scale': 1.5,
            'curve-style': 'bezier',
            'opacity': 0.75,
            'overlay-opacity': 0
          }
        },
        {
          selector: 'node.labels-off',
          style: {
            'text-opacity': 0,
            'text-outline-width': 0
          }
        },
        {
          selector: 'node.filtered',
          style: {
            'display': 'none'
          }
        },
        {
          selector: 'edge.filtered',
          style: {
            'display': 'none'
          }
        },
        {
          selector: 'edge.muted',
          style: {
            'opacity': 0,
            'width': 0.5,
            'target-arrow-shape': 'none'
          }
        },
        {
          selector: 'node.dimmed',
          style: {
            'opacity': 0.12,
            'text-opacity': 0.08
          }
        },
        {
          selector: 'edge.dimmed',
          style: {
            'opacity': 0.06
          }
        },
        {
          selector: 'node.focused',
          style: {
            'border-width': 6,
            'border-color': '#22c55e',
            'z-index': 999
          }
        },
        {
          selector: 'edge.focused',
          style: {
            'opacity': 0.95,
            'width': 4
          }
        },
        {
          selector: 'node.search-hit',
          style: {
            'border-width': 6,
            'border-color': '#f97316',
            'z-index': 998
          }
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#fbbf24',
            'target-arrow-color': '#fbbf24',
            'width': 4,
            'opacity': 1,
            'label': 'data(label)',
            'font-size': '12px',
            'color': '#374151',
            'text-background-color': '#ffffff',
            'text-background-opacity': 0.9,
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle'
          }
        }
      ],
      layout: {
        name: 'concentric',
        concentric: (node: any) => {
          return node.data('type') === 'Vendor' ? 100 : 1;
        },
        levelWidth: () => 1,
        minNodeSpacing: 120,
        animate: false, // 禁用初始动画以提升性能
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        spacingFactor: 1.5
      } as any,
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 3
    });

    cyRef.current = cy;
  };

  const updateSelectedNode = useCallback((node: any | null) => {
    if (!node || node.empty()) {
      setSelectedNode(null);
      setSelectedNeighbors([]);
      return;
    }

    const neighbors = node.neighborhood('node');
    const neighborItems = neighbors
      .map((neighbor: any) => {
        const label = neighbor.data('label');
        return {
          id: neighbor.id(),
          label,
          type: neighbor.data('type'),
          degree: Number(neighbor.data('degree') || 0),
          labelLower: String(label).toLowerCase()
        };
      })
      .sort((a: GraphIndexItem, b: GraphIndexItem) => b.degree - a.degree)
      .slice(0, MAX_NEIGHBOR_ITEMS);

    setSelectedNode({
      id: node.id(),
      label: node.data('label'),
      type: node.data('type'),
      degree: Number(node.data('degree') || neighbors.length),
      properties: node.data('properties')
    });
    setSelectedNeighbors(neighborItems);
  }, []);

  const applyFocus = useCallback((node: any | null) => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().removeClass('dimmed focused');
      if (!node || node.empty() || !focusNeighbors) return;
      const neighborhood = node.closedNeighborhood();
      cy.elements().addClass('dimmed');
      neighborhood.removeClass('dimmed').addClass('focused');
    });
  }, [focusNeighbors]);

  const focusOnNode = useCallback((nodeId: string) => {
    const cy = cyRef.current;
    if (!cy) return;
    const node = cy.getElementById(nodeId);
    if (!node || node.empty()) return;

    cy.nodes().removeClass('search-hit');
    node.addClass('search-hit');
    updateSelectedNode(node);
    applyFocus(node);
    cy.animate({
      zoom: Math.min(cy.zoom() * 1.2, 2),
      center: { eles: node }
    }, {
      duration: 400
    });
  }, [applyFocus, updateSelectedNode]);

  const applyFilters = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const enabledTypes = new Set<string>();
    if (typeFilters.Vendor) enabledTypes.add('Vendor');
    if (typeFilters.Function) enabledTypes.add('Function');

    cy.batch(() => {
      cy.nodes().forEach((node: any) => {
        const visible = enabledTypes.has(node.data('type'));
        node.toggleClass('filtered', !visible);
      });
      cy.edges().forEach((edge: any) => {
        const visible = !edge.source().hasClass('filtered') && !edge.target().hasClass('filtered');
        edge.toggleClass('filtered', !visible);
      });
      cy.edges().toggleClass('muted', !showEdges);
    });
  }, [typeFilters, showEdges]);

  const applyLabelVisibility = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const zoom = cy.zoom();
    const hideLabels = !showLabels || zoom < LABEL_ZOOM_THRESHOLD;
    cy.batch(() => {
      cy.nodes().toggleClass('labels-off', hideLabels);
    });
  }, [showLabels]);

  /**
   * 搜索节点
   */
  const handleSearch = useCallback(() => {
    if (!searchTerm.trim()) return;
    if (searchResults.length > 0) {
      focusOnNode(searchResults[0].id);
    }
  }, [searchTerm, searchResults, focusOnNode]);

  /**
   * 切换布局模式（性能优化版）
   */
  const handleLayoutChange = useCallback((mode: 'force' | 'hierarchy') => {
    setLayoutMode(mode);
    if (!cyRef.current) return;

    const cy = cyRef.current;

    if (mode === 'hierarchy') {
      runHierarchyLayout(cy, false);
    } else {
      runForceLayout(cy, true);
    }
  }, [runForceLayout, runHierarchyLayout]);

  const handleNodeTap = useCallback((event: any) => {
    const node = event.target;
    updateSelectedNode(node);
    applyFocus(node);
  }, [applyFocus, updateSelectedNode]);

  const handleCanvasTap = useCallback((event: any) => {
    const cy = cyRef.current;
    if (!cy) return;
    if (event.target === cy) {
      updateSelectedNode(null);
      applyFocus(null);
      cy.nodes().removeClass('search-hit');
    }
  }, [applyFocus, updateSelectedNode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.off('tap', 'node', handleNodeTap);
    cy.off('tap', handleCanvasTap);
    cy.on('tap', 'node', handleNodeTap);
    cy.on('tap', handleCanvasTap);
    return () => {
      cy.off('tap', 'node', handleNodeTap);
      cy.off('tap', handleCanvasTap);
    };
  }, [handleCanvasTap, handleNodeTap, graphVersion]);

  useEffect(() => {
    applyFilters();
  }, [applyFilters, graphIndex, graphVersion]);

  useEffect(() => {
    applyLabelVisibility();
  }, [applyLabelVisibility, graphIndex, graphVersion]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    let raf = 0;
    const handleZoom = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => applyLabelVisibility());
    };
    cy.on('zoom', handleZoom);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      cy.off('zoom', handleZoom);
    };
  }, [applyLabelVisibility]);

  useEffect(() => {
    if (!focusNeighbors) {
      cyRef.current?.elements().removeClass('dimmed focused');
      return;
    }
    if (selectedNode && cyRef.current) {
      const node = cyRef.current.getElementById(selectedNode.id);
      if (!node.empty()) {
        applyFocus(node);
      }
    }
  }, [focusNeighbors, selectedNode, applyFocus]);

  useEffect(() => {
    if (!selectedNode || !cyRef.current) return;
    const node = cyRef.current.getElementById(selectedNode.id);
    if (node.empty() || node.hasClass('filtered')) {
      updateSelectedNode(null);
      applyFocus(null);
    }
  }, [applyFocus, selectedNode, typeFilters, updateSelectedNode]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      cyRef.current?.nodes().removeClass('search-hit');
    }
  }, [searchTerm]);

  /**
   * 重置视图
   */
  const handleReset = useCallback(() => {
    if (!cyRef.current) return;
    cyRef.current.elements().removeClass('dimmed focused search-hit');
    cyRef.current.fit(undefined, 50);
    cyRef.current.zoom(1);
  }, []);

  const toggleTypeFilter = useCallback((type: 'Vendor' | 'Function') => {
    setTypeFilters(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  }, []);

  const enableAllTypes = useCallback(() => {
    setTypeFilters({ Vendor: true, Function: true });
  }, []);

  const selectedPropertyEntries = selectedNode?.properties
    ? Object.entries(selectedNode.properties)
      .filter(([, value]) => value !== undefined && value !== null)
      .slice(0, 8)
    : [];

  useEffect(() => {
    if (layoutMode !== 'force' || !cyRef.current) return;
    const timeout = setTimeout(() => {
      runForceLayout(cyRef.current!, false);
    }, 120);
    return () => clearTimeout(timeout);
  }, [forceStrength, layoutMode, runForceLayout]);

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
    const init = async () => {
      // 先获取完整统计数据（包括命令和参数）
      await fetchStats();
      await loadVendors();
    };
    init();

    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 空依赖数组，只在挂载时执行一次

  useEffect(() => {
    if (!selectedVendor) {
      clearGraph();
      return;
    }
    void loadGraph();
  }, [selectedVendor, loadGraph, clearGraph]);

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/40 to-emerald-50/30">
      {/* 知识图谱状态模块 */}
      <div className="bg-white/80 backdrop-blur border-b border-white/60 shadow-[0_12px_30px_rgba(15,23,42,0.08)] p-5">
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
            disabled={loading || !selectedVendor}
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
              {loading ? '...' : (stats.vendors ?? 0)}
            </p>
          </div>

          {/* 功能 */}
          <div className="p-3 rounded-xl bg-gradient-to-br from-green-50 to-green-100">
            <div className="flex items-center gap-2 mb-1">
              <GitBranch className="w-4 h-4 text-green-600" />
              <span className="text-xs font-medium text-gray-600">功能</span>
            </div>
            <p className="text-xl font-semibold text-gray-900">
              {loading ? '...' : (stats.functions ?? 0)}
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
      <div className="bg-white/90 backdrop-blur border-b border-white/70 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 flex items-center gap-2 min-w-[280px]">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索节点名称或类型..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white/90"
              />
              {searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => focusOnNode(result.id)}
                      className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{result.label}</p>
                        <p className="text-xs text-gray-500">类型: {result.type} · 关联 {result.degree}</p>
                      </div>
                      <ArrowUpRight className="w-4 h-4 text-gray-400" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors whitespace-nowrap shadow-sm"
            >
              搜索
            </button>
          </div>

          {/* 布局模式切换 */}
          <div className="flex items-center gap-2 border-l pl-3 border-gray-200">
            <span className="text-sm text-gray-600 whitespace-nowrap">布局:</span>
            <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-white">
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
                className={`px-3 py-1.5 text-sm border-l border-gray-200 transition-colors ${layoutMode === 'hierarchy'
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
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
            title="重置视图"
          >
            <Maximize2 className="w-5 h-5" />
          </button>

          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors whitespace-nowrap"
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
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 p-4 overflow-hidden">
        {/* 图谱容器 */}
        <div className="relative flex-1 bg-white/90 rounded-2xl border border-white/70 shadow-[0_18px_45px_rgba(15,23,42,0.08)] overflow-hidden">
          <div
            ref={containerRef}
            className="w-full h-full"
            style={{ minHeight: '520px' }}
          />
          {!selectedVendor && (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/90 to-blue-50/80 backdrop-blur-sm">
              <div className="text-center max-w-sm px-6">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                  <Network className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">选择厂商后显示图谱</h3>
                <p className="mt-2 text-sm text-gray-500">
                  图谱连线较多，建议先选择厂商或使用概览模式。
                </p>
              </div>
            </div>
          )}
          {selectedVendor && (
            <div className="absolute top-4 left-4 flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-white/90 shadow-sm border border-gray-200 text-gray-700">
                当前显示：厂商 {stats.vendors ?? 0} · 功能 {stats.functions ?? 0}
              </span>
              <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-white/90 shadow-sm border border-gray-200 text-gray-700">
                关系 {stats.relationships ?? 0}
              </span>
            </div>
          )}
        </div>

        {/* 控制与详情栏 */}
        <aside className="bg-white/90 rounded-2xl border border-white/70 shadow-[0_18px_45px_rgba(15,23,42,0.08)] p-4 overflow-y-auto flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              厂商过滤
            </h3>
            <div className="mt-3 space-y-2">
              <select
                value={selectedVendor}
                onChange={(event) => setSelectedVendor(event.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {vendorSelectOptions.map(option => (
                  <option key={option.value || option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400">
                未选择厂商时不加载图谱，避免连线过多影响阅读。
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Filter className="w-4 h-4 text-blue-600" />
              视图控制
            </h3>
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 flex items-center gap-2">
                  {showLabels ? <Eye className="w-4 h-4 text-emerald-500" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
                  显示标签
                </span>
                <button
                  onClick={() => setShowLabels(!showLabels)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${showLabels
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-gray-100 text-gray-500'
                    }`}
                >
                  {showLabels ? '开启' : '关闭'}
                </button>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 flex items-center gap-2">
                  <Link2 className={`w-4 h-4 ${showEdges ? 'text-indigo-500' : 'text-gray-400'}`} />
                  显示关系
                </span>
                <button
                  onClick={() => setShowEdges(!showEdges)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${showEdges
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-100 text-gray-500'
                    }`}
                >
                  {showEdges ? '开启' : '关闭'}
                </button>
              </div>
              {layoutMode === 'force' && (
                <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-blue-500" />
                      力导向强度
                    </span>
                    <span className="text-xs font-semibold text-gray-700">
                      {Math.round(forceStrength * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.6"
                    max="1.6"
                    step="0.05"
                    value={forceStrength}
                    onChange={(event) => setForceStrength(Number(event.target.value))}
                    className="mt-2 w-full accent-blue-600"
                  />
                  <div className="mt-2 text-[11px] text-gray-500">
                    自动参数：{forceProfile.label}图 · 节点 {forceProfile.nodeCount}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 flex items-center gap-2">
                  <Target className={`w-4 h-4 ${focusNeighbors ? 'text-orange-500' : 'text-gray-400'}`} />
                  聚焦关联
                </span>
                <button
                  onClick={() => setFocusNeighbors(!focusNeighbors)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${focusNeighbors
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-gray-100 text-gray-500'
                    }`}
                >
                  {focusNeighbors ? '开启' : '关闭'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                提示：缩放到 {LABEL_ZOOM_THRESHOLD} 以下时自动隐藏标签以保持清晰度。
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              节点过滤
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => toggleTypeFilter('Vendor')}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${typeFilters.Vendor
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}
              >
                厂商
              </button>
              <button
                type="button"
                onClick={() => toggleTypeFilter('Function')}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${typeFilters.Function
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}
              >
                功能
              </button>
              <button
                type="button"
                onClick={enableAllTypes}
                className="px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 text-gray-500 hover:bg-gray-50"
              >
                重置全部
              </button>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              已启用 {Object.values(typeFilters).filter(Boolean).length} 类节点
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-600" />
              节点详情
            </h3>
            {selectedNode ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: NODE_COLORS[selectedNode.type] || NODE_COLORS.default }}
                  />
                  <span className="text-sm font-medium text-gray-900">{selectedNode.label}</span>
                </div>
                <div className="text-xs text-gray-500">
                  类型：{selectedNode.type} · 关联：{selectedNode.degree ?? 0}
                </div>
                <div className="text-xs text-gray-500 font-mono break-all">
                  {selectedNode.id}
                </div>
                {selectedNeighbors.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-2">高频关联</p>
                    <div className="space-y-2">
                      {selectedNeighbors.map((neighbor) => (
                        <button
                          key={neighbor.id}
                          type="button"
                          onClick={() => focusOnNode(neighbor.id)}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:border-blue-200 hover:bg-blue-50 transition-colors text-left"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-900 truncate">{neighbor.label}</p>
                            <p className="text-[10px] text-gray-500">{neighbor.type} · 关联 {neighbor.degree}</p>
                          </div>
                          <ArrowUpRight className="w-4 h-4 text-gray-400" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {selectedPropertyEntries.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-2">属性</p>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {selectedPropertyEntries.map(([key, value]) => (
                        <div key={key} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                          <p className="text-[11px] font-medium text-gray-500">{key}</p>
                          <p className="text-xs text-gray-800 break-all">
                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </p>
                        </div>
                      ))}
                    </div>
                    {selectedNode.properties && Object.keys(selectedNode.properties).length > selectedPropertyEntries.length && (
                      <p className="mt-2 text-[11px] text-gray-400">
                        仅展示前 {selectedPropertyEntries.length} 项属性
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-4 text-xs text-gray-500">
                点击任意节点即可查看属性与关联关系。
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Network className="w-4 h-4 text-blue-600" />
              图例
            </h3>
            <div className="mt-3 space-y-2 text-xs text-gray-600">
              {Object.entries(NODE_COLORS)
                .filter(([key]) => key !== 'default')
                .map(([type, color]) => (
                  <div key={type} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <span>{type}</span>
                  </div>
                ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default KnowledgeGraph;
