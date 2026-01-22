/**
 * Mock 工厂 - 用于创建外部依赖的 Mock 对象
 */

import { vi } from 'vitest';

/**
 * Mock SiliconFlow Embedding API
 */
export const mockEmbeddingAPI = () => {
  return vi.fn().mockResolvedValue({
    data: [
      {
        embedding: new Array(1024).fill(0.1),
        index: 0
      }
    ],
    model: 'BAAI/bge-m3',
    usage: {
      prompt_tokens: 10,
      total_tokens: 10
    }
  });
};

/**
 * Mock SiliconFlow Reranking API
 */
export const mockRerankingAPI = () => {
  return vi.fn().mockResolvedValue({
    results: [
      { index: 0, relevance_score: 0.95 },
      { index: 1, relevance_score: 0.85 },
      { index: 2, relevance_score: 0.75 }
    ],
    model: 'BAAI/bge-reranker-v2-m3'
  });
};

/**
 * Mock Neo4j Driver
 */
export const mockNeo4jDriver = () => {
  const mockRecords = vi.fn().mockReturnValue([]);
  const mockRun = vi.fn().mockResolvedValue({ records: mockRecords() });
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const mockSession = vi.fn(() => ({
    run: mockRun,
    close: mockClose
  }));

  return {
    driver: {
      session: mockSession,
      verifyConnectivity: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined)
    },
    session: mockSession(),
    mockRun,
    mockRecords,
    mockClose
  };
};

/**
 * Mock File System (fs/promises)
 */
export const mockFileSystem = () => {
  const files = new Map<string, string>();

  return {
    files,
    readFile: vi.fn((path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        return Promise.reject(new Error(`ENOENT: no such file or directory, open '${path}'`));
      }
      return Promise.resolve(content);
    }),
    writeFile: vi.fn((path: string, data: string) => {
      files.set(path, data);
      return Promise.resolve();
    }),
    unlink: vi.fn((path: string) => {
      files.delete(path);
      return Promise.resolve();
    }),
    mkdir: vi.fn(() => Promise.resolve()),
    access: vi.fn((path: string) => {
      if (files.has(path)) {
        return Promise.resolve();
      }
      return Promise.reject(new Error(`ENOENT: no such file or directory, access '${path}'`));
    }),
    rename: vi.fn((oldPath: string, newPath: string) => {
      const content = files.get(oldPath);
      if (content !== undefined) {
        files.set(newPath, content);
        files.delete(oldPath);
      }
      return Promise.resolve();
    })
  };
};

/**
 * Mock Fetch API
 */
export const mockFetch = () => {
  return vi.fn((url: string, options?: any) => {
    // 默认成功响应
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, data: {} }),
      text: () => Promise.resolve(''),
      headers: new Headers()
    });
  });
};

/**
 * Mock WebSocket
 */
export const mockWebSocket = () => {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();

  const ws = {
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: (...args: any[]) => void) => {
      const handlers = listeners.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    }),
    readyState: 1, // OPEN
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3
  };

  // 辅助方法：触发事件
  const trigger = (event: string, data?: any) => {
    const handlers = listeners.get(event);
    if (handlers) {
      handlers.forEach((handler: (...args: any[]) => void) => handler(data));
    }
  };

  return { ws, trigger, listeners };
};

/**
 * Mock LocalStorage
 */
export const mockLocalStorage = () => {
  const storage = new Map<string, string>();

  return {
    storage,
    getItem: vi.fn((key: string) => storage.get(key) || null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    get length() {
      return storage.size;
    },
    key: vi.fn((index: number) => {
      const keys = Array.from(storage.keys());
      return keys[index] || null;
    })
  };
};

/**
 * Mock Console (用于测试日志输出)
 */
export const mockConsole = () => {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  };
};

/**
 * Mock Timer (用于测试时间相关功能)
 */
export const mockTimer = () => {
  return {
    setTimeout: vi.fn((callback: () => void, delay: number) => {
      return setTimeout(callback, delay);
    }),
    clearTimeout: vi.fn((id: any) => {
      clearTimeout(id);
    }),
    setInterval: vi.fn((callback: () => void, delay: number) => {
      return setInterval(callback, delay);
    }),
    clearInterval: vi.fn((id: any) => {
      clearInterval(id);
    })
  };
};

/**
 * Mock Date (用于测试时间戳)
 */
export const mockDate = (timestamp: number = Date.now()) => {
  const OriginalDate = Date;
  const MockDate = class extends OriginalDate {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(timestamp);
      } else {
        super(...args);
      }
    }

    static now() {
      return timestamp;
    }
  };

  return MockDate as any;
};

/**
 * 创建 Mock Storage 模块
 */
export const createMockStorage = () => {
  const documents = new Map();
  const chunks = new Map();
  const settings = {};

  return {
    getAllDocuments: vi.fn(() => Promise.resolve(Array.from(documents.values()))),
    getDocument: vi.fn((id: string) => Promise.resolve(documents.get(id) || null)),
    createDocument: vi.fn((doc: any) => {
      documents.set(doc.id, doc);
      return Promise.resolve(doc);
    }),
    updateDocument: vi.fn((id: string, updates: any) => {
      const doc = documents.get(id);
      if (doc) {
        const updated = { ...doc, ...updates };
        documents.set(id, updated);
        return Promise.resolve(updated);
      }
      return Promise.resolve(null);
    }),
    deleteDocument: vi.fn((id: string) => {
      documents.delete(id);
      chunks.delete(id);
      return Promise.resolve(true);
    }),
    getChunks: vi.fn((docId: string) => Promise.resolve(chunks.get(docId) || [])),
    createChunk: vi.fn((chunk: any) => {
      const docChunks = chunks.get(chunk.documentId) || [];
      docChunks.push(chunk);
      chunks.set(chunk.documentId, docChunks);
      return Promise.resolve(chunk);
    }),
    getSettings: vi.fn(() => Promise.resolve(settings)),
    updateSettings: vi.fn((newSettings: any) => {
      Object.assign(settings, newSettings);
      return Promise.resolve(settings);
    }),
    vectorSearchChunks: vi.fn(() => Promise.resolve([])),
    searchChunks: vi.fn(() => Promise.resolve([]))
  };
};

/**
 * 创建 Mock Embedding 模块
 */
export const createMockEmbedding = () => {
  return {
    embedText: vi.fn((text: string) =>
      Promise.resolve(new Array(1024).fill(0.1))
    ),
    embedTexts: vi.fn((texts: string[]) =>
      Promise.resolve(texts.map(() => new Array(1024).fill(0.1)))
    ),
    rerankDocuments: vi.fn((query: string, docs: any[], topN: number) =>
      Promise.resolve(docs.slice(0, topN).map((doc, i) => ({
        ...doc,
        score: 0.9 - i * 0.1
      })))
    )
  };
};

/**
 * 重置所有 Mocks
 */
export const resetAllMocks = () => {
  vi.clearAllMocks();
  vi.resetAllMocks();
};
