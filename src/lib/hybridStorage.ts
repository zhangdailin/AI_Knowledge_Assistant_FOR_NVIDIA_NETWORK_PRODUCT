/**
 * 混合存储管理器
 * 自动在 localStorage 和 IndexedDB 之间切换
 * 当 localStorage 空间不足时，自动使用 IndexedDB
 */

import { chunksIDBStorage, dataIDBStorage } from './indexedDBStorage';

type StorageType = 'localStorage' | 'indexedDB';

class HybridStorage {
  private storageType: StorageType = 'localStorage';
  private useIndexedDBForChunks: boolean = false;

  constructor() {
    // 检查是否应该使用 IndexedDB
    this.checkStorageCapacity();
  }

  // 检查存储容量，决定使用哪种存储方式
  private async checkStorageCapacity(): Promise<void> {
    try {
      // 检查 localStorage 使用情况
      let used = 0;
      const keys = ['ai_assistant_chunks'];
      keys.forEach(key => {
        const item = localStorage.getItem(key);
        if (item) {
          used += item.length;
        }
      });

      // 如果 localStorage 使用超过 3MB，切换到 IndexedDB
      const threshold = 3 * 1024 * 1024; // 3MB
      if (used > threshold) {
        this.useIndexedDBForChunks = true;
        console.log('localStorage 使用量超过阈值，切换到 IndexedDB 存储 chunks');
      }
    } catch (error) {
      console.error('检查存储容量失败:', error);
    }
  }

  // 获取数据（自动选择存储方式）
  async getItem(key: string, useIndexedDB: boolean = false): Promise<string | null> {
    if (useIndexedDB || (key === 'ai_assistant_chunks' && this.useIndexedDBForChunks)) {
      try {
        return await chunksIDBStorage.getItem(key);
      } catch (error) {
        console.warn('IndexedDB 获取失败，回退到 localStorage:', error);
        return localStorage.getItem(key);
      }
    }
    return localStorage.getItem(key);
  }

  // 设置数据（自动选择存储方式）
  async setItem(key: string, value: string, useIndexedDB: boolean = false): Promise<void> {
    if (useIndexedDB || (key === 'ai_assistant_chunks' && this.useIndexedDBForChunks)) {
      try {
        await chunksIDBStorage.setItem(key, value);
        return;
      } catch (error) {
        console.warn('IndexedDB 保存失败，回退到 localStorage:', error);
        // 如果 IndexedDB 失败，尝试 localStorage
      }
    }

    try {
      localStorage.setItem(key, value);
    } catch (error: any) {
      // 如果 localStorage 空间不足，尝试切换到 IndexedDB
      if (error.name === 'QuotaExceededError' && key === 'ai_assistant_chunks') {
        console.warn('localStorage 空间不足，切换到 IndexedDB');
        this.useIndexedDBForChunks = true;
        try {
          await chunksIDBStorage.setItem(key, value);
        } catch (idbError) {
          throw new Error('存储空间不足，无法保存数据');
        }
      } else {
        throw error;
      }
    }
  }

  // 删除数据
  async removeItem(key: string, useIndexedDB: boolean = false): Promise<void> {
    if (useIndexedDB || (key === 'ai_assistant_chunks' && this.useIndexedDBForChunks)) {
      try {
        await chunksIDBStorage.removeItem(key);
      } catch (error) {
        console.warn('IndexedDB 删除失败，尝试 localStorage:', error);
      }
    }
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('删除数据失败:', error);
    }
  }

  // 清空所有数据
  async clear(useIndexedDB: boolean = false): Promise<void> {
    if (useIndexedDB || this.useIndexedDBForChunks) {
      try {
        await chunksIDBStorage.clear();
      } catch (error) {
        console.warn('IndexedDB 清空失败:', error);
      }
    }
    try {
      localStorage.clear();
    } catch (error) {
      console.warn('清空数据失败:', error);
    }
  }

  // 获取存储使用情况
  async getStorageUsage(): Promise<{ used: number; available: number; percentage: number; type: StorageType }> {
    if (this.useIndexedDBForChunks) {
      const usage = await chunksIDBStorage.getStorageUsage();
      return { ...usage, type: 'indexedDB' };
    }

    let used = 0;
    const keys = ['ai_assistant_chunks'];
    keys.forEach(key => {
      const item = localStorage.getItem(key);
      if (item) {
        used += item.length;
      }
    });

    const estimatedLimit = 5 * 1024 * 1024; // 5MB
    const available = Math.max(0, estimatedLimit - used);
    const percentage = (used / estimatedLimit) * 100;

    return { used, available, percentage, type: 'localStorage' };
  }

  // 强制使用 IndexedDB
}

export const hybridStorage = new HybridStorage();

