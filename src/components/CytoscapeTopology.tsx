/**
 * Cytoscape.js 拓扑渲染组件
 * 用于超大规模拓扑（2000+ 节点）的高性能渲染
 */

import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import Cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import { Layers, Zap, Maximize, Move } from 'lucide-react';

Cytoscape.use(coseBilkent);

// 层级颜色
const layerColors: Record<string, string> = {
    core: '#e74c3c',
    spine: '#3498db',
    leaf: '#27ae60',
    csw: '#d62728',
    ssw: '#1f77b4',
    asw: '#2ca02c',
    oob: '#ffcc00',
    other: '#7f7f7f',
    unknown: '#95a5a6'
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
}

/**
 * 将拓扑数据转换为 Cytoscape 格式
 */
function convertToCytoscapeFormat(
    data: TopologyData,
    selectedPod: string = 'ALL',
    layerVisibility: Record<string, boolean> = {}
): { nodes: any[]; edges: any[] } {
    const nodes: any[] = [];
    const edges: any[] = [];
    const nodeIds = new Set<string>();

    // 处理节点
    Object.entries(data.nodesByLayer || {}).forEach(([layer, layerNodes]) => {
        // 检查层级可见性
        if (layerVisibility[layer] === false) return;

        const nodeList = Array.isArray(layerNodes) ? layerNodes : [];

        nodeList.forEach((node: TopologyNode) => {
            // POD 过滤
            if (selectedPod !== 'ALL') {
                if (node.pod && node.pod !== selectedPod && !node.id?.includes(selectedPod)) {
                    return;
                }
            }

            nodeIds.add(node.id);
            nodes.push({
                data: {
                    id: node.id,
                    label: node.label || node.id,
                    layer,
                    pod: node.pod
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

/**
 * 获取 Cytoscape 样式配置
 */
function getCytoscapeStyles(): any[] {
    return [
        // 节点基础样式
        {
            selector: 'node',
            style: {
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'center',
                'font-size': '10px',
                'color': '#fff',
                'text-wrap': 'wrap',
                'text-max-width': '90px',
                'width': '100px',
                'height': '36px',
                'shape': 'roundrectangle',
                'background-color': '#95a5a6',
                'border-width': '2px',
                'border-color': 'data(color)', // Use data attribute if available, or fallback
                'border-opacity': 0.8
            }
        },
        // Core 层样式
        {
            selector: 'node.core',
            style: {
                'background-color': layerColors.core,
                'border-color': layerColors.core,
                'width': '110px',
                'height': '40px',
                'font-weight': 'bold'
            }
        },
        // Spine 层样式
        {
            selector: 'node.spine',
            style: {
                'background-color': layerColors.spine,
                'border-color': layerColors.spine
            }
        },
        // Leaf 层样式
        {
            selector: 'node.leaf',
            style: {
                'background-color': layerColors.leaf,
                'border-color': layerColors.leaf
            }
        },
        // OOB 样式 (文字颜色深色)
        {
            selector: 'node[layer="oob"]',
            style: {
                'color': '#333',
                'background-color': layerColors.oob || '#ffcc00',
                'border-color': layerColors.oob || '#ffcc00'
            }
        },
        // 边样式
        {
            selector: 'edge',
            style: {
                'width': 1.5,
                'line-color': '#bdc3c7',
                'target-arrow-color': '#bdc3c7',
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                'opacity': 0.7
            }
        },
        // 选中节点样式
        {
            selector: 'node:selected',
            style: {
                'border-width': '4px',
                'border-color': '#3b82f6',
                'box-shadow': '0 0 10px #3b82f6'
            }
        },
        // 选中边样式
        {
            selector: 'edge:selected',
            style: {
                'line-color': '#3b82f6',
                'target-arrow-color': '#3b82f6',
                'width': 3,
                'opacity': 1
            }
        },
        // 高亮节点样式
        {
            selector: 'node.highlighted',
            style: {
                'border-width': '4px',
                'border-color': '#ff0000',
                'background-color': '#ff6b6b'
            }
        }
    ];
}

/**
 * Cytoscape 拓扑可视化组件
 */


const CytoscapeTopology: React.FC<CytoscapeTopologyProps> = memo(({
    data,
    selectedPod = 'ALL',
    layerVisibility = {},
    onNodeClick,
    onEdgeClick,
    height = '600px',
    highlightedNodeId
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const cyRef = useRef<cytoscape.Core | null>(null);
    const [stats, setStats] = useState({ nodes: 0, edges: 0, renderTime: 0 });

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

        // 转换数据
        const { nodes, edges } = convertToCytoscapeFormat(data, selectedPod, layerVisibility);

        // 如果已有实例，更新数据
        if (cyRef.current) {
            cyRef.current.elements().remove();
            cyRef.current.add([...nodes, ...edges]);

            // 重新布局
            cyRef.current.layout({
                name: 'preset',
                positions: (node: any) => {
                    return calculateNodePosition(node, data.nodesByLayer);
                }
            }).run();
        } else {
            // 创建新实例
            const cy = Cytoscape({
                container: containerRef.current,
                elements: [...nodes, ...edges],
                style: getCytoscapeStyles(),
                layout: {
                    name: 'preset',
                    positions: (node: any) => {
                        return calculateNodePosition(node, data.nodesByLayer);
                    }
                },
                // 性能优化设置
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
                        layer: node.data('layer'),
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
     * 计算节点位置（分层布局）
     */
    function calculateNodePosition(
        node: any,
        nodesByLayer: Record<string, TopologyNode[]>
    ): { x: number; y: number } {
        const nodeId = typeof node === 'string' ? node : node.id();
        const layer = typeof node === 'string' ? '' : node.data('layer');

        // 层级 Y 坐标
        const layerYPositions: Record<string, number> = {
            core: 100,
            spine: 300,
            leaf: 500
        };

        // 层级节点间距
        const layerXGaps: Record<string, number> = {
            core: 180,
            spine: 150,
            leaf: 120
        };

        const yPos = layerYPositions[layer] || 300;
        const xGap = layerXGaps[layer] || 150;

        // 找到该节点在其层级中的索引
        const layerNodes = nodesByLayer[layer] || [];
        const nodeIndex = layerNodes.findIndex((n: TopologyNode) => n.id === nodeId);
        const totalInLayer = layerNodes.length;

        // 计算 X 坐标（居中对齐）
        const startX = -(totalInLayer - 1) * xGap / 2;
        const xPos = startX + nodeIndex * xGap;

        return { x: xPos, y: yPos };
    }

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
     * 运行预设布局
     */
    const runPresetLayout = useCallback(() => {
        if (!cyRef.current) return;
        cyRef.current.layout({
            name: 'preset',
            positions: (node: any) => calculateNodePosition(node, data.nodesByLayer),
            animate: true,
            animationDuration: 500,
            fit: true,
            padding: 50
        } as any).run();
    }, [data.nodesByLayer]);

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
export { convertToCytoscapeFormat, getCytoscapeStyles, layerColors };
