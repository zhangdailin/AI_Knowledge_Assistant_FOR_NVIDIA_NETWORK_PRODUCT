/**
 * 统一错误处理和分类模块
 * 提供清晰的错误分类和用户友好的错误消息
 */

export enum ErrorType {
  API_KEY_MISSING = 'API_KEY_MISSING',
  API_TIMEOUT = 'API_TIMEOUT',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  RATE_LIMIT = 'RATE_LIMIT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  STORAGE_FULL = 'STORAGE_FULL',
  UNKNOWN = 'UNKNOWN'
}

export interface AppError extends Error {
  type: ErrorType;
  retryable: boolean;
  userMessage: string;
  originalError?: any;
}

/**
 * 分类错误并返回用户友好的消息
 */
export function classifyError(error: any): AppError {
  const message = error.message || String(error);

  // API密钥缺失
  if (message.includes('API密钥') || message.includes('api key') || message.includes('401')) {
    return {
      name: 'AppError',
      message,
      type: ErrorType.API_KEY_MISSING,
      retryable: false,
      userMessage: '❌ API密钥未配置或已过期，请在设置中更新',
      originalError: error
    };
  }

  // 超时错误
  if (message.includes('超时') || message.includes('timeout') || message.includes('AbortError')) {
    return {
      name: 'AppError',
      message,
      type: ErrorType.API_TIMEOUT,
      retryable: true,
      userMessage: '⏱️ 请求超时，系统将自动重试',
      originalError: error
    };
  }

  // 模型不存在
  if (message.includes('Model does not exist') || message.includes('404')) {
    return {
      name: 'AppError',
      message,
      type: ErrorType.MODEL_NOT_FOUND,
      retryable: true,
      userMessage: '🔄 模型暂不可用，已自动切换备用模型',
      originalError: error
    };
  }

  // 速率限制
  if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
    return {
      name: 'AppError',
      message,
      type: ErrorType.RATE_LIMIT,
      retryable: true,
      userMessage: '⚠️ 请求过于频繁，请稍候再试',
      originalError: error
    };
  }

  // 网络错误
  if (message.includes('network') || message.includes('fetch') || message.includes('ECONNREFUSED')) {
    return {
      name: 'AppError',
      message,
      type: ErrorType.NETWORK_ERROR,
      retryable: true,
      userMessage: '🌐 网络连接失败，请检查网络设置',
      originalError: error
    };
  }

  // 存储满
  if (message.includes('QuotaExceededError') || message.includes('storage')) {
    return {
      name: 'AppError',
      message,
      type: ErrorType.STORAGE_FULL,
      retryable: false,
      userMessage: '💾 本地存储已满，请清理数据后重试',
      originalError: error
    };
  }

  // 未知错误
  return {
    name: 'AppError',
    message,
    type: ErrorType.UNKNOWN,
    retryable: true,
    userMessage: '❓ 发生未知错误，请重试或联系支持',
    originalError: error
  };
}

/**
 * 获取错误恢复建议
 */
export function getErrorRecoveryAdvice(error: AppError): string {
  switch (error.type) {
    case ErrorType.API_KEY_MISSING:
      return '请在设置中配置有效的API密钥';
    case ErrorType.API_TIMEOUT:
      return '网络可能较慢，请稍候后重试';
    case ErrorType.MODEL_NOT_FOUND:
      return '系统已自动切换到备用模型，请重新发送问题';
    case ErrorType.RATE_LIMIT:
      return '请等待几秒钟后再发送新问题';
    case ErrorType.NETWORK_ERROR:
      return '请检查网络连接，然后重试';
    case ErrorType.STORAGE_FULL:
      return '请清理浏览器缓存或删除旧的对话记录';
    default:
      return '请重试或刷新页面';
  }
}

/**
 * 错误处理器类
 */
export class ErrorHandler {
  private errorLog: AppError[] = [];
  private readonly MAX_LOG_SIZE = 100;

  /**
   * 处理错误
   */
  handle(error: any): AppError {
    const appError = classifyError(error);
    this.logError(appError);
    return appError;
  }

  /**
   * 记录错误
   */
  private logError(error: AppError): void {
    this.errorLog.push(error);
    if (this.errorLog.length > this.MAX_LOG_SIZE) {
      this.errorLog.shift();
    }
    console.error(`[${error.type}] ${error.message}`);
  }

  /**
   * 获取错误日志
   */
  getErrorLog(): AppError[] {
    return [...this.errorLog];
  }

  /**
   * 获取错误统计
   */
  getErrorStats(): Record<ErrorType, number> {
    const stats: Record<ErrorType, number> = {
      [ErrorType.API_KEY_MISSING]: 0,
      [ErrorType.API_TIMEOUT]: 0,
      [ErrorType.MODEL_NOT_FOUND]: 0,
      [ErrorType.RATE_LIMIT]: 0,
      [ErrorType.NETWORK_ERROR]: 0,
      [ErrorType.STORAGE_FULL]: 0,
      [ErrorType.UNKNOWN]: 0
    };

    for (const error of this.errorLog) {
      stats[error.type]++;
    }

    return stats;
  }

  /**
   * 清空错误日志
   */
  clearLog(): void {
    this.errorLog = [];
  }
}

// 全局错误处理器实例
export const errorHandler = new ErrorHandler();
