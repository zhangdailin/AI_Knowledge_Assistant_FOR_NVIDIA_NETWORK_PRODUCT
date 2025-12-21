/**
 * 高级关键词提取和语义分析模块
 * 专门针对网络配置和技术文档的语义理解
 */

export interface ExtractedKeywords {
  keywords: string[];
  networkAddresses: NetworkAddress[];
  commands: CommandInfo[];
  semanticGroups: SemanticGroup[];
  intent: QueryIntent;
}

export interface NetworkAddress {
  address: string;
  type: 'ipv4' | 'ipv6' | 'cidr' | 'range';
  mask?: string;
  originalText: string;
}

export interface CommandInfo {
  command: string;
  parameters: string[];
  action: 'configure' | 'show' | 'enable' | 'disable' | 'delete';
  target: string;
}

export interface SemanticGroup {
  type: 'network_config' | 'access_control' | 'routing' | 'security' | 'monitoring';
  elements: string[];
  confidence: number;
}

export type QueryIntent = 'network_config' | 'command_reference' | 'troubleshooting' | 'general';

/**
 * 高级关键词提取器
 * 能够识别网络配置、IP地址、命令等复杂技术信息
 */
export class AdvancedKeywordExtractor {
  private networkPatterns = {
    // IPv4地址
    ipv4: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    // CIDR表示法
    cidr: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/\d{1,2}\b/g,
    // IPv6地址（简化版本）
    ipv6: /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g,
    // 网络范围（如 192.168.1.0-192.168.1.255）
    range: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\s*-\s*(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
  };

  private commandPatterns = {
    // 网络设备命令
    cisco: /\b(?:show|configure|enable|disable|ip|interface|router|switch|vlan|access-list)\b/gi,
    // ACL命令
    acl: /\b(?:access-list|acl|permit|deny|allow|block)\b/gi,
    // 配置命令
    config: /\b(?:config|configuration|setup|install|deploy)\b/gi,
  };

  private semanticPatterns = {
    // 网络配置相关
    network_config: /\b(?:network|configure|setup|interface|vlan|routing|subnet|gateway|dns|dhcp)\b/gi,
    // 访问控制
    access_control: /\b(?:access|control|permission|allow|deny|permit|block|restrict|acl|firewall)\b/gi,
    // 安全相关
    security: /\b(?:security|secure|encrypt|authentication|authorization|ssl|tls|vpn)\b/gi,
    // 监控相关
    monitoring: /\b(?:monitor|log|alert|status|health|performance|metric)\b/gi,
  };

  private stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    '如何', '怎么', '怎样', '什么', '哪个', '哪些', '为什么', '是否', '能否', '可以', '应该',
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '些', '个', '只', '现在', '请', '问'
  ]);

  /**
   * 提取关键词和语义信息
   */
  extractKeywords(query: string): ExtractedKeywords {
    const normalizedQuery = this.normalizeQuery(query);
    
    const networkAddresses = this.extractNetworkAddresses(query);
    const commands = this.extractCommands(query);
    const semanticGroups = this.extractSemanticGroups(query);
    const intent = this.detectIntent(query, networkAddresses, commands, semanticGroups);
    
    // 提取基础关键词
    const basicKeywords = this.extractBasicKeywords(normalizedQuery);
    
    // 合并所有提取的信息
    const allKeywords = new Set([
      ...basicKeywords,
      ...networkAddresses.map(addr => addr.address),
      ...commands.map(cmd => cmd.command),
      ...semanticGroups.flatMap(group => group.elements)
    ]);

    return {
      keywords: Array.from(allKeywords),
      networkAddresses,
      commands,
      semanticGroups,
      intent
    };
  }

  /**
   * 标准化查询文本
   */
  private normalizeQuery(query: string): string {
    // 处理中文标点符号和特殊字符
    return query
      .replace(/[，。！？；：""''（）【】《》]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 提取网络地址信息
   */
  private extractNetworkAddresses(query: string): NetworkAddress[] {
    const addresses: NetworkAddress[] = [];
    const processed = new Set<string>(); // 避免重复

    // 提取CIDR地址
    const cidrMatches = query.match(this.networkPatterns.cidr);
    if (cidrMatches) {
      cidrMatches.forEach(match => {
        if (!processed.has(match)) {
          addresses.push({
            address: match,
            type: 'cidr',
            originalText: match,
            mask: match.split('/')[1]
          });
          processed.add(match);
        }
      });
    }

    // 提取IPv4地址（排除已经处理的CIDR）
    const ipv4Matches = query.match(this.networkPatterns.ipv4);
    if (ipv4Matches) {
      ipv4Matches.forEach(match => {
        // 只添加不是CIDR的纯IP地址
        if (!processed.has(match) && !query.includes(match + '/')) {
          addresses.push({
            address: match,
            type: 'ipv4',
            originalText: match
          });
          processed.add(match);
        }
      });
    }

    // 提取IP地址范围
    const rangeMatches = query.match(this.networkPatterns.range);
    if (rangeMatches) {
      rangeMatches.forEach(match => {
        if (!processed.has(match)) {
          addresses.push({
            address: match,
            type: 'range',
            originalText: match
          });
          processed.add(match);
        }
      });
    }

    return addresses;
  }

  /**
   * 提取命令信息
   */
  private extractCommands(query: string): CommandInfo[] {
    const commands: CommandInfo[] = [];
    const queryLower = query.toLowerCase();

    // 分析命令动作
    let action: CommandInfo['action'] = 'show'; // 默认动作
    if (queryLower.includes('配置') || queryLower.includes('config') || queryLower.includes('设置')) {
      action = 'configure';
    } else if (queryLower.includes('启用') || queryLower.includes('enable') || queryLower.includes('开启')) {
      action = 'enable';
    } else if (queryLower.includes('禁用') || queryLower.includes('disable') || queryLower.includes('关闭')) {
      action = 'disable';
    } else if (queryLower.includes('删除') || queryLower.includes('delete') || queryLower.includes('移除')) {
      action = 'delete';
    }

    // 提取主要命令词
    const commandMatches = query.match(/\b(?:acl|access-list|ip|interface|route|vlan|firewall|switch|router)\b/gi);
    if (commandMatches) {
      commandMatches.forEach(match => {
        commands.push({
          command: match.toLowerCase(),
          parameters: this.extractParameters(query),
          action,
          target: this.extractCommandTarget(query)
        });
      });
    }

    return commands;
  }

  /**
   * 提取命令参数
   */
  private extractParameters(query: string): string[] {
    const parameters: string[] = [];
    
    // 提取IP地址和网段作为参数
    const addresses = this.extractNetworkAddresses(query);
    parameters.push(...addresses.map(addr => addr.address));

    // 提取其他可能的参数（数字、标识符等）
    const paramMatches = query.match(/\b\d+\b/g);
    if (paramMatches) {
      parameters.push(...paramMatches);
    }

    return Array.from(new Set(parameters)); // 去重
  }

  /**
   * 提取命令目标
   */
  private extractCommandTarget(query: string): string {
    const queryLower = query.toLowerCase();
    
    // 识别配置目标
    if (queryLower.includes('访问控制') || queryLower.includes('acl')) {
      return 'access-control';
    } else if (queryLower.includes('路由')) {
      return 'routing';
    } else if (queryLower.includes('接口') || queryLower.includes('interface')) {
      return 'interface';
    } else if (queryLower.includes('vlan')) {
      return 'vlan';
    } else if (queryLower.includes('防火墙') || queryLower.includes('firewall')) {
      return 'firewall';
    }

    return 'general';
  }

  /**
   * 提取语义组
   */
  private extractSemanticGroups(query: string): SemanticGroup[] {
    const groups: SemanticGroup[] = [];
    const queryLower = query.toLowerCase();

    Object.entries(this.semanticPatterns).forEach(([groupType, pattern]) => {
      const matches = queryLower.match(pattern);
      if (matches && matches.length > 0) {
        groups.push({
          type: groupType as SemanticGroup['type'],
          elements: Array.from(new Set(matches.map(m => m.toLowerCase()))),
          confidence: matches.length / queryLower.split(/\s+/).length
        });
      }
    });

    return groups;
  }

  /**
   * 检测查询意图
   */
  private detectIntent(
    query: string, 
    networkAddresses: NetworkAddress[], 
    commands: CommandInfo[], 
    semanticGroups: SemanticGroup[]
  ): QueryIntent {
    const queryLower = query.toLowerCase();

    // 网络配置意图
    if (networkAddresses.length > 0 && commands.length > 0) {
      return 'network_config';
    }

    // 命令参考意图
    if (commands.length > 0 || queryLower.includes('命令') || queryLower.includes('command')) {
      return 'command_reference';
    }

    // 故障排除意图
    if (queryLower.includes('问题') || queryLower.includes('故障') || queryLower.includes('error') || queryLower.includes('失败')) {
      return 'troubleshooting';
    }

    // 检查语义组
    const hasNetworkConfig = semanticGroups.some(g => g.type === 'network_config');
    const hasAccessControl = semanticGroups.some(g => g.type === 'access_control');
    
    if (hasNetworkConfig || hasAccessControl) {
      return 'network_config';
    }

    return 'general';
  }

  /**
   * 提取基础关键词
   */
  private extractBasicKeywords(query: string): string[] {
    const keywords: string[] = [];
    
    // 1. 提取技术缩写（如BGP, OSPF, VLAN等）
    const acronyms = query.match(/\b[A-Z]{2,}\b/g);
    if (acronyms) {
      keywords.push(...acronyms.map(a => a.toLowerCase()));
    }

    // 2. 提取专有名词（如Nvidia, Cumulus, Linux等）
    const properNouns = query.match(/\b[A-Z][a-z]+\b/g);
    if (properNouns) {
      keywords.push(...properNouns.map(n => n.toLowerCase()));
    }

    // 3. 提取技术术语模式（如IPv4, IPv6, L2VPN等）
    const techTerms = query.match(/\b(?:[A-Z]+[a-z]*|[a-z]+[A-Z]+)\d*\b/g);
    if (techTerms) {
      keywords.push(...techTerms.map(t => t.toLowerCase()));
    }

    // 4. 提取普通词汇（过滤停用词）
    const words = query
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !this.stopWords.has(w));

    keywords.push(...words);

    // 5. 去重并返回
    return Array.from(new Set(keywords));
  }

  /**
   * 生成增强的搜索查询
   */
  generateEnhancedQuery(originalQuery: string): string {
    const extracted = this.extractKeywords(originalQuery);
    
    // 构建增强查询
    const queryParts: string[] = [];
    
    // 添加网络地址
    if (extracted.networkAddresses.length > 0) {
      queryParts.push(...extracted.networkAddresses.map(addr => addr.address));
    }
    
    // 添加命令信息
    if (extracted.commands.length > 0) {
      queryParts.push(...extracted.commands.map(cmd => `${cmd.command} ${cmd.action}`));
    }
    
    // 添加语义组
    if (extracted.semanticGroups.length > 0) {
      queryParts.push(...extracted.semanticGroups.flatMap(group => group.elements));
    }
    
    // 添加基础关键词
    queryParts.push(...extracted.keywords);
    
    return queryParts.join(' ');
  }
}

// 创建单例实例
export const advancedKeywordExtractor = new AdvancedKeywordExtractor();