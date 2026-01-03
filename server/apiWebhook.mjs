/**
 * Webhook 事件管理模块
 * 支持订阅和推送各种知识库事件
 */

import crypto from 'crypto';
import * as storage from './storage.mjs';

// Webhook 事件类型定义
export const WebhookEvents = {
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_PROCESSED: 'document.processed',
  DOCUMENT_UPDATED: 'document.updated',
  DOCUMENT_DELETED: 'document.deleted',
  DOCUMENT_FAILED: 'document.failed',
  SEARCH_EXECUTED: 'search.executed',
  FEEDBACK_RECEIVED: 'feedback.received',
  CATEGORY_CREATED: 'category.created',
  CATEGORY_UPDATED: 'category.updated',
  CATEGORY_DELETED: 'category.deleted'
};

// Webhook 存储
const webhooks = new Map();

/**
 * 注册 Webhook
 * @param {Object} webhookConfig - Webhook 配置
 * @returns {Object} - 注册的 Webhook 信息
 */
export async function registerWebhook(webhookConfig) {
  const {
    url,
    events = [],
    secret = null,
    enabled = true,
    name = 'Unnamed Webhook',
    userId = 'system'
  } = webhookConfig;

  if (!url || !isValidUrl(url)) {
    throw new Error('Invalid webhook URL');
  }

  if (events.length === 0) {
    throw new Error('At least one event must be specified');
  }

  // 验证事件类型
  const invalidEvents = events.filter(e => !Object.values(WebhookEvents).includes(e));
  if (invalidEvents.length > 0) {
    throw new Error(`Invalid event types: ${invalidEvents.join(', ')}`);
  }

  const webhookId = `wh_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const webhookSecret = secret || generateWebhookSecret();

  const webhook = {
    id: webhookId,
    url,
    events,
    secret: webhookSecret,
    enabled,
    name,
    userId,
    createdAt: new Date().toISOString(),
    lastTriggeredAt: null,
    successCount: 0,
    failureCount: 0
  };

  // 保存到存储
  await saveWebhook(webhook);
  webhooks.set(webhookId, webhook);

  return {
    id: webhookId,
    url,
    events,
    secret: webhookSecret,
    name,
    createdAt: webhook.createdAt
  };
}

/**
 * 触发 Webhook 事件
 * @param {string} eventType - 事件类型
 * @param {Object} payload - 事件数据
 */
export async function triggerWebhook(eventType, payload) {
  if (!Object.values(WebhookEvents).includes(eventType)) {
    console.warn(`[Webhook] Unknown event type: ${eventType}`);
    return;
  }

  // 获取所有订阅此事件的 webhooks
  const subscribedWebhooks = Array.from(webhooks.values()).filter(
    wh => wh.enabled && wh.events.includes(eventType)
  );

  if (subscribedWebhooks.length === 0) {
    return;
  }

  console.log(`[Webhook] Triggering ${subscribedWebhooks.length} webhooks for event: ${eventType}`);

  // 并行发送所有 webhooks
  const deliveryPromises = subscribedWebhooks.map(webhook =>
    deliverWebhook(webhook, eventType, payload)
  );

  await Promise.allSettled(deliveryPromises);
}

/**
 * 发送 Webhook 请求
 * @param {Object} webhook - Webhook 配置
 * @param {string} eventType - 事件类型
 * @param {Object} payload - 事件数据
 */
async function deliverWebhook(webhook, eventType, payload) {
  const deliveryId = `del_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const webhookPayload = {
    id: deliveryId,
    event: eventType,
    timestamp: new Date().toISOString(),
    data: payload
  };

  // 生成签名
  const signature = generateSignature(webhookPayload, webhook.secret);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': eventType,
        'X-Webhook-Delivery': deliveryId,
        'User-Agent': 'AI-Knowledge-Assistant-Webhook/1.0'
      },
      body: JSON.stringify(webhookPayload),
      signal: AbortSignal.timeout(10000) // 10秒超时
    });

    if (response.ok) {
      console.log(`[Webhook] Successfully delivered to ${webhook.url} (${eventType})`);
      await updateWebhookStats(webhook.id, true);
    } else {
      console.error(`[Webhook] Failed to deliver to ${webhook.url}: ${response.status} ${response.statusText}`);
      await updateWebhookStats(webhook.id, false);
    }
  } catch (error) {
    console.error(`[Webhook] Error delivering to ${webhook.url}:`, error.message);
    await updateWebhookStats(webhook.id, false);
  }
}

/**
 * 生成 Webhook 签名
 * @param {Object} payload - 数据负载
 * @param {string} secret - Webhook 密钥
 * @returns {string} - HMAC-SHA256 签名
 */
function generateSignature(payload, secret) {
  const payloadString = JSON.stringify(payload);
  return crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
}

/**
 * 验证 Webhook 签名
 * @param {Object} payload - 数据负载
 * @param {string} signature - 接收到的签名
 * @param {string} secret - Webhook 密钥
 * @returns {boolean} - 签名是否有效
 */
