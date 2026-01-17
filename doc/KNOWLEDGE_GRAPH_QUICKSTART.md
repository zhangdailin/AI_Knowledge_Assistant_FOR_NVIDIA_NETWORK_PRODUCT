# 知识图谱快速开始指南

## 5 分钟快速上手

### 步骤 1: 启动 Neo4j

使用 Docker 快速启动（推荐）：

```bash
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password123 \
  neo4j:latest
```

等待 30 秒让 Neo4j 完全启动，然后访问 http://localhost:7474 验证。

### 步骤 2: 配置连接

创建或编辑 `data/settings.json`：

```json
{
  "neo4j": {
    "uri": "bolt://localhost:7687",
    "username": "neo4j",
    "password": "password123"
  }
}
```

### 步骤 3: 启动服务器

```bash
npm run server
```

### 步骤 4: 初始化知识图谱

```bash
curl -X POST http://localhost:8787/api/knowledge-graph/init
```

预期输出：
```json
{"ok": true, "message": "知识图谱连接成功"}
```

### 步骤 5: 构建知识图谱

```bash
curl -X POST http://localhost:8787/api/knowledge-graph/build
```

这将处理所有已上传的文档并提取实体。根据文档数量，可能需要几分钟。

### 步骤 6: 验证结果

查看统计信息：

```bash
curl http://localhost:8787/api/knowledge-graph/stats
```

预期输出：
```json
{
  "ok": true,
  "knowledgeGraph": {
    "vendors": 12,
    "vendorsTotal": 36,
    "functions": 45,
    "functionsTotal": 96,
    "commands": 128,
    "commandsTotal": 512,
    "parameters": 256,
    "parametersTotal": 1024,
    "relationships": 432
  },
  "status": "active"
}
```

### 步骤 7: 测试查询

```bash
curl -X POST http://localhost:8787/api/knowledge-graph/query \
  -H "Content-Type: application/json" \
  -d '{"query": "BGP 配置", "limit": 5}'
```

## 运行测试脚本

```bash
node test/test_knowledge_graph.mjs
```

测试脚本会自动验证所有功能。

## 使用知识图谱增强检索

知识图谱会自动集成到搜索管道中。当用户进行查询时：

1. 系统自动识别查询类型（厂商、功能、命令等）
2. 从知识图谱中检索相关实体和关系
3. 使用知识图谱信息增强向量检索结果
4. 返回更准确、更相关的结果

**无需额外配置，知识图谱会自动工作！**

## 禁用知识图谱（可选）

如果需要对比效果，可以临时禁用：

在 `data/settings.json` 中添加：

```json
{
  "retrieval": {
    "enableKnowledgeGraph": false
  }
}
```

## 常见问题

### Q: Neo4j 连接失败？

**A:** 检查 Neo4j 是否运行：
```bash
docker ps | grep neo4j
```

如果没有运行，启动它：
```bash
docker start neo4j
```

### Q: 构建知识图谱很慢？

**A:** 这是正常的。处理大量文档需要时间。可以：
- 先处理部分文档测试
- 在后台运行构建任务
- 使用增量更新（只处理新文档）

### Q: 如何查看提取了哪些实体？

**A:** 使用 Neo4j Browser (http://localhost:7474) 执行查询：

```cypher
// 查看所有厂商
MATCH (v:Vendor) RETURN v LIMIT 25

// 查看厂商和功能的关系
MATCH (v:Vendor)-[r:HAS_FUNCTION]->(f:Function)
RETURN v, r, f LIMIT 25

// 查看功能关联的命令
MATCH (f:Function)-[r:HAS_COMMAND]->(c:Command)
RETURN f.name, collect(c.name) as commands
```

### Q: 准确率提升不明显？

**A:** 可能的原因：
1. 文档中实体较少 - 添加更多包含厂商、功能、命令的文档
2. 查询类型不匹配 - 知识图谱对厂商/功能/命令查询效果最好
3. 需要更多数据 - 处理更多文档以丰富知识图谱
4. 新厂商未标注分类 - 可直接在文档中出现，系统会自动学习并写入图谱

## 下一步

- 📖 阅读完整文档：[KNOWLEDGE_GRAPH_GUIDE.md](./KNOWLEDGE_GRAPH_GUIDE.md)
- 🔧 自定义实体抽取规则
- 📊 监控准确率提升效果
- 🚀 优化检索策略

## 技术支持

遇到问题？

1. 查看服务器日志
2. 运行测试脚本诊断
3. 查看 Neo4j 日志
4. 提交 GitHub Issue
