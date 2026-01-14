/**
 * 测试环境配置
 */

/**
 * 测试环境配置
 */
export const TEST_CONFIG = {
  // Neo4j 测试配置
  neo4j: {
    uri: process.env.NEO4J_TEST_URI || 'bolt://localhost:7688',
    username: 'neo4j',
    password: 'testpassword'
  },

  // SiliconFlow API 测试配置
  siliconflow: {
    apiKey: process.env.SILICONFLOW_TEST_KEY || 'test-key',
    mockMode: !process.env.SILICONFLOW_TEST_KEY // 如果没有 key 则使用 mock
  },

  // 测试数据目录
  dataDir: process.env.TEST_DATA_DIR || '/tmp/test-data',

  // 是否使用真实服务
  useRealServices: process.env.REAL_SERVICES === 'true',

  // 测试超时
  timeout: {
    unit: 5000,
    integration: 30000
  }
};

/**
 * 判断是否在 CI 环境
 */
export const isCI = () => {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
};

/**
 * 判断是否应该跳过集成测试
 */
export const shouldSkipIntegrationTests = () => {
  return isCI() && !TEST_CONFIG.useRealServices;
};
