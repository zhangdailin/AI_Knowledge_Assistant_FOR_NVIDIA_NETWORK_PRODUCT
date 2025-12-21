/**
 * IndexedDB 存储管理器
 * 用于存储大量数据，提供比 localStorage 更大的存储容量
 */

interface IDBStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
  getStorageUsage(): Promise<{ used: number; available: number; percentage: number }>;
}

class IndexedDBStorage implements IDBStorage {
  private dbName: string;
  private storeName: string;
  private db: IDBDatabase | null = null;

  constructor(dbName: string, storeName: string) {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? String(result) : null);
        };
      });
    } catch (error) {
      console.error('IndexedDB getItem 失败:', error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(value, key);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('IndexedDB setItem 失败:', error);
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(key);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('IndexedDB removeItem 失败:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.clear();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('IndexedDB clear 失败:', error);
      throw error;
    }
  }

  async getStorageUsage(): Promise<{ used: number; available: number; percentage: number }> {
    try {
      const db = await this.openDB();
      let used = 0;

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.openCursor();

        request.onerror = () => reject(request.error);
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const value = cursor.value;
            if (typeof value === 'string') {
              used += value.length;
            } else if (value) {
              used += JSON.stringify(value).length;
            }
            cursor.continue();
          } else {
            // IndexedDB 通常有更大的存储限制（通常是可用磁盘空间的50%）
            // 这里使用一个保守的估计值
            const estimatedLimit = 50 * 1024 * 1024; // 50MB
            const available = Math.max(0, estimatedLimit - used);
            const percentage = (used / estimatedLimit) * 100;
            resolve({ used, available, percentage });
          }
        };
      });
    } catch (error) {
      console.error('IndexedDB getStorageUsage 失败:', error);
      return { used: 0, available: 0, percentage: 0 };
    }
  }
}

// 导出 chunks 存储实例
export const chunksIDBStorage = new IndexedDBStorage('ai_assistant_db', 'chunks');

// 导出数据存储实例（用于其他数据）
export const dataIDBStorage = new IndexedDBStorage('ai_assistant_db', 'data');

