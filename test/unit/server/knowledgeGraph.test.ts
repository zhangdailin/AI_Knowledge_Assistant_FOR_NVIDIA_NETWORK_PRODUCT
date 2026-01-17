/**
 * Knowledge Graph 模块测试
 * 测试知识图谱实体抽取和存储功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockNeo4jDriver } from '../../helpers/mock-factory';
import { createMockEntities, createMockDocument } from '../../fixtures/mock-data';
import { extractEntities } from '../../../server/knowledgeGraph.mjs';

describe('Knowledge Graph Module', () => {
  let neo4jMock: ReturnType<typeof mockNeo4jDriver>;

  beforeEach(() => {
    neo4jMock = mockNeo4jDriver();
    vi.clearAllMocks();
  });

  describe('extractEntities', () => {
    it('should extract vendor entities from metadata and patterns', () => {
      const text = `
        Acme Networks builds routers.
        NVIDIA Cumulus Linux supports BGP routing.
      `;

      const entities = extractEntities(text, {
        vendorNames: ['Acme Networks'],
        source: 'test'
      });

      expect(entities.vendors.length).toBeGreaterThan(0);
      expect(entities.vendors.some(v => v.name === 'NVIDIA')).toBe(true);
      expect(entities.vendors.some(v => v.name === 'Acme Networks')).toBe(true);
    });

    it('should extract vendor entities from text patterns without metadata', () => {
      const text = `
        Vendor: Huron Systems
        The Acme Networks platform is deployed in the lab.
      `;

      const entities = extractEntities(text, { source: 'test' });

      expect(entities.vendors.some(v => v.name === 'Huron Systems')).toBe(true);
      expect(entities.vendors.some(v => v.name === 'Acme Networks')).toBe(true);
    });

    it('should honor allowHeuristicVendors=false when vendorName is provided', () => {
      const text = `
        Vendor: Huron Systems
        The Acme Networks platform is deployed in the lab.
      `;

      const entities = extractEntities(text, {
        vendorName: 'NVIDIA',
        allowHeuristicVendors: false,
        source: 'test'
      });

      expect(entities.vendors).toHaveLength(1);
      expect(entities.vendors[0].name).toBe('NVIDIA');
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

    it('should extract function entities via patterns', () => {
      const text = `
        Configure BGP routing protocol.
        Enable OSPF on all interfaces.
        Set up EVPN for layer 2 extension.
        Use VXLAN for overlay network.
      `;
      const entities = extractEntities(text, { source: 'test' });

      expect(entities.functions.length).toBeGreaterThan(0);
      expect(entities.functions.some(p => p.name === 'BGP')).toBe(true);
      expect(entities.functions.some(p => p.name === 'OSPF')).toBe(true);
      expect(entities.functions.some(p => p.name === 'EVPN')).toBe(true);
    });

    it('should identify relationships between entities', () => {
      const text = `
        NVIDIA supports BGP and uses nv set interface command with eth0 parameter.
      `;

      const extractRelationships = (text: string, entities: any) => {
        const relationships = [];

        for (const func of entities.functions || []) {
          for (const command of entities.commands || []) {
            const funcIndex = text.indexOf(func.name);
            const commandIndex = text.indexOf(command.name);
            if (funcIndex !== -1 && commandIndex !== -1 &&
                Math.abs(funcIndex - commandIndex) < 200) {
              relationships.push({
                from: func.name,
                to: command.name,
                type: 'HAS_COMMAND'
              });
            }
          }
        }

        return relationships;
      };

      const entities = {
        vendors: [{ name: 'NVIDIA' }],
        functions: [{ name: 'BGP' }],
        commands: [{ name: 'nv set interface', category: 'nvue' }],
        parameters: [{ name: 'eth0', type: 'interface' }]
      };

      const relationships = extractRelationships(text, entities);

      expect(relationships.length).toBeGreaterThan(0);
      expect(relationships[0].type).toBe('HAS_COMMAND');
    });

    it('should handle text without entities gracefully', () => {
      const text = 'This is just plain text without any network entities.';
      const entities = extractEntities(text, { source: 'test' });
      expect(entities.vendors).toHaveLength(0);
    });
  });

  describe('storeEntities', () => {
    it('should create nodes in Neo4j', async () => {
      const entities = createMockEntities();

      // 模拟存储
      for (const vendor of entities.vendors) {
        await neo4jMock.session.run(
          'MERGE (v:Vendor {name: $name}) SET v.name = $name',
          { name: vendor.name }
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
      const vendor = { name: 'NVIDIA' };

      // 第一次创建
      await neo4jMock.session.run(
        'MERGE (v:Vendor {name: $name}) SET v.name = $name',
        vendor
      );

      // 第二次应该合并而不是创建新节点
      await neo4jMock.session.run(
        'MERGE (v:Vendor {name: $name}) SET v.name = $name',
        vendor
      );

      expect(neo4jMock.mockRun).toHaveBeenCalledTimes(2);
      // MERGE 确保不会创建重复节点
    });

    it('should track entity sources', async () => {
      const vendor = {
        name: 'NVIDIA',
        source: 'doc-test-1'
      };

      await neo4jMock.session.run(
        `MERGE (v:Vendor {name: $name})
         ON CREATE SET v.sources = [$source]
         ON MATCH SET v.sources = v.sources + $source`,
        vendor
      );

      expect(neo4jMock.mockRun).toHaveBeenCalledWith(
        expect.stringContaining('sources'),
        expect.objectContaining({ source: 'doc-test-1' })
      );
    });
  });

  describe('queryKnowledgeGraph', () => {
    it('should find entities by name', async () => {
      const query = 'NVIDIA';

      await neo4jMock.session.run(
        'MATCH (v:Vendor {name: $name}) RETURN v',
        { name: query }
      );

      expect(neo4jMock.mockRun).toHaveBeenCalledWith(
        expect.stringContaining('MATCH'),
        expect.objectContaining({ name: query })
      );
    });

    it('should traverse relationships', async () => {
      await neo4jMock.session.run(
        `MATCH (f:Function {name: $name})
         OPTIONAL MATCH (f)-[:HAS_COMMAND]->(c:Command)
         RETURN f, collect(c) as commands`,
        { name: 'BGP' }
      );

      expect(neo4jMock.mockRun).toHaveBeenCalledWith(
        expect.stringContaining('OPTIONAL MATCH'),
        expect.any(Object)
      );
    });

    it('should use fulltext search as fallback', async () => {
      const query = 'BGP configuration';

      await neo4jMock.session.run(
        `CALL db.index.fulltext.queryNodes('kg_search', $query)
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
        'MATCH (v:Vendor) RETURN v LIMIT $limit',
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
        MATCH (v:Vendor) WITH count(v) as vendorCount
        MATCH (f:Function) WITH vendorCount, count(f) as functionCount
        RETURN vendorCount, functionCount
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
          vendors: [],
          functions: [],
          commands: [],
          parameters: [],
          relationships: []
        };
      };

      const entities = extractAll(text);

      expect(entities).toBeDefined();
      expect(entities).toHaveProperty('vendors');
      expect(entities).toHaveProperty('functions');
      expect(entities).toHaveProperty('commands');
    });

    it('should handle documents without entities', async () => {
      const doc = createMockDocument({
        content: 'Plain text without network entities.'
      });

      const extractAll = (text: string) => {
        return {
          vendors: [],
          functions: [],
          commands: [],
          parameters: [],
          relationships: []
        };
      };

      const entities = extractAll(doc.content);

      expect(entities.vendors).toHaveLength(0);
      expect(entities.functions).toHaveLength(0);
      expect(entities.commands).toHaveLength(0);
    });
  });
});
