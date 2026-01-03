# AI 知识助手 API 使用文档

## 概述

AI 知识助手提供了完整的 RESTful API，支持文档管理、智能搜索、批量操作和 Webhook 事件订阅等功能。

## 基础信息

- **Base URL**: `http://localhost:3000/api/v1`
- **认证方式**: API Key (Header: `X-API-Key` 或 `Authorization: Bearer {api_key}`)
- **数据格式**: JSON
- **字符编码**: UTF-8

## 认证

### 创建 API Key

```bash
POST /api/v1/auth/keys
Content-Type: application/json

{
  "name": "My API Key",
  "permissions": ["read", "write"],
  "rateLimit": {
    "requests": 1000,
    "window": "1h"
  }
}
```

**响应示例**:
```json
{
  "ok": true,
  "apiKey": "ak_1234567890abcdef...",
  "secret": "whsec_abcdef1234567890...",
  "name": "My API Key",
  "permissions": ["read", "write"],
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

⚠️ **重要**: `secret` 只在创建时返回一次，请妥善保管。

### 使用 API Key

在所有 API 请求中添加以下 Header：

```bash
X-API-Key: ak_1234567890abcdef...
```

或者：

```bash
Authorization: Bearer ak_1234567890abcdef...
```

### 列出所有 API Keys

```bash
GET /api/v1/auth/keys
X-API-Key: {your_api_key}
```

### 撤销 API Key

```bash
DELETE /api/v1/auth/keys/{api_key}
X-API-Key: {your_api_key}
```

## 文档管理 API

### 1. 上传文档

```bash
POST /api/v1/documents/upload
X-API-Key: {your_api_key}
Content-Type: multipart/form-data

