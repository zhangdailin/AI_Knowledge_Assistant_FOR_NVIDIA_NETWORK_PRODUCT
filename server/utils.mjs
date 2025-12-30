/**
 * 服务器端工具函数
 * 提供通用的错误处理、日志记录等功能
 */

/**
 * 异步路由处理器包装函数
 * 统一处理 Express 路由中的 async/await 错误
 * 
 * @param {Function} fn - 异步路由处理函数
 * @returns {Function} - 包装后的路由处理函数
 * 
 * @example
 * // 使用前
 * app.get('/api/data', async (req, res) => {
 *   try {
 *     const data = await fetchData();
 *     res.json({ ok: true, data });
 *   } catch (error) {
 *     console.error('获取数据失败:', error);
 *     res.status(500).json({ ok: false, error: '获取数据失败' });
 *   }
 * });
 * 
 * // 使用后
 * app.get('/api/data', asyncHandler(async (req, res) => {
 *   const data = await fetchData();
 *   res.json({ ok: true, data });
 * }, '获取数据'));
 */
export function asyncHandler(fn, operationName = '操作') {
    return async (req, res, next) => {
        try {
            await fn(req, res, next);
        } catch (error) {
            console.error(`${operationName}失败:`, error);

            // 如果响应已发送，交给 Express 默认错误处理
            if (res.headersSent) {
                return next(error);
            }

            // 根据错误类型返回不同状态码
            const statusCode = error.statusCode || 500;
            const errorMessage = error.userMessage || `${operationName}失败`;

            res.status(statusCode).json({
                ok: false,
                error: errorMessage,
                ...(process.env.NODE_ENV === 'development' && { detail: error.message })
            });
        }
    };
}

/**
 * 创建带有状态码的错误
 * @param {string} message - 错误消息
 * @param {number} statusCode - HTTP 状态码
 * @param {string} userMessage - 用户友好的错误消息
 */
export function createError(message, statusCode = 500, userMessage = null) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.userMessage = userMessage || message;
    return error;
}

/**
 * 简单的 LRU 缓存实现
 * 用于缓存搜索结果等数据
 */
export class SimpleLRUCache {
    constructor(maxSize = 100, ttlMs = null) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return null;
        const entry = this.cache.get(key);
        if (this.ttlMs && Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }
        // LRU: 移动到最后
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // 删除最早的条目
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }

    setMaxSize(maxSize) {
        this.maxSize = maxSize;
        while (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
    }

    setTTL(ttlMs) {
        this.ttlMs = ttlMs;
        this.pruneExpired();
    }

    pruneExpired() {
        if (!this.ttlMs) return;
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.ttlMs) {
                this.cache.delete(key);
            }
        }
    }

    clear() {
        this.cache.clear();
    }

    get size() {
        return this.cache.size;
    }
}
