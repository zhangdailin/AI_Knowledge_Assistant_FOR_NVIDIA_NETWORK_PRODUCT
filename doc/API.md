# AI 知识助手 API 文档

## 目录

- [快速开始](#快速开始)
- [基础信息](#基础信息)
- [认证](#认证)
- [文档管理 API](#文档管理-api)
- [搜索 API](#搜索-api)
- [批量操作 API](#批量操作-api)
- [Webhook API](#webhook-api)
- [统计分析 API](#统计分析-api)
- [错误处理](#错误处理)
- [速率限制](#速率限制)
- [SDK 示例](#sdk-示例)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)

---

## 快速开始

本指南将帮助你在 5 分钟内开始使用 AI 知识助手的 API。

### 第一步：创建 API Key

首先，你需要创建一个 API Key 来访问 API。

```bash
curl -X POST http://localhost:8787/api/v1/auth/keys \
  -H "Content-Type: application/json" \
  -d '{
    "name": "我的第一个 API Key",
    "permissions": ["read", "write"],
    "rateLimit": {
      "requests": 1000,
      "window": "1h"
    }
  }'
```

**响应示例**:
```json
{
  "ok": true,
  "apiKey": "ak_1234567890abcdef...",
  "secret": "whsec_abcdef1234567890...",
  "name": "我的第一个 API Key",
  "permissions": ["read", "write"],
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

⚠️ **重要**: 请保存好 `apiKey` 和 `secret`，它们只会显示一次！

### 第二步：测试 API 连接

使用你的 API Key 测试连接：

```bash
curl -X GET http://localhost:8787/api/documents \
  -H "X-API-Key: ak_1234567890abcdef..."
```

如果返回文档列表，说明连接成功！

### 第三步：上传你的第一个文档

```bash
curl -X POST http://localhost:8787/api/documents/upload \
  -H "X-API-Key: ak_1234567890abcdef..." \
  -F "file=@/path/to/your/document.pdf" \
  -F "category=技术文档"
```

**响应示例**:
```json
{
  "ok": true,
  "document": {
    "id": "doc-1234567890",
    "filename": "document.pdf",
    "fileSize": 1024000,
    "status": "pending",
    "uploadedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 第四步：搜索文档内容

等待文档处理完成后（status 变为 "ready"），你可以开始搜索：

```bash
curl -X GET "http://localhost:8787/api/chunks/search?q=如何配置网络&limit=5" \
  -H "X-API-Key: ak_1234567890abcdef..."
```

---

## 基础信息

- **Base URL**: `http://localhost:8787/api/v1`
- **认证方式**: API Key (Header: `X-API-Key` 或 `Authorization: Bearer {api_key}`)
- **数据格式**: JSON
- **字符编码**: UTF-8

---

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

---

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

---

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

---

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

---

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

---

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

---

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

---

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

---

## SDK 示例

### Node.js

#### 安装依赖

```bash
npm install node-fetch form-data
```

#### 示例代码

```javascript
import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';

const API_KEY = 'ak_1234567890abcdef...';
const BASE_URL = 'http://localhost:8787';

// 上传文档
async function uploadDocument(filePath, category) {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  formData.append('category', category);

  const response = await fetch(`${BASE_URL}/api/documents/upload`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY
    },
    body: formData
  });

  return await response.json();
}

// 搜索
async function search(query, limit = 10) {
  const response = await fetch(
    `${BASE_URL}/api/chunks/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    {
      headers: {
        'X-API-Key': API_KEY
      }
    }
  );

  return await response.json();
}

// 批量搜索
async function batchSearch(queries) {
  const response = await fetch(`${BASE_URL}/api/v1/batch/search`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      queries,
      limit: 5,
      parallel: true
    })
  });

  return await response.json();
}

// 使用示例
(async () => {
  // 上传文档
  const uploadResult = await uploadDocument('./document.pdf', '技术文档');
  console.log('上传结果:', uploadResult);

  // 搜索
  const searchResult = await search('如何配置网络');
  console.log('搜索结果:', searchResult);

  // 批量搜索
  const batchResult = await batchSearch([
    '如何配置 BGP',
    'OSPF 路由协议',
    'VXLAN 隧道'
  ]);
  console.log('批量搜索结果:', batchResult);
})();
```

### Python

#### 安装依赖

```bash
pip install requests
```

#### 示例代码

```python
import requests
import json

API_KEY = 'ak_1234567890abcdef...'
BASE_URL = 'http://localhost:8787'

headers = {
    'X-API-Key': API_KEY
}

# 上传文档
def upload_document(file_path, category='技术文档'):
    with open(file_path, 'rb') as f:
        files = {'file': f}
        data = {'category': category}
        response = requests.post(
            f'{BASE_URL}/api/documents/upload',
            headers=headers,
            files=files,
            data=data
        )
    return response.json()

# 搜索
def search(query, limit=10):
    params = {'q': query, 'limit': limit}
    response = requests.get(
        f'{BASE_URL}/api/chunks/search',
        headers=headers,
        params=params
    )
    return response.json()

# 批量搜索
def batch_search(queries):
    payload = {
        'queries': queries,
        'limit': 5,
        'parallel': True
    }
    response = requests.post(
        f'{BASE_URL}/api/v1/batch/search',
        headers={**headers, 'Content-Type': 'application/json'},
        json=payload
    )
    return response.json()

# 使用示例
if __name__ == '__main__':
    # 上传文档
    upload_result = upload_document('./document.pdf', '技术文档')
    print('上传结果:', upload_result)

    # 搜索
    search_result = search('如何配置网络')
    print('搜索结果:', search_result)

    # 批量搜索
    batch_result = batch_search([
        '如何配置 BGP',
        'OSPF 路由协议',
        'VXLAN 隧道'
    ])
    print('批量搜索结果:', batch_result)
```

### Webhook 接收示例

#### Node.js + Express

```javascript
import express from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.json());

// Webhook 密钥（从注册 Webhook 时获得）
const WEBHOOK_SECRET = 'whsec_abcdef1234567890...';

// 验证 Webhook 签名
function verifySignature(payload, signature) {
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Webhook 接收端点
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = req.body;

  // 验证签名
  if (!verifySignature(payload, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 处理事件
  console.log('收到 Webhook 事件:', payload.event);
  console.log('事件数据:', payload.data);

  switch (payload.event) {
    case 'document.uploaded':
      console.log('文档已上传:', payload.data.filename);
      break;
    case 'document.processed':
      console.log('文档处理完成:', payload.data.filename);
      break;
    case 'search.executed':
      console.log('搜索执行:', payload.data.query);
      break;
  }

  res.json({ received: true });
});

app.listen(3000, () => {
  console.log('Webhook 服务器运行在 http://localhost:3000');
});
```

#### Python + Flask

```python
from flask import Flask, request, jsonify
import hmac
import hashlib
import json

app = Flask(__name__)

# Webhook 密钥
WEBHOOK_SECRET = 'whsec_abcdef1234567890...'

def verify_signature(payload, signature):
    expected_signature = hmac.new(
        WEBHOOK_SECRET.encode(),
        json.dumps(payload).encode(),
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(signature, expected_signature)

@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-Webhook-Signature')
    payload = request.json

    # 验证签名
    if not verify_signature(payload, signature):
        return jsonify({'error': 'Invalid signature'}), 401

    # 处理事件
    print(f'收到 Webhook 事件: {payload["event"]}')
    print(f'事件数据: {payload["data"]}')

    event = payload['event']
    data = payload['data']

    if event == 'document.uploaded':
        print(f'文档已上传: {data["filename"]}')
    elif event == 'document.processed':
        print(f'文档处理完成: {data["filename"]}')
    elif event == 'search.executed':
        print(f'搜索执行: {data["query"]}')

    return jsonify({'received': True})

if __name__ == '__main__':
    app.run(port=3000)
```

---

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

---

## 常见问题

### 1. API Key 无效

**错误**: `Invalid API Key`

**解决方案**:
- 检查 API Key 是否正确复制
- 确认 API Key 没有被撤销
- 检查 Header 格式是否正确

### 2. 超过速率限制

**错误**: `Rate limit exceeded`

**解决方案**:
- 查看响应 Header 中的 `X-RateLimit-Reset` 了解重置时间
- 考虑升级到更高的速率限制层级
- 使用批量操作 API 减少请求次数

### 3. 文档处理失败

**错误**: `Document processing failed`

**解决方案**:
- 检查文档格式是否支持（PDF, Word, Excel, Markdown）
- 确认文档大小不超过限制
- 查看文档状态和错误信息

### 4. Webhook 未收到事件

**解决方案**:
- 确认 Webhook URL 可以从外部访问
- 检查 Webhook 是否启用（enabled: true）
- 使用测试端点验证 Webhook 配置
- 查看 Webhook 统计信息中的失败次数

---

## 获取帮助

如有问题或建议，请通过以下方式联系我们：

- GitHub Issues: https://github.com/your-repo/issues
- Email: support@example.com
- 文档: https://docs.example.com

---

**祝你使用愉快！** 🎉