export function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = generateSignature(payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * 生成 Webhook 密钥
 */
function generateWebhookSecret() {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * 验证 URL 格式
 */
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 保存 Webhook 到存储
 */
async function saveWebhook(webhook) {
  const settings = await storage.getSettings();
  if (!settings.webhooks) {
    settings.webhooks = {};
  }
  settings.webhooks[webhook.id] = webhook;
  await storage.updateSettings(settings);
}

/**
 * 更新 Webhook 统计信息
 */
async function updateWebhookStats(webhookId, success) {
  const webhook = webhooks.get(webhookId);
  if (!webhook) return;

  webhook.lastTriggeredAt = new Date().toISOString();
  if (success) {
    webhook.successCount++;
  } else {
    webhook.failureCount++;
  }

  await saveWebhook(webhook);
}

/**
 * 获取所有 Webhooks
 * @param {string} userId - 用户ID（可选）
 * @returns {Array} - Webhook 列表
 */
export async function listWebhooks(userId = null) {
  let webhookList = Array.from(webhooks.values());

  if (userId) {
    webhookList = webhookList.filter(wh => wh.userId === userId);
  }

  // 移除敏感信息
  return webhookList.map(wh => ({
    id: wh.id,
    url: wh.url,
    events: wh.events,
    name: wh.name,
    enabled: wh.enabled,
    createdAt: wh.createdAt,
    lastTriggeredAt: wh.lastTriggeredAt,
    successCount: wh.successCount,
    failureCount: wh.failureCount
  }));
}

/**
 * 获取单个 Webhook
 * @param {string} webhookId - Webhook ID
 * @returns {Object|null} - Webhook 信息
 */
export async function getWebhook(webhookId) {
  const webhook = webhooks.get(webhookId);
  if (!webhook) return null;

  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    name: webhook.name,
    enabled: webhook.enabled,
    createdAt: webhook.createdAt,
    lastTriggeredAt: webhook.lastTriggeredAt,
    successCount: webhook.successCount,
    failureCount: webhook.failureCount
  };
}

/**
 * 更新 Webhook
 * @param {string} webhookId - Webhook ID
 * @param {Object} updates - 更新内容
 * @returns {Object|null} - 更新后的 Webhook
 */
export async function updateWebhook(webhookId, updates) {
  const webhook = webhooks.get(webhookId);
  if (!webhook) return null;

  // 允许更新的字段
  const allowedUpdates = ['url', 'events', 'enabled', 'name'];
  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      webhook[key] = updates[key];
    }
  }

  await saveWebhook(webhook);
  return getWebhook(webhookId);
}

/**
 * 删除 Webhook
 * @param {string} webhookId - Webhook ID
 * @returns {boolean} - 是否删除成功
 */
export async function deleteWebhook(webhookId) {
  const webhook = webhooks.get(webhookId);
  if (!webhook) return false;

  webhooks.delete(webhookId);

  const settings = await storage.getSettings();
  if (settings.webhooks?.[webhookId]) {
    delete settings.webhooks[webhookId];
    await storage.updateSettings(settings);
  }

  return true;
}

/**
 * 测试 Webhook
 * @param {string} webhookId - Webhook ID
 * @returns {Object} - 测试结果
 */
export async function testWebhook(webhookId) {
  const webhook = webhooks.get(webhookId);
  if (!webhook) {
    return { success: false, error: 'Webhook not found' };
  }

  const testPayload = {
    message: 'This is a test webhook delivery',
    webhookId: webhook.id,
    timestamp: new Date().toISOString()
  };

  try {
    await deliverWebhook(webhook, 'webhook.test', testPayload);
    return {
      success: true,
      message: 'Test webhook delivered successfully'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 初始化 Webhooks（从存储加载）
 */
export async function initializeWebhooks() {
  try {
    const settings = await storage.getSettings();
    if (settings.webhooks) {
      Object.values(settings.webhooks).forEach(webhook => {
        webhooks.set(webhook.id, webhook);
      });
      console.log(`[Webhook] Loaded ${webhooks.size} webhooks from storage`);
    }
  } catch (error) {
    console.error('[Webhook] Failed to initialize webhooks:', error);
  }
}

/**
 * Webhook 事件辅助函数
 */
export const WebhookHelpers = {
  // 文档上传事件
  documentUploaded: (document) => triggerWebhook(WebhookEvents.DOCUMENT_UPLOADED, {
    documentId: document.id,
    filename: document.filename,
    fileSize: document.fileSize,
    category: document.category,
    uploadedAt: document.uploadedAt
  }),

  // 文档处理完成事件
  documentProcessed: (document, stats) => triggerWebhook(WebhookEvents.DOCUMENT_PROCESSED, {
    documentId: document.id,
    filename: document.filename,
    status: document.status,
    chunkCount: stats.total,
    embeddingCount: stats.withEmbedding
  }),

  // 文档更新事件
  documentUpdated: (document, updates) => triggerWebhook(WebhookEvents.DOCUMENT_UPDATED, {
    documentId: document.id,
    filename: document.filename,
    updates
  }),

  // 文档删除事件
  documentDeleted: (documentId) => triggerWebhook(WebhookEvents.DOCUMENT_DELETED, {
    documentId
  }),

  // 搜索执行事件
  searchExecuted: (query, resultCount, responseTime) => triggerWebhook(WebhookEvents.SEARCH_EXECUTED, {
    query,
    resultCount,
    responseTime,
    timestamp: new Date().toISOString()
  }),

  // 反馈接收事件
  feedbackReceived: (feedback) => triggerWebhook(WebhookEvents.FEEDBACK_RECEIVED, {
    feedbackId: feedback.id,
    verdict: feedback.verdict,
    question: feedback.question,
    timestamp: feedback.timestamp
  })
};
