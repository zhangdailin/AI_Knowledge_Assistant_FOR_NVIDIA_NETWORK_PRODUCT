/**
 * Cache Management and LRU Eviction Unit Tests
 * Tests for both chunk cache and search cache with LRU eviction
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Cache Management Unit Tests', () => {
  describe('1. LRU Cache Implementation', () => {
    class LRUCache<K, V> {
      private cache = new Map<K, V>();
      private maxSize: number;

      constructor(maxSize: number) {
        this.maxSize = maxSize;
      }

      get(key: K): V | undefined {
        if (!this.cache.has(key)) return undefined;

        // Move to end (most recently used)
        const value = this.cache.get(key)!;
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
      }

      set(key: K, value: V): void {
        if (this.cache.has(key)) {
          this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
          // Delete oldest (first)
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
      }

      has(key: K): boolean {
        return this.cache.has(key);
      }

      delete(key: K): boolean {
        return this.cache.delete(key);
      }

      clear(): void {
        this.cache.clear();
      }

      size(): number {
        return this.cache.size;
      }

      keys(): IterableIterator<K> {
        return this.cache.keys();
      }
    }

    it('should evict least recently used item when cache is full', () => {
      const cache = new LRUCache<string, string>(3);

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      expect(cache.size()).toBe(3);

      // Add 4th item, should evict 'a'
      cache.set('d', '4');
      expect(cache.size()).toBe(3);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('d')).toBe('4');
    });

    it('should update access order on get', () => {
      const cache = new LRUCache<string, string>(3);

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      // Access 'a' to make it most recently used
      cache.get('a');

      // Add new item, should evict 'b' (least recently used)
      cache.set('d', '4');
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe('1');
      expect(cache.get('c')).toBe('3');
      expect(cache.get('d')).toBe('4');
    });

    it('should update value and access order on duplicate set', () => {
      const cache = new LRUCache<string, string>(3);

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      // Update 'a'
      cache.set('a', '1-updated');
      expect(cache.size()).toBe(3);

      // Add new item, should evict 'b'
      cache.set('d', '4');
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe('1-updated');
    });

    it('should handle cache size of 1', () => {
      const cache = new LRUCache<string, string>(1);

      cache.set('a', '1');
      expect(cache.get('a')).toBe('1');

      cache.set('b', '2');
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe('2');
    });

    it('should support manual deletion', () => {
      const cache = new LRUCache<string, string>(3);

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      expect(cache.delete('b')).toBe(true);
      expect(cache.size()).toBe(2);
      expect(cache.get('b')).toBeUndefined();
    });

    it('should support clear operation', () => {
      const cache = new LRUCache<string, string>(3);

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });

    it('should maintain correct order after multiple operations', () => {
      const cache = new LRUCache<string, number>(4);

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4);

      // Access order: d, c, b, a (newest to oldest)
      cache.get('b'); // b is now newest
      cache.get('a'); // a is now newest

      // Access order: a, b, d, c
      cache.set('e', 5); // should evict 'c'

      expect(cache.get('c')).toBeUndefined();
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('d')).toBe(4);
      expect(cache.get('e')).toBe(5);
    });
  });

  describe('2. TTL-based Cache Eviction', () => {
    interface CacheEntry<V> {
      data: V;
      timestamp: number;
    }

    class TTLCache<K, V> {
      private cache = new Map<K, CacheEntry<V>>();
      private ttl: number;
      private maxEntries: number;

      constructor(ttl: number, maxEntries: number = 100) {
        this.ttl = ttl;
        this.maxEntries = maxEntries;
      }

      set(key: K, value: V): void {
        this.pruneExpired();

        // LRU eviction if at max capacity
        if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }

        this.cache.delete(key); // Remove old entry to update position
        this.cache.set(key, { data: value, timestamp: Date.now() });
      }

      get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        const now = Date.now();
        if (now - entry.timestamp > this.ttl) {
          this.cache.delete(key);
          return undefined;
        }

        // Move to end (LRU)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.data;
      }

      pruneExpired(now = Date.now()): void {
        for (const [key, entry] of this.cache.entries()) {
          if (now - entry.timestamp > this.ttl) {
            this.cache.delete(key);
          }
        }
      }

      size(): number {
        return this.cache.size;
      }
    }

    it('should evict expired entries on get', () => {
      const cache = new TTLCache<string, string>(100, 10); // 100ms TTL

      cache.set('a', '1');
      expect(cache.get('a')).toBe('1');

      // Wait for expiration
      vi.useFakeTimers();
      vi.advanceTimersByTime(150);

      expect(cache.get('a')).toBeUndefined();

      vi.useRealTimers();
    });

    it('should prune expired entries', () => {
      vi.useFakeTimers();
      const cache = new TTLCache<string, string>(100, 10);

      cache.set('a', '1');
      cache.set('b', '2');
      expect(cache.size()).toBe(2);

      vi.advanceTimersByTime(150);
      cache.pruneExpired();

      expect(cache.size()).toBe(0);

      vi.useRealTimers();
    });

    it('should combine TTL and LRU eviction', () => {
      const cache = new TTLCache<string, string>(1000, 3); // Long TTL, small max

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      expect(cache.size()).toBe(3);

      // LRU eviction (not TTL)
      cache.set('d', '4');
      expect(cache.size()).toBe(3);
      expect(cache.get('a')).toBeUndefined();
    });

    it('should refresh timestamp on set for existing key', () => {
      vi.useFakeTimers();
      const cache = new TTLCache<string, string>(100, 10);

      cache.set('a', '1');
      vi.advanceTimersByTime(50);

      cache.set('a', '1-updated'); // Refresh timestamp
      vi.advanceTimersByTime(60); // Total 110ms from first set, but only 60ms from update

      expect(cache.get('a')).toBe('1-updated');

      vi.useRealTimers();
    });
  });

  describe('3. Search Cache with Exact and Semantic Matching', () => {
    interface SemanticCacheEntry {
      query: string;
      queryEmbedding: number[];
      results: any[];
      timestamp: number;
    }

    class SearchCache {
      private exactCache = new Map<string, any[]>();
      private semanticCache: SemanticCacheEntry[] = [];
      private maxExactEntries = 100;
      private maxSemanticEntries = 50;
      private semanticThreshold = 0.85;

      private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
          dotProduct += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }

        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom > 0 ? dotProduct / denom : 0;
      }

      setExact(key: string, results: any[]): void {
        // LRU eviction
        if (this.exactCache.size >= this.maxExactEntries && !this.exactCache.has(key)) {
          const firstKey = this.exactCache.keys().next().value;
          this.exactCache.delete(firstKey);
        }

        this.exactCache.delete(key);
        this.exactCache.set(key, results);
      }

      getExact(key: string): any[] | null {
        const results = this.exactCache.get(key);
        if (!results) return null;

        // Move to end (LRU)
        this.exactCache.delete(key);
        this.exactCache.set(key, results);
        return results;
      }

      setSemantic(query: string, queryEmbedding: number[], results: any[]): void {
        // LRU eviction
        if (this.semanticCache.length >= this.maxSemanticEntries) {
          this.semanticCache.shift();
        }

        this.semanticCache.push({
          query,
          queryEmbedding,
          results,
          timestamp: Date.now()
        });
      }

      getSemantic(queryEmbedding: number[]): { query: string; results: any[]; similarity: number } | null {
        for (const entry of this.semanticCache) {
          const similarity = this.cosineSimilarity(queryEmbedding, entry.queryEmbedding);
          if (similarity >= this.semanticThreshold) {
            return {
              query: entry.query,
              results: entry.results,
              similarity
            };
          }
        }
        return null;
      }

      invalidate(reason: string): void {
        this.exactCache.clear();
        this.semanticCache = [];
      }

      getStats() {
        return {
          exactCacheSize: this.exactCache.size,
          semanticCacheSize: this.semanticCache.length
        };
      }
    }

    it('should cache exact matches', () => {
      const cache = new SearchCache();
      const results = [{ id: 'doc1', content: 'test' }];

      cache.setExact('test query', results);
      expect(cache.getExact('test query')).toEqual(results);
    });

    it('should return null for cache miss', () => {
      const cache = new SearchCache();

      expect(cache.getExact('nonexistent')).toBeNull();
    });

    it('should match semantically similar queries', () => {
      const cache = new SearchCache();
      const query1Embedding = [1, 0, 0];
      const query2Embedding = [0.95, 0.1, 0.05]; // Similar
      const results = [{ id: 'doc1', content: 'test' }];

      cache.setSemantic('query1', query1Embedding, results);

      const match = cache.getSemantic(query2Embedding);
      expect(match).not.toBeNull();
      expect(match?.results).toEqual(results);
      expect(match?.similarity).toBeGreaterThan(0.85);
    });

    it('should not match semantically different queries', () => {
      const cache = new SearchCache();
      const query1Embedding = [1, 0, 0];
      const query2Embedding = [0, 1, 0]; // Orthogonal
      const results = [{ id: 'doc1', content: 'test' }];

      cache.setSemantic('query1', query1Embedding, results);

      const match = cache.getSemantic(query2Embedding);
      expect(match).toBeNull();
    });

    it('should evict old exact cache entries', () => {
      const cache = new SearchCache();
      cache['maxExactEntries'] = 3;

      cache.setExact('a', [{ id: 'a' }]);
      cache.setExact('b', [{ id: 'b' }]);
      cache.setExact('c', [{ id: 'c' }]);
      cache.setExact('d', [{ id: 'd' }]);

      expect(cache.getExact('a')).toBeNull();
      expect(cache.getExact('d')).not.toBeNull();
    });

    it('should evict old semantic cache entries', () => {
      const cache = new SearchCache();
      cache['maxSemanticEntries'] = 2;

      cache.setSemantic('q1', [1, 0], [{ id: '1' }]);
      cache.setSemantic('q2', [0, 1], [{ id: '2' }]);
      cache.setSemantic('q3', [1, 1], [{ id: '3' }]);

      // First entry should be evicted
      expect(cache.getSemantic([1, 0])).toBeNull();
      expect(cache.getSemantic([1, 1])).not.toBeNull();
    });

    it('should invalidate all caches', () => {
      const cache = new SearchCache();

      cache.setExact('query1', [{ id: '1' }]);
      cache.setSemantic('query2', [1, 0], [{ id: '2' }]);

      cache.invalidate('test');

      expect(cache.getStats()).toEqual({
        exactCacheSize: 0,
        semanticCacheSize: 0
      });
    });

    it('should update LRU order on exact cache hit', () => {
      const cache = new SearchCache();
      cache['maxExactEntries'] = 3;

      cache.setExact('a', [{ id: 'a' }]);
      cache.setExact('b', [{ id: 'b' }]);
      cache.setExact('c', [{ id: 'c' }]);

      // Access 'a' to make it most recently used
      cache.getExact('a');

      // Add new entry, should evict 'b'
      cache.setExact('d', [{ id: 'd' }]);

      expect(cache.getExact('a')).not.toBeNull();
      expect(cache.getExact('b')).toBeNull();
    });
  });

  describe('4. Chunk File Cache', () => {
    interface ChunkCacheEntry {
      data: any[];
      timestamp: number;
    }

    class ChunkFileCache {
      private cache = new Map<string, ChunkCacheEntry>();
      private ttl: number;
      private maxEntries: number;

      constructor(ttl: number, maxEntries: number) {
        this.ttl = ttl;
        this.maxEntries = maxEntries;
      }

      get(file: string): any[] | null {
        const cached = this.cache.get(file);
        if (!cached) return null;

        const now = Date.now();
        if (now - cached.timestamp > this.ttl) {
          this.cache.delete(file);
          return null;
        }

        // Move to end (LRU)
        this.cache.delete(file);
        this.cache.set(file, cached);
        return cached.data;
      }

      set(file: string, data: any[]): void {
        this.pruneExpired();

        // LRU eviction
        if (this.cache.size >= this.maxEntries && !this.cache.has(file)) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }

        this.cache.delete(file);
        this.cache.set(file, { data, timestamp: Date.now() });
      }

      invalidate(file: string): void {
        this.cache.delete(file);
      }

      pruneExpired(now = Date.now()): void {
        for (const [key, entry] of this.cache.entries()) {
          if (now - entry.timestamp > this.ttl) {
            this.cache.delete(key);
          }
        }

        // Additional LRU enforcement
        while (this.cache.size > this.maxEntries) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
      }

      size(): number {
        return this.cache.size;
      }
    }

    it('should cache chunk file data', () => {
      const cache = new ChunkFileCache(60000, 50);
      const chunks = [{ id: 'chunk1', content: 'test' }];

      cache.set('doc1.json', chunks);
      expect(cache.get('doc1.json')).toEqual(chunks);
    });

    it('should invalidate specific file', () => {
      const cache = new ChunkFileCache(60000, 50);
      const chunks = [{ id: 'chunk1', content: 'test' }];

      cache.set('doc1.json', chunks);
      cache.invalidate('doc1.json');

      expect(cache.get('doc1.json')).toBeNull();
    });

    it('should prune expired entries', () => {
      vi.useFakeTimers();
      const cache = new ChunkFileCache(1000, 50);

      cache.set('doc1.json', [{ id: '1' }]);
      cache.set('doc2.json', [{ id: '2' }]);

      vi.advanceTimersByTime(1500);
      cache.pruneExpired();

      expect(cache.size()).toBe(0);

      vi.useRealTimers();
    });

    it('should enforce max entries with LRU', () => {
      const cache = new ChunkFileCache(60000, 3);

      cache.set('file1.json', [{ id: '1' }]);
      cache.set('file2.json', [{ id: '2' }]);
      cache.set('file3.json', [{ id: '3' }]);
      cache.set('file4.json', [{ id: '4' }]);

      expect(cache.size()).toBe(3);
      expect(cache.get('file1.json')).toBeNull();
      expect(cache.get('file4.json')).not.toBeNull();
    });

    it('should update LRU order on access', () => {
      const cache = new ChunkFileCache(60000, 3);

      cache.set('file1.json', [{ id: '1' }]);
      cache.set('file2.json', [{ id: '2' }]);
      cache.set('file3.json', [{ id: '3' }]);

      // Access file1
      cache.get('file1.json');

      // Add file4, should evict file2
      cache.set('file4.json', [{ id: '4' }]);

      expect(cache.get('file1.json')).not.toBeNull();
      expect(cache.get('file2.json')).toBeNull();
      expect(cache.get('file3.json')).not.toBeNull();
      expect(cache.get('file4.json')).not.toBeNull();
    });
  });
});
