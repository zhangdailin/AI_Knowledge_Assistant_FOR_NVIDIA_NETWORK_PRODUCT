/**
 * 边聚合工具 - 减少大规模拓扑中的连接线数量
 * 将多条相似的边合并为一条粗边，显著改善视觉和性能
 */

import { Edge } from 'reactflow';

export interface EdgeBundle {
  id: string;
  source: string;
  target: string;
  count: number;
  originalEdges: string[];  // 原始边的 ID 列表
  label?: string;
}

export interface EdgeBundlingOptions {
  /**
   * 聚合阈值：当同一源→目标对的边数 >= threshold 时，进行聚合
   * 默认值 5：至少 5 条边才会被聚合
   */
  threshold?: number;

  /**
   * 是否保留原始边数据用于展开
   * 默认 true：允许用户点击聚合边查看原始连接
   */
  keepOriginal?: boolean;

  /**
   * 最大粗度（用于可视化）
   * 默认 8px：防止边变得过粗
   */
  maxStrokeWidth?: number;

  /**
   * 聚合后是否隐藏原始边
   */
  hideOriginal?: boolean;
}

/**
 * 主函数：聚合边
 * @param edges 所有边
 * @param options 配置选项
 * @returns { bundledEdges, bundleMap }
 */
export function bundleEdges(
  edges: Edge[],
  options: EdgeBundlingOptions = {}
): {
  bundledEdges: Edge[];
  bundleMap: Map<string, EdgeBundle>;
  stats: {
    originalCount: number;
    bundledCount: number;
    bundleCount: number;
    reduction: string;
  };
} {
  const {
    threshold = 5,
    keepOriginal = true,
    maxStrokeWidth = 8,
    hideOriginal = true
  } = options;

  const bundleMap = new Map<string, EdgeBundle>();
  const edgesByKey = new Map<string, Edge[]>();

  // 第一步：按源→目标分组
  for (const edge of edges) {
    const key = `${edge.source}→${edge.target}`;
    if (!edgesByKey.has(key)) {
      edgesByKey.set(key, []);
    }
    edgesByKey.get(key)!.push(edge);
  }

  // 第二步：创建聚合边或保留原始边
  const bundledEdges: Edge[] = [];
  let bundleId = 0;

  for (const [key, groupEdges] of edgesByKey) {
    const [source, target] = key.split('→');

    if (groupEdges.length >= threshold) {
      // 聚合多条边为一条
      const bundleIdStr = `bundle-${bundleId++}`;

      // 计算粗度：边数越多越粗，最多 maxStrokeWidth
      const strokeWidth = Math.min(
        2 + (groupEdges.length - threshold) * 0.5,
        maxStrokeWidth
      );

      // 创建聚合边
      const bundledEdge: Edge = {
        id: bundleIdStr,
        source,
        target,
        animated: false,
        style: {
          stroke: '#999',
          strokeWidth,
          opacity: 0.6
        },
        label: `${groupEdges.length} 条连接`,
        labelStyle: {
          fontSize: '10px',
          fill: '#666',
          backgroundColor: '#fff',
          padding: '2px 4px',
          borderRadius: '3px'
        },
        data: {
          type: 'bundle',
          originalCount: groupEdges.length,
          originalEdgeIds: groupEdges.map(e => e.id),
          expanded: false  // 用于追踪展开状态
        }
      };

      bundledEdges.push(bundledEdge);

      // 记录到 bundleMap
      const bundle: EdgeBundle = {
        id: bundleIdStr,
        source,
        target,
        count: groupEdges.length,
        originalEdges: groupEdges.map(e => e.id),
        label: `${groupEdges.length} 条`
      };
      bundleMap.set(bundleIdStr, bundle);

      // 如果需要保留原始边，添加到结果中但标记为隐藏
      if (keepOriginal) {
        for (const originalEdge of groupEdges) {
          bundledEdges.push({
            ...originalEdge,
            style: {
              ...originalEdge.style,
              display: hideOriginal ? 'none' : 'block',
              opacity: hideOriginal ? 0 : 0.3
            },
            data: {
              ...originalEdge.data,
              bundleId: bundleIdStr,
              hidden: hideOriginal
            }
          });
        }
      }
    } else {
      // 边数不足阈值，保持原样
      bundledEdges.push(...groupEdges);
    }
  }

  // 统计信息
  // 计算实际可见边数量（聚合边 + 未聚合的原始边）
  const visibleEdgeCount = bundledEdges.filter(e =>
    e.data?.type === 'bundle' || (!e.data?.bundleId && !e.data?.hidden)
  ).length;
  const stats = {
    originalCount: edges.length,
    bundledCount: bundleMap.size,
    bundleCount: bundleMap.size,
    reduction: edges.length > 0
      ? `${(((edges.length - visibleEdgeCount) / edges.length) * 100).toFixed(1)}%`
      : '0%'
  };

  console.log('[EdgeBundling]', {
    originalEdges: edges.length,
    visibleEdges: visibleEdgeCount,
    bundleCount: bundleMap.size,
    reduction: stats.reduction
  });

  return { bundledEdges, bundleMap, stats };
}

