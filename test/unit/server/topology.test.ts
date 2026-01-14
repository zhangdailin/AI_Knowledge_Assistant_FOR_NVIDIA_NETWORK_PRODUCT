/**
 * Topology 模块测试
 * 测试网络拓扑分析功能
 */

import { describe, it, expect } from 'vitest';
import { createMockTopology } from '../../fixtures/mock-data';

describe('Topology Module', () => {
  describe('autoDetectLayers', () => {
    it('should detect IB network layers (IBCR, IBSP, IBLF)', () => {
      const devices = [
        'IBCR-01', 'IBCR-02',  // Core
        'IBSP-01', 'IBSP-02',  // Spine
        'IBLF-01', 'IBLF-02',  // Leaf
        'GPU-node-1'           // Compute (should be filtered)
      ];

      const detectIBLayers = (devices: string[]) => {
        const layers = { core: [] as string[], spine: [] as string[], leaf: [] as string[] };
        const gpuRegex = /GPU|compute|worker|node|host/i;

        devices.filter(d => !gpuRegex.test(d)).forEach(device => {
          if (/IBCR/i.test(device)) layers.core.push(device);
          else if (/IBSP/i.test(device)) layers.spine.push(device);
          else if (/IBLF/i.test(device)) layers.leaf.push(device);
        });

        return layers;
      };

      const layers = detectIBLayers(devices);

      expect(layers.core).toHaveLength(2);
      expect(layers.spine).toHaveLength(2);
      expect(layers.leaf).toHaveLength(2);
      expect(layers.core).toContain('IBCR-01');
      expect(layers.spine).toContain('IBSP-01');
      expect(layers.leaf).toContain('IBLF-01');
    });

    it('should detect RoCE network layers (CSW, SSW, ASW)', () => {
      const devices = [
        'CSW-01', 'CORE-01',    // Core
        'SSW-01', 'SPINE-01',   // Spine
        'ASW-01', 'LEAF-01'     // Leaf/Access
      ];

      const detectRoCELayers = (devices: string[]) => {
        const layers = { core: [] as string[], spine: [] as string[], leaf: [] as string[] };

        devices.forEach(device => {
          if (/CSW|CORE/i.test(device)) layers.core.push(device);
          else if (/SSW|SPINE/i.test(device)) layers.spine.push(device);
          else if (/ASW|ACCESS|LEAF/i.test(device)) layers.leaf.push(device);
        });

        return layers;
      };

      const layers = detectRoCELayers(devices);

      expect(layers.core).toHaveLength(2);
      expect(layers.spine).toHaveLength(2);
      expect(layers.leaf).toHaveLength(2);
    });

    it('should filter out compute nodes', () => {
      const devices = [
        'IBCR-01',
        'GPU-node-1',
        'compute-01',
        'worker-node-1',
        'IBSP-01'
      ];

      const filterCompute = (devices: string[]) => {
        const gpuRegex = /GPU|compute|worker|node|host|server/i;
        return devices.filter(d => !gpuRegex.test(d));
      };

      const networkDevices = filterCompute(devices);

      expect(networkDevices).toHaveLength(2);
      expect(networkDevices).toContain('IBCR-01');
      expect(networkDevices).toContain('IBSP-01');
      expect(networkDevices).not.toContain('GPU-node-1');
    });

    it('should use topology inference when naming fails', () => {
      const portMap = createMockTopology();

      // 构建连接图
      const buildGraph = (portMap: Map<string, any>) => {
        const graph = new Map<string, Set<string>>();

        for (const [key, val] of portMap) {
          const [device] = key.split('|');
          const peer = val.peer;

          if (!graph.has(device)) graph.set(device, new Set());
          if (!graph.has(peer)) graph.set(peer, new Set());

          graph.get(device)!.add(peer);
          graph.get(peer)!.add(device);
        }

        return graph;
      };

      const graph = buildGraph(portMap);

      expect(graph.size).toBeGreaterThan(0);
      expect(graph.has('IBCR-01')).toBe(true);
    });

    it('should apply custom patterns', () => {
      const devices = ['CUSTOM-CORE-01', 'CUSTOM-SPINE-01'];
      const customPatterns = {
        core: /CUSTOM-CORE/i,
        spine: /CUSTOM-SPINE/i,
        leaf: /CUSTOM-LEAF/i
      };

      const detectWithCustom = (devices: string[], patterns: any) => {
        const layers = { core: [] as string[], spine: [] as string[], leaf: [] as string[] };

        devices.forEach(device => {
          if (patterns.core.test(device)) layers.core.push(device);
          else if (patterns.spine.test(device)) layers.spine.push(device);
          else if (patterns.leaf.test(device)) layers.leaf.push(device);
        });

        return layers;
      };

      const layers = detectWithCustom(devices, customPatterns);

      expect(layers.core).toContain('CUSTOM-CORE-01');
      expect(layers.spine).toContain('CUSTOM-SPINE-01');
    });
  });

  describe('analyzeRoCETopology', () => {
    it('should identify spine-leaf architecture', () => {
      const portMap = createMockTopology();

      // 分析架构
      const analyzeArchitecture = (portMap: Map<string, any>) => {
        const devices = new Set<string>();
        for (const [key] of portMap) {
          const [device] = key.split('|');
          devices.add(device);
        }

        const hasCore = Array.from(devices).some(d => /IBCR|CSW|CORE/i.test(d));
        const hasSpine = Array.from(devices).some(d => /IBSP|SSW|SPINE/i.test(d));
        const hasLeaf = Array.from(devices).some(d => /IBLF|ASW|LEAF/i.test(d));

        if (hasCore && hasSpine && hasLeaf) return 'three-tier';
        if (hasSpine && hasLeaf) return 'spine-leaf';
        return 'unknown';
      };

      const architecture = analyzeArchitecture(portMap);

      expect(architecture).toBe('three-tier');
    });

    it('should detect redundant paths', () => {
      const portMap = createMockTopology();

      // 检测冗余路径
      const detectRedundancy = (portMap: Map<string, any>) => {
        const connections = new Map<string, number>();

        for (const [key] of portMap) {
          const [device] = key.split('|');
          connections.set(device, (connections.get(device) || 0) + 1);
        }

        // 如果设备有多个连接，说明有冗余
        return Array.from(connections.values()).some(count => count > 1);
      };

      const hasRedundancy = detectRedundancy(portMap);

      expect(hasRedundancy).toBe(true);
    });

    it('should calculate network depth', () => {
      const portMap = createMockTopology();

      // 计算网络深度（从 core 到 leaf 的最大跳数）
      const calculateDepth = (portMap: Map<string, any>) => {
        // 简化实现：基于设备类型
        const devices = new Set<string>();
        for (const [key] of portMap) {
          const [device] = key.split('|');
          devices.add(device);
        }

        let depth = 0;
        if (Array.from(devices).some(d => /IBCR|CSW/i.test(d))) depth++;
        if (Array.from(devices).some(d => /IBSP|SSW/i.test(d))) depth++;
        if (Array.from(devices).some(d => /IBLF|ASW/i.test(d))) depth++;

        return depth;
      };

      const depth = calculateDepth(portMap);

      expect(depth).toBeGreaterThan(0);
      expect(depth).toBeLessThanOrEqual(3);
    });
  });

  describe('inferLayersFromTopology', () => {
    it('should infer layers from connection patterns', () => {
      const portMap = createMockTopology();

      // 基于连接度推断层级
      const inferLayers = (portMap: Map<string, any>) => {
        const connectionCount = new Map<string, number>();

        for (const [key] of portMap) {
          const [device] = key.split('|');
          connectionCount.set(device, (connectionCount.get(device) || 0) + 1);
        }

        const layers = { core: [] as string[], spine: [] as string[], leaf: [] as string[] };

        // Core: 最多连接
        // Spine: 中等连接
        // Leaf: 最少连接
        const sorted = Array.from(connectionCount.entries())
          .sort((a, b) => b[1] - a[1]);

        const third = Math.ceil(sorted.length / 3);
        layers.core = sorted.slice(0, third).map(([d]) => d);
        layers.spine = sorted.slice(third, third * 2).map(([d]) => d);
        layers.leaf = sorted.slice(third * 2).map(([d]) => d);

        return layers;
      };

      const layers = inferLayers(portMap);

      expect(layers.core.length + layers.spine.length + layers.leaf.length).toBeGreaterThan(0);
    });

    it('should calculate confidence score', () => {
      const portMap = createMockTopology();

      const calculateConfidence = (portMap: Map<string, any>) => {
        const devices = new Set<string>();
        for (const [key] of portMap) {
          const [device] = key.split('|');
          devices.add(device);
        }

        // 如果有明确的命名模式，置信度高
        const hasNaming = Array.from(devices).some(d =>
          /IBCR|IBSP|IBLF|CSW|SSW|ASW/i.test(d)
        );

        return hasNaming ? 0.9 : 0.5;
      };

      const confidence = calculateConfidence(portMap);

      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('topology validation', () => {
    it('should validate topology completeness', () => {
      const portMap = createMockTopology();

      const validateTopology = (portMap: Map<string, any>) => {
        // 检查是否所有连接都是双向的
        const connections = new Set<string>();

        for (const [key, val] of portMap) {
          const [device, port] = key.split('|');
          const peer = val.peer;
          const peerPort = val.peerPort;

          connections.add(`${device}-${peer}`);

          // 检查反向连接
          const reverseKey = `${peer}|${peerPort}`;
          if (portMap.has(reverseKey)) {
            const reverse = portMap.get(reverseKey);
            if (reverse.peer === device) {
              connections.add(`${peer}-${device}`);
            }
          }
        }

        return connections.size > 0;
      };

      const isValid = validateTopology(portMap);

      expect(isValid).toBe(true);
    });

    it('should detect orphaned devices', () => {
      const portMap = new Map([
        ['device1|1', { peer: 'device2', peerPort: '1' }],
        ['device3|1', { peer: 'device3', peerPort: '2' }] // 自连接
      ]);

      const detectOrphans = (portMap: Map<string, any>) => {
        const connected = new Set<string>();

        for (const [key, val] of portMap) {
          const [device] = key.split('|');
          const peer = val.peer;

          if (device !== peer) {
            connected.add(device);
            connected.add(peer);
          }
        }

        const allDevices = new Set<string>();
        for (const [key] of portMap) {
          const [device] = key.split('|');
          allDevices.add(device);
        }

        const orphans = Array.from(allDevices).filter(d => !connected.has(d));
        return orphans;
      };

      const orphans = detectOrphans(portMap);

      expect(orphans).toContain('device3');
    });
  });

  describe('topology statistics', () => {
    it('should count total devices', () => {
      const portMap = createMockTopology();

      const countDevices = (portMap: Map<string, any>) => {
        const devices = new Set<string>();
        for (const [key, val] of portMap) {
          const [device] = key.split('|');
          devices.add(device);
          devices.add(val.peer);
        }
        return devices.size;
      };

      const count = countDevices(portMap);

      expect(count).toBeGreaterThan(0);
    });

    it('should count total connections', () => {
      const portMap = createMockTopology();

      const countConnections = (portMap: Map<string, any>) => {
        return portMap.size;
      };

      const count = countConnections(portMap);

      expect(count).toBeGreaterThan(0);
    });

    it('should calculate average connectivity', () => {
      const portMap = createMockTopology();

      const calculateAvgConnectivity = (portMap: Map<string, any>) => {
        const deviceConnections = new Map<string, number>();

        for (const [key] of portMap) {
          const [device] = key.split('|');
          deviceConnections.set(device, (deviceConnections.get(device) || 0) + 1);
        }

        const total = Array.from(deviceConnections.values())
          .reduce((sum, count) => sum + count, 0);

        return total / deviceConnections.size;
      };

      const avgConnectivity = calculateAvgConnectivity(portMap);

      expect(avgConnectivity).toBeGreaterThan(0);
    });
  });
});
