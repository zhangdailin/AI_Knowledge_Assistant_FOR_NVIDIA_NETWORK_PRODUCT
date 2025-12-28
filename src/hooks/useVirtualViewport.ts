/**
 * 虚拟视口 Hook - 只渲染视口内的节点
 * 用于大规模拓扑的性能优化
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Node, Edge, useReactFlow, Viewport } from 'reactflow';

interface VirtualViewportConfig {
  /** 缓冲区大小（像素），用于预渲染视口边缘外的节点 */
  bufferPx?: number;
  /** 更新节流时间（毫秒） */
  throttleMs?: number;
  /** 节点的估计宽度（用于边界计算） */
  nodeWidth?: number;
  /** 节点的估计高度 */
  nodeHeight?: number;
  /** 是否启用虚拟化 */
  enabled?: boolean;
}

interface VirtualViewportResult {
  /** 可见节点 */
  visibleNodes: Node[];
  /** 可见边 */
  visibleEdges: Edge[];
  /** 当前视口信息 */
  viewport: Viewport | null;
  /** 虚拟化统计 */
  stats: {
    totalNodes: number;
    visibleNodes: number;
    totalEdges: number;
    visibleEdges: number;
    reductionPercent: string;
  };
  /** 手动刷新可见节点 */
  refresh: () => void;
}

/**
 * 虚拟视口 Hook
 * 根据当前视口位置和缩放级别，过滤出可见的节点和边
 */
export function useVirtualViewport(
  allNodes: Node[],
  allEdges: Edge[],
  config: VirtualViewportConfig = {}
): VirtualViewportResult {
  const {
    bufferPx = 200,
    throttleMs = 50,
    nodeWidth = 120,
    nodeHeight = 60,
    enabled = true
  } = config;

  const [visibleNodes, setVisibleNodes] = useState<Node[]>(allNodes);
  const [visibleEdges, setVisibleEdges] = useState<Edge[]>(allEdges);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const throttleRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 尝试获取 ReactFlow 实例（可能不在 ReactFlow 上下文中）
  let reactFlowInstance: ReturnType<typeof useReactFlow> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    reactFlowInstance = useReactFlow();
  } catch {
    // 不在 ReactFlow 上下文中，跳过
  }

  /**
   * 计算可见节点
   */
  const calculateVisibleNodes = useCallback(() => {
    if (!enabled || !reactFlowInstance) {
      setVisibleNodes(allNodes);
      setVisibleEdges(allEdges);
      return;
    }

    try {
      const currentViewport = reactFlowInstance.getViewport();
      setViewport(currentViewport);

      // 获取容器尺寸
      const container = document.querySelector('.react-flow');
      if (!container) {
        setVisibleNodes(allNodes);
        setVisibleEdges(allEdges);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const { x: vpX, y: vpY, zoom } = currentViewport;

      // 计算视口在世界坐标中的边界
      const worldLeft = -vpX / zoom - bufferPx / zoom;
      const worldTop = -vpY / zoom - bufferPx / zoom;
      const worldRight = (-vpX + containerRect.width) / zoom + bufferPx / zoom;
      const worldBottom = (-vpY + containerRect.height) / zoom + bufferPx / zoom;

      // 过滤可见节点
      const newVisibleNodes = allNodes.filter((node) => {
        const x = node.position.x;
        const y = node.position.y;
        const width = nodeWidth;
        const height = nodeHeight;

        // 检查节点是否在视口范围内
        return (
          x + width > worldLeft &&
          x < worldRight &&
          y + height > worldTop &&
          y < worldBottom
        );
      });

      // 获取可见节点的 ID 集合
      const visibleNodeIds = new Set(newVisibleNodes.map((n) => n.id));

      // 过滤可见边（两端节点都可见的边）
      const newVisibleEdges = allEdges.filter((edge) => {
        return visibleNodeIds.has(edge.source) || visibleNodeIds.has(edge.target);
      });

      setVisibleNodes(newVisibleNodes);
      setVisibleEdges(newVisibleEdges);
    } catch (error) {
      // 出错时回退到显示所有节点
      console.warn('[VirtualViewport] 计算可见节点失败:', error);
      setVisibleNodes(allNodes);
      setVisibleEdges(allEdges);
    }
  }, [allNodes, allEdges, bufferPx, nodeWidth, nodeHeight, enabled, reactFlowInstance]);

  /**
   * 节流更新
   */
  const throttledUpdate = useCallback(() => {
    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
    }
    throttleRef.current = setTimeout(() => {
      calculateVisibleNodes();
    }, throttleMs);
  }, [calculateVisibleNodes, throttleMs]);

  /**
   * 监听视口变化
   */
  useEffect(() => {
    if (!enabled) {
      setVisibleNodes(allNodes);
      setVisibleEdges(allEdges);
      return;
    }

    // 初始计算
    calculateVisibleNodes();

    // 监听视口变化事件
    const container = document.querySelector('.react-flow');
    if (container) {
      containerRef.current = container as HTMLDivElement;

      const handleViewportChange = () => {
        throttledUpdate();
      };

      // 监听滚轮（缩放）和鼠标移动（平移）
      container.addEventListener('wheel', handleViewportChange, { passive: true });
      container.addEventListener('mouseup', handleViewportChange);
      window.addEventListener('resize', handleViewportChange);

      return () => {
        container.removeEventListener('wheel', handleViewportChange);
        container.removeEventListener('mouseup', handleViewportChange);
        window.removeEventListener('resize', handleViewportChange);
        if (throttleRef.current) {
          clearTimeout(throttleRef.current);
        }
      };
    }
  }, [enabled, throttledUpdate, calculateVisibleNodes, allNodes, allEdges]);

  // 当节点列表变化时重新计算
  useEffect(() => {
    if (enabled) {
      calculateVisibleNodes();
    } else {
      setVisibleNodes(allNodes);
      setVisibleEdges(allEdges);
    }
  }, [allNodes, allEdges, enabled, calculateVisibleNodes]);

  // 计算统计信息
  const stats = {
    totalNodes: allNodes.length,
    visibleNodes: visibleNodes.length,
    totalEdges: allEdges.length,
    visibleEdges: visibleEdges.length,
    reductionPercent:
      allNodes.length > 0
        ? `${((1 - visibleNodes.length / allNodes.length) * 100).toFixed(1)}%`
        : '0%'
  };

  return {
    visibleNodes,
    visibleEdges,
    viewport,
    stats,
    refresh: calculateVisibleNodes
  };
}

/**
 * 简化版：只返回可见节点 ID
 * 用于与现有 ReactFlow 集成
 */
export function useVisibleNodeIds(
  allNodes: Node[],
  config: VirtualViewportConfig = {}
): Set<string> {
  const { visibleNodes } = useVirtualViewport(allNodes, [], config);
  return new Set(visibleNodes.map((n) => n.id));
}

export default useVirtualViewport;
