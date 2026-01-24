# 文档索引

本目录已汇总为少量核心文档，便于快速定位与维护。

## 入口

- API 参考：`doc/API.md`
- 知识图谱与检索：`doc/KNOWLEDGE_GRAPH.md`
- 测试与质量保障：`doc/TESTING.md`
- 工程与运维说明：`doc/ENGINEERING_NOTES.md`
- 版本与工作记录：`doc/WORK_HISTORY.md`

## 仓库规范摘要

### 项目结构

- `src/`：React + TypeScript 前端（入口 `src/main.tsx`）
- `server/`：Node/Express 后端（ESM `.mjs`）
- `test/`：测试与基准脚本
- `data/`、`test-data/`：数据与样例
- 根配置：`vite.config.ts`、`tsconfig.json`、`eslint.config.js`、`tailwind.config.js`

### 常用命令

- `npm run server`：前后端联动启动
- `npm run server:backend`：仅后端（默认 `PORT=8787`）
- `npm run build`：类型检查 + 生产构建
- `npm run lint`：ESLint 检查
- `npm run check`：仅 TypeScript 检查
- `npm run test` / `npm run test:run`：测试
- `npm run test:benchmark`：基准测试

### 编码与命名

- TypeScript + React；2 空格缩进；单引号；不使用分号
- `@/` 指向 `src/*`
- 组件 PascalCase；后端模块使用小写或 kebab-case

### 测试与提交

- 测试文件位于 `test/`，遵循现有命名规范
- 优先使用 Vitest
- 提交建议使用 `feat:`, `fix:`, `docs:` 等前缀

### 配置与密钥

后端读取 `PORT`, `AZURE_VISION_ENDPOINT`, `AZURE_VISION_KEY`,
`SILICONFLOW_API_KEY`（或 `VITE_SILICONFLOW_API_KEY`）。不要提交密钥。