/**
 * 展开特定的边束
 * 用于用户点击聚合边时显示所有原始连接
 */
export function expandBundle(
  bundleId: string,
  bundledEdges: Edge[],
  bundleMap: Map<string, EdgeBundle>
): Edge[] {
  const bundle = bundleMap.get(bundleId);
  if (!bundle) return bundledEdges;

  return bundledEdges.map(edge => {
    // 展开目标束的原始边
    if (edge.data?.bundleId === bundleId && edge.data?.hidden) {
      return {
        ...edge,
        style: {
          ...edge.style,
          display: 'block',
          opacity: 0.5
        },
        data: {
          ...edge.data,
          hidden: false
        }
      };
    }

    // 隐藏其他束（或选择显示）
    if (edge.id === bundleId) {
      return {
        ...edge,
        style: {
          ...edge.style,
          opacity: 0.2
        },
        data: {
          ...edge.data,
          expanded: true
        }
      };
    }

    return edge;
  });
}

/**
 * 收起展开的边束
 */
export function collapseBundle(
  bundleId: string,
  bundledEdges: Edge[],
  bundleMap: Map<string, EdgeBundle>
): Edge[] {
  const bundle = bundleMap.get(bundleId);
  if (!bundle) return bundledEdges;

  return bundledEdges.map(edge => {
    // 隐藏原始边
    if (edge.data?.bundleId === bundleId) {
      return {
        ...edge,
        style: {
          ...edge.style,
          display: 'none',
          opacity: 0
        },
        data: {
          ...edge.data,
          hidden: true
        }
      };
    }

    // 恢复聚合边
    if (edge.id === bundleId) {
      return {
        ...edge,
        style: {
          ...edge.style,
          opacity: 0.6
        },
        data: {
          ...edge.data,
          expanded: false
        }
      };
    }

    return edge;
  });
}

/**
 * 按设备层级组织的智能聚合
 * 例如：所有 Leaf→Spine 的边会被聚合
 */
export function bundleEdgesByLayer(
  edges: Edge[],
  threshold: number = 10
): {
  bundledEdges: Edge[];
  bundleMap: Map<string, EdgeBundle>;
} {
  const bundleMap = new Map<string, EdgeBundle>();
  const edgesByLayerKey = new Map<string, Edge[]>();

  // 按层级对分组
  for (const edge of edges) {
    const sourceLayer = extractLayer(edge.source);
    const targetLayer = extractLayer(edge.target);
    const layerKey = `${sourceLayer}→${targetLayer}`;

    if (!edgesByLayerKey.has(layerKey)) {
      edgesByLayerKey.set(layerKey, []);
    }
    edgesByLayerKey.get(layerKey)!.push(edge);
  }

  // 创建聚合边
  const bundledEdges: Edge[] = [];
  let bundleId = 0;

  for (const [layerKey, groupEdges] of edgesByLayerKey) {
    if (groupEdges.length >= threshold) {
      const bundleIdStr = `layer-bundle-${bundleId++}`;
      const [sourceLayer, targetLayer] = layerKey.split('→');

      const bundledEdge: Edge = {
        id: bundleIdStr,
        source: `${sourceLayer}-aggregate`,
        target: `${targetLayer}-aggregate`,
        animated: true,
        style: {
          stroke: getLayerColor(sourceLayer, targetLayer),
          strokeWidth: Math.min(3 + groupEdges.length / 10, 8),
          opacity: 0.5
        },
        label: `${groupEdges.length}`,
        data: {
          type: 'layer-bundle',
          layerKey,
          originalCount: groupEdges.length
        }
      };

      bundledEdges.push(bundledEdge);

      const bundle: EdgeBundle = {
        id: bundleIdStr,
        source: `${sourceLayer}-aggregate`,
        target: `${targetLayer}-aggregate`,
        count: groupEdges.length,
        originalEdges: groupEdges.map(e => e.id),
        label: `${layerKey}: ${groupEdges.length}`
      };

      bundleMap.set(bundleIdStr, bundle);
    } else {
      bundledEdges.push(...groupEdges);
    }
  }

  return { bundledEdges, bundleMap };
}

