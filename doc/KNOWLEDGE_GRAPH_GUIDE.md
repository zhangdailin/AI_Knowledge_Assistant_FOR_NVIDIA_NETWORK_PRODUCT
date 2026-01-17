# 知识图谱集成指南

本文档介绍如何使用知识图谱功能来增强 RAG 系统的检索准确率。

## 概述

知识图谱模块通过以下方式提升检索准确率：

1. **实体抽取**：从文档中自动提取厂商、功能、命令、参数等实体
2. **关系建模**：构建实体之间的关系（如厂商包含功能、功能包含命令、命令包含参数等）
3. **混合检索**：结合向量检索和知识图谱查询，提供更精准的结果
4. **智能路由**：根据查询类型自动调整检索策略

## 架构设计

### 知识图谱 Schema

#### 节点类型（Entities）

1. **Vendor（厂商）**
   - 属性：name, sources
   - 示例：NVIDIA, Mellanox, Cumulus

2. **Function（功能）**
   - 属性：name, sources
   - 示例：BGP, OSPF, EVPN, VXLAN, ACL, VLAN

3. **Command（命令）**
   - 属性：name, category, sources
   - 类别：nvue, linux, config
   - 示例：nv set interface, ip route show

4. **Parameter（参数）**
   - 属性：name, type, sources
   - 类型：network_param, ip_address, port, interface
   - 示例：vlan100, 192.168.1.1/24, eth0

#### 关系类型（Relationships）

1. **HAS_FUNCTION**：厂商 → 功能
2. **HAS_COMMAND**：功能 → 命令
3. **HAS_PARAMETER**：命令 → 参数

### 混合检索策略

系统根据查询类型自动选择最佳检索策略：

| 查询类型 | 知识图谱权重 | 最大结果数 | 适用场景 |
|---------|------------|----------|---------|
| vendor-focused | 0.4 | 8 | 厂商相关查询 |
| command-focused | 0.35 | 6 | 命令配置查询 |
| function-focused | 0.3 | 5 | 功能/协议相关查询 |
| concept-focused | 0.2 | 3 | 概念性查询 |
| balanced | 0.25 | 5 | 默认策略 |

## 安装和配置

### 1. 安装 Neo4j

#### 使用 Docker（推荐）

```bash
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/your_password \
  -v $HOME/neo4j/data:/data \
  neo4j:latest
```

#### 使用 Neo4j Desktop

