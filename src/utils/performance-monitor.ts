/**
 * 性能监控工具
 * 用于测量和跟踪拓扑渲染的性能指标
 */

export interface PerformanceMetrics {
  // 时间指标
  loadTime: number;           // 初始化耗时 (ms)
  renderTime: number;         // 首次渲染耗时 (ms)
  interactionLatency: number; // 交互延迟 (ms)

  // 内存指标
  heapSize: number;           // 堆大小 (MB)
  heapUsed: number;           // 已使用内存 (MB)

  // 帧率
  fps: number;                // 当前 FPS
  avgFps: number;             // 平均 FPS

  // 节点/边统计
  nodeCount: number;
  edgeCount: number;
  bundledEdgeCount?: number;
  originalEdgeCount?: number;

  // DOM 统计
  domNodes: number;
  domSize: number;            // DOM 树大小估计 (KB)
}

export interface PerformanceThreshold {
  excellent: number;
  good: number;
  fair: number;
  poor: number;
}

/**
 * 性能监控类
 */
export class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    loadTime: 0,
    renderTime: 0,
    interactionLatency: 0,
    heapSize: 0,
    heapUsed: 0,
    fps: 0,
    avgFps: 0,
    nodeCount: 0,
    edgeCount: 0,
    domNodes: 0,
    domSize: 0
  };

  private startTime: number = 0;
  private fpsFrames: number[] = [];
  private lastFrameTime: number = 0;
  private animationFrameId: number | null = null;
  private interactionStartTime: number = 0;

  /**
   * 开始测量初始化时间
   */
  startMeasure() {
    this.startTime = performance.now();
  }

  /**
   * 完成初始化测量
   */
  endMeasure() {
    this.metrics.loadTime = performance.now() - this.startTime;
  }

  /**
   * 测量渲染时间
   */
  measureRenderTime() {
    this.metrics.renderTime = performance.now() - this.startTime;
  }

  /**
   * 开始跟踪 FPS
   */
  startFpsTracking() {
    this.fpsFrames = [];
    this.lastFrameTime = performance.now();

    const measureFrame = () => {
      const now = performance.now();
      const delta = now - this.lastFrameTime;
      const fps = 1000 / delta;

      this.fpsFrames.push(fps);

      // 保留最近 60 帧
      if (this.fpsFrames.length > 60) {
        this.fpsFrames.shift();
      }

      this.metrics.fps = fps;
      this.metrics.avgFps =
        this.fpsFrames.reduce((a, b) => a + b, 0) / this.fpsFrames.length;

      this.lastFrameTime = now;
      this.animationFrameId = requestAnimationFrame(measureFrame);
    };

    this.animationFrameId = requestAnimationFrame(measureFrame);
  }

  /**
   * 停止跟踪 FPS
   */
  stopFpsTracking() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * 测量交互延迟
   */
  startInteractionMeasure() {
    this.interactionStartTime = performance.now();
  }

  recordInteractionLatency() {
    this.metrics.interactionLatency = performance.now() - this.interactionStartTime;
  }

  /**
   * 更新内存指标
   */
  updateMemoryMetrics() {
    if ((performance as any).memory) {
      this.metrics.heapSize = (performance as any).memory.jsHeapSizeLimit / (1024 * 1024);
      this.metrics.heapUsed = (performance as any).memory.usedJSHeapSize / (1024 * 1024);
    }
  }

  /**
   * 更新节点/边统计
   */
  updateElementCounts(nodeCount: number, edgeCount: number, bundledCount?: number) {
    this.metrics.nodeCount = nodeCount;
    this.metrics.edgeCount = edgeCount;
    this.metrics.bundledEdgeCount = bundledCount;
    this.metrics.originalEdgeCount = edgeCount - (bundledCount || 0);
  }

  /**
   * 更新 DOM 统计
   */
  updateDomStats() {
    const svgElements = document.querySelectorAll('svg, g, path, circle, rect');
    this.metrics.domNodes = svgElements.length;

    // 估算 DOM 大小
    let estimatedSize = 0;
    svgElements.forEach((el) => {
      // 每个 DOM 节点估计 500 字节
      estimatedSize += 500;
      // 加上属性
      estimatedSize += el.attributes.length * 50;
    });

    this.metrics.domSize = estimatedSize / 1024; // 转换为 KB
  }

  /**
   * 获取当前指标
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * 生成性能报告
   */
  generateReport(): string {
    const metrics = this.metrics;
    const heapUsagePercent = (metrics.heapUsed / metrics.heapSize) * 100;

    return `
╔════════════════════════════════════════════════════════════════╗
║               拓扑拓展显示 - 性能报告                          ║
╚════════════════════════════════════════════════════════════════╝

⏱️  时间指标：
   • 初始化耗时：${metrics.loadTime.toFixed(2)} ms
   • 首次渲染：${metrics.renderTime.toFixed(2)} ms
   • 交互延迟：${metrics.interactionLatency.toFixed(2)} ms

📊 帧率：
   • 当前 FPS：${metrics.fps.toFixed(1)}
   • 平均 FPS：${metrics.avgFps.toFixed(1)}
   ${this.getFpsRating(metrics.avgFps)}

💾 内存使用：
   • 堆大小：${metrics.heapSize.toFixed(0)} MB
   • 已使用：${metrics.heapUsed.toFixed(0)} MB (${heapUsagePercent.toFixed(1)}%)
   ${this.getMemoryRating(heapUsagePercent)}

📈 拓扑规模：
   • 节点数：${metrics.nodeCount}
   • 边数（原始）：${metrics.originalEdgeCount || metrics.edgeCount}
   ${metrics.bundledEdgeCount ? `• 边数（优化后）：${metrics.edgeCount}` : ''}
   ${metrics.bundledEdgeCount ? `• 聚合边数：${metrics.bundledEdgeCount}` : ''}
   ${metrics.bundledEdgeCount ? `• 优化率：${(((metrics.originalEdgeCount || metrics.edgeCount) - metrics.edgeCount) / (metrics.originalEdgeCount || metrics.edgeCount) * 100).toFixed(1)}%` : ''}

🌳 DOM 统计：
   • DOM 节点数：${metrics.domNodes}
   • 估算 DOM 大小：${metrics.domSize.toFixed(0)} KB
    `;
  }

  /**
   * 获取 FPS 评级
   */
  private getFpsRating(fps: number): string {
    if (fps >= 50) {
      return '   ✅ 评级：优秀（60fps 目标）';
    } else if (fps >= 30) {
      return '   ⚠️  评级：良好（可接受）';
    } else {
      return '   ❌ 评级：需要优化';
    }
  }

  /**
   * 获取内存评级
   */
  private getMemoryRating(percent: number): string {
    if (percent < 50) {
      return '   ✅ 评级：优秀';
    } else if (percent < 75) {
      return '   ⚠️  评级：良好';
    } else {
      return '   ❌ 评级：可能存在内存压力';
    }
  }
}

