/**
 * 增强的PFC和ECN关键词提取器
 * 专门针对网络流量控制配置
 */

export class EnhancedNetworkKeywordExtractor {
  private networkTechTerms = {
    // PFC相关术语
    pfc: ['pfc', 'priority flow control', 'priority-based flow control', '802.1bb', 'link pause', 'queue pause'],
    // ECN相关术语
    ecn: ['ecn', 'explicit congestion notification', 'congestion control', 'red', 'wred', 'random early detection'],
    // RoCE相关术语
    roce: ['roce', 'rdma over converged ethernet', 'rdma', 'lossless ethernet'],
    // QoS相关术语
    qos: ['qos', 'quality of service', 'traffic class', 'traffic priority', 'cos', 'dscp'],
    // BGP相关术语
    bgp: ['bgp', 'border gateway protocol', 'ebgp', 'ibgp', 'neighbor', 'peer', 'as', 'autonomous system', 'asn'],
    // 路由相关
    routing: ['route', 'router', 'routing', 'ip route', 'static route'],
    // 厂商相关
    vendors: ['nvidia', 'mellanox', 'cumulus', 'broadcom', '思科', 'cisco', 'nv', 'nvos'],
    // 配置相关
    config: ['configure', 'configuration', 'setup', 'enable', 'disable', 'show', 'set', 'apply', 'nv', 'acl', 'access control list']
  };

  extractKeywords(query: string) {
    const keywords: string[] = [];
    const techTerms: string[] = [];
    const vendors: string[] = [];
    const configTerms: string[] = [];
    
    const queryLower = query.toLowerCase();

    // 1. 提取技术术语
    Object.entries(this.networkTechTerms).forEach(([category, terms]) => {
      terms.forEach(term => {
        if (queryLower.includes(term.toLowerCase())) {
          if (['pfc', 'ecn', 'roce', 'qos', 'bgp', 'routing'].includes(category)) {
            techTerms.push(term.toLowerCase());
          } else if (category === 'vendors') {
            vendors.push(term.toLowerCase());
          } else if (category === 'config') {
            configTerms.push(term.toLowerCase());
          }
        }
      });
    });

    // 显式提取 ACL
    if (queryLower.includes('acl') || queryLower.includes('access control list')) {
        techTerms.push('acl');
        techTerms.push('access control list');
    }

    // 2. 提取数字和参数（如优先级、阈值等）
    const numberPattern = /\b\d+\b/g;
    const numbers = queryLower.match(numberPattern) || [];

    // 提取IPv4地址
    const ipv4Pattern = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
    const ips = query.match(ipv4Pattern) || [];
    
    // 3. 提取中文关键词（去除停用词）
    const stopWords = new Set(['的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '些', '个', '只', '现在', '请', '问', '怎么', '如何', '怎样', '什么', '哪个', '哪些', '为什么', '是否', '能否', '可以', '应该', '给出', '完整']);
    
    const chineseWords = query.match(/[\u4e00-\u9fa5]+/g) || [];
    const filteredChinese = chineseWords.filter(word => word.length >= 2 && !stopWords.has(word));

    // 4. 提取英文关键词
    const englishWords = query.match(/[a-zA-Z]+/g) || [];
    const filteredEnglish = englishWords.filter(word => word.length >= 2);

    // 5. 合并所有关键词
    // 注意：不包含 IP 和 纯数字，避免干扰通用检索（除非用户是在 troubleshoot 特定 IP）
    // 但是，为了保留用户的原始意图，我们还是把它们放在 extracted.keywords 里，
    // 但在 generateEnhancedQuery 时需要小心
    keywords.push(...techTerms, ...vendors, ...configTerms, ...ips, ...numbers, ...filteredChinese, ...filteredEnglish);

    return {
      keywords: [...new Set(keywords)],
      searchKeywords: [...new Set([...techTerms, ...vendors, ...configTerms, ...filteredChinese, ...filteredEnglish])], // 不含 IP 和数字
      techTerms: [...new Set(techTerms)],
      vendors: [...new Set(vendors)],
      configTerms: [...new Set(configTerms)],
      hasPFC: techTerms.includes('pfc') || techTerms.includes('priority flow control'),
      hasECN: techTerms.includes('ecn') || techTerms.includes('explicit congestion notification'),
      hasRoCE: techTerms.includes('roce') || techTerms.includes('rdma'),
      hasBGP: techTerms.includes('bgp') || techTerms.includes('border gateway protocol'),
      hasQoS: techTerms.includes('qos') || techTerms.includes('quality of service'),
      intent: this.detectIntent(techTerms, vendors, configTerms)
    };
  }

  private detectIntent(techTerms: string[], vendors: string[], configTerms: string[]): string {
    if (techTerms.length > 0 && configTerms.length > 0) {
      return 'network_config';
    } else if (techTerms.length > 0) {
      return 'tech_reference';
    } else if (vendors.length > 0) {
      return 'vendor_specific';
    }
    return 'general';
  }

  generateEnhancedQuery(originalQuery: string): string {
    const extracted = this.extractKeywords(originalQuery);
    const queryParts: string[] = [];

    // 添加核心技术术语
    if (extracted.hasPFC) {
      queryParts.push('pfc', 'priority flow control', '802.1bb', 'queue pause', 'link pause');
    }
    
    if (extracted.hasECN) {
      queryParts.push('ecn', 'explicit congestion notification', 'congestion control', 'red', 'wred');
    }
    
    if (extracted.hasRoCE) {
      queryParts.push('roce', 'rdma', 'rdma over converged ethernet', 'lossless ethernet');
    }

    if (extracted.hasBGP) {
      queryParts.push('bgp', 'border gateway protocol', 'ebgp', 'ibgp', 'neighbor', 'router bgp');
    }

    // 添加 ACL 相关术语
    if (extracted.techTerms.includes('acl') || extracted.techTerms.includes('access control list')) {
      queryParts.push('acl', 'access control list', 'ip access-list', 'ipv6 access-list', 'permit', 'deny', 'rule');
      // 显式增加 NV 命令模式
      queryParts.push('nv set acl', 'nv config acl');
    }

    // 添加QoS相关术语（仅当检测到QoS或相关流量控制意图时）
    if (extracted.hasQoS || extracted.hasPFC || extracted.hasECN || extracted.hasRoCE) {
      queryParts.push('qos', 'quality of service', 'traffic class', 'traffic priority');
    }

    // 添加厂商信息
    if (extracted.vendors.includes('nvidia')) {
      queryParts.push('nvidia', 'mellanox', 'cumulus', 'nvos');
    }

    // 添加配置相关术语
    queryParts.push('configure', 'configuration', 'setup', 'enable', 'command', 'cli');
    
    // 如果是配置意图，添加通用的 nv set 命令前缀，增加命中率
    if (extracted.intent === 'network_config') {
        queryParts.push('nv set', 'nv config', 'net add');
    }

    // 添加原始关键词 (使用不含 IP/数字 的版本，除非没有其他关键词)
    if (extracted.searchKeywords.length > 0) {
        queryParts.push(...extracted.searchKeywords);
    } else {
        queryParts.push(...extracted.keywords);
    }

    return [...new Set(queryParts)].join(' ');
  }
}

// 创建单例实例
export const enhancedNetworkKeywordExtractor = new EnhancedNetworkKeywordExtractor();