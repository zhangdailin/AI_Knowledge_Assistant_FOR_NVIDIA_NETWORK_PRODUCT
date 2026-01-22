/**
 * Structured logging utility
 * Provides environment-aware logging with different levels
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

class Logger {
  constructor() {
    // Set log level based on environment
    const envLevel = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
    this.level = LOG_LEVELS[envLevel] ?? LOG_LEVELS.INFO;
    this.isDevelopment = process.env.NODE_ENV !== 'production';
  }

  /**
   * Format log message with timestamp and metadata
   */
  _format(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...meta
    };

    if (this.isDevelopment) {
      // Pretty print in development
      return `[${timestamp}] ${level.padEnd(5)} ${message}${
        Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : ''
      }`;
    } else {
      // JSON format in production
      return JSON.stringify(logEntry);
    }
  }

  /**
   * Sanitize sensitive data from logs
   */
  _sanitize(meta) {
    if (!meta || typeof meta !== 'object') return meta;

    const sanitized = { ...meta };
    const sensitiveKeys = ['password', 'token', 'apiKey', 'api_key', 'secret', 'authorization'];

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        sanitized[key] = '***REDACTED***';
      }
    }

    return sanitized;
  }

  debug(message, meta = {}) {
    if (this.level <= LOG_LEVELS.DEBUG) {
      console.log(this._format('DEBUG', message, this._sanitize(meta)));
    }
  }

  info(message, meta = {}) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(this._format('INFO', message, this._sanitize(meta)));
    }
  }

  warn(message, meta = {}) {
    if (this.level <= LOG_LEVELS.WARN) {
      console.warn(this._format('WARN', message, this._sanitize(meta)));
    }
  }

  error(message, meta = {}) {
    if (this.level <= LOG_LEVELS.ERROR) {
      console.error(this._format('ERROR', message, this._sanitize(meta)));
    }
  }

  /**
   * Log performance metrics
   */
  perf(operation, duration, meta = {}) {
    this.info(`Performance: ${operation}`, {
      duration_ms: duration,
      ...meta
    });
  }

  /**
   * Create a child logger with additional context
   */
  child(context) {
    const childLogger = new Logger();
    childLogger.level = this.level;
    childLogger.context = { ...this.context, ...context };

    // Override format to include context
    const originalFormat = childLogger._format.bind(childLogger);
    childLogger._format = (level, message, meta) => {
      return originalFormat(level, message, { ...childLogger.context, ...meta });
    };

    return childLogger;
  }
}

// Export singleton instance
export const logger = new Logger();

// Export for testing
export { Logger, LOG_LEVELS };