/**
 * 全局单例
 */
let instance: PerformanceMonitor | null = null;

export function getPerformanceMonitor(): PerformanceMonitor {
  if (!instance) {
    instance = new PerformanceMonitor();
  }
  return instance;
}

/**
 * 便利函数：比较优化前后的性能改进
 */
export function comparePerformance(
  before: PerformanceMetrics,
  after: PerformanceMetrics
): string {
  const improvements = [
    {
      name: '渲染时间',
      before: before.renderTime,
      after: after.renderTime,
      unit: 'ms'
    },
    {
      name: '内存占用',
      before: before.heapUsed,
      after: after.heapUsed,
      unit: 'MB'
    },
    {
      name: '平均 FPS',
      before: before.avgFps,
      after: after.avgFps,
      unit: 'fps'
    },
    {
      name: 'DOM 节点',
      before: before.domNodes,
      after: after.domNodes,
      unit: '个'
    }
  ];

  let report = '\n📊 性能改进对比：\n';

  for (const item of improvements) {
    const improvement = before[item.name as keyof PerformanceMetrics] as number -
                       after[item.name as keyof PerformanceMetrics] as number;
    const percent = ((improvement / before[item.name as keyof PerformanceMetrics] as number) * 100).toFixed(1);

    const direction = improvement > 0 ? '↓' : '↑';
    const symbol = improvement > 0 ? '✅' : '❌';

    report += `   ${symbol} ${item.name}: ${before[item.name as keyof PerformanceMetrics]}${item.unit} → ${after[item.name as keyof PerformanceMetrics]}${item.unit} (${direction} ${Math.abs(Number(percent))}%)\n`;
  }

  return report;
}

/**
 * 获取性能建议
 */
export function getPerformanceRecommendations(metrics: PerformanceMetrics): string[] {
  const recommendations: string[] = [];

  // 渲染时间建议
  if (metrics.renderTime > 1000) {
    recommendations.push('⚠️  初始渲染耗时超过 1 秒，建议：');
    recommendations.push('   - 启用边聚合（可减少 70% 的边）');
    recommendations.push('   - 使用虚拟滚动（仅渲染可见区域）');
    recommendations.push('   - 考虑迁移到 Cytoscape.js');
  }

  // FPS 建议
  if (metrics.avgFps < 30) {
    recommendations.push('⚠️  帧率低于 30fps，交互体验差，建议：');
    recommendations.push('   - 关闭动画效果');
    recommendations.push('   - 启用边聚合');
    recommendations.push('   - 禁用实时布局更新');
  }

  // 内存建议
  const memoryPercent = (metrics.heapUsed / metrics.heapSize) * 100;
  if (memoryPercent > 80) {
    recommendations.push('⚠️  内存占用超过 80%，建议：');
    recommendations.push('   - 清理未使用的数据');
    recommendations.push('   - 分批加载大规模拓扑');
    recommendations.push('   - 使用流式渲染');
  }

  // DOM 大小建议
  if (metrics.domSize > 1000) {
    recommendations.push('⚠️  DOM 树过大（>1MB），建议：');
    recommendations.push('   - 使用 Canvas 渲染替代 DOM');
    recommendations.push('   - 启用虚拟化');
    recommendations.push('   - 简化节点/边的样式');
  }

  // 规模建议
  if (metrics.nodeCount > 3000 && metrics.edgeCount > 5000) {
    recommendations.push('ℹ️  检测到大规模拓扑（3000+ 节点，5000+ 边）');
    recommendations.push('   推荐方案：迁移到 Cytoscape.js 或实现虚拟滚动');
  }

  return recommendations;
}
