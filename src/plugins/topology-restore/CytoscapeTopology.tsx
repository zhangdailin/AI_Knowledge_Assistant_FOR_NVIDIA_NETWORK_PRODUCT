/**
 * Cytoscape.js 拓扑渲染组件
 * 用于超大规模拓扑（2000+ 节点）的高性能渲染
 */

import React, { useEffect, useRef, useState, useCallback, memo, useMemo } from 'react';
import Cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import { Layers, Zap, Maximize, Move } from 'lucide-react';

Cytoscape.use(coseBilkent);

// Import Premium Styles
import { getPremiumStyles, NEON_PALETTE } from './TopologyStyles';

// 兼容旧的 layerColors 导出（映射到新主题）
const layerColors: Record<string, string> = {
    core: NEON_PALETTE.core,
    spine: NEON_PALETTE.spine,
    leaf: NEON_PALETTE.leaf,
    oob: '#fbbf24',
    unknown: '#64748b',
    other: '#7f7f7f',
    csw: '#d62728',
    ssw: '#1f77b4',
    asw: '#2ca02c',
    podGroup: NEON_PALETTE.pod
};

interface TopologyNode {
    id: string;
    label?: string;
    layer?: string;
    pod?: string;
}

interface TopologyEdge {
    source: string;
    target: string;
    srcPort?: string;
    dstPort?: string;
}

interface TopologyData {
    nodesByLayer: Record<string, TopologyNode[]>;
    connections: TopologyEdge[];
    metadata?: {
        pods?: string[];
        layers?: Record<string, string[]>;
    };
}

interface CytoscapeTopologyProps {
    /** 拓扑数据 */
    data: TopologyData;
    /** 选中的 POD */
    selectedPod?: string;
    /** 选中的 Rail */
    selectedRail?: string;
    /** 层级可见性 */
    layerVisibility?: Record<string, boolean>;
    /** 节点点击回调 */
    onNodeClick?: (node: TopologyNode) => void;
    /** 边点击回调 */
    onEdgeClick?: (edge: TopologyEdge) => void;
    /** 容器高度 */
    height?: string | number;
    /** 是否启用动画 */
    animate?: boolean;
    /** 高亮节点 ID */
    highlightedNodeId?: string | null;
    /** 激活的 Core 节点过滤器 (仅显示列表中的 Core 节点) */
    activeCoreFilter?: string[] | null;
    /** Phase 2: POD 折叠状态集合 */
    collapsedPods?: Set<string>;
    /** 网络类型 (用于条件过滤) */
    networkType?: 'ib' | 'roce';
}

/**
 * 获取网络设备的显示标签 (RoCE vs IB)
 */
function getLayerLabel(layer: string, networkType: 'ib' | 'roce' = 'ib'): string {
    if (networkType === 'roce') {
        const labels: Record<string, string> = {
            core: 'CSW',
            spine: 'SSW',
            leaf: 'ASW',
            podAggregate: 'POD'
        };
        return labels[layer] || layer.toUpperCase();
    }
    // IB
    return layer.charAt(0).toUpperCase() + layer.slice(1);
}

/**
 * 计算节点位置 (分层布局)
 */
function calculateNodePosition(node: any, nodesByLayer: any, layerY?: Record<string, number>): { x: number; y: number } {
    // 兼容 Cytoscape 节点对象 (function) 和 原始数据对象 (initial load)
    const data = typeof node.data === 'function' ? node.data() : (node.data || node);

    const layer = data.layer;
    if (Math.random() < 0.01) {
        console.log(`[LayoutDebug] Node=${data.id}, Layer=${layer}, LayerNodes=${nodesByLayer?.[layer]?.length}`);
    }

    if (!layer || !nodesByLayer || !nodesByLayer[layer]) {
        console.warn(`[LayoutDebug] MISSING LAYER DATA for Node=${data.id}, Layer=${layer}`);
        return { x: 0, y: 0 };
    }

    // Y 轴位置 (优先使用后端提供的 layerY)
    let y = 800;
    if (layerY && typeof layerY[layer] === 'number') {
        y = layerY[layer];
    } else {
        const yMap: Record<string, number> = {
            core: 0,
            spine: 300,
            leaf: 600,
            csw: 0,
            ssw: 300,
            asw: 600,
            lsw: 450,
            oob: 150,
            soob: 250,
            podAggregate: 450
        };
        y = yMap[layer] ?? 800;
    }

    // X 轴位置 (均匀分布)
    const layerNodes = nodesByLayer[layer];
    const index = layerNodes.findIndex((n: any) => n.id === data.id);
    const count = layerNodes.length;

    // 宽度分布
    const width = Math.max(1000, count * 100);
    const x = (index + 1) * (width / (count + 1));

    return { x, y };
}

