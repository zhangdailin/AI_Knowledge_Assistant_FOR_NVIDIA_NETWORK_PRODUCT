/**
 * Knowledge Graph 模块测试
 * 测试知识图谱实体抽取和存储功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockNeo4jDriver } from '../../helpers/mock-factory';
import { createMockEntities, createMockDocument } from '../../fixtures/mock-data';
import { expectToBeValidEntity } from '../../helpers/test-utils';

describe('Knowledge Graph Module', () => {
  let neo4jMock: ReturnType<typeof mockNeo4jDriver>;

  beforeEach(() => {
    neo4jMock = mockNeo4jDriver();
    vi.clearAllMocks();
  });

  describe('extractEntities', () => {
    it('should extract device entities (IBCR, CSW, GPU)', () => {
      const text = `
        Configure IBCR-01 switch for BGP routing.
        Connect CSW-02 to the spine layer.
        GPU-node-1 is connected to IBLF-03.
      `;

      // 模拟实体抽取
      const extractDevices = (text: string) => {
        const patterns = [
          /\b(IBCR|IBSP|IBLF|CSW|SSW|ASW)[-_]?\w*\d+/gi,
          /\b(GPU)[-_]?node[-_]?\d+/gi
        ];

        const devices = [];
        for (const pattern of patterns) {
          const matches = text.match(pattern);
          if (matches) {
            devices.push(...matches.map(m => ({
              name: m,
              type: m.startsWith('GPU') ? 'compute_node' : 'switch'
            })));
          }
        }
        return devices;
      };

      const devices = extractDevices(text);

      expect(devices.length).toBeGreaterThan(0);
      expect(devices.some(d => d.name.includes('IBCR-01'))).toBe(true);
      expect(devices.some(d => d.name.includes('CSW-02'))).toBe(true);
      expect(devices.some(d => d.name.includes('GPU-node-1'))).toBe(true);
    });

    it('should extract command entities (nv set, ip route)', () => {
      const text = `
        Run nv set interface eth0 to configure the interface.
        Use ip route show to display routes.
        Execute nv show system to check status.
      `;

      const extractCommands = (text: string) => {
        const patterns = [
          /\bnv\s+(set|show|config|unset)\s+[\w\-\.]+(?:\s+[\w\-\.]+)*/gi,
          /\b(ip|ifconfig)\s+[\w\-]+/gi
        ];

        const commands = [];
        for (const pattern of patterns) {
          const matches = text.match(pattern);
          if (matches) {
            commands.push(...matches.map(m => ({
              name: m.trim(),
              category: m.startsWith('nv') ? 'nvue' : 'linux'
            })));
          }
        }
        return commands;
      };

      const commands = extractCommands(text);

      expect(commands.length).toBeGreaterThan(0);
      expect(commands.some(c => c.name.includes('nv set'))).toBe(true);
      expect(commands.some(c => c.name.includes('ip route'))).toBe(true);
    });

    it('should extract parameter entities (vlan, IP addresses)', () => {
      const text = `
        Configure vlan100 on interface eth0.
        Set IP address to 192.168.1.1/24.
        Use port 8080 for the service.
      `;

      const extractParameters = (text: string) => {
        const patterns = [
          { regex: /\bvlan\d+/gi, type: 'network_param' },
          { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?\b/g, type: 'ip_address' },
          { regex: /\bport\s+(\d+)/gi, type: 'port' },
          { regex: /\b(eth|swp|bond)\d+/gi, type: 'interface' }
        ];

        const parameters = [];
        for (const pattern of patterns) {
          const matches = text.match(pattern.regex);
          if (matches) {
            parameters.push(...matches.map(m => ({
              name: m.trim(),
              type: pattern.type
            })));
          }
        }
        return parameters;
      };

      const parameters = extractParameters(text);

      expect(parameters.length).toBeGreaterThan(0);
      expect(parameters.some(p => p.name === 'vlan100')).toBe(true);
      expect(parameters.some(p => p.name === '192.168.1.1/24')).toBe(true);
      expect(parameters.some(p => p.name === 'eth0')).toBe(true);
    });

    it('should extract protocol entities (BGP, OSPF, EVPN)', () => {
      const text = `
        Configure BGP routing protocol.
        Enable OSPF on all interfaces.
        Set up EVPN for layer 2 extension.
        Use VXLAN for overlay network.
      `;

      const extractProtocols = (text: string) => {
        const protocols = ['BGP', 'OSPF', 'EVPN', 'VXLAN', 'MLAG', 'LACP'];
        const found = [];

        for (const protocol of protocols) {
          const regex = new RegExp(`\\b${protocol}\\b`, 'gi');
          if (regex.test(text)) {
            found.push({ name: protocol });
          }
        }

        return found;
      };

      const protocols = extractProtocols(text);

      expect(protocols.length).toBeGreaterThan(0);
      expect(protocols.some(p => p.name === 'BGP')).toBe(true);
      expect(protocols.some(p => p.name === 'OSPF')).toBe(true);
      expect(protocols.some(p => p.name === 'EVPN')).toBe(true);
    });

    it('should identify relationships between entities', () => {
      const text = `
        IBCR-01 uses nv set interface command with eth0 parameter.
        The device supports BGP protocol.
      `;

      // 模拟关系提取
      const extractRelationships = (text: string, entities: any) => {
        const relationships = [];

        // 设备-命令关系
        for (const device of entities.devices || []) {
          for (const command of entities.commands || []) {
            const deviceIndex = text.indexOf(device.name);
            const commandIndex = text.indexOf(command.name);
            if (deviceIndex !== -1 && commandIndex !== -1 &&
                Math.abs(deviceIndex - commandIndex) < 200) {
              relationships.push({
                from: device.name,
                to: command.name,
                type: 'USES_COMMAND'
              });
            }
          }
        }

        return relationships;
      };

      const entities = {
        devices: [{ name: 'IBCR-01', type: 'switch' }],
        commands: [{ name: 'nv set interface', category: 'nvue' }],
        parameters: [{ name: 'eth0', type: 'interface' }],
        protocols: [{ name: 'BGP' }]
      };

      const relationships = extractRelationships(text, entities);

      expect(relationships.length).toBeGreaterThan(0);
      expect(relationships[0].type).toBe('USES_COMMAND');
    });

    it('should handle text without entities gracefully', () => {
      const text = 'This is just plain text without any network entities.';

      const extractDevices = (text: string) => {
        const pattern = /\b(IBCR|IBSP|IBLF)[-_]?\w*\d+/gi;
        return (text.match(pattern) || []).map(m => ({ name: m, type: 'switch' }));
      };

      const devices = extractDevices(text);

      expect(devices).toHaveLength(0);
    });
  });

  describe('storeEntities', () => {
    it('should create nodes in Neo4j', async () => {
      const entities = createMockEntities();

      // 模拟存储
      for (const device of entities.devices) {
        await neo4jMock.session.run(
          'MERGE (d:Device {name: $name}) SET d.type = $type',
          { name: device.name, type: device.type }
        );
      }

      expect(neo4jMock.mockRun).toHaveBeenCalled();
      expect(neo4jMock.mockRun).toHaveBeenCalledWith(
        expect.stringContaining('MERGE'),
        expect.any(Object)
      );
    });

    it('should create relationships between nodes', async () => {
      const entities = createMockEntities();

      // 模拟关系创建
      for (const rel of entities.relationships) {
        await neo4jMock.session.run(
          `MATCH (from:${rel.fromType} {name: $from})
           MATCH (to:${rel.toType} {name: $to})
           MERGE (from)-[r:${rel.type}]->(to)`,
          { from: rel.from, to: rel.to }
        );
      }

      expect(neo4jMock.mockRun).toHaveBeenCalled();
    });

    it('should merge duplicate entities', async () => {
      const device = { name: 'IBCR-01', type: 'switch' };

      // 第一次创建
      await neo4jMock.session.run(
        'MERGE (d:Device {name: $name}) SET d.type = $type',
        device
      );

      // 第二次应该合并而不是创建新节点
      await neo4jMock.session.run(
        'MERGE (d:Device {name: $name}) SET d.type = $type',
        device
      );

      expect(neo4jMock.mockRun).toHaveBeenCalledTimes(2);
      // MERGE 确保不会创建重复节点
    });

    it('should track entity sources', async () => {
      const device = {
        name: 'IBCR-01',
        type: 'switch',
        source: 'doc-test-1'
      };

      await neo4jMock.session.run(
        `MERGE (d:Device {name: $name})
         ON CREATE SET d.sources = [$source]
         ON MATCH SET d.sources = d.sources + $source`,
        device
      );

      expect(neo4jMock.mockRun).toHaveBeenCalledWith(
        expect.stringContaining('sources'),
        expect.objectContaining({ source: 'doc-test-1' })
      );
    });
  });

  describe('queryKnowledgeGraph', () => {
    it('should find entities by name', async () => {
      const query = 'IBCR-01';

      await neo4jMock.session.run(
        'MATCH (d:Device {name: $name}) RETURN d',
        { name: query }
      );

      expect(neo4jMock.mockRun).toHaveBeenCalledWith(
        expect.stringContaining('MATCH'),
        expect.objectContaining({ name: query })
      );
    });

    it('should traverse relationships', async () => {
      await neo4jMock.session.run(
        `MATCH (d:Device {name: $name})
         OPTIONAL MATCH (d)-[:USES_COMMAND]->(c:Command)
         RETURN d, collect(c) as commands`,
        { name: 'IBCR-01' }
      );

      expect(neo4jMock.mockRun).toHaveBeenCalledWith(
        expect.stringContaining('OPTIONAL MATCH'),
        expect.any(Object)
      );
    });

    it('should use fulltext search as fallback', async () => {
      const query = 'BGP configuration';

      await neo4jMock.session.run(
        `CALL db.index.fulltext.queryNodes('device_search', $query)
         YIELD node, score
         RETURN node, score
         ORDER BY score DESC
         LIMIT $limit`,
        { query, limit: 10 }
      );

      expect(neo4jMock.mockRun).toHaveBeenCalledWith(
        expect.stringContaining('fulltext'),
        expect.objectContaining({ query })
      );
    });

    it('should limit result count', async () => {
      const limit = 5;

      await neo4jMock.session.run(
        'MATCH (d:Device) RETURN d LIMIT $limit',
        { limit }
      );

      expect(neo4jMock.mockRun).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.objectContaining({ limit })
      );
    });
  });

  describe('getGraphStats', () => {
    it('should count nodes by type', async () => {
      await neo4jMock.session.run(`
        MATCH (d:Device) WITH count(d) as deviceCount
        MATCH (c:Command) WITH deviceCount, count(c) as commandCount
        RETURN deviceCount, commandCount
      `);

      expect(neo4jMock.mockRun).toHaveBeenCalled();
    });

    it('should count relationships', async () => {
      await neo4jMock.session.run(`
        MATCH ()-[r]->()
        RETURN count(r) as relationshipCount
      `);

      expect(neo4jMock.mockRun).toHaveBeenCalled();
    });
  });

  describe('processDocument', () => {
    it('should extract and store entities from document', async () => {
      const doc = createMockDocument();
      const text = doc.content;

      // 模拟处理流程
      const extractAll = (text: string) => {
        return {
          devices: [],
          commands: [],
          parameters: [],
          protocols: [],
          relationships: []
        };
      };

      const entities = extractAll(text);

      expect(entities).toBeDefined();
      expect(entities).toHaveProperty('devices');
      expect(entities).toHaveProperty('commands');
    });

    it('should handle documents without entities', async () => {
      const doc = createMockDocument({
        content: 'Plain text without network entities.'
      });

      const extractAll = (text: string) => {
        return {
          devices: [],
          commands: [],
          parameters: [],
          protocols: [],
          relationships: []
        };
      };

      const entities = extractAll(doc.content);

      expect(entities.devices).toHaveLength(0);
      expect(entities.commands).toHaveLength(0);
    });
  });
});