/**
 * 辅助函数：从设备名提取层级
 */
function extractLayer(deviceName: string): string {
  if (deviceName.includes('IBCR') || deviceName.includes('CORE')) {
    return 'core';
  } else if (deviceName.includes('IBSP') || deviceName.includes('SPINE')) {
    return 'spine';
  } else if (deviceName.includes('IBLF') || deviceName.includes('LEAF')) {
    return 'leaf';
  }
  return 'other';
}

/**
 * 辅助函数：获取层级颜色
 */
function getLayerColor(sourceLayer: string, targetLayer: string): string {
  const colorMap: Record<string, Record<string, string>> = {
    core: {
      core: '#e74c3c',
      spine: '#e67e22',
      leaf: '#d35400'
    },
    spine: {
      core: '#e67e22',
      spine: '#3498db',
      leaf: '#1abc9c'
    },
    leaf: {
      core: '#d35400',
      spine: '#1abc9c',
      leaf: '#27ae60'
    }
  };

  return colorMap[sourceLayer]?.[targetLayer] || '#95a5a6';
}

/**
 * 按 POD 智能聚合
 * 适用于有多个 POD 的拓扑
 */
export function bundleEdgesByPod(
  edges: Edge[],
  podMapping: Map<string, string>,  // deviceName → podName
  threshold: number = 5
): {
  bundledEdges: Edge[];
  bundleMap: Map<string, EdgeBundle>;
} {
  const bundleMap = new Map<string, EdgeBundle>();
  const edgesByPodKey = new Map<string, Edge[]>();

  // 按 POD 对分组
  for (const edge of edges) {
    const sourcePod = podMapping.get(edge.source) || 'UNKNOWN';
    const targetPod = podMapping.get(edge.target) || 'UNKNOWN';

    // 跨 POD 的边才聚合（同 POD 内保留原样）
    if (sourcePod !== targetPod) {
      const podKey = `${sourcePod}→${targetPod}`;

      if (!edgesByPodKey.has(podKey)) {
        edgesByPodKey.set(podKey, []);
      }
      edgesByPodKey.get(podKey)!.push(edge);
    }
  }

  const bundledEdges: Edge[] = [];
  let bundleId = 0;

  for (const [podKey, groupEdges] of edgesByPodKey) {
    if (groupEdges.length >= threshold) {
      const bundleIdStr = `pod-bundle-${bundleId++}`;

      const bundledEdge: Edge = {
        id: bundleIdStr,
        source: groupEdges[0].source,
        target: groupEdges[0].target,
        animated: true,
        style: {
          stroke: '#9b59b6',
          strokeWidth: Math.min(2 + groupEdges.length / 5, 6),
          opacity: 0.4
        },
        label: `${groupEdges.length} (跨 POD)`,
        data: {
          type: 'pod-bundle',
          podKey,
          originalCount: groupEdges.length
        }
      };

      bundledEdges.push(bundledEdge);

      const bundle: EdgeBundle = {
        id: bundleIdStr,
        source: groupEdges[0].source,
        target: groupEdges[0].target,
        count: groupEdges.length,
        originalEdges: groupEdges.map(e => e.id),
        label: `${podKey}: ${groupEdges.length}`
      };

      bundleMap.set(bundleIdStr, bundle);
    } else {
      bundledEdges.push(...groupEdges);
    }
  }

  // 添加同 POD 内的边
  for (const edge of edges) {
    const sourcePod = podMapping.get(edge.source);
    const targetPod = podMapping.get(edge.target);

    if (sourcePod === targetPod) {
      bundledEdges.push(edge);
    }
  }

  return { bundledEdges, bundleMap };
}
