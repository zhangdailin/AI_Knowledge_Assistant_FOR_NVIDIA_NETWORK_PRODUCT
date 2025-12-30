# AI Knowledge Assistant

> AI 驱动的知识库管理与智能问答系统

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-Private-gray.svg)](LICENSE)

## 功能特性

- 智能文档解析：支持 PDF、Word、Excel、Markdown 等格式
- 混合检索：关键词搜索 + 向量语义搜索（RRF 融合）
- AI 问答：基于 RAG 的上下文问答
- 网络拓扑还原与可视化：IB / RoCE 拓扑渲染与交互
- 仪表盘统计：文档统计、查询分析、分类管理
- 分类管理：树形分类结构与文档归档

## 技术栈

### 前端
- React 18 + TypeScript
- Vite
- Tailwind CSS
- Zustand
- Cytoscape.js + ReactFlow

### 后端
- Node.js + Express
- 向量嵌入（Embedding API）
- 文件系统存储

## 快速开始

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

## 项目结构

```
├── src/                    # 前端源码（入口：src/main.tsx）
│   ├── components/         # UI 组件
│   ├── plugins/            # 功能插件（拓扑还原、AI 工具箱等）
│   ├── stores/             # Zustand 状态管理
│   ├── utils/              # 工具函数
│   └── index.css           # 全局样式
├── server/                 # 后端服务（ESM）
├── test/                   # 测试与基准脚本
├── test-data/              # 测试样本数据
├── data/                   # 本地数据存储
└── doc/                    # 项目文档
```

## NPM 脚本

| 命令 | 说明 |
|------|------|
| `npm run server` | 启动开发服务器（前端+后端） |
| `npm run server:backend` | 仅启动后端服务 |
| `npm run build` | 构建生产版本 |
| `npm run preview` | 本地预览生产版本 |
| `npm run lint` | 运行 ESLint 检查 |
| `npm run check` | TypeScript 类型检查 |
| `npm run test` | Vitest 监听模式 |
| `npm run test:run` | Vitest 单次运行 |
| `npm run test:ui` | Vitest UI |
| `npm run test:benchmark` | 运行精度基准测试 |

## License

Private - All Rights Reserved
