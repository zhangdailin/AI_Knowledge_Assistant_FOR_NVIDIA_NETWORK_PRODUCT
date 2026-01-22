/**
 * Unit tests for query expansion and rewriting
 */
import { describe, it, expect } from 'vitest';
import { expandQuery, addQueryContext, smartQueryRewrite } from '../../../server/queryExpansion.mjs';

describe('Query Expansion', () => {
  describe('expandQuery', () => {
    it('should return original query as first variant', () => {
      const result = expandQuery('BGP配置');
      expect(result[0]).toBe('BGP配置');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should translate Chinese to English', () => {
      const result = expandQuery('配置BGP');
      expect(result.some(v => v.includes('config'))).toBe(true);
    });

    it('should translate English to Chinese', () => {
      const result = expandQuery('show interface');
      expect(result.some(v => v.includes('查看') || v.includes('接口'))).toBe(true);
    });

    it('should expand technical abbreviations', () => {
      const result = expandQuery('BGP配置');
      expect(result.some(v => v.toLowerCase().includes('border gateway protocol'))).toBe(true);
    });

    it('should convert questions to statements', () => {
      const result = expandQuery('如何配置BGP？');
      expect(result.some(v => !v.includes('如何') && v.includes('BGP'))).toBe(true);
      expect(result.some(v => v.includes('方法') || v.includes('步骤'))).toBe(true);
    });

    it('should add action synonyms', () => {
      const result = expandQuery('查看接口状态');
      expect(result.some(v => v.includes('检查') || v.includes('show') || v.includes('显示'))).toBe(true);
    });

    it('should limit variants to maxVariants (default 15)', () => {
      const result = expandQuery('如何配置BGP EVPN VXLAN');
      // v2.0: 默认最大变体数从 10 增加到 15
      expect(result.length).toBeLessThanOrEqual(15);
    });

    it('should respect custom maxVariants option', () => {
      const result = expandQuery('如何配置BGP EVPN VXLAN', { maxVariants: 10 });
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('should handle empty query', () => {
      const result = expandQuery('');
      expect(result).toEqual(['']);
    });

    it('should deduplicate variants', () => {
      const result = expandQuery('BGP');
      const uniqueSet = new Set(result);
      expect(result.length).toBe(uniqueSet.size);
    });

    it('should extract and combine entities', () => {
      const result = expandQuery('配置BGP');
      // Should generate combinations like "配置 bgp", "bgp 配置", etc.
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('addQueryContext', () => {
    it('should return original query when no recent queries', () => {
      const result = addQueryContext('状态', []);
      expect(result.original).toBe('状态');
      expect(result.expanded).toContain('状态');
    });

    it('should add context from recent queries', () => {
      const result = addQueryContext('状态', ['BGP配置', 'OSPF路由']);
      expect(result.expanded.length).toBeGreaterThan(1);
      expect(result.expanded.some(q => q.includes('bgp') || q.includes('ospf'))).toBe(true);
    });

    it('should not add context if query already has technical terms', () => {
      const result = addQueryContext('BGP状态', ['OSPF配置']);
      // Should not add OSPF context since query already has BGP
      expect(result.expanded.filter(q => q.includes('ospf')).length).toBe(0);
    });

    it('should only use last 3 recent queries', () => {
      const recentQueries = ['BGP', 'OSPF', 'EVPN', 'VXLAN', 'MLAG'];
      const result = addQueryContext('状态', recentQueries);
      // Should only extract terms from first 3: BGP, OSPF, EVPN
      expect(result.expanded.some(q => q.includes('mlag'))).toBe(false);
    });

    it('should handle short queries', () => {
      const result = addQueryContext('查看', ['BGP配置']);
      expect(result.expanded.length).toBeGreaterThan(1);
    });
  });

  describe('smartQueryRewrite', () => {
    it('should perform expansion by default', () => {
      const result = smartQueryRewrite('BGP配置');
      expect(result.original).toBe('BGP配置');
      expect(result.variants.length).toBeGreaterThan(1);
      expect(result.strategy).toContain('expansion');
    });

    it('should skip expansion when disabled', () => {
      const result = smartQueryRewrite('BGP配置', { enableExpansion: false });
      expect(result.variants).toEqual(['BGP配置']);
      expect(result.strategy).not.toContain('expansion');
    });

    it('should add context when enabled', () => {
      const result = smartQueryRewrite('状态', {
        enableContext: true,
        recentQueries: ['BGP配置']
      });
      expect(result.strategy).toContain('context');
      expect(result.variants.length).toBeGreaterThan(1);
    });

    it('should combine expansion and context', () => {
      const result = smartQueryRewrite('查看状态', {
        enableExpansion: true,
        enableContext: true,
        recentQueries: ['BGP配置']
      });
      expect(result.strategy).toContain('expansion');
      expect(result.strategy).toContain('context');
      expect(result.variants.length).toBeGreaterThan(2);
    });

    it('should deduplicate all variants', () => {
      const result = smartQueryRewrite('BGP配置', {
        enableExpansion: true,
        enableContext: true,
        recentQueries: ['BGP']
      });
      const uniqueSet = new Set(result.variants);
      expect(result.variants.length).toBe(uniqueSet.size);
    });

    it('should always include original query', () => {
      const query = 'test query';
      const result = smartQueryRewrite(query);
      expect(result.variants).toContain(query);
    });
  });
});
