import { describe, expect, it } from 'vitest';
import { advancedIntentDetector } from '../src/lib/advancedIntentDetector';

describe('advancedIntentDetector', () => {
  it('detects configuration intent for explicit setup questions', () => {
    const result = advancedIntentDetector.detect('如何配置BGP邻居和路由策略？');
    expect(result.intent).toBe('configuration');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.context?.complexity).toBeDefined();
  });

  it('detects troubleshoot intent when errors and codes are mentioned', () => {
    const query = '为什么交换机启用PFC后仍然出现错误 code 1202 并且无法启动？';
    const result = advancedIntentDetector.detect(query);

    expect(result.intent).toBe('troubleshoot');
    expect(result.context?.hasError).toBe(true);
    expect(result.context?.hasParameter).toBe(true);
    expect(result.reasons.some(reason => reason.includes('关键词'))).toBe(true);
  });

  it('flags verification as a sub-intent when the user wants to check status', () => {
    const result = advancedIntentDetector.detect('如何配置PFC并检查端口状态？');

    expect(result.intent).toBe('configuration');
    expect(result.subIntents).toBeDefined();
    expect(result.subIntents).toContain('command');
  });

  it('adapts retrieval parameters based on confidence', () => {
    const highConfidence = advancedIntentDetector.getRetrievalParams('command', 0.85);
    expect(highConfidence.minScore).toBeCloseTo(0.5, 5);
    expect(highConfidence.limit).toBe(20);

    const lowConfidence = advancedIntentDetector.getRetrievalParams('troubleshoot', 0.4);
    expect(lowConfidence.minScore).toBeCloseTo(0.43, 5);
    expect(lowConfidence.limit).toBe(25);
  });
});
