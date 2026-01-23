# 🚀 AI Knowledge Assistant for NVIDIA Network Products

<div align="center">

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)
[![License](https://img.shields.io/badge/license-Private-gray.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](doc/PUSH_GUIDE.md)

**面向 NVIDIA/Mellanox InfiniBand & RoCE 网络设备的智能知识库系统**

[快速开始](#-快速开始) • [核心特性](#-核心特性) • [架构设计](#-架构设计) • [API 文档](doc/API.md) • [开发指南](#-开发指南)

</div>

---

## 📖 项目简介

AI Knowledge Assistant 是一个基于 **RAG (Retrieval-Augmented Generation)** 架构的企业级知识库系统，专为复杂网络设备文档（InfiniBand、RoCE、Cumulus Linux 等）设计。系统提供：

- 🤖 **智能问答**：混合检索 + LLM 生成，精准回答技术问题
- 🧠 **知识图谱**：实体关系建模，增强检索准确率
- 🕸️ **网络拓扑还原**：从 UFM/NetQ 导入数据，可视化分析
- 📊 **性能监控**：实时指标、A/B 测试、质量评估
- 🔌 **RESTful API**：支持系统集成和自动化

---

## 🎯 核心特性

### 1️⃣ 智能问答与检索

```mermaid
graph LR
    A[用户查询] --> B[查询扩展]
    B --> C[混合检索]
    C --> D[知识图谱增强]
    D --> E[重排序]
    E --> F[LLM 生成]
    F --> G[引用验证]
    G --> H[流式输出]
```

#### 核心技术
- **混合检索**：关键词（BM25）+ 向量检索（BGE-M3）+ RRF 融合
- **查询智能化**：
  - 同义词/缩写展开：`BGP` → `Border Gateway Protocol`
  - 中英互译：`如何配置 BGP` → `how to configure BGP`
  - 上下文优化：结合历史对话理解查询意图
- **抗幻觉机制**：
  - 命令/参数一致性校验
  - 引用来源可追溯（文档 + 页码）
  - 负样本学习（自动识别低质量答案）
- **缓存优化**：
  - 精确缓存：查询字符串完全匹配
  - 语义缓存：向量相似度 > 0.95 复用结果
  - LRU + TTL：1000 条 / 1 小时过期

#### 性能指标
| 指标 | 数值 | 说明 |
|------|------|------|
| 平均响应时间 | < 2s | P95: 3.5s |
| 缓存命中率 | 45-60% | 高频查询优化 |
| 检索准确率 | 88%+ | 基于 benchmark 测试 |

---

### 2️⃣ 知识图谱增强

```
┌─────────────────────────────────────────────────────┐
│                    Knowledge Graph                   │
│                                                       │
│  ┌─────────┐    HAS_FUNCTION    ┌─────────┐         │
│  │ Vendor  │──────────────────→ │Function │         │
│  │(NVIDIA) │                     │  (BGP)  │         │
│  └─────────┘                     └────┬────┘         │
│                                        │              │
│                                 HAS_COMMAND          │
│                                        │              │
│                                   ┌────▼────┐        │
│                                   │ Command │        │
│                                   │(nv set) │        │
│                                   └────┬────┘        │
│                                        │              │
│                                 HAS_PARAMETER        │
│                                        │              │
│                                   ┌────▼────┐        │
│                                   │Parameter│        │
│                                   │(vlan100)│        │
│                                   └─────────┘        │
└─────────────────────────────────────────────────────┘
```

#### 实体类型
- **Vendor**: NVIDIA, Mellanox, Cumulus
- **Function**: BGP, OSPF, EVPN, VXLAN, ACL
- **Command**: `nv set`, `ip route`, `ifconfig`
- **Parameter**: IP 地址、VLAN ID、接口名

#### 检索策略
系统根据查询类型自动调整检索策略：

| 查询类型 | 图谱权重 | 最大结果数 | 示例 |
|---------|---------|----------|------|
| 厂商相关 | 40% | 8 | "NVIDIA BGP 配置" |
| 功能相关 | 35% | 10 | "如何配置 EVPN" |
| 命令相关 | 45% | 6 | "nv set 命令用法" |
| 参数相关 | 30% | 8 | "vlan100 配置方法" |
| 通用查询 | 20% | 12 | "网络优化建议" |

📚 详细文档：[知识图谱集成指南](doc/KNOWLEDGE_GRAPH_GUIDE.md)

---

### 3️⃣ 网络拓扑还原与可视化

<div align="center">

```
        Core Layer (Tier 0)
            ┌───────┐
            │ CORE1 │
            └───┬───┘
                │
     ┌──────────┼──────────┐
     │          │          │
Spine Layer (Tier 1)
┌────▼───┐ ┌───▼────┐ ┌───▼────┐
│SPINE-1 │ │SPINE-2 │ │SPINE-3 │
└────┬───┘ └───┬────┘ └───┬────┘
     │         │          │
     └─────────┼──────────┘
               │
     ┌─────────┼─────────┐
     │         │         │
Leaf Layer (Tier 2)
┌────▼───┐ ┌──▼─────┐ ┌──▼─────┐
│ LEAF-1 │ │ LEAF-2 │ │ LEAF-3 │
│(POD-A) │ │(POD-A) │ │(POD-B) │
└────────┘ └────────┘ └────────┘
```

</div>

#### 支持的拓扑格式
- **InfiniBand**: UFM CSV 导出（节点、链路、端口状态）
- **RoCE**: NetQ Excel 导出（BGP、LLDP、拓扑数据）

#### 可视化功能
- 🔍 **路径追溯**：点击节点/边查看详细信息
- 🎨 **层级着色**：Core(红) / Spine(蓝) / Leaf(绿)
- 🔎 **搜索过滤**：按节点名、层级、POD 筛选
- 📐 **布局优化**：分层布局 / 力导向图自适应

📚 快速开始：[网络拓扑可视化指南](doc/KNOWLEDGE_GRAPH_QUICKSTART.md)

---

### 4️⃣ 文档管理与质量评估

#### 支持的文档格式
| 格式 | 解析引擎 | 特性 |
|------|---------|------|
| PDF | pdf-parse | 保留表格、代码块结构 |
| Word | mammoth | 样式保留、图片提取 |
| Excel | xlsx | 多 sheet、公式计算 |
| Markdown | remark | 语法高亮、链接解析 |

#### 质量评估指标
```javascript
{
  "completeness": 0.85,    // 文档完整性（80%+ 优秀）
  "readability": 0.92,     // 可读性（Flesch 分数）
  "technicalDepth": 0.78,  // 技术深度（实体密度）
  "freshness": 0.90        // 时效性（最后更新时间）
}
```

---

## 🏗️ 架构设计

### 技术栈

```
┌─────────────────────────────────────────────────────┐
│                   Frontend Layer                     │
│  React 18 + TypeScript + TailwindCSS + Zustand      │
│  Cytoscape.js (图可视化) + Recharts (数据可视化)    │
└────────────────────┬────────────────────────────────┘
                     │ HTTP / WebSocket
┌────────────────────▼────────────────────────────────┐
│                   Backend Layer                      │
│  Node.js 20 + Express + WebSocket                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   Storage   │  │  Retrieval  │  │     AI      │ │
│  │  (SQLite)   │  │  (Hybrid)   │  │   (LLM)     │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│                  External Services                   │
│  Neo4j (图数据库) + Ollama (嵌入/生成) + Redis      │
└─────────────────────────────────────────────────────┘
```

### 核心模块

| 模块 | 文件路径 | 职责 |
|------|---------|------|
| **混合检索** | `server/hybridRetrieval.mjs` | BM25 + 向量检索 + RRF |
| **查询扩展** | `server/queryExpansion.mjs` | 同义词、缩写、翻译 |
| **知识图谱** | `server/graphRAG.mjs` | Neo4j 集成、实体抽取 |
| **负样本学习** | `server/negativeSampleLearning.mjs` | 低质量答案识别 |
| **缓存管理** | `server/cache-manager.mjs` | LRU + 语义缓存 |
| **任务队列** | `server/taskQueue.mjs` | 批量任务调度 |

---

## 🚀 快速开始

### 前置要求

- **Node.js**: >= 20.0.0
- **Docker**: >= 24.0 (可选，用于 Neo4j)
- **Ollama**: 本地部署（或远程 API）

### 1. 克隆项目

```bash
git clone <repository-url>
cd AI_Knowledge_Assistant_FOR_NVIDIA_NETWORK_PRODUCT
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境

编辑 `data/settings.json`：

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "embeddingModel": "bge-m3:latest",
    "chatModel": "qwen2.5:32b"
  },
  "neo4j": {
    "enabled": true,
    "uri": "bolt://localhost:7687",
    "username": "neo4j",
    "password": "your-password"
  }
}
```

### 4. 启动服务

```bash
# 开发模式（前端 + 后端）
npm run server

# 仅后端
npm run server:backend

# 生产部署（Docker）
docker-compose up -d
```

### 5. 访问应用

- **Web UI**: http://localhost:5173
- **API Server**: http://localhost:8787
- **API 文档**: [doc/API.md](doc/API.md)

---

## 📚 API 使用示例

### 1. 上传文档

```bash
curl -X POST http://localhost:8787/api/upload \
  -F "file=@./manual.pdf" \
  -F "category=network_config"
```

### 2. 智能问答

```bash
curl -X POST http://localhost:8787/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "conv-123",
    "message": "如何配置 EVPN?",
    "options": {
      "useGraphRAG": true,
      "maxResults": 10
    }
  }'
```

### 3. 导入网络拓扑

```bash
curl -X POST http://localhost:8787/api/topology/import \
  -F "file=@./ufm_topology.csv" \
  -F "type=ufm"
```

📚 完整 API 文档：[doc/API.md](doc/API.md)

---

## 🧪 测试与质量保证

### 测试覆盖率

```bash
# 运行所有测试
npm test

# 单元测试
npm run test:unit

# 集成测试
npm run test:integration

# 覆盖率报告
npm run test:coverage
```

### Benchmark 测试

```bash
# 检索精度测试（80+ 个测试用例）
npm run test:benchmark
```

**最新测试结果** (2026-01-24):
- 总测试用例：82 个
- 通过率：88.5%
- 平均响应时间：1.8s
- 缓存命中率：52%

📊 详细报告：[test/graphrag_eval_results.json](test/graphrag_eval_results.json)

---

## 🛠️ 开发指南

### 项目结构

```
.
├── server/              # 后端服务
│   ├── index.mjs       # 主入口
│   ├── hybridRetrieval.mjs
│   ├── queryExpansion.mjs
│   ├── graphRAG.mjs
│   └── storage-sqlite.mjs
├── src/                # 前端代码
│   ├── components/     # React 组件
│   ├── stores/         # Zustand 状态管理
│   └── App.tsx
├── test/               # 测试文件
│   ├── unit/          # 单元测试
│   ├── integration/   # 集成测试
│   └── benchmark_precision.mjs
├── data/              # 数据文件
│   ├── settings.json  # 配置文件
│   └── *.db          # SQLite 数据库
└── doc/              # 文档
    ├── API.md
    ├── KNOWLEDGE_GRAPH_GUIDE.md
    └── ...
```

### 添加新功能

1. **创建功能分支**
   ```bash
   git checkout -b feature/your-feature
   ```

2. **编写代码和测试**
   ```bash
   # 在 server/ 或 src/ 中添加代码
   # 在 test/ 中添加测试用例
   npm test
   ```

3. **提交代码**
   ```bash
   npm run lint
   git add .
   git commit -m "feat: add your feature"
   git push origin feature/your-feature
   ```

📚 详细指南：[doc/PUSH_GUIDE.md](doc/PUSH_GUIDE.md)

---

## 📊 性能优化记录

### 最近优化 (2026-01-23/24)

| 优化项 | 效果 | 文档 |
|--------|------|------|
| 移除未使用依赖 | 减少 2.5MB 包体积 | [OPTIMIZATION_SUMMARY](doc/OPTIMIZATION_SUMMARY_2026-01-23.md) |
| 添加数据库索引 | 查询性能提升 2-5x | [PERFORMANCE_IMPROVEMENTS](doc/PERFORMANCE_IMPROVEMENTS.md) |
| 优化缓存配置 | 缓存命中率提升 30-50% | [OPTIMIZATION_SUMMARY](doc/OPTIMIZATION_SUMMARY_2026-01-23.md) |
| 结构化日志系统 | 提升可观测性和安全性 | [LOGGER_MIGRATION_GUIDE](doc/LOGGER_MIGRATION_GUIDE.md) |
| 查询扩展优化 | 检索准确率提升 12% | [QUERY_OPTIMIZATION_FIX](doc/QUERY_OPTIMIZATION_FIX.md) |

---

## 🔒 安全性

- ✅ API Key 认证
- ✅ 速率限制（1000 req/hour）
- ✅ 输入验证与 SQL 注入防护
- ✅ 敏感信息脱敏（日志/错误报告）
- ✅ CORS 配置

📄 安全审计报告：[doc/SECURITY_REPORT_2026-01-23.md](doc/SECURITY_REPORT_2026-01-23.md)

---

## 📝 文档索引

| 文档 | 描述 |
|------|------|
| [API.md](doc/API.md) | 完整 API 参考 |
| [KNOWLEDGE_GRAPH_GUIDE.md](doc/KNOWLEDGE_GRAPH_GUIDE.md) | 知识图谱集成指南 |
| [KNOWLEDGE_GRAPH_QUICKSTART.md](doc/KNOWLEDGE_GRAPH_QUICKSTART.md) | 知识图谱快速开始 |
| [TEST_ARCHITECTURE.md](doc/TEST_ARCHITECTURE.md) | 测试架构设计 |
| [AGENTS.md](doc/AGENTS.md) | 多 Agent 协作机制 |
| [PUSH_GUIDE.md](doc/PUSH_GUIDE.md) | 代码提交规范 |
| [WORK_HISTORY.md](doc/WORK_HISTORY.md) | 开发历史记录 |

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！请遵循以下规范：

1. **代码风格**：使用 ESLint 配置
2. **提交信息**：遵循 [Conventional Commits](https://www.conventionalcommits.org/)
3. **测试要求**：新功能必须包含单元测试
4. **文档更新**：API 变更需同步更新文档

---

## 📄 许可证

Private - All Rights Reserved

---

## 🙏 致谢

本项目使用了以下开源技术：

- **前端**: React, TypeScript, TailwindCSS, Cytoscape.js
- **后端**: Node.js, Express, SQLite, Neo4j
- **AI**: Ollama, BGE-M3, Qwen2.5
- **工具**: Vitest, Playwright, Docker

---

<div align="center">

**Built with ❤️ for NVIDIA Network Engineers**

[⬆️ 返回顶部](#-ai-knowledge-assistant-for-nvidia-network-products)

</div>
