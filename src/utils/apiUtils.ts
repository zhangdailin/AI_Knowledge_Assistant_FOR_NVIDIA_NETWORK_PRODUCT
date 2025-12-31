/**
 * API 工具函数
 * 提供统一的 API 服务器 URL 管理功能
 */

/**
 * 获取 API 服务器 URL
 * 优先级: localStorage 自定义 URL > 环境变量 > 默认 URL
 *
 * @returns {string} API 服务器的完整 URL
 */
export function getApiServerUrl(): string {
  // 1. 优先使用用户在前端设置的自定义地址
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('custom_api_server_url');
    if (customUrl) return customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
  }

  // 2. 其次使用环境变量
  const envUrl = import.meta.env.VITE_API_SERVER_URL;
  if (envUrl) {
    return envUrl.endsWith('/') ? envUrl.slice(0, -1) : envUrl;
  }

  // 3. 如果没有环境变量，使用当前页面的 hostname 和默认端口
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = '8787'; // 默认服务器端口
    return `${protocol}//${hostname}:${port}`;
  }

  // 作为最后的备选方案，返回一个默认值
  return 'http://localhost:8787';
}

/**
 * 统一的 API 客户端
 * 提供标准化的请求处理和错误处理
 */
export class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getApiServerUrl();
  }

  /**
   * 发送 GET 请求
   */
  async get<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      method: 'GET',
      ...options
    });

    return this.handleResponse<T>(response);
  }

  /**
   * 发送 POST 请求
   */
  async post<T = any>(endpoint: string, data?: any, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: data ? JSON.stringify(data) : undefined,
      ...options
    });

    return this.handleResponse<T>(response);
  }

  /**
   * 处理 API 响应
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `API 请求失败: ${response.status} ${response.statusText}`);
    }

    // 对于某些 API，可能没有返回 JSON 数据
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }

    // 如果不是 JSON 响应，返回文本
    return await response.text() as unknown as T;
  }

  /**
   * 更新基础 URL
   */
  setBaseUrl(url: string): void {
    this.baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  }
}

// 创建全局 API 客户端实例
export const apiClient = new ApiClient();