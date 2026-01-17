# AI Knowledge Assistant

> AI 驱动的知识库管理与智能问答系统

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-Private-gray.svg)](LICENSE)

## 📖 项目简介

AI Knowledge Assistant 是一个基于 RAG (Retrieval-Augmented Generation) 架构的知识库系统，面向复杂网络设备文档（IB、RoCE 等）。系统同时提供知识图谱、文档质量评估、检索性能监控和网络拓扑还原，既可通过 UI 使用，也可通过 API 集成。

## ✨ 核心能力

### 1. 🧠 智能问答与检索
- **混合检索**：关键词 + 向量检索融合（RRF），支持重排与多阶段召回。
- **查询智能化**：查询扩展、同义词/缩写展开、上下文优化、负样本学习。
- **抗幻觉机制**：命令/参数一致性校验，引用来源可追溯。
- **流式响应**：WebSocket 打字机式输出，低延迟体验。
- **缓存与性能**：精确缓存 + 语义缓存，支持 TTL 与 LRU。

### 2. 🧩 知识图谱增强
- **实体抽取**：厂商、功能、命令、参数自动抽取并建模。
- **Neo4j 集成**：图谱持久化与查询，检索策略自动加权。
- **可控开关**：可按需启用/禁用图谱增强。

### 3. 🕸️ 网络拓扑还原与可视化
- **多协议支持**：InfiniBand (UFM CSV)、RoCE (NetQ Excel)。
- **自动层级识别**：Core/Spine/Leaf 结构推断。
- **交互式分析**：路径追溯、节点搜索、层级过滤、POD 识别。

### 4. 📚 文档管理与质量评估
- **多格式支持**：PDF、Word、Excel、Markdown。
- **智能分块**：保留代码块/表格结构，适配技术文档。
- **质量评分**：多维度评分与报告（结构、技术密度、反馈等）。

### 5. 🔌 平台化与扩展
- **API & Webhook**：API Key 管理、批量任务、回调通知。
- **插件系统**：内置 topology-restore、sn-topology、sn-iblf、sn-address、nvidia-doc-pdf、ai-tools 等插件。
- **性能监控**：检索指标与系统健康度可视化。

## 🛠️ 技术栈

### 前端 (Frontend)
- **框架**: React 18 + TypeScript + Vite
- **状态管理**: Zustand
- **UI 组件**: Tailwind CSS + Radix UI + Lucide Icons
- **可视化**: ReactFlow + Cytoscape.js
- **Markdown**: React-Markdown + Rehype-Highlight

### 后端 (Backend)
- **运行时**: Node.js (ES Modules)
- **Web 框架**: Express + WebSocket
- **知识图谱**: Neo4j (可选)
- **文档解析**: pdf-parse + mammoth + xlsx + Playwright
- **存储**: 本地文件系统 (JSON) + 内存向量索引

## 🚀 快速开始

### 方式一：Docker 部署（推荐）

```bash
docker compose up --build
```

- 前端地址: http://localhost:5173
- 后端地址: http://localhost:8787
- 数据持久化: `./data` 映射到容器 `/app/data`

### 方式二：本地开发

```bash
npm install

# 同时启动前端和后端服务
npm run server
```

### 构建生产版本

```bash
npm run build
npm run server:backend
npm run preview
```

> `npm run preview` 默认在 4173 端口启动静态站点，可按需改用任意静态服务器部署 `dist/`。

## ⚙️ 配置与端口

### 常用端口
- `5173`: 前端开发/容器前端
- `8787`: 后端 API
- `7474/7687`: Neo4j（可选，浏览器/bolt）

### 常用配置项
- `data/settings.json`: 模型 API Key、检索与知识图谱配置
- `VITE_API_SERVER_URL`: 前端 API 地址（构建时注入）
- `PORT`: 后端监听端口（默认 8787）
- `NEO4J_URI`/`NEO4J_USERNAME`/`NEO4J_PASSWORD`: 知识图谱连接
- `CORS_ORIGINS`/`CORS_ALLOW_ANY`/`ALLOW_NO_ORIGIN`: 跨域策略

## 🧭 知识图谱快速启用（可选）

1. 启动 Neo4j（示例）
   ```bash
   docker run -d --name neo4j -p 7474:7474 -p 7687:7687 \
     -e NEO4J_AUTH=neo4j/password123 neo4j:latest
   ```
2. 配置 `data/settings.json` 或环境变量
3. 初始化并构建图谱（详见文档）

## 📂 项目结构

```
├── src/                    # 前端源码
│   ├── components/         # 通用 UI 组件
│   ├── lib/                # 核心逻辑 (RAG, 检索, 存储)
│   ├── plugins/            # 插件系统
│   ├── stores/             # 状态管理
│   └── main.tsx            # 入口文件
├── server/                 # 后端服务
├── data/                   # 数据存储 (文档, 索引, 设置)
├── docker/                 # Docker 相关配置
├── doc/                    # 项目文档
└── test/                   # 测试脚本与基准测试
```

## 🧪 测试与验证

```bash
# 运行单元测试
npm run test:unit

# 运行所有测试
npm test

# 检索性能基准测试
npm run test:benchmark
```

## 📎 文档索引

- API 文档: `doc/API.md`
- 知识图谱: `doc/KNOWLEDGE_GRAPH_QUICKSTART.md`, `doc/KNOWLEDGE_GRAPH_GUIDE.md`
- 性能与优化: `doc/PERFORMANCE_IMPROVEMENTS.md`, `doc/QUERY_OPTIMIZATION_FIX.md`
- 测试体系: `doc/TEST_ARCHITECTURE.md`, `doc/TEST_IMPLEMENTATION_SUMMARY.md`
- 历史与发布: `doc/WORK_HISTORY.md`
- 开发工具: `doc/PUSH_GUIDE.md`

## 📜 License

Private - All Rights Reserved
