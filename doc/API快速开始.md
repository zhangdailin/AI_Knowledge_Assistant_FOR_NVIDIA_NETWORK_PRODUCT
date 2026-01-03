# AI 知识助手 API 快速开始指南

## 🚀 快速开始

本指南将帮助你在 5 分钟内开始使用 AI 知识助手的 API。

## 第一步：创建 API Key

首先，你需要创建一个 API Key 来访问 API。

### 使用 curl 创建

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

### 响应示例

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

## 第二步：测试 API 连接

使用你的 API Key 测试连接：

```bash
curl -X GET http://localhost:8787/api/documents \
  -H "X-API-Key: ak_1234567890abcdef..."
```

如果返回文档列表，说明连接成功！

## 第三步：上传你的第一个文档

```bash
curl -X POST http://localhost:8787/api/documents/upload \
  -H "X-API-Key: ak_1234567890abcdef..." \
  -F "file=@/path/to/your/document.pdf" \
  -F "category=技术文档"
```

### 响应示例

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

## 第四步：搜索文档内容

等待文档处理完成后（status 变为 "ready"），你可以开始搜索：

```bash
curl -X GET "http://localhost:8787/api/chunks/search?q=如何配置网络&limit=5" \
  -H "X-API-Key: ak_1234567890abcdef..."
```

## 常用操作示例

### 1. 批量上传文档

```bash
curl -X POST http://localhost:8787/api/v1/batch/documents/upload \
  -H "X-API-Key: ak_1234567890abcdef..." \
  -F "files=@file1.pdf" \
  -F "files=@file2.pdf" \
  -F "files=@file3.pdf" \
  -F "category=技术文档" \
  -F "batchSize=5" \
  -F "autoProcess=true"
```

### 2. 批量搜索

```bash
curl -X POST http://localhost:8787/api/v1/batch/search \
  -H "X-API-Key: ak_1234567890abcdef..." \
  -H "Content-Type: application/json" \
  -d '{
    "queries": [
      "如何配置 BGP",
      "OSPF 路由协议",
      "VXLAN 隧道配置"
    ],
    "limit": 5,
    "parallel": true
  }'
```

### 3. 注册 Webhook

```bash
curl -X POST http://localhost:8787/api/v1/webhooks \
  -H "X-API-Key: ak_1234567890abcdef..." \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.com/webhook",
    "events": [
      "document.uploaded",
      "document.processed",
      "search.executed"
    ],
    "name": "我的 Webhook"
  }'
```

### 4. 获取系统统计

```bash
curl -X GET http://localhost:8787/api/stats \
  -H "X-API-Key: ak_1234567890abcdef..."
```

## 使用 Node.js

### 安装依赖

```bash
npm install node-fetch form-data
```

### 示例代码

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

## 使用 Python

### 安装依赖

```bash
pip install requests
```

### 示例代码

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

## Webhook 接收示例

### Node.js + Express

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

### Python + Flask

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

## 下一步

- 📖 查看完整的 [API 使用文档](./API使用文档.md)
- 🔧 探索更多高级功能
- 💬 加入社区讨论

## 获取帮助

如有问题，请通过以下方式联系：

- GitHub Issues: https://github.com/your-repo/issues
- Email: support@example.com
- 文档: https://docs.example.com

---

**祝你使用愉快！** 🎉