/**
 * 将拓扑数据转换为 Cytoscape 格式 (支持 Compound Nodes)
 */
function convertToCytoscapeFormat(
    data: TopologyData,
    selectedPod: string = 'ALL',
    // layerVisibility removed - 显示所有层级
    selectedRail: string = 'ALL',
    activeCoreFilter: string[] | null = null,
    collapsedPods: Set<string> = new Set(),
    networkType: 'ib' | 'roce' = 'ib'
): { nodes: any[]; edges: any[] } {
    const nodes: any[] = [];
    const edges: any[] = [];
    const nodeIds = new Set<string>();
    const createdPods = new Set<string>(); // Phase 1: 追踪已创建POD节点

    // Phase 2 V2: Pre-scan to collect POD statistics for aggregate nodes
    const podStats = new Map<string, { spineCount: number; leafCount: number }>();

    Object.entries(data.nodesByLayer || {}).forEach(([layer, layerNodes]) => {
        // 不再过滤层级,显示所有设备
        const nodeList = Array.isArray(layerNodes) ? layerNodes : [];

        nodeList.forEach((node: TopologyNode) => {
            if ((layer === 'spine' || layer === 'leaf') && node.pod) {
                const podName = node.pod;
                if (!podStats.has(podName)) {
                    podStats.set(podName, { spineCount: 0, leafCount: 0 });
                }
                const stats = podStats.get(podName)!;
                if (layer === 'spine') stats.spineCount++;
                if (layer === 'leaf') stats.leafCount++;
            }
        });
    });

    // 处理节点
    Object.entries(data.nodesByLayer || {}).forEach(([layer, layerNodes]) => {
        // 不再过滤层级,显示所有设备

        const nodeList = Array.isArray(layerNodes) ? layerNodes : [];

        nodeList.forEach((node: TopologyNode) => {
            // 所有过滤已禁用 - 显示全部设备


            // POD折叠功能已禁用



            // Phase 1: Compound Nodes - 创建POD父节点
            let parentId = undefined;
            if ((layer === 'spine' || layer === 'leaf') && node.pod) {
                const podName = node.pod;
                if (!createdPods.has(podName)) {
                    nodes.push({
                        data: {
                            id: podName,
                            label: podName,
                            backgroundColor: NEON_PALETTE.background  // Phase 1: Dark ModepodGroup'
                        },
                        classes: 'podGroup'
                    });
                    createdPods.add(podName);
                }
                parentId = podName;
            }

            nodeIds.add(node.id);
            nodes.push({
                data: {
                    id: node.id,
                    label: node.label || node.id,
                    layer,
                    displayLayer: getLayerLabel(layer, networkType),
                    pod: node.pod,
                    parent: parentId  // Phase 1: 指定父节点
                },
                classes: layer
            });
        });
    });

    // 处理边
    (data.connections || []).forEach((conn: TopologyEdge, idx: number) => {
        if (nodeIds.has(conn.source) && nodeIds.has(conn.target)) {
            edges.push({
                data: {
                    id: `edge-${idx}`,
                    source: conn.source,
                    target: conn.target,
                    srcPort: conn.srcPort,
                    dstPort: conn.dstPort,
                    label: conn.srcPort && conn.dstPort ? `${conn.srcPort}-${conn.dstPort}` : ''
                }
            });
        }
    });

    return { nodes, edges };
}

// Phase 1: 辅助函数 - 从 ID 提取 Rail (数字)
function getRailFromId(id: string): number {
    const match = id.match(/[-_](?:RAIL|R|Plane|P)(\d+)[-_]/i);
    if (match) return parseInt(match[1], 10);
    return 999; // 默认值，表示不匹配
}


/**
 * Cytoscape 拓扑可视化组件
 */


