# 知识图谱与检索指南

本文档整合了知识图谱的快速开始与集成指南，便于部署与维护。

## 概述

知识图谱用于增强 RAG 检索准确率，主要能力：
- 实体抽取（厂商、功能、命令、参数）
- 关系建模（厂商-功能-命令-参数）
- 混合检索（向量 + 图谱）
- 查询路由（按查询类型动态调整权重）

## 快速开始（5 分钟）

### 1) 启动 Neo4j（Docker）

```bash
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password123 \
  neo4j:latest
```

### 2) 配置连接

`data/settings.json`：
```json
{
  "neo4j": {
    "uri": "bolt://localhost:7687",
    "username": "neo4j",
    "password": "password123"
  }
}
```

### 3) 初始化与构建

```bash
curl -X POST http://localhost:8787/api/knowledge-graph/init
curl -X POST http://localhost:8787/api/knowledge-graph/build
```

### 4) 验证

```bash
curl http://localhost:8787/api/knowledge-graph/stats
```

### 5) 查询

```bash
curl -X POST http://localhost:8787/api/knowledge-graph/query \
  -H "Content-Type: application/json" \
  -d '{"query": "BGP 配置", "limit": 5}'
```

## 架构与模型

### 实体类型

- Vendor（厂商）：NVIDIA、Mellanox、Cumulus
- Function（功能）：BGP、OSPF、EVPN、VXLAN、MLAG
- Command（命令）：`nv set`、`ip route`、`ifconfig`
- Parameter（参数）：VLAN、接口名、IP 等

### 关系类型

- Vendor → Function：`HAS_FUNCTION`
- Function → Command：`HAS_COMMAND`
- Command → Parameter：`HAS_PARAMETER`

## 检索策略（按查询类型）

| 查询类型 | 图谱权重 | 结果上限 | 适用场景 |
|---------|---------|---------|---------|
| vendor-focused | 0.4 | 8 | 厂商相关 |
| command-focused | 0.35 | 6 | 命令配置 |
| function-focused | 0.3 | 5 | 协议功能 |
| concept-focused | 0.2 | 3 | 概念解释 |
| balanced | 0.25 | 5 | 默认策略 |

## 主要 API

| 方法 | 端点 | 描述 |
|-----|------|------|
| POST | `/api/knowledge-graph/init` | 初始化连接 |
| POST | `/api/knowledge-graph/build` | 构建图谱 |
| POST | `/api/knowledge-graph/process/:documentId` | 处理单文档 |
| POST | `/api/knowledge-graph/query` | 查询图谱 |
| GET | `/api/knowledge-graph/stats` | 统计信息 |
| DELETE | `/api/knowledge-graph/clear` | 清空图谱 |

## 实体抽取要点

- 厂商来自分类名与文本模式识别
- 功能/协议通过关键词映射与上下文触发
- 命令识别支持 NVUE 与 Linux 命令格式
- 参数识别覆盖 VLAN、VRF、IP、接口等

## 维护与性能建议

- 批量构建建议在空闲时运行
- 新文档可使用增量处理
- 图谱查询结果有缓存
- 规模变大时建议重建索引

## 故障排查

- **连接失败**：确认 Neo4j 已运行、配置正确
- **实体为空**：检查文档是否包含厂商/命令/协议
- **查询慢**：等待索引建立或重建图谱

## 禁用图谱（对比测试）

`data/settings.json`：
```json
{
  "retrieval": {
    "enableKnowledgeGraph": false
  }
}
```
