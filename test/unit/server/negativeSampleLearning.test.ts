/**
 * Negative Sample Learning Unit Tests
 * Tests for negative feedback collection and penalty scoring
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('Negative Sample Learning Unit Tests', () => {
  describe('1. Negative Sample Recording', () => {
    class NegativeSampleStore {
      private samples: Map<string, Map<string, number>> = new Map();

      recordNegativeSample(query: string, documentId: string): void {
        const normalizedQuery = query.toLowerCase().trim();

        if (!this.samples.has(normalizedQuery)) {
          this.samples.set(normalizedQuery, new Map());
        }

        const docMap = this.samples.get(normalizedQuery)!;
        docMap.set(documentId, (docMap.get(documentId) || 0) + 1);
      }

      recordNegativeSamples(query: string, documentIds: string[]): void {
        for (const docId of documentIds) {
          this.recordNegativeSample(query, docId);
        }
      }

      getNegativeCount(query: string, documentId: string): number {
        const normalizedQuery = query.toLowerCase().trim();
        const docMap = this.samples.get(normalizedQuery);
        return docMap?.get(documentId) || 0;
      }

      getAllNegativeDocs(query: string): Map<string, number> {
        const normalizedQuery = query.toLowerCase().trim();
        return this.samples.get(normalizedQuery) || new Map();
      }

      clear(): void {
        this.samples.clear();
      }

      size(): number {
        return this.samples.size;
      }
    }

    it('should record single negative sample', () => {
      const store = new NegativeSampleStore();

      store.recordNegativeSample('BGP configuration', 'doc123');

      expect(store.getNegativeCount('BGP configuration', 'doc123')).toBe(1);
    });

    it('should normalize query (case-insensitive)', () => {
      const store = new NegativeSampleStore();

      store.recordNegativeSample('BGP Configuration', 'doc123');

      expect(store.getNegativeCount('bgp configuration', 'doc123')).toBe(1);
      expect(store.getNegativeCount('BGP CONFIGURATION', 'doc123')).toBe(1);
    });

    it('should trim whitespace in queries', () => {
      const store = new NegativeSampleStore();

      store.recordNegativeSample('  BGP config  ', 'doc123');

      expect(store.getNegativeCount('BGP config', 'doc123')).toBe(1);
    });

    it('should increment count for duplicate negative feedback', () => {
      const store = new NegativeSampleStore();

      store.recordNegativeSample('BGP config', 'doc123');
      store.recordNegativeSample('BGP config', 'doc123');
      store.recordNegativeSample('BGP config', 'doc123');

      expect(store.getNegativeCount('BGP config', 'doc123')).toBe(3);
    });

    it('should track multiple documents for same query', () => {
      const store = new NegativeSampleStore();

      store.recordNegativeSample('BGP config', 'doc123');
      store.recordNegativeSample('BGP config', 'doc456');
      store.recordNegativeSample('BGP config', 'doc789');

      expect(store.getNegativeCount('BGP config', 'doc123')).toBe(1);
      expect(store.getNegativeCount('BGP config', 'doc456')).toBe(1);
      expect(store.getNegativeCount('BGP config', 'doc789')).toBe(1);
    });

    it('should track multiple queries for same document', () => {
      const store = new NegativeSampleStore();

      store.recordNegativeSample('BGP config', 'doc123');
      store.recordNegativeSample('OSPF setup', 'doc123');
      store.recordNegativeSample('VLAN configuration', 'doc123');

      expect(store.getNegativeCount('BGP config', 'doc123')).toBe(1);
      expect(store.getNegativeCount('OSPF setup', 'doc123')).toBe(1);
      expect(store.getNegativeCount('VLAN configuration', 'doc123')).toBe(1);
    });

    it('should record batch negative samples', () => {
      const store = new NegativeSampleStore();

      store.recordNegativeSamples('BGP config', ['doc1', 'doc2', 'doc3']);

      expect(store.getNegativeCount('BGP config', 'doc1')).toBe(1);
      expect(store.getNegativeCount('BGP config', 'doc2')).toBe(1);
      expect(store.getNegativeCount('BGP config', 'doc3')).toBe(1);
    });

    it('should get all negative docs for a query', () => {
      const store = new NegativeSampleStore();

      store.recordNegativeSample('BGP config', 'doc1');
      store.recordNegativeSample('BGP config', 'doc2');
      store.recordNegativeSample('BGP config', 'doc2'); // Duplicate

      const negativeDocs = store.getAllNegativeDocs('BGP config');
      expect(negativeDocs.size).toBe(2);
      expect(negativeDocs.get('doc1')).toBe(1);
      expect(negativeDocs.get('doc2')).toBe(2);
    });

    it('should return empty map for unknown query', () => {
      const store = new NegativeSampleStore();

      const negativeDocs = store.getAllNegativeDocs('unknown query');
      expect(negativeDocs.size).toBe(0);
    });
  });

  describe('2. Penalty Score Calculation', () => {
    interface NegativeSample {
      query: string;
      documents: Map<string, number>;
    }

    class PenaltyCalculator {
      private samples = new Map<string, Map<string, number>>();
      private readonly exactPenaltyPerFeedback = 0.1;
      private readonly fuzzyPenaltyPerFeedback = 0.05;
      private readonly maxExactPenalty = 0.5;
      private readonly maxFuzzyPenalty = 0.25;

      recordNegativeSample(query: string, documentId: string): void {
        const normalizedQuery = query.toLowerCase().trim();
        if (!this.samples.has(normalizedQuery)) {
          this.samples.set(normalizedQuery, new Map());
        }
        const docMap = this.samples.get(normalizedQuery)!;
        docMap.set(documentId, (docMap.get(documentId) || 0) + 1);
      }

      getExactPenalty(query: string, documentId: string): number {
        const normalizedQuery = query.toLowerCase().trim();
        const docMap = this.samples.get(normalizedQuery);

        if (!docMap || !docMap.has(documentId)) {
          return 0;
        }

        const feedbackCount = docMap.get(documentId)!;
        return -Math.min(
          feedbackCount * this.exactPenaltyPerFeedback,
          this.maxExactPenalty
        );
      }

      getFuzzyPenalty(query: string, documentId: string): number {
        const normalizedQuery = query.toLowerCase().trim();
        const queryKeywords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);

        let maxPenalty = 0;

        for (const [cachedQuery, docs] of this.samples.entries()) {
          if (cachedQuery === normalizedQuery) continue; // Skip exact matches

          const cachedKeywords = cachedQuery.split(/\s+/).filter(w => w.length > 2);

          // Check for keyword overlap
          const hasOverlap = queryKeywords.some(kw => cachedQuery.includes(kw)) ||
                            cachedKeywords.some(kw => normalizedQuery.includes(kw));

          if (hasOverlap && docs.has(documentId)) {
            const feedbackCount = docs.get(documentId)!;
            const penalty = -Math.min(
              feedbackCount * this.fuzzyPenaltyPerFeedback,
              this.maxFuzzyPenalty
            );
            maxPenalty = Math.min(maxPenalty, penalty);
          }
        }

        return maxPenalty;
      }

      getTotalPenalty(query: string, documentId: string): number {
        const exactPenalty = this.getExactPenalty(query, documentId);
        if (exactPenalty < 0) {
          return exactPenalty; // Exact match takes precedence
        }
        return this.getFuzzyPenalty(query, documentId);
      }
    }

    it('should calculate exact match penalty', () => {
      const calculator = new PenaltyCalculator();

      calculator.recordNegativeSample('BGP config', 'doc123');

      const penalty = calculator.getExactPenalty('BGP config', 'doc123');
      expect(penalty).toBeCloseTo(-0.1, 5);
    });

    it('should calculate penalty for multiple feedbacks', () => {
      const calculator = new PenaltyCalculator();

      calculator.recordNegativeSample('BGP config', 'doc123');
      calculator.recordNegativeSample('BGP config', 'doc123');
      calculator.recordNegativeSample('BGP config', 'doc123');

      const penalty = calculator.getExactPenalty('BGP config', 'doc123');
      expect(penalty).toBeCloseTo(-0.3, 5);
    });

    it('should cap penalty at maximum', () => {
      const calculator = new PenaltyCalculator();

      // Record 10 negative feedbacks
      for (let i = 0; i < 10; i++) {
        calculator.recordNegativeSample('BGP config', 'doc123');
      }

      const penalty = calculator.getExactPenalty('BGP config', 'doc123');
      expect(penalty).toBeCloseTo(-0.5, 5); // Capped at -0.5
    });

    it('should return zero penalty for no negative feedback', () => {
      const calculator = new PenaltyCalculator();

      const penalty = calculator.getExactPenalty('BGP config', 'doc123');
      expect(penalty).toBe(0);
    });

    it('should calculate fuzzy match penalty', () => {
      const calculator = new PenaltyCalculator();

      calculator.recordNegativeSample('BGP configuration', 'doc123');

      const penalty = calculator.getFuzzyPenalty('BGP setup', 'doc123');
      expect(penalty).toBeLessThan(0); // Should have some penalty due to 'BGP' keyword
    });

    it('should have lower fuzzy penalty than exact penalty', () => {
      const calculator = new PenaltyCalculator();

      calculator.recordNegativeSample('BGP config', 'doc123');

      const exactPenalty = calculator.getExactPenalty('BGP config', 'doc123');
      const fuzzyPenalty = calculator.getFuzzyPenalty('BGP setup', 'doc123');

      expect(Math.abs(fuzzyPenalty)).toBeLessThan(Math.abs(exactPenalty));
    });

    it('should not give fuzzy penalty for unrelated queries', () => {
      const calculator = new PenaltyCalculator();

      calculator.recordNegativeSample('BGP configuration', 'doc123');

      const penalty = calculator.getFuzzyPenalty('OSPF routing', 'doc123');
      expect(penalty).toBe(0); // No keyword overlap
    });

    it('should prefer exact penalty over fuzzy penalty', () => {
      const calculator = new PenaltyCalculator();

      calculator.recordNegativeSample('BGP config', 'doc123');
      calculator.recordNegativeSample('BGP setup', 'doc123');

      const totalPenalty = calculator.getTotalPenalty('BGP config', 'doc123');
      const exactPenalty = calculator.getExactPenalty('BGP config', 'doc123');

      expect(totalPenalty).toBe(exactPenalty);
    });

    it('should use fuzzy penalty when no exact match', () => {
      const calculator = new PenaltyCalculator();

      calculator.recordNegativeSample('BGP configuration', 'doc123');

      const totalPenalty = calculator.getTotalPenalty('BGP setup', 'doc123');
      const fuzzyPenalty = calculator.getFuzzyPenalty('BGP setup', 'doc123');

      expect(totalPenalty).toBe(fuzzyPenalty);
      expect(totalPenalty).toBeLessThan(0);
    });

    it('should ignore short words in fuzzy matching', () => {
      const calculator = new PenaltyCalculator();

      calculator.recordNegativeSample('a BGP configuration', 'doc123');

      // Query with only short overlapping words
      const penalty = calculator.getFuzzyPenalty('a b c', 'doc123');
      expect(penalty).toBe(0); // All words too short
    });

    it('should cap fuzzy penalty at maximum', () => {
      const calculator = new PenaltyCalculator();

      // Record many negative samples with similar keywords
      for (let i = 0; i < 10; i++) {
        calculator.recordNegativeSample('BGP configuration method', 'doc123');
      }

      const penalty = calculator.getFuzzyPenalty('BGP setup guide', 'doc123');
      expect(penalty).toBeGreaterThanOrEqual(-0.25); // Capped at -0.25
    });
  });

  describe('3. Score Adjustment with Negative Samples', () => {
    it('should reduce document score based on negative feedback', () => {
      interface SearchResult {
        id: string;
        score: number;
      }

      const applyNegativePenalty = (
        results: SearchResult[],
        query: string,
        getPenalty: (query: string, docId: string) => number
      ): SearchResult[] => {
        return results.map(result => ({
          ...result,
          score: result.score + getPenalty(query, result.id)
        }));
      };

      const results = [
        { id: 'doc1', score: 0.9 },
        { id: 'doc2', score: 0.8 },
        { id: 'doc3', score: 0.7 }
      ];

      const getPenalty = (query: string, docId: string) => {
        if (query === 'BGP config' && docId === 'doc2') {
          return -0.3; // doc2 has negative feedback
        }
        return 0;
      };

      const adjusted = applyNegativePenalty(results, 'BGP config', getPenalty);

      expect(adjusted[0].score).toBe(0.9);
      expect(adjusted[1].score).toBe(0.5); // 0.8 - 0.3
      expect(adjusted[2].score).toBe(0.7);
    });

    it('should not reduce score below zero', () => {
      interface SearchResult {
        id: string;
        score: number;
      }

      const applyNegativePenalty = (
        results: SearchResult[],
        query: string,
        getPenalty: (query: string, docId: string) => number
      ): SearchResult[] => {
        return results.map(result => ({
          ...result,
          score: Math.max(0, result.score + getPenalty(query, result.id))
        }));
      };

      const results = [{ id: 'doc1', score: 0.2 }];

      const getPenalty = () => -0.5;

      const adjusted = applyNegativePenalty(results, 'test', getPenalty);

      expect(adjusted[0].score).toBe(0); // Not negative
    });

    it('should re-rank results after applying penalties', () => {
      interface SearchResult {
        id: string;
        score: number;
      }

      const applyNegativePenaltyAndRerank = (
        results: SearchResult[],
        query: string,
        getPenalty: (query: string, docId: string) => number
      ): SearchResult[] => {
        const adjusted = results.map(result => ({
          ...result,
          score: result.score + getPenalty(query, result.id)
        }));

        return adjusted.sort((a, b) => b.score - a.score);
      };

      const results = [
        { id: 'doc1', score: 0.9 },
        { id: 'doc2', score: 0.8 },
        { id: 'doc3', score: 0.7 }
      ];

      const getPenalty = (query: string, docId: string) => {
        if (docId === 'doc1') return -0.5; // Heavy penalty for doc1
        return 0;
      };

      const reranked = applyNegativePenaltyAndRerank(results, 'test', getPenalty);

      expect(reranked[0].id).toBe('doc2'); // doc2 now first
      expect(reranked[1].id).toBe('doc3');
      expect(reranked[2].id).toBe('doc1'); // doc1 last due to penalty
    });
  });

  describe('4. Integration with Feedback System', () => {
    interface FeedbackEntry {
      verdict: 'up' | 'down';
      question: string;
      metadata?: {
        references?: Array<{ documentId: string; id?: string }>;
      };
    }

    class FeedbackProcessor {
      private negativeSamples = new Map<string, Map<string, number>>();

      processFeedback(entry: FeedbackEntry): void {
        if (entry.verdict !== 'down') return;
        if (!entry.question || !entry.metadata?.references) return;

        const normalizedQuery = entry.question.toLowerCase().trim();

        if (!this.negativeSamples.has(normalizedQuery)) {
          this.negativeSamples.set(normalizedQuery, new Map());
        }

        const docMap = this.negativeSamples.get(normalizedQuery)!;

        for (const ref of entry.metadata.references) {
          const docId = ref.documentId || ref.id;
          if (docId) {
            docMap.set(docId, (docMap.get(docId) || 0) + 1);
          }
        }
      }

      getNegativeCount(query: string, documentId: string): number {
        const normalizedQuery = query.toLowerCase().trim();
        const docMap = this.negativeSamples.get(normalizedQuery);
        return docMap?.get(documentId) || 0;
      }
    }

    it('should process negative feedback', () => {
      const processor = new FeedbackProcessor();

      const feedback: FeedbackEntry = {
        verdict: 'down',
        question: 'BGP configuration',
        metadata: {
          references: [
            { documentId: 'doc123' },
            { documentId: 'doc456' }
          ]
        }
      };

      processor.processFeedback(feedback);

      expect(processor.getNegativeCount('BGP configuration', 'doc123')).toBe(1);
      expect(processor.getNegativeCount('BGP configuration', 'doc456')).toBe(1);
    });

    it('should ignore positive feedback', () => {
      const processor = new FeedbackProcessor();

      const feedback: FeedbackEntry = {
        verdict: 'up',
        question: 'BGP configuration',
        metadata: {
          references: [{ documentId: 'doc123' }]
        }
      };

      processor.processFeedback(feedback);

      expect(processor.getNegativeCount('BGP configuration', 'doc123')).toBe(0);
    });

    it('should handle feedback without references', () => {
      const processor = new FeedbackProcessor();

      const feedback: FeedbackEntry = {
        verdict: 'down',
        question: 'BGP configuration'
      };

      processor.processFeedback(feedback);

      // Should not throw, just ignore
      expect(processor.getNegativeCount('BGP configuration', 'doc123')).toBe(0);
    });

    it('should accumulate multiple negative feedbacks', () => {
      const processor = new FeedbackProcessor();

      const feedback1: FeedbackEntry = {
        verdict: 'down',
        question: 'BGP configuration',
        metadata: {
          references: [{ documentId: 'doc123' }]
        }
      };

      const feedback2: FeedbackEntry = {
        verdict: 'down',
        question: 'BGP configuration',
        metadata: {
          references: [{ documentId: 'doc123' }]
        }
      };

      processor.processFeedback(feedback1);
      processor.processFeedback(feedback2);

      expect(processor.getNegativeCount('BGP configuration', 'doc123')).toBe(2);
    });

    it('should handle alternative id field', () => {
      const processor = new FeedbackProcessor();

      const feedback: FeedbackEntry = {
        verdict: 'down',
        question: 'BGP configuration',
        metadata: {
          references: [{ id: 'doc123' } as any]
        }
      };

      processor.processFeedback(feedback);

      expect(processor.getNegativeCount('BGP configuration', 'doc123')).toBe(1);
    });
  });
});
