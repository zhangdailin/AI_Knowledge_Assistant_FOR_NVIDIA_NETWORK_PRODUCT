import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateAdaptiveThreshold,
  calculateDynamicRRFWeight,
  deduplicateAndMergeChunks,
  detectQueryIntentAdvanced,
  enhanceQueryWithHistory,
  extractCoreQueryEnhanced
} from '../src/lib/retrievalEnhancements';
import { enhancedNetworkKeywordExtractor } from '../src/lib/enhancedNetworkKeywordExtractor';
import { advancedKeywordExtractor } from '../src/lib/advancedKeywordExtractor';
import type { Chunk } from '../src/lib/types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('retrievalEnhancements utilities', () => {
  it('calibrates dynamic RRF weights per intent', () => {
    expect(calculateDynamicRRFWeight('command')).toBe(40);
    expect(calculateDynamicRRFWeight('question')).toBe(65);
    expect(calculateDynamicRRFWeight('unknown' as any)).toBe(60);
  });

  it('enhances queries with recent history context', () => {
    const result = enhanceQueryWithHistory('查询PFC', ['之前的对话', '需要更多上下文']);
    expect(result).toBe('查询PFC 之前的对话 需要更多上下文');
  });

  it('prefers the specialized network extractor for network-heavy queries', () => {
    const networkSpy = vi
      .spyOn(enhancedNetworkKeywordExtractor, 'generateEnhancedQuery')
      .mockReturnValue('network-only');
    const genericSpy = vi
      .spyOn(advancedKeywordExtractor, 'generateEnhancedQuery')
      .mockReturnValue('general-only');

    const networkQuery = extractCoreQueryEnhanced('配置PFC拥塞控制并启用RoCE', 'configuration');
    expect(networkQuery).toBe('network-only');
    expect(networkSpy).toHaveBeenCalledWith('配置PFC拥塞控制并启用RoCE');
    expect(genericSpy).not.toHaveBeenCalled();

    const genericQuery = extractCoreQueryEnhanced('解释AI模型的原理', 'explanation');
    expect(genericQuery).toBe('general-only');
    expect(genericSpy).toHaveBeenCalledWith('解释AI模型的原理');
    expect(networkSpy).toHaveBeenCalledTimes(1);
  });

  it('deduplicates chunk search results by chunk id', () => {
    const baseChunk: Chunk = {
      id: 'chunk-1',
      documentId: 'doc-1',
      content: 'base content',
      chunkIndex: 0,
      tokenCount: 10,
      createdAt: new Date().toISOString()
    };
    const otherChunk: Chunk = {
      ...baseChunk,
      id: 'chunk-2',
      content: 'other content'
    };

    const results = [
      { chunk: baseChunk, score: 0.9 },
      { chunk: { ...baseChunk }, score: 0.85 },
      { chunk: otherChunk, score: 0.7 }
    ];

    const deduped = deduplicateAndMergeChunks(results);
    expect(deduped).toHaveLength(2);
    expect(deduped.map(r => r.chunk.id)).toEqual(['chunk-1', 'chunk-2']);
  });

  it('calculates stricter adaptive thresholds based on incoming scores', () => {
    const chunks: Chunk[] = [
      {
        id: 'chunk-1',
        documentId: 'doc',
        content: 'a',
        chunkIndex: 0,
        tokenCount: 10,
        createdAt: '2024-01-01T00:00:00.000Z'
      },
      {
        id: 'chunk-2',
        documentId: 'doc',
        content: 'b',
        chunkIndex: 1,
        tokenCount: 9,
        createdAt: '2024-01-01T00:00:00.000Z'
      },
      {
        id: 'chunk-3',
        documentId: 'doc',
        content: 'c',
        chunkIndex: 2,
        tokenCount: 8,
        createdAt: '2024-01-01T00:00:00.000Z'
      }
    ];
    const adaptive = calculateAdaptiveThreshold(
      [
        { chunk: chunks[0], score: 0.92 },
        { chunk: chunks[1], score: 0.75 },
        { chunk: chunks[2], score: 0.45 }
      ],
      0.4
    );

    const expected = Math.max(0.4, Math.min(0.92 * 0.85, ((0.92 + 0.75 + 0.45) / 3) * 1.5));
    expect(adaptive).toBeCloseTo(expected, 5);

    const fallback = calculateAdaptiveThreshold([], 0.55);
    expect(fallback).toBe(0.55);
  });

  it('exposes intent metadata via detectQueryIntentAdvanced', () => {
    const result = detectQueryIntentAdvanced('如何 config PFC 并 nv show 状态');
    expect(result.intent).toBe('command');
    expect(result.context?.hasCommand).toBe(true);
    expect(result.context?.hasParameter).toBe(false);
  });
});
