# AI Knowledge Assistant

> AI 驱动的知识库管理与智能问答系统

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-Private-gray.svg)](LICENSE)

## ✨ 功能特性

- 📄 **智能文档解析** - 支持 PDF、Word、Excel、Markdown 等多种格式
- 🔍 **混合检索** - 结合关键词搜索与向量语义搜索 (RRF 融合算法)
- 🤖 **AI 问答** - 基于 RAG 的智能问答，支持上下文理解
- 🌐 **网络拓扑可视化** - 支持 IB/RoCE 网络拓扑图展示
- 📊 **仪表盘统计** - 文档统计、查询分析、分类管理
- 🏷️ **分类管理** - 树形分类结构，支持文档归类

## 🛠️ 技术栈

### 前端
- React 18 + TypeScript
- Vite 构建工具
- Tailwind CSS
- Zustand 状态管理
- Cytoscape.js 拓扑可视化

### 后端
- Node.js + Express
- 向量嵌入 (Embedding API)
- 文件系统存储

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
# 同时启动前端和后端
npm run server

# 仅启动后端
npm run server:backend
```

### 构建生产版本

```bash
npm run build
npm run preview
```

## 📁 项目结构

```
├── src/                    # 前端源码
│   ├── components/         # React 组件
│   ├── lib/               # 工具库
│   ├── plugins/           # 插件（拓扑可视化等）
│   └── stores/            # Zustand 状态管理
├── server/                 # 后端服务
│   ├── index.mjs          # 主入口
│   ├── storage.mjs        # 存储管理
│   ├── embedding.mjs      # 向量嵌入
│   ├── chunking.mjs       # 文档分块
│   ├── topology.mjs       # 拓扑分析
│   └── utils.mjs          # 工具函数
├── data/                   # 数据存储目录
└── doc/                    # 项目文档
```

## 📋 NPM 脚本

| 命令 | 说明 |
|------|------|
| `npm run server` | 启动开发服务器（前端+后端） |
| `npm run server:backend` | 仅启动后端服务 |
| `npm run build` | 构建生产版本 |
| `npm run lint` | 运行 ESLint 检查 |
| `npm run test` | 运行测试 |

## 🔧 环境变量

| 变量名 | 说明 |
|--------|------|
| `PORT` | 后端服务端口（默认 8787） |
| `SILICONFLOW_API_KEY` | SiliconFlow API 密钥 |
| `AZURE_VISION_ENDPOINT` | Azure Vision OCR 端点 |
| `AZURE_VISION_KEY` | Azure Vision API 密钥 |

## 📄 License

Private - All Rights Reserved