1. 下载并安装 [Neo4j Desktop](https://neo4j.com/download/)
2. 创建新的数据库实例
3. 启动数据库

### 2. 配置连接

在 `data/settings.json` 中添加 Neo4j 配置：

```json
{
  "neo4j": {
    "uri": "bolt://localhost:7687",
    "username": "neo4j",
    "password": "your_password"
  }
}
```

或者使用环境变量：

```bash
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USERNAME=neo4j
export NEO4J_PASSWORD=your_password
```

### 3. 初始化知识图谱

```bash
curl -X POST http://localhost:8787/api/knowledge-graph/init
```

## 使用方法

### 1. 构建知识图谱

#### 处理所有文档

```bash
curl -X POST http://localhost:8787/api/knowledge-graph/build \
  -H "Content-Type: application/json"
```

#### 处理指定文档

```bash
curl -X POST http://localhost:8787/api/knowledge-graph/build \
  -H "Content-Type: application/json" \
  -d '{"documentIds": ["doc-123", "doc-456"]}'
```

#### 处理单个文档

```bash
curl -X POST http://localhost:8787/api/knowledge-graph/process/doc-123
```

### 2. 查询知识图谱

```bash
curl -X POST http://localhost:8787/api/knowledge-graph/query \
  -H "Content-Type: application/json" \
  -d '{"query": "NVIDIA BGP 配置", "limit": 10}'
```

### 3. 获取统计信息

```bash
curl http://localhost:8787/api/knowledge-graph/stats
```

响应示例：

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

### 4. 清空知识图谱

```bash
curl -X DELETE http://localhost:8787/api/knowledge-graph/clear
```

## API 端点

### 知识图谱管理

| 方法 | 端点 | 描述 |
|-----|------|------|
| POST | `/api/knowledge-graph/init` | 初始化 Neo4j 连接 |
| POST | `/api/knowledge-graph/build` | 构建知识图谱 |
| POST | `/api/knowledge-graph/process/:documentId` | 处理单个文档 |
| POST | `/api/knowledge-graph/query` | 查询知识图谱 |
| GET | `/api/knowledge-graph/stats` | 获取统计信息 |
| DELETE | `/api/knowledge-graph/clear` | 清空知识图谱 |

## 实体抽取规则

### 厂商识别方式

- 厂商节点来自知识库目录/分类名称（支持中文厂商名）
- 文本模式自动识别：vendor/厂商标签、公司后缀（Networks/Systems 等）、上下文触发的专有名词
- 文档中识别到的厂商会自动进入知识图谱，后续查询可直接命中

### 功能识别模式

```javascript
// 协议/功能缩写（自动识别）
// 例如: BGP/OSPF/EVPN/VXLAN/MLAG/LACP/RoCE/ACL/VLAN/VRF

// 领域关键词映射
routing|interface|qos|security|monitoring|telemetry|system|switching

// 语境触发模式（TitleCase + 领域词）
<Name> + (protocol|feature|service|routing|overlay|tunneling)
```

### 命令识别模式

```javascript
// Cumulus/NVUE 命令
nv set|show|config|unset + 参数

// Linux 网络命令
ip|ifconfig|route|netstat|ping|traceroute|tcpdump + 参数

// 配置命令
configure|show|set|get|enable|disable + 参数
```

### 参数识别模式

```javascript
// 网络参数
vlan|vrf|bgp|ospf|mlag|lacp|bond + 值

// IP 地址
xxx.xxx.xxx.xxx/xx

// 接口名称
eth|swp|bond|vlan + 编号
```

## 性能优化

### 1. 批量处理

建议在系统空闲时批量构建知识图谱：

```bash
# 在后台运行
curl -X POST http://localhost:8787/api/knowledge-graph/build &
```

### 2. 增量更新

上传新文档后自动处理：

```javascript
// 在文档上传成功后
await fetch('/api/knowledge-graph/process/' + documentId, {
  method: 'POST'
});
```

### 3. 缓存策略

知识图谱查询结果会被缓存，提升响应速度。

## 监控和调试

### 查看日志

```bash
# 知识图谱相关日志
grep "KnowledgeGraph" server.log

# 混合检索日志
grep "HybridRetrieval" server.log

# 搜索管道日志
grep "SearchPipeline" server.log
```

### 常见问题

#### 1. Neo4j 连接失败

```
错误：Neo4j 连接失败
解决：检查 Neo4j 是否运行，验证连接配置
```

```bash
# 检查 Neo4j 状态
docker ps | grep neo4j

# 测试连接
curl http://localhost:7474
```

#### 2. 实体抽取结果为空

```
原因：文档内容不包含可识别的实体
解决：检查文档内容，确保包含厂商名、功能关键词、命令等信息
```

#### 3. 知识图谱查询慢

```
原因：图谱规模过大，缺少索引
解决：系统会自动创建索引，等待索引构建完成
```

## 准确率提升验证

### 测试方法

1. **准备测试集**：选择 20-30 个典型查询
2. **基线测试**：禁用知识图谱，记录检索结果
3. **对比测试**：启用知识图谱，记录检索结果
4. **计算提升**：对比相关性和准确率

### 禁用知识图谱

在 `data/settings.json` 中：

```json
{
  "retrieval": {
    "enableKnowledgeGraph": false
  }
}
```

或在查询时指定：

```javascript
const config = {
  enableKnowledgeGraph: false
};
```

### 预期提升

根据查询类型，预期准确率提升：

- **厂商相关查询**：15-25%
- **命令配置查询**：10-20%
- **功能相关查询**：8-15%
- **概念性查询**：5-10%
- **平均提升**：10-15%

## 高级功能

### 自定义实体抽取

修改 `server/knowledgeGraph.mjs` 中的 `extractEntities` 函数：

```javascript
// 添加功能领域映射
FUNCTION_DOMAIN_TERMS.set('your-domain', 'YourFunction');

// 扩展厂商标签/后缀
VENDOR_LABEL_TERMS.push('your-vendor-label');
VENDOR_SUFFIXES.push('YourSuffix');
```

### 自定义检索策略

修改 `server/hybridRetrieval.mjs` 中的 `determineRetrievalStrategy` 函数：

```javascript
// 添加自定义策略
if (/YOUR_PATTERN/.test(query)) {
  return {
    strategy: 'custom-strategy',
    enableKnowledgeGraph: true,
    kgWeight: 0.5,
    maxKgResults: 10
  };
}
```

## 维护建议

### 定期维护

1. **每周**：检查知识图谱统计，确保数据增长正常
2. **每月**：清理无效实体和关系
3. **每季度**：重建知识图谱，优化性能

### 备份和恢复

```bash
# 备份 Neo4j 数据
docker exec neo4j neo4j-admin dump --to=/backups/neo4j-backup.dump

# 恢复数据
docker exec neo4j neo4j-admin load --from=/backups/neo4j-backup.dump
```

## 技术支持

如有问题，请查看：

1. 服务器日志：`server.log`
2. Neo4j 日志：`$HOME/neo4j/logs/`
3. GitHub Issues：提交问题和建议

## 更新日志

### v1.0.0 (2026-01-14)

- ✅ 实现基础知识图谱功能
- ✅ 支持厂商、功能、命令、参数实体抽取
- ✅ 实现混合检索（RAG + 知识图谱）
- ✅ 智能检索策略路由
- ✅ 完整的 API 端点
- ✅ 性能优化和缓存机制
