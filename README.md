# AI Knowledge Assistant

> AI 驱动的知识库管理与智能问答系统

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-Private-gray.svg)](LICENSE)

## 📖 项目简介

AI Knowledge Assistant 是一个基于 RAG (Retrieval-Augmented Generation) 架构的智能知识库系统，专为复杂的网络设备文档（如 IB、RoCE 交换机配置）设计。它结合了传统关键词搜索与现代向量语义搜索，提供高精度的问答服务，并具备强大的网络拓扑可视化能力。

经过**七个阶段**的深度优化，系统在准确性、响应速度和用户体验上都达到了生产级标准。

## ✨ 核心功能

### 1. 🧠 智能问答与检索 (RAG)
- **混合检索引擎**：结合 Elasticsearch (关键词) 和 向量数据库 (语义)，采用动态 RRF 权重融合算法。
- **抗幻觉机制**：多重验证层，包含命令逐字校验、参数一致性检查，杜绝 AI 编造命令。
- **流式响应 (Streaming)**：支持打字机效果的实时答案生成，首 Token 延迟 < 1s。
- **多轮对话**：支持上下文记忆，能够理解"它"、"这个"等指代词。
- **置信度评分**：每个答案附带置信度评分和来源引用，透明可信。

### 2. 🕸️ 网络拓扑还原与可视化
- **多协议支持**：支持 InfiniBand (UFM CSV) 和 RoCE (NetQ Excel) 网络拓扑。
- **自动化层级识别**：基于图论度数分析，自动识别 Core、Spine、Leaf 层级。
- **智能布局**：专门针对 CLOS 三层架构优化的可视化布局。
- **POD 管理**：支持通过正则或前缀自动提取和过滤 POD。
- **交互式分析**：支持路径追溯、节点搜索、层级过滤。

### 3. 📚 文档管理
- **多格式支持**：PDF, Word, Excel, Markdown。
- **智能分块**：针对技术文档优化的分块策略，保留表格和代码块结构。
- **向量化**：使用高性能 Embedding 模型将文档转化为向量索引。

### 4. 📊 仪表盘与统计
- **全景视图**：文档数量、存储状态、检索日志统计。
- **分类管理**：灵活的树形分类系统。

## 🛠️ 技术栈

### 前端 (Frontend)
- **框架**: React 18 + TypeScript + Vite
- **状态管理**: Zustand
- **UI 组件**: Tailwind CSS + Radix UI + Lucide Icons
- **可视化**: ReactFlow + Cytoscape.js
- **Markdown**: React-Markdown + Rehype-Highlight

### 后端 (Backend)
- **运行时**: Node.js (ES Modules)
- **Web 框架**: Express
- **向量/AI**: 兼容 OpenAI 接口的 Embedding 和 Chat API
- **存储**: 本地文件系统 (JSON) + 内存向量索引

## 🚀 快速开始

### 1. 环境准备
- Node.js >= 18.0.0
- npm 或 pnpm

### 2. 安装依赖
```bash
npm install
```

### 3. 配置
在设置页面或 `data/settings.json` 中配置 AI 模型 API Key（支持 SiliconFlow, OpenAI 等兼容接口）。

### 4. 启动开发环境
```bash
# 同时启动前端和后端服务
npm run server

# 访问地址: http://localhost:5173
```

### 5. 构建生产版本
```bash
npm run build
npm run preview
```

## 📂 项目结构

```
├── src/                    # 前端源码
│   ├── components/         # 通用 UI 组件
│   ├── lib/                # 核心逻辑 (RAG, 验证, API)
│   ├── plugins/            # 插件系统
│   │   ├── topology-restore/ # 拓扑还原插件
│   │   └── ...
│   ├── stores/             # Zustand 状态管理
│   └── main.tsx            # 入口文件
├── server/                 # 后端服务
│   ├── index.mjs           # API 入口
│   ├── topology.mjs        # 拓扑算法实现
│   └── ...
├── data/                   # 数据存储 (文档, 索引, 设置)
├── doc/                    # 详细项目文档
└── test/                   # 测试脚本与基准测试
```

## 📝 详细文档

项目包含详尽的开发和设计文档，位于 `doc/` 目录下：

### 核心特性
- **[系统优化总结](doc/COMPLETE_SUMMARY.md)**: 了解七阶段优化的完整历程。
- **[准确性提升](doc/ACCURACY_IMPROVEMENT_V2.md)**: RAG 精度优化和抗幻觉技术细节。
- **[流式响应](doc/PHASE7_STREAMING.md)**: 流式 API 和前端实现细节。

### 拓扑功能
- **[拓扑功能总结](doc/TOPOLOGY_SUMMARY.md)**: 拓扑还原功能的完整概述。
- **[快速开始](doc/TOPOLOGY_QUICKSTART.md)**: 拓扑功能使用指南。
- **[实现细节](doc/TOPOLOGY_IMPLEMENTATION.md)**: 算法与架构设计。

### 测试与开发
- **[测试指南](doc/TOPOLOGY_TESTING.md)**: 如何运行测试和验证功能。
- **[API 参考](doc/QUICK_REFERENCE.md)**: 核心 API 和配置说明。

## 🔍 验证与测试

项目包含完善的测试套件，用于验证检索精度和系统稳定性：

```bash
# 运行检索精度基准测试
npm run test:benchmark

# 运行单元测试
npm run test
```

## 📜 License

Private - All Rights Reserved