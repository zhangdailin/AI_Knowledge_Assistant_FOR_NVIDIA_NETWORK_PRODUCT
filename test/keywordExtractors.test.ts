import { describe, expect, it } from 'vitest';
import { advancedKeywordExtractor } from '../src/lib/advancedKeywordExtractor';
import { enhancedNetworkKeywordExtractor } from '../src/lib/enhancedNetworkKeywordExtractor';

describe('advancedKeywordExtractor', () => {
  it('extracts network context, commands and intents from ACL queries', () => {
    const query = '配置 ACL 允许192.168.1.0/24访问8.8.8.8 并拒绝10.0.0.0/24';
    const result = advancedKeywordExtractor.extractKeywords(query);

    expect(result.intent).toBe('network_config');
    expect(result.networkAddresses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: '192.168.1.0/24', type: 'cidr' }),
        expect.objectContaining({ address: '10.0.0.0/24', type: 'cidr' }),
        expect.objectContaining({ address: '8.8.8.8', type: 'ipv4' })
      ])
    );
    expect(result.commands.some(cmd => cmd.command === 'acl' && cmd.action === 'configure')).toBe(true);
  });

  it('builds an enhanced query that mixes addresses and normalized commands', () => {
    const enhanced = advancedKeywordExtractor.generateEnhancedQuery('配置ACL, 允许192.168.1.0/24访问核心网络');
    expect(enhanced).toContain('acl configure');
    expect(enhanced).toContain('192.168.1.0/24');
  });
});

describe('enhancedNetworkKeywordExtractor', () => {
  it('amplifies PFC/ECN intents with vendor specific context', () => {
    const enhanced = enhancedNetworkKeywordExtractor.generateEnhancedQuery('如何在NVIDIA交换机上启用PFC和ECN并配置QoS');
    expect(enhanced).toContain('priority flow control');
    expect(enhanced).toContain('explicit congestion notification');
    expect(enhanced).toContain('nvidia');
    expect(enhanced).toContain('nv set');
    expect(enhanced).toContain('qos');
  });

  it('keeps numeric IP tokens out of search keywords while preserving them in keywords', () => {
    const result = enhancedNetworkKeywordExtractor.extractKeywords('configure PFC to 10.0.0.1 and enable ECN priority');
    expect(result.keywords).toContain('10.0.0.1');
    expect(result.searchKeywords).not.toContain('10.0.0.1');
    expect(result.intent).toBe('network_config');
    expect(result.hasPFC).toBe(true);
    expect(result.hasECN).toBe(true);
  });
});
