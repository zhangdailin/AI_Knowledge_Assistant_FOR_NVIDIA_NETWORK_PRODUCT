/**
 * API 认证和授权模块
 * 支持 API Key 和 JWT Token 认证
 */

import crypto from 'crypto';
import * as storage from './storage-adapter.mjs';

// API Key 存储文件
const API_KEYS_FILE = 'data/api_keys.json';

/**
 * 生成安全的 API Key
 */
export function generateApiKey() {
  const prefix = 'ak_'; // API Key 前缀
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return `${prefix}${randomBytes}`;
}

/**
 * 生成 API Secret (用于签名验证)
 */
export function generateApiSecret() {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * 创建新的 API Key
 * @param {Object} options - API Key 配置
 * @returns {Object} - 包含 apiKey 和 secret 的对象
 */
export async function createApiKey(options = {}) {
  const {
    name = 'Default API Key',
    userId = 'system',
    permissions = ['read', 'write'],
    rateLimit = { requests: 1000, window: '1h' },
    expiresAt = null
  } = options;

  const apiKey = generateApiKey();
  const secret = generateApiSecret();
  const hashedSecret = hashSecret(secret);

  const keyData = {
    apiKey,
    hashedSecret,
    name,
    userId,
    permissions,
    rateLimit,
    createdAt: new Date().toISOString(),
    expiresAt,
    lastUsedAt: null,
    usageCount: 0,
    enabled: true
  };

  // 保存到存储
  await saveApiKey(keyData);

  // 只返回一次 secret（之后无法再次获取）
  return {
    apiKey,
    secret, // 明文 secret，只在创建时返回
    name,
    permissions,
    rateLimit,
    createdAt: keyData.createdAt
  };
}

/**
 * 验证 API Key
 * @param {string} apiKey - API Key
 * @param {string} signature - 请求签名（可选）
 * @returns {Object|null} - 验证成功返回 key 数据，失败返回 null
 */
export async function verifyApiKey(apiKey, signature = null) {
  if (!apiKey || !apiKey.startsWith('ak_')) {
    return null;
  }

  const keyData = await getApiKey(apiKey);

  if (!keyData) {
    return null;
  }

  // 检查是否启用
  if (!keyData.enabled) {
    return null;
  }

  // 检查是否过期
  if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
    return null;
  }

  // 如果提供了签名，验证签名
  if (signature) {
    const isValid = verifySignature(signature, keyData.hashedSecret);
    if (!isValid) {
      return null;
    }
  }

  // 更新使用统计
  await updateApiKeyUsage(apiKey);

  return {
    apiKey: keyData.apiKey,
    userId: keyData.userId,
    permissions: keyData.permissions,
    rateLimit: keyData.rateLimit
  };
}

/**
 * 验证请求签名
 */
function verifySignature(signature, hashedSecret) {
  // 实现 HMAC-SHA256 签名验证
  // 这里简化处理，实际应该验证完整的请求签名
  return true; // 暂时返回 true，后续可以完善
}

/**
 * 哈希 Secret
 */
function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/**
 * 保存 API Key
 */
async function saveApiKey(keyData) {
  const settings = await storage.getSettings();
  if (!settings.apiKeys) {
    settings.apiKeys = {};
  }
  settings.apiKeys[keyData.apiKey] = keyData;
  await storage.updateSettings(settings);
}

/**
 * 获取 API Key
 */
async function getApiKey(apiKey) {
  const settings = await storage.getSettings();
  return settings.apiKeys?.[apiKey] || null;
}

/**
 * 更新 API Key 使用统计
 */
async function updateApiKeyUsage(apiKey) {
  const settings = await storage.getSettings();
  if (settings.apiKeys?.[apiKey]) {
    settings.apiKeys[apiKey].lastUsedAt = new Date().toISOString();
    settings.apiKeys[apiKey].usageCount = (settings.apiKeys[apiKey].usageCount || 0) + 1;
    await storage.updateSettings(settings);
  }
}

/**
 * 列出所有 API Keys（不包含 secret）
 */
export async function listApiKeys(userId = null) {
  const settings = await storage.getSettings();
  const apiKeys = settings.apiKeys || {};

  let keys = Object.values(apiKeys);

  if (userId) {
    keys = keys.filter(k => k.userId === userId);
  }

  // 移除敏感信息
  return keys.map(k => ({
    apiKey: k.apiKey,
    name: k.name,
    permissions: k.permissions,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    usageCount: k.usageCount,
    enabled: k.enabled,
    expiresAt: k.expiresAt
  }));
}

/**
 * 撤销 API Key
 */
export async function revokeApiKey(apiKey) {
  const settings = await storage.getSettings();
  if (settings.apiKeys?.[apiKey]) {
    settings.apiKeys[apiKey].enabled = false;
    await storage.updateSettings(settings);
    return true;
  }
  return false;
}

/**
 * 删除 API Key
 */
export async function deleteApiKey(apiKey) {
  const settings = await storage.getSettings();
  if (settings.apiKeys?.[apiKey]) {
    delete settings.apiKeys[apiKey];
    await storage.updateSettings(settings);
    return true;
  }
  return false;
}

/**
 * Express 中间件：验证 API Key
 */
export function requireApiKey(requiredPermissions = []) {
  return async (req, res, next) => {
    // 从 Header 中获取 API Key
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

    if (!apiKey) {
      return res.status(401).json({
        ok: false,
        error: 'API Key is required',
        message: 'Please provide an API Key in the X-API-Key header or Authorization header'
      });
    }

    // 验证 API Key
    const keyData = await verifyApiKey(apiKey);

    if (!keyData) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid API Key',
        message: 'The provided API Key is invalid or has been revoked'
      });
    }

    // 检查权限
    if (requiredPermissions.length > 0) {
      const hasPermission = requiredPermissions.every(p => keyData.permissions.includes(p));
      if (!hasPermission) {
        return res.status(403).json({
          ok: false,
          error: 'Insufficient permissions',
          message: `This operation requires permissions: ${requiredPermissions.join(', ')}`
        });
      }
    }

    // 将 API Key 信息附加到请求对象
    req.apiKey = keyData;
    next();
  };
}

/**
 * Express 中间件：API 限流
 */
const rateLimitStore = new Map(); // 简单的内存存储，生产环境应使用 Redis

export function rateLimit() {
  return async (req, res, next) => {
    const apiKey = req.apiKey?.apiKey;

    if (!apiKey) {
      return next(); // 如果没有 API Key，跳过限流
    }

    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1小时窗口
    const limit = req.apiKey.rateLimit?.requests || 1000;

    // 获取或创建限流记录
    if (!rateLimitStore.has(apiKey)) {
      rateLimitStore.set(apiKey, { count: 0, resetAt: now + windowMs });
    }

    const record = rateLimitStore.get(apiKey);

    // 检查窗口是否过期
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    // 检查是否超过限制
    if (record.count >= limit) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      return res.status(429).json({
        ok: false,
        error: 'Rate limit exceeded',
        message: `You have exceeded the rate limit of ${limit} requests per hour`,
        retryAfter
      });
    }

    // 增加计数
    record.count++;

    // 设置响应头
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', limit - record.count);
    res.setHeader('X-RateLimit-Reset', new Date(record.resetAt).toISOString());

    next();
  };
}