file: [文件]
category: "技术文档"
```

**响应示例**:
```json
{
  "ok": true,
  "document": {
    "id": "doc-1234567890",
    "filename": "network-guide.pdf",
    "fileSize": 1024000,
    "status": "pending",
    "uploadedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 2. 获取文档列表

```bash
GET /api/v1/documents
X-API-Key: {your_api_key}
```

**查询参数**:
- `category`: 按分类筛选
- `status`: 按状态筛选 (pending, processing, ready, failed)
- `limit`: 返回数量限制
- `offset`: 分页偏移量

### 3. 获取单个文档

```bash
GET /api/v1/documents/{document_id}
X-API-Key: {your_api_key}
```

### 4. 更新文档元数据

```bash
PUT /api/v1/documents/{document_id}
X-API-Key: {your_api_key}
Content-Type: application/json

{
  "category": "新分类",
  "tags": ["tag1", "tag2"]
}
```

### 5. 删除文档

```bash
DELETE /api/v1/documents/{document_id}
X-API-Key: {your_api_key}
```

### 6. 获取文档内容

```bash
GET /api/v1/documents/{document_id}/chunks
X-API-Key: {your_api_key}
```

## 搜索 API

### 1. 统一搜索接口

```bash
POST /api/v1/search
X-API-Key: {your_api_key}
Content-Type: application/json

{
  "query": "如何配置 MLAG",
  "limit": 10,
  "filters": {
    "category": "网络配置"
  },
  "includeMetadata": true
}
```

**响应示例**:
```json
{
  "ok": true,
  "results": [
    {
      "chunk": {
        "id": "chunk-123",
        "content": "MLAG 配置步骤...",
        "score": 0.95
      },
      "document": {
        "id": "doc-456",
        "filename": "mlag-guide.pdf"
      },
      "metadata": {
        "breadcrumbs": ["网络配置", "MLAG"],
        "header": "MLAG 配置"
      }
    }
  ],
  "count": 10,
  "query": "如何配置 MLAG",
  "responseTime": 150
}
```

### 2. 语义搜索

```bash
POST /api/v1/semantic-search
X-API-Key: {your_api_key}
Content-Type: application/json

{
  "query": "网络故障排查",
  "limit": 5
}
```

### 3. 关键词搜索

```bash
POST /api/v1/keyword-search
X-API-Key: {your_api_key}
Content-Type: application/json

{
  "keywords": ["BGP", "OSPF", "路由"],
  "limit": 10
}
```

## 批量操作 API

### 1. 批量上传文档

```bash
POST /api/v1/batch/documents/upload
X-API-Key: {your_api_key}
Content-Type: multipart/form-data

files: [文件1, 文件2, 文件3]
category: "技术文档"
batchSize: 5
autoProcess: true
```

**响应示例**:
```json
{
  "ok": true,
  "results": {
    "success": [
      {
        "documentId": "doc-123",
        "filename": "file1.pdf",
        "status": "uploaded"
      }
    ],
    "failed": [
      {
        "filename": "file2.pdf",
        "error": "File too large"
      }
    ],
    "total": 3
  }
}
```

### 2. 批量删除文档

```bash
POST /api/v1/batch/documents/delete
X-API-Key: {your_api_key}
Content-Type: application/json

{
  "documentIds": ["doc-123", "doc-456", "doc-789"]
}
```

### 3. 批量更新文档

```bash
POST /api/v1/batch/documents/update
X-API-Key: {your_api_key}
Content-Type: application/json

{
  "updates": [
    {
      "documentId": "doc-123",
      "updates": {
        "category": "新分类"
      }
    },
    {
      "documentId": "doc-456",
      "updates": {
        "tags": ["tag1", "tag2"]
      }
    }
  ]
}
```

### 4. 批量搜索

```bash
POST /api/v1/batch/search
X-API-Key: {your_api_key}
Content-Type: application/json

{
  "queries": [
    "如何配置 BGP",
    "OSPF 路由协议",
    "VXLAN 隧道"
  ],
  "limit": 5,
  "parallel": true
}
```

**响应示例**:
```json
{
  "ok": true,
  "results": [
    {
      "query": "如何配置 BGP",
      "results": [...],
      "count": 5,
      "status": "success"
    },
    {
      "query": "OSPF 路由协议",
      "results": [...],
      "count": 3,
      "status": "success"
    }
  ]
}
```

### 5. 批量导出文档

```bash
POST /api/v1/batch/documents/export
X-API-Key: {your_api_key}
Content-Type: application/json

{
  "documentIds": ["doc-123", "doc-456"],
  "format": "json"
}
```

支持的格式: `json`, `csv`

### 6. 批量重新处理文档

```bash
POST /api/v1/batch/documents/reprocess
X-API-Key: {your_api_key}
Content-Type: application/json

{
  "documentIds": ["doc-123", "doc-456"]
}
```

## Webhook API

### 1. 注册 Webhook

```bash
POST /api/v1/webhooks
X-API-Key: {your_api_key}
Content-Type: application/json

{
  "url": "https://your-server.com/webhook",
  "events": [
    "document.uploaded",
    "document.processed",
    "search.executed"
  ],
  "name": "My Webhook",
  "enabled": true
}
```

**响应示例**:
```json
{
  "ok": true,
  "webhook": {
    "id": "wh_1234567890",
    "url": "https://your-server.com/webhook",
    "events": ["document.uploaded", "document.processed"],
    "secret": "whsec_abcdef1234567890...",
    "name": "My Webhook",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 2. 支持的事件类型

- `document.uploaded` - 文档上传完成
- `document.processed` - 文档处理完成
- `document.updated` - 文档更新
- `document.deleted` - 文档删除
- `document.failed` - 文档处理失败
- `search.executed` - 搜索执行
- `feedback.received` - 收到用户反馈
- `category.created` - 分类创建
- `category.updated` - 分类更新
- `category.deleted` - 分类删除

### 3. Webhook 负载格式

```json
{
  "id": "del_1234567890",
  "event": "document.processed",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "data": {
    "documentId": "doc-123",
    "filename": "network-guide.pdf",
    "status": "ready",
    "chunkCount": 50,
    "embeddingCount": 45
  }
}
```

### 4. 验证 Webhook 签名

Webhook 请求包含 `X-Webhook-Signature` Header，使用 HMAC-SHA256 算法生成。

**验证示例 (Node.js)**:
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

### 5. 列出所有 Webhooks

```bash
GET /api/v1/webhooks
X-API-Key: {your_api_key}
```

### 6. 获取单个 Webhook

```bash
GET /api/v1/webhooks/{webhook_id}
X-API-Key: {your_api_key}
```

### 7. 更新 Webhook

```bash
PUT /api/v1/webhooks/{webhook_id}
X-API-Key: {your_api_key}
Content-Type: application/json

{
  "enabled": false,
  "events": ["document.uploaded"]
}
```

### 8. 删除 Webhook

```bash
DELETE /api/v1/webhooks/{webhook_id}
X-API-Key: {your_api_key}
```

### 9. 测试 Webhook

```bash
POST /api/v1/webhooks/{webhook_id}/test
X-API-Key: {your_api_key}
```

## 统计分析 API

### 1. 获取系统统计

```bash
GET /api/v1/analytics/stats
X-API-Key: {your_api_key}
```

**响应示例**:
```json
{
  "ok": true,
  "stats": {
    "totalDocuments": 150,
    "totalChunks": 5000,
    "totalQueries": 1200,
    "avgResponseTime": 0.8,
    "documentsByCategory": {
      "技术文档": 80,
      "用户手册": 50,
      "其他": 20
    }
  }
}
```

### 2. 获取搜索统计

```bash
GET /api/v1/analytics/search
X-API-Key: {your_api_key}
```

### 3. 获取热门内容

```bash
GET /api/v1/analytics/popular
X-API-Key: {your_api_key}
```

### 4. 获取批量操作统计

```bash
GET /api/v1/batch/stats
X-API-Key: {your_api_key}
```

## 错误处理

### 错误响应格式

```json
{
  "ok": false,
  "error": "Invalid API Key",
  "message": "The provided API Key is invalid or has been revoked",
  "code": "AUTH_INVALID_KEY"
}
```

### 常见错误码

| HTTP 状态码 | 错误码 | 说明 |
|------------|--------|------|
| 400 | BAD_REQUEST | 请求参数错误 |
| 401 | AUTH_REQUIRED | 需要认证 |
| 401 | AUTH_INVALID_KEY | API Key 无效 |
| 403 | FORBIDDEN | 权限不足 |
| 404 | NOT_FOUND | 资源不存在 |
| 429 | RATE_LIMIT_EXCEEDED | 超过速率限制 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |

## 速率限制

API 请求受到速率限制保护：

- **免费版**: 1000 请求/小时
- **标准版**: 10000 请求/小时
- **企业版**: 50000 请求/小时

速率限制信息包含在响应 Header 中：

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 2024-01-01T01:00:00.000Z
```

## SDK 示例

### Node.js SDK

```javascript
const AIKnowledgeAPI = require('ai-knowledge-sdk');

const client = new AIKnowledgeAPI({
  apiKey: 'ak_1234567890abcdef...',
  baseURL: 'http://localhost:3000/api/v1'
});

// 搜索
const results = await client.search({
  query: '如何配置 MLAG',
  limit: 10
});

// 上传文档
const document = await client.uploadDocument({
  file: './network-guide.pdf',
  category: '技术文档'
});

// 批量搜索
const batchResults = await client.batchSearch({
  queries: ['BGP 配置', 'OSPF 路由'],
  parallel: true
});
```

### Python SDK

```python
from ai_knowledge_sdk import AIKnowledgeClient

client = AIKnowledgeClient(
    api_key='ak_1234567890abcdef...',
    base_url='http://localhost:3000/api/v1'
)

# 搜索
results = client.search(
    query='如何配置 MLAG',
    limit=10
)

# 上传文档
document = client.upload_document(
    file_path='./network-guide.pdf',
    category='技术文档'
)

# 批量搜索
batch_results = client.batch_search(
    queries=['BGP 配置', 'OSPF 路由'],
    parallel=True
)
```

## 最佳实践

### 1. 使用批量操作

对于多个文档或查询，使用批量 API 可以显著提高效率：

```javascript
// ❌ 不推荐：逐个上传
for (const file of files) {
  await client.uploadDocument(file);
}

// ✅ 推荐：批量上传
await client.batchUpload(files);
```

### 2. 实现重试机制

对于可能失败的请求，实现指数退避重试：

```javascript
async function retryRequest(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
}
```

### 3. 缓存搜索结果

对于频繁的相同查询，在客户端实现缓存：

```javascript
const cache = new Map();

async function cachedSearch(query) {
  if (cache.has(query)) {
    return cache.get(query);
  }

  const results = await client.search({ query });
  cache.set(query, results);
  return results;
}
```

### 4. 监控 Webhook 健康状态

定期检查 Webhook 的成功率：

```javascript
const webhooks = await client.listWebhooks();

webhooks.forEach(wh => {
  const successRate = wh.successCount / (wh.successCount + wh.failureCount);
  if (successRate < 0.9) {
    console.warn(`Webhook ${wh.id} has low success rate: ${successRate}`);
  }
});
```

## 支持与反馈

如有问题或建议，请通过以下方式联系我们：

- GitHub Issues: https://github.com/your-repo/issues
- Email: support@example.com
- 文档: https://docs.example.com

## 更新日志

### v1.0.0 (2024-01-01)
- 初始版本发布
- 支持文档管理、搜索、批量操作和 Webhook
- 提供 API Key 认证和速率限制
