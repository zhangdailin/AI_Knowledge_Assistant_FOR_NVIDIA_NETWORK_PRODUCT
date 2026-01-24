# 工程与运维说明

本文档汇总性能优化、日志迁移、安全风险与发布流程的关键信息。

## 近期优化概览

- 移除未使用依赖，减小包体积
- 增加数据库索引，提升查询性能
- 搜索缓存优化（容量与 TTL）
- 引入结构化日志系统
- 修复查询上下文边缘情况

## 性能优化要点

### 搜索性能
- 向量/关键词检索使用 Top-K 结构（减少内存占用）
- 预计算与内联相似度降低 CPU 开销
- LRU + TTL 缓存提升重复查询命中率

### 数据库索引
- documents：按时间、分类、用户、状态索引
- chunks：创建时间、embedding、有无 embedding、文档+类型复合索引

## 查询优化修复（上下文添加）

问题：查询已包含技术术语时仍添加上下文，导致引入无关词。
修复：判断是否包含任何技术术语，只有完全缺失时才补上下文。

## 结构化日志迁移

### 使用方式

```javascript
import { logger } from './utils/logger.mjs';
logger.info('Document uploaded', { documentId, filename });
logger.error('Embedding failed', { error: error.message });
```

### 日志级别

- DEBUG：详细调试
- INFO：默认
- WARN：告警
- ERROR：错误

```bash
export LOG_LEVEL=INFO
```

## 安全风险（xlsx）

### 风险
- 原型污染与 ReDoS 漏洞（高危）
- 主要风险来自恶意构造的 Excel 文件

### 缓解建议
- 严格文件校验与大小限制
- 解析失败日志与监控
- 评估迁移到更安全库（如 exceljs）

## 推送与发布

```bash
git remote set-url origin git@github.com:<org>/<repo>.git
git push origin main
```

若使用 PAT：
```bash
git push origin main
# Username: <your-username>
# Password: <your-token>
```

## 规划与待办

- 拆分 `server/index.mjs`，拆到 `routes/` 与 `services/`
- 逐步迁移关键模块日志
- 优化 Neo4j 连接与启动内存

## Web Search 配置（Gemini 联网）

服务端可通过搜索 API 获取结果并注入到 Gemini 的上下文中。
支持 Serper、Bing、Brave，按优先级尝试或通过 `SEARCH_PROVIDER` 指定。

### 环境变量

```bash
# 选择搜索提供商：serper | bing | brave
SEARCH_PROVIDER=serper

# Serper
SERPER_API_KEY=your_key
SERPER_BASE_URL=https://google.serper.dev
SERPER_HL=en
SERPER_GL=us

# Bing
BING_SEARCH_KEY=your_key
BING_SEARCH_ENDPOINT=https://api.bing.microsoft.com/v7.0/search
BING_SEARCH_MARKET=en-US

# Brave
BRAVE_SEARCH_API_KEY=your_key
BRAVE_SEARCH_ENDPOINT=https://api.search.brave.com/res/v1/web/search
BRAVE_SEARCH_LANG=en
```