const CytoscapeTopology: React.FC<CytoscapeTopologyProps> = memo(({
    data,
    selectedPod = 'ALL',
    selectedRail = 'ALL',
    layerVisibility = {},
    onNodeClick,
    onEdgeClick,
    height = '600px',
    highlightedNodeId,
    activeCoreFilter = null,
    collapsedPods = new Set(),
    networkType = 'ib'
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const cyRef = useRef<cytoscape.Core | null>(null);
    const [stats, setStats] = useState({ nodes: 0, edges: 0, renderTime: 0 });

    // Phase 1: 使用 useMemo 获取样式，避免重复计算
    const styles = useMemo(() => getPremiumStyles(), []);

    /**
     * 监听高亮变化
     */
    useEffect(() => {
        if (highlightedNodeId && cyRef.current) {
            // 清除旧高亮
            cyRef.current.$('.highlighted').removeClass('highlighted');
            // 高亮新节点
            const node = cyRef.current.$(`#${highlightedNodeId}`);
            if (node.length > 0) {
                node.addClass('highlighted');
                cyRef.current.center(node);
                cyRef.current.zoom({ level: 1.5, position: node.position() });
            }
        }
    }, [highlightedNodeId]);

    /**
     * 初始化或更新 Cytoscape 实例
     */
    useEffect(() => {
        if (!containerRef.current || !data) return;

        const startTime = performance.now();

        // 转换数据 (不再过滤层级,显示所有设备)
        const { nodes, edges } = convertToCytoscapeFormat(
            data,
            selectedPod,
            // layerVisibility removed
            selectedRail,
            activeCoreFilter,
            collapsedPods as Set<string>
        );

        // 如果已有实例，更新数据
        if (cyRef.current) {
            cyRef.current.elements().remove();
            cyRef.current.add([...nodes, ...edges]);

            // 重新布局
            cyRef.current.layout({
                name: 'preset',
                positions: (node: any) => {
                    return calculateNodePosition(node, data.nodesByLayer, (data as any).layerY);
                }
            }).run();
        } else {
            // 创建新实例
            const cy = Cytoscape({
                container: containerRef.current,
                elements: [...nodes, ...edges],
                style: styles,  // Phase 1: 使用 Premium Styles
                layout: {
                    name: 'preset',
                    positions: (node: any) => calculateNodePosition(node, data.nodesByLayer, (data as any).layerY),
                    fit: true,
                    padding: 50,
                    animate: false
                },
                wheelSensitivity: 0.3,
                minZoom: 0.1,
                maxZoom: 3,
                boxSelectionEnabled: true,
                autounselectify: false,
                autoungrabify: false
            });

            // 事件绑定
            cy.on('tap', 'node', (event) => {
                const node = event.target;
                if (onNodeClick) {
                    onNodeClick({
                        id: node.id(),
                        label: node.data('label'),
                        layer: node.data('displayLayer') || node.data('layer'), // Use localized layer name
                        pod: node.data('pod')
                    });
                }
            });

            cy.on('tap', 'edge', (event) => {
                const edge = event.target;
                if (onEdgeClick) {
                    onEdgeClick({
                        source: edge.data('source'),
                        target: edge.data('target'),
                        srcPort: edge.data('srcPort'),
                        dstPort: edge.data('dstPort')
                    });
                }
            });

            // 自适应视图
            cy.fit(undefined, 50);
            cy.center();

            cyRef.current = cy;
        }

        const endTime = performance.now();
        setStats({
            nodes: nodes.length,
            edges: edges.length,
            renderTime: Math.round(endTime - startTime)
        });

        console.log('[CytoscapeTopology] 渲染完成:', {
            nodes: nodes.length,
            edges: edges.length,
            renderTime: `${Math.round(endTime - startTime)}ms`
        });
    }, [data, selectedPod, layerVisibility, onNodeClick, onEdgeClick]);

    /**
     * 组件卸载时销毁实例
     */
    useEffect(() => {
        return () => {
            if (cyRef.current) {
                cyRef.current.destroy();
                cyRef.current = null;
            }
        };
    }, []);



    /**
     * 公开方法：高亮节点
     */
    const highlightNode = useCallback((nodeId: string) => {
        if (!cyRef.current) return;

        // 清除之前的高亮
        cyRef.current.$('.highlighted').removeClass('highlighted');

        // 高亮新节点
        const node = cyRef.current.$(`#${nodeId}`);
        if (node.length > 0) {
            node.addClass('highlighted');
            cyRef.current.center(node);
        }
    }, []);

    /**
     * 公开方法：适应视图
     */
    const fitView = useCallback(() => {
        if (!cyRef.current) return;
        cyRef.current.fit(undefined, 50);
        cyRef.current.center();
    }, []);

    /**
     * 运行预设布局 (手动触发)
     */
    const runPresetLayout = useCallback(() => {
        if (!cyRef.current || !data?.nodesByLayer) return;

        cyRef.current.layout({
            name: 'preset',
            positions: (node: any) => calculateNodePosition(node, data.nodesByLayer, (data as any).layerY),
            animate: true,
            animationDuration: 500,
            fit: true,
            padding: 50
        } as any).run();
    }, [data]);

    /**
     * 运行智能布局 (CoSE Bilkent)
     */
    const runSmartLayout = useCallback(() => {
        if (!cyRef.current) return;

        // 提示用户
        const nodeCount = cyRef.current.nodes().length;
        if (nodeCount > 500) {
            console.log('[Cytoscape] Starting Smart Layout for', nodeCount, 'nodes');
        }

        cyRef.current.layout({
            name: 'cose-bilkent',
            animate: 'end', // layout continuously then animate? or just 'true'? 'end' is usually safer for heavy layouts
            animationDuration: 1000,
            nodeDimensionsIncludeLabels: true,
            idealEdgeLength: 100,
            edgeElasticity: 0.45,
            gravity: 0.25,
            numIter: 2500,
            tile: true,
            tilingPaddingVertical: 20,
            tilingPaddingHorizontal: 20
        } as any).run();
    }, []);

    /**
     * 公开方法：导出为 PNG
     */
    const exportPng = useCallback(() => {
        if (!cyRef.current) return null;
        return cyRef.current.png({
            output: 'blob',
            bg: '#ffffff',
            full: true,
            scale: 2
        });
    }, []);

    return (
        <div className="relative w-full" style={{ height }}>
            {/* Cytoscape 容器 */}
            <div
                ref={containerRef}
                className="w-full h-full bg-gray-50 rounded-lg border border-gray-200"
                style={{ minHeight: height }}
            />

            {/* 统计信息 */}
            <div className="absolute bottom-3 left-3 px-3 py-2 bg-white/90 rounded-lg shadow-sm border border-gray-200 text-xs">
                <div className="flex gap-4">
                    <span className="text-gray-600">
                        节点: <span className="font-semibold text-gray-900">{stats.nodes}</span>
                    </span>
                    <span className="text-gray-600">
                        边: <span className="font-semibold text-gray-900">{stats.edges}</span>
                    </span>
                    <span className="text-gray-600">
                        渲染: <span className="font-semibold text-green-600">{stats.renderTime}ms</span>
                    </span>
                </div>
            </div>

            {/* 控制按钮 */}
            <div className="absolute top-3 right-3 flex flex-col gap-2">
                <button
                    onClick={fitView}
                    className="p-2 bg-white text-gray-700 rounded-lg shadow-sm border border-gray-200 hover:bg-gray-50 text-xs flex items-center justify-center"
                    title="适应视图"
                >
                    <Move className="w-4 h-4" />
                </button>
                <div className="h-px bg-gray-300 mx-1"></div>
                <button
                    onClick={runPresetLayout}
                    className="p-2 bg-white text-gray-700 rounded-lg shadow-sm border border-gray-200 hover:bg-gray-50 text-xs flex items-center justify-center"
                    title="重置(分层布局)"
                >
                    <Maximize className="w-4 h-4" />
                </button>
                <button
                    onClick={runSmartLayout}
                    className="p-2 bg-white text-gray-700 rounded-lg shadow-sm border border-gray-200 hover:bg-gray-50 text-xs flex items-center justify-center"
                    title="智能布局 (适合混乱拓扑)"
                >
                    <Zap className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
});

export default CytoscapeTopology;

// 导出辅助函数
export { convertToCytoscapeFormat, layerColors };
