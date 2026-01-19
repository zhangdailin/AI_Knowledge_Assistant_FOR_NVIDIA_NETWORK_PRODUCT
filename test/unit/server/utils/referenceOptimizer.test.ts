
import { describe, it, expect } from 'vitest';
import { optimizeReferences } from '../../../../server/utils/referenceOptimizer.mjs';

describe('Reference Optimizer Module', () => {
    it('should return empty array for empty input', () => {
        const result = optimizeReferences([]);
        expect(result).toEqual([]);
    });

    it('should pass through single chunk', () => {
        const chunks = [{
            id: 'chunk-1',
            documentId: 'doc-1',
            content: 'content 1',
            chunkIndex: 1,
            score: 0.9
        }];
        const result = optimizeReferences(chunks);
        expect(result).toHaveLength(1);
        expect(result[0].content).toBe('content 1');
    });

    it('should merge adjacent chunks from same document', () => {
        const chunks = [
            {
                id: 'chunk-1',
                documentId: 'doc-1',
                content: 'Part 1',
                chunkIndex: 1,
                score: 0.8
            },
            {
                id: 'chunk-2',
                documentId: 'doc-1',
                content: 'Part 2',
                chunkIndex: 2,
                score: 0.9
            }
        ];

        // Sort logic relies on internal Map iteration order which is insertion order, 
        // but optimizedRefs sorts by chunkIndex internally for each doc.
        const result = optimizeReferences(chunks);

        expect(result).toHaveLength(1);
        expect(result[0].content).toBe('Part 1\n\nPart 2');
        expect(result[0].score).toBe(0.9); // Should take max score
        expect(result[0].mergedIds).toEqual(['chunk-1', 'chunk-2']);
    });

    it('should NOT merge non-adjacent chunks from same document', () => {
        const chunks = [
            {
                id: 'chunk-1',
                documentId: 'doc-1',
                content: 'Part 1',
                chunkIndex: 1,
                score: 0.9
            },
            {
                id: 'chunk-3',
                documentId: 'doc-1',
                content: 'Part 3',
                chunkIndex: 3, // Gap of 1
                score: 0.8
            }
        ];

        const result = optimizeReferences(chunks);

        expect(result).toHaveLength(2);
        // Result is sorted by score
        expect(result[0].content).toBe('Part 1');
        expect(result[1].content).toBe('Part 3');
    });

    it('should handle multiple documents', () => {
        const chunks = [
            { id: 'c1', documentId: 'doc-A', chunkIndex: 1, content: 'A1', score: 0.9 },
            { id: 'c2', documentId: 'doc-A', chunkIndex: 2, content: 'A2', score: 0.8 }, // Merge with c1
            { id: 'c3', documentId: 'doc-B', chunkIndex: 5, content: 'B5', score: 0.95 }
        ];

        const result = optimizeReferences(chunks);

        expect(result).toHaveLength(2);
        // doc-B has higher score (0.95 vs max(0.9, 0.8))
        expect(result[0].documentId).toBe('doc-B');
        expect(result[0].content).toBe('B5');

        expect(result[1].documentId).toBe('doc-A');
        expect(result[1].content).toBe('A1\n\nA2');
    });

    it('should respect maxReferences limit', () => {
        const chunks = [];
        for (let i = 0; i < 20; i++) {
            chunks.push({
                id: `c${i}`,
                documentId: `doc-${i}`,
                chunkIndex: 1,
                content: `Content ${i}`,
                score: 0.5 + (i * 0.01)
            });
        }

        const result = optimizeReferences(chunks, { maxReferences: 5 });
        expect(result).toHaveLength(5);
        // Should be the highest scoring ones
        expect(result[0].score).toBeGreaterThan(result[4].score);
    });
});
