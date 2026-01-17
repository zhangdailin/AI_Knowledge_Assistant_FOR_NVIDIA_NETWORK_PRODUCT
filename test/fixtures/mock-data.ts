/**
 * Mock 数据工厂 - 用于生成测试数据
 */

import type { Document, Chunk, Message, Conversation } from '../../src/lib/types';

/**
 * 创建 Mock 文档
 */
export const createMockDocument = (overrides: Partial<Document> = {}): Document => ({
  id: 'doc-test-1',
  name: 'test-document.pdf',
  content: 'Test document content with network configuration details.',
  uploadedAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
  chunkCount: 5,
  category: 'default',
  categoryId: 'default',
  userId: 'test-user',
  ...overrides
});

/**
 * 创建 Mock Chunk
 */
export const createMockChunk = (overrides: Partial<Chunk> = {}): Chunk => ({
  id: 'chunk-test-1',
  documentId: 'doc-test-1',
  content: 'Test chunk content about BGP configuration on IBCR-01 switch.',
  chunkIndex: 0,
  tokenCount: 100,
  embedding: new Array(1024).fill(0.1),
  createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
  ...overrides
});

/**
 * 创建多个 Mock Chunks
 */
export const createMockChunks = (count: number, baseOverrides: Partial<Chunk> = {}): Chunk[] => {
  return Array.from({ length: count }, (_, i) =>
    createMockChunk({
      id: `chunk-test-${i + 1}`,
      chunkIndex: i,
      content: `Test chunk ${i + 1} content`,
      ...baseOverrides
    })
  );
};

/**
 * 创建 Mock Embedding
 */
export const createMockEmbedding = (dimension: number = 1024, value: number = 0.1): number[] => {
  return new Array(dimension).fill(value);
};

/**
 * 创建 Mock 查询结果
 */
export const createMockSearchResult = (overrides: any = {}) => ({
  chunk: createMockChunk(),
  score: 0.85,
  ...overrides
});

/**
 * 创建 Mock 消息
 */
export const createMockMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'msg-test-1',
  role: 'user',
  content: 'How to configure BGP on IBCR-01?',
  timestamp: Date.now(),
  ...overrides
});

/**
 * 创建 Mock 对话
 */
export const createMockConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'conv-test-1',
  title: 'Test Conversation',
  messages: [
    createMockMessage({ role: 'user', content: 'Hello' }),
    createMockMessage({ role: 'assistant', content: 'Hi! How can I help?' })
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides
});

/**
 * 创建 Mock 实体数据（用于知识图谱测试）
 */
export const createMockEntities = () => ({
  vendors: [
    { name: 'NVIDIA', source: 'doc-test-1' }
  ],
  functions: [
    { name: 'BGP', source: 'doc-test-1' },
    { name: 'EVPN', source: 'doc-test-1' }
  ],
  commands: [
    { name: 'nv set interface', category: 'nvue', source: 'doc-test-1' },
    { name: 'ip route show', category: 'linux', source: 'doc-test-1' }
  ],
  parameters: [
    { name: 'vlan100', type: 'network_param', source: 'doc-test-1' },
    { name: '192.168.1.1/24', type: 'ip_address', source: 'doc-test-1' },
    { name: 'eth0', type: 'interface', source: 'doc-test-1' }
  ],
  relationships: [
    { from: 'NVIDIA', to: 'BGP', type: 'HAS_FUNCTION', fromType: 'Vendor', toType: 'Function' },
    { from: 'BGP', to: 'nv set interface', type: 'HAS_COMMAND', fromType: 'Function', toType: 'Command' },
    { from: 'nv set interface', to: 'eth0', type: 'HAS_PARAMETER', fromType: 'Command', toType: 'Parameter' },
    { from: 'NVIDIA', to: 'EVPN', type: 'HAS_FUNCTION', fromType: 'Vendor', toType: 'Function' }
  ]
});

/**
 * 创建 Mock 拓扑数据
 */
export const createMockTopology = () => {
  const portMap = new Map();

  // Core layer
  portMap.set('IBCR-01|1', { peer: 'IBSP-01', peerPort: '1' });
  portMap.set('IBCR-01|2', { peer: 'IBSP-02', peerPort: '1' });

  // Spine layer
  portMap.set('IBSP-01|1', { peer: 'IBCR-01', peerPort: '1' });
  portMap.set('IBSP-01|2', { peer: 'IBLF-01', peerPort: '1' });
  portMap.set('IBSP-02|1', { peer: 'IBCR-01', peerPort: '2' });
  portMap.set('IBSP-02|2', { peer: 'IBLF-02', peerPort: '1' });

  // Leaf layer
  portMap.set('IBLF-01|1', { peer: 'IBSP-01', peerPort: '2' });
  portMap.set('IBLF-01|2', { peer: 'GPU-node-1', peerPort: '1' });
  portMap.set('IBLF-02|1', { peer: 'IBSP-02', peerPort: '2' });
  portMap.set('IBLF-02|2', { peer: 'GPU-node-2', peerPort: '1' });

  return portMap;
};

/**
 * 创建 Mock Markdown 文档
 */
export const createMockMarkdown = () => `
# Network Configuration Guide

## BGP Configuration

Configure BGP on IBCR-01 switch:

\`\`\`bash
nv set router bgp autonomous-system 65001
nv set router bgp router-id 10.0.0.1
nv set vrf default router bgp neighbor 10.0.0.2
\`\`\`

## EVPN Configuration

Enable EVPN on spine switches:

\`\`\`bash
nv set evpn enable on
nv set router bgp address-family l2vpn-evpn enable on
\`\`\`

## Interface Configuration

Configure interface eth0:

- IP Address: 192.168.1.1/24
- VLAN: 100
- MTU: 9000
`;

/**
 * 创建 Mock 查询历史
 */
export const createMockQueryHistory = () => [
  { query: 'BGP configuration', timestamp: Date.now() - 3600000, responseTime: 1200 },
  { query: 'EVPN setup', timestamp: Date.now() - 1800000, responseTime: 1500 },
  { query: 'Interface status', timestamp: Date.now() - 900000, responseTime: 800 }
];

/**
 * 创建 Mock API 响应
 */
export const createMockApiResponse = (data: any, ok: boolean = true) => ({
  ok,
  data,
  error: ok ? undefined : 'Mock error message'
});

/**
 * 创建 Mock 设置
 */
export const createMockSettings = () => ({
  modelSelection: {
    embedding: 'BAAI/bge-m3',
    reranking: 'BAAI/bge-reranker-v2-m3'
  },
  retrieval: {
    enableQueryExpansion: true,
    enableNegativeLearning: true,
    enableKnowledgeGraph: true,
    searchCacheSize: 200,
    searchCacheTTL: 30000
  },
  neo4j: {
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password'
  }
});
