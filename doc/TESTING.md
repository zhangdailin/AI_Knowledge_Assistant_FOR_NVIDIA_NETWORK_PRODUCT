# 测试与质量保障

本文档汇总测试架构、执行方式与当前覆盖范围。

## 目录结构

```
test/
├── unit/          # 单元测试
├── integration/   # 集成测试
├── fixtures/      # 测试数据
└── helpers/       # 测试工具
```

## 常用命令

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:coverage
npm run test:ui
```

## 测试基础设施

- `test/fixtures/mock-data.ts`：测试数据工厂
- `test/helpers/mock-factory.ts`：外部依赖 Mock
- `test/helpers/test-utils.ts`：断言/等待/并发工具
- `test/helpers/setup.ts`：全局 setup

## 已覆盖模块（核心）

- storage
- treeUtils
- chunking
- knowledgeGraph
- embedding
- hybridRetrieval
- topology

## 覆盖率目标

- 全局 80%+
- 核心模块 90%+
- 工具函数 95%+

## 真实环境集成测试

```bash
docker run -d --name neo4j-test \
  -p 7688:7687 \
  -e NEO4J_AUTH=neo4j/testpassword \
  neo4j:latest

export NEO4J_TEST_URI=bolt://localhost:7688
export SILICONFLOW_TEST_KEY=your-test-key
npm run test:integration:real
```

## 测试编写建议

- 采用 AAA（Arrange / Act / Assert）
- Mock 外部依赖（Neo4j、API、文件系统）
- 每个测试独立、可重复运行
