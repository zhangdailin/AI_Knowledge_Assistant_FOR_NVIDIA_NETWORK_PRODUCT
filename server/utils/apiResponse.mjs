/**
 * API 响应和错误处理工具类
 */

export class ApiResponse {
  /**
   * 成功响应
   */
  static success(res, data = {}, statusCode = 200) {
    return res.status(statusCode).json({
      ok: true,
      ...data
    });
  }

  /**
   * 错误响应
   */
  static error(res, statusCode = 500, code = 'INTERNAL_ERROR', message = '内部服务器错误') {
    return res.status(statusCode).json({
      ok: false,
      error: code,
      message
    });
  }

  /**
   * 400 Bad Request
   */
  static badRequest(res, field) {
    return this.error(res, 400, 'BAD_REQUEST', `缺少或无效的参数: ${field}`);
  }

  /**
   * 404 Not Found
   */
  static notFound(res, resource = '资源') {
    return this.error(res, 404, 'NOT_FOUND', `${resource}不存在`);
  }

  /**
   * 401 Unauthorized
   */
  static unauthorized(res, message = '未授权') {
    return this.error(res, 401, 'UNAUTHORIZED', message);
  }

  /**
   * 403 Forbidden
   */
  static forbidden(res, message = '无权访问此资源') {
    return this.error(res, 403, 'FORBIDDEN', message);
  }

  /**
   * 500 Internal Server Error
   */
  static internalError(res, message = '内部服务器错误') {
    return this.error(res, 500, 'INTERNAL_ERROR', message);
  }

  /**
   * 验证失败
   */
  static validationError(res, errors = {}) {
    return res.status(400).json({
      ok: false,
      error: 'VALIDATION_ERROR',
      message: '请求数据验证失败',
      details: errors
    });
  }
}

/**
 * 异步路由包装器 - 自动处理未捕获的异常
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 参数验证助手
 */
export class RequestValidator {
  static requireFields(req, fields = []) {
    const missing = fields.filter(f => !req.body[f] && req.body[f] !== 0);
    if (missing.length > 0) {
      throw new ValidationError(`缺少必需字段: ${missing.join(', ')}`);
    }
  }

  static requireParam(req, param) {
    if (!req.params[param]) {
      throw new ValidationError(`缺少路径参数: ${param}`);
    }
  }

  static requireQuery(req, query) {
    if (!req.query[query]) {
      throw new ValidationError(`缺少查询参数: ${query}`);
    }
  }
}

/**
 * 自定义错误类
 */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

export class NotFoundError extends Error {
  constructor(resource = '资源') {
    super(`${resource}不存在`);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class AuthError extends Error {
  constructor(message = '未授权') {
    super(message);
    this.name = 'AuthError';
    this.statusCode = 401;
  }
}
