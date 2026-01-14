# 白盒测试架构实施文档

## 📋 概述

本文档描述了基于 Vitest 的全面白盒测试架构，覆盖知识库系统的所有核心功能模块。

## ✅ 已完成的工作

### 1. 测试基础设施

#### 目录结构
```
test/
├── unit/                          # 单元测试
│   ├── server/                    # 服务器端单元测试
│   │   ├── storage.test.ts        # ✅ 已创建
│   │   └── utils/                 # 工具函数测试
│   └── client/                    # 前端单元测试
│       ├── stores/
│       ├── lib/
│       └── utils/
├── integration/                   # 集成测试
├── fixtures/                      # 测试数据
│   └── mock-data.ts              # ✅ 已创建
└── helpers/                       # 测试辅助工具
    ├── mock-factory.ts           # ✅ 已创建
    ├── test-utils.ts             # ✅ 已创建
    ├── test-env.ts               # ✅ 已创建
    └── setup.ts                  # ✅ 已创建
```

#### 核心文件说明

**test/fixtures/mock-data.ts**
- 提供所有测试数据的工厂函数
- 包含：Document, Chunk, Message, Conversation, Entities, Topology 等
- 支持自定义覆盖参数

**test/helpers/mock-factory.ts**
- 外部依赖的 Mock 工厂
- 包含：SiliconFlow API, Neo4j Driver, File System, Fetch, WebSocket, LocalStorage
- 提供 `createMockStorage()` 和 `createMockEmbedding()` 等高级 Mock

**test/helpers/test-utils.ts**
- 通用测试工具函数
- 包含：waitFor, sleep, 断言辅助, 性能测试, 并发执行等
- 提供 `expectToBeValidDocument()`, `expectToBeValidChunk()` 等验证函数

**test/helpers/test-env.ts**
- 测试环境配置
- 支持真实服务和 Mock 模式切换
- 配置 Neo4j 和 SiliconFlow API 测试环境

**test/helpers/setup.ts**
- 全局测试设置
- 自动清理 mocks
- 可选的静默模式

### 2. 配置文件更新

#### vite.config.ts
```typescript
test: {
  globals: true,
  environment: 'jsdom',
  setupFiles: ['./test/helpers/setup.ts'],
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html', 'lcov'],
    thresholds: {
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80
    }
  },
  testTimeout: 10000,
  hookTimeout: 10000
}
```

#### package.json 测试脚本
```json
{
  "test": "vitest",
  "test:unit": "vitest run test/unit",
  "test:unit:server": "vitest run test/unit/server",
  "test:unit:client": "vitest run test/unit/client",
  "test:integration": "vitest run test/integration",
  "test:integration:real": "REAL_SERVICES=true vitest run test/integration",
  "test:coverage": "vitest run --coverage",
  "test:coverage:threshold": "vitest run --coverage --coverage.thresholds...",
  "test:watch": "vitest watch",
  "test:ui": "vitest --ui"
}
```

### 3. 示例测试文件

#### test/unit/server/storage.test.ts
完整的 Storage 模块测试，包含：
- ✅ 文档 CRUD 操作
- ✅ Chunk 存储和检索
- ✅ 向量搜索
- ✅ 设置管理
- ✅ 查询日志

测试覆盖：
- 原子写入操作
- 分文件存储策略（避免 OOM）
- 余弦相似度计算
- 分类过滤
- 并发安全

## 🚀 快速开始

### 安装依赖
```bash
npm install
```

### 运行测试

```bash
# 运行所有测试
npm test

# 运行单元测试
npm run test:unit

# 运行服务器端测试
npm run test:unit:server

# 运行前端测试
npm run test:unit:client

# 生成覆盖率报告
npm run test:coverage

# 查看覆盖率报告
open coverage/index.html

# 监视模式
npm run test:watch

# UI 模式
npm run test:ui
```

### 集成测试（真实环境）

```bash
# 1. 启动 Neo4j 测试实例
docker run -d \
  --name neo4j-test \
  -p 7475:7474 -p 7688:7687 \
  -e NEO4J_AUTH=neo4j/testpassword \
  neo4j:latest

# 2. 设置环境变量
export NEO4J_TEST_URI=bolt://localhost:7688
export SILICONFLOW_TEST_KEY=your-test-key

# 3. 运行集成测试
npm run test:integration:real
```

## 📝 编写测试指南

### 基本测试结构

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockFileSystem } from '../../helpers/mock-factory';
import { createMockDocument } from '../../fixtures/mock-data';
import { expectToBeValidDocument } from '../../helpers/test-utils';

describe('Module Name', () => {
  beforeEach(() => {
    // 清理和设置
    vi.clearAllMocks();
  });

  describe('Feature Name', () => {
    it('should do something', () => {
      // Arrange
      const data = createMockDocument();

      // Act
      const result = someFunction(data);

      // Assert
      expect(result).toBeDefined();
      expectToBeValidDocument(result);
    });
  });
});
```

### 使用 Mock 工厂

```typescript
import { mockFileSystem, createMockStorage } from '../../helpers/mock-factory';

// Mock 文件系统
const mockFs = mockFileSystem();
vi.mock('fs/promises', () => mockFs);

// Mock Storage 模块
const mockStorage = createMockStorage();
```

### 使用测试数据

```typescript
import {
  createMockDocument,
  createMockChunk,
  createMockEntities
} from '../../fixtures/mock-data';

const doc = createMockDocument({ name: 'custom-name.pdf' });
const chunks = createMockChunks(10, { documentId: doc.id });
const entities = createMockEntities();
```

### 异步测试

```typescript
import { waitFor, sleep } from '../../helpers/test-utils';

it('should handle async operations', async () => {
  const promise = someAsyncFunction();

  await waitFor(() => someCondition(), 5000);

  const result = await promise;
  expect(result).toBeDefined();
});
```

## 📊 覆盖率目标

| 模块类型 | 目标覆盖率 | 状态 |
|---------|-----------|------|
| 整体 | 80%+ | 🟡 进行中 |
| 核心模块 | 90%+ | 🟡 进行中 |
| 辅助模块 | 75%+ | 🟡 进行中 |
| 工具函数 | 95%+ | 🟡 进行中 |

### 核心模块
- embedding.mjs
- storage.mjs ✅ 测试已创建
- chunking.mjs
- knowledgeGraph.mjs
- hybridRetrieval.mjs
- searchPipeline.mjs

## 🔄 待完成的测试文件

### 第一批（基础依赖）
- [x] test/fixtures/mock-data.ts
- [x] test/helpers/mock-factory.ts
- [x] test/helpers/test-utils.ts
- [x] test/helpers/setup.ts
- [x] test/unit/server/storage.test.ts
- [ ] test/unit/server/utils/treeUtils.test.ts
- [ ] test/unit/server/utils/fileExtractor.test.ts

### 第二批（核心业务逻辑）
- [ ] test/unit/server/embedding.test.ts
- [ ] test/unit/server/chunking.test.ts
- [ ] test/unit/server/knowledgeGraph.test.ts
- [ ] test/unit/server/topology.test.ts

### 第三批（高级功能）
- [ ] test/unit/server/hybridRetrieval.test.ts
- [ ] test/unit/server/queryExpansion.test.ts
- [ ] test/unit/server/queryAnalyzer.test.ts
- [ ] test/unit/server/documentQuality.test.ts
- [ ] test/unit/server/taskQueue.test.ts

### 第四批（编排层）
- [ ] test/unit/server/utils/searchPipeline.test.ts
- [ ] test/unit/client/stores/chatStore.test.ts
- [ ] test/unit/client/stores/toolStore.test.ts
- [ ] test/unit/client/lib/localStorage.test.ts
- [ ] test/unit/client/utils/apiUtils.test.ts

### 第五批（集成测试）
- [ ] test/integration/search-pipeline.test.ts
- [ ] test/integration/document-upload.test.ts
- [ ] test/integration/knowledge-graph.test.ts

## 🛠️ 测试工具和模式

### Mock 策略

1. **外部 API Mock**: 使用 `mockEmbeddingAPI()`, `mockRerankingAPI()`
2. **数据库 Mock**: 使用 `mockNeo4jDriver()`
3. **文件系统 Mock**: 使用 `mockFileSystem()`
4. **模块 Mock**: 使用 `createMockStorage()`, `createMockEmbedding()`

### 断言辅助

```typescript
// 验证数据结构
expectToBeValidDocument(doc);
expectToBeValidChunk(chunk);
expectToBeValidSearchResult(result);
expectToBeValidEntity(entity, 'device');

// 验证 Embedding
expectToBeValidEmbedding(embedding);
```

### 测试工具

```typescript
// 等待条件
await waitFor(() => condition, 5000);

// 性能测试
const { result, duration } = await measurePerformance(fn);

// 重试机制
const result = await retry(fn, 3, 1000);

// 并发执行
const results = await runInParallel(tasks, 5);
```

## 🔍 调试测试

### 查看详细输出
```bash
npm run test:watch -- --reporter=verbose
```

### 调试单个测试
```bash
npm run test:watch -- storage.test.ts
```

### 查看覆盖率详情
```bash
npm run test:coverage
open coverage/index.html
```

## 📚 参考资料

- [Vitest 文档](https://vitest.dev/)
- [测试最佳实践](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [项目测试计划](/Users/dailin/.claude/plans/elegant-splashing-wolf.md)

## 🎯 下一步

1. **继续实现测试文件**: 按照上述待完成列表逐步实现
2. **提高覆盖率**: 目标达到 80%+ 整体覆盖率
3. **集成 CI/CD**: 配置 GitHub Actions 自动运行测试
4. **性能优化**: 优化测试执行速度
5. **文档完善**: 为每个模块添加测试文档

## 💡 最佳实践

1. **测试隔离**: 每个测试应该独立运行，不依赖其他测试
2. **清理机制**: 使用 `beforeEach` 和 `afterEach` 清理状态
3. **Mock 外部依赖**: 所有外部 API 和数据库调用都应该 Mock
4. **有意义的测试名称**: 使用描述性的测试名称
5. **AAA 模式**: Arrange, Act, Assert
6. **避免测试实现细节**: 测试行为而不是实现
7. **保持测试简单**: 一个测试只验证一个行为

## 🐛 常见问题

### Q: 测试运行很慢？
A: 使用 `npm run test:unit` 只运行单元测试，或使用 `--run` 参数避免监视模式。

### Q: Mock 不生效？
A: 确保在测试文件顶部调用 `vi.mock()`，并在 `beforeEach` 中清理 mocks。

### Q: 覆盖率不准确？
A: 检查 `vite.config.ts` 中的 `coverage.exclude` 配置。

### Q: 集成测试失败？
A: 确保 Neo4j 测试实例正在运行，并且环境变量配置正确。

## 📞 支持

如有问题，请：
1. 查看测试日志
2. 检查 Mock 配置
3. 参考示例测试文件
4. 提交 Issue

---

**创建时间**: 2026-01-14
**版本**: 1.0.0
**状态**: 🟡 进行中
