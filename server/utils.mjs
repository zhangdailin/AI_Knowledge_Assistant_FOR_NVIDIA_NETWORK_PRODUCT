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
 * 计算两个向量的余弦相似度（性能优化版）
 * 使用循环展开和数学优化减少计算开销
 * @param {number[]|Float32Array|Float64Array} vecA - 向量A
 * @param {number[]|Float32Array|Float64Array} vecB - 向量B
 * @param {number} [precomputedNormA] - 预计算的向量A范数（可选，用于批量计算）
 * @returns {number} 余弦相似度 (0-1)
 */
export function cosineSimilarity(vecA, vecB, precomputedNormA = 0) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

    const len = vecA.length;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    // 循环展开：每次处理4个元素，减少循环开销
    const limit = len - (len % 4);
    let i = 0;

    for (; i < limit; i += 4) {
        const a0 = vecA[i], a1 = vecA[i + 1], a2 = vecA[i + 2], a3 = vecA[i + 3];
        const b0 = vecB[i], b1 = vecB[i + 1], b2 = vecB[i + 2], b3 = vecB[i + 3];

        dotProduct += a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
        normA += a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
        normB += b0 * b0 + b1 * b1 + b2 * b2 + b3 * b3;
    }

    // 处理剩余元素
    for (; i < len; i++) {
        const a = vecA[i], b = vecB[i];
        dotProduct += a * b;
        normA += a * a;
        normB += b * b;
    }

    // 如果提供了预计算的范数A，使用它（批量计算优化）
    const finalNormA = precomputedNormA > 0 ? precomputedNormA * precomputedNormA : normA;

    // 数学优化：sqrt(a) * sqrt(b) = sqrt(a * b)
    const denominator = Math.sqrt(finalNormA * normB);
    return denominator > 0 ? dotProduct / denominator : 0;
}

/**
 * 计算向量范数（用于批量相似度计算的预处理）
 * @param {number[]|Float32Array|Float64Array} vec - 向量
 * @returns {number} 向量的L2范数
 */
export function vectorNorm(vec) {
    if (!vec || vec.length === 0) return 0;

    let sum = 0;
    const len = vec.length;
    const limit = len - (len % 4);
    let i = 0;

    for (; i < limit; i += 4) {
        const a0 = vec[i], a1 = vec[i + 1], a2 = vec[i + 2], a3 = vec[i + 3];
        sum += a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
    }

    for (; i < len; i++) {
        sum += vec[i] * vec[i];
    }

    return Math.sqrt(sum);
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
