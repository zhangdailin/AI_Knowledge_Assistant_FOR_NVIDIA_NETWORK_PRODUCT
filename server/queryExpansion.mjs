/**
 * 查询扩展与智能改写模块
 * 功能：自动生成查询变体，提升召回率
 */

/**
 * 提取查询实体（命令、技术术语等）
 */
function extractEntities(query) {
  const entities = {
    commands: [],
    protocols: [],
    actions: [],
    objects: []
  };

  const queryLower = query.toLowerCase();

  // 命令模式
  const commandPatterns = [
    /nv\s+(set|show|config|unset|action)/g,
    /netq\s+(show|check|trace)/g,
    /ip\s+(route|link|addr)/g,
    /show\s+(\w+)/g,
    /config\s+(\w+)/g
  ];

  for (const pattern of commandPatterns) {
    let match;
    while ((match = pattern.exec(queryLower)) !== null) {
      entities.commands.push(match[0]);
    }
  }

  // 协议/技术术语
  const protocolKeywords = ['bgp', 'ospf', 'evpn', 'vxlan', 'mlag', 'lacp', 'stp', 'vlan', 'vrf', 'acl', 'bfd', 'roce', 'rdma', 'pfc', 'ecn'];
  for (const proto of protocolKeywords) {
    if (queryLower.includes(proto)) {
      entities.protocols.push(proto);
    }
  }

  // 动作词
  const actionKeywords = ['配置', '查看', '检查', '显示', '设置', '删除', '启用', '禁用', '验证', '调试'];
  for (const action of actionKeywords) {
    if (query.includes(action)) {
      entities.actions.push(action);
    }
  }

  // 对象词
  const objectKeywords = ['接口', '路由', '邻居', '状态', '配置', '日志', '错误', '性能'];
  for (const obj of objectKeywords) {
    if (query.includes(obj)) {
      entities.objects.push(obj);
    }
  }

  return entities;
}

/**
 * 生成查询变体
 */
export function expandQuery(query) {
  const variants = [query]; // 原始查询
  const queryLower = query.toLowerCase();
  const entities = extractEntities(query);

  // 1. 中英文互转
  const translations = {
    '配置': 'config',
    'config': '配置',
    '查看': 'show',
    'show': '查看',
    '状态': 'status',
    'status': '状态',
    '接口': 'interface',
    'interface': '接口',
    '路由': 'route',
    'route': '路由'
  };

  for (const [cn, en] of Object.entries(translations)) {
    if (query.includes(cn)) {
      variants.push(query.replace(new RegExp(cn, 'g'), en));
    }
  }

  // 2. 添加技术缩写的完整形式
  const abbreviations = {
    'bgp': 'border gateway protocol',
    'ospf': 'open shortest path first',
    'vxlan': 'virtual extensible lan',
    'mlag': 'multi-chassis link aggregation',
    'lacp': 'link aggregation control protocol',
    'acl': 'access control list'
  };

  for (const [abbr, full] of Object.entries(abbreviations)) {
    if (queryLower.includes(abbr)) {
      variants.push(query.replace(new RegExp(abbr, 'gi'), full));
    }
  }

  // 3. 问句转换为陈述句
  if (query.includes('如何') || query.includes('怎么')) {
    const withoutHow = query
      .replace(/如何|怎么|怎样/g, '')
      .replace(/？|\?/g, '')
      .trim();
    if (withoutHow) {
      variants.push(withoutHow);
      variants.push(withoutHow + ' 方法');
      variants.push(withoutHow + ' 步骤');
    }
  }

  // 4. 添加同义动作词
  const actionSynonyms = {
    '配置': ['设置', 'config', 'setup'],
    '查看': ['检查', 'show', 'display', '显示'],
    '删除': ['remove', 'unset', 'clear'],
    '启用': ['enable', 'start', '开启'],
    '禁用': ['disable', 'stop', '关闭']
  };

  for (const action of entities.actions) {
    const synonyms = actionSynonyms[action];
    if (synonyms) {
      for (const syn of synonyms) {
        variants.push(query.replace(action, syn));
      }
    }
  }

  // 5. 组合实体生成新查询
  if (entities.protocols.length > 0 && entities.actions.length > 0) {
    for (const proto of entities.protocols) {
      for (const action of entities.actions) {
        variants.push(`${action} ${proto}`);
        variants.push(`${proto} ${action}`);
      }
    }
  }

  // 去重并限制数量（避免过多查询）
  const uniqueVariants = [...new Set(variants)];
  return uniqueVariants.slice(0, 10); // 最多返回10个变体
}

/**
 * 为查询添加上下文（基于历史查询）
 */
export function addQueryContext(query, recentQueries = []) {
  const contextualQuery = { original: query, expanded: [query] };

  if (recentQueries.length === 0) {
    return contextualQuery;
  }

  // 提取最近查询中的关键技术术语
  const recentTerms = new Set();
  const technicalTerms = ['bgp', 'ospf', 'evpn', 'vxlan', 'mlag', 'roce', 'rdma'];

  for (const recent of recentQueries.slice(0, 3)) {
    const recentLower = recent.toLowerCase();
    for (const term of technicalTerms) {
      if (recentLower.includes(term)) {
        recentTerms.add(term);
      }
    }
  }

  // 如果当前查询很短且没有技术术语，尝试添加上下文
  if (query.length < 15 && recentTerms.size > 0) {
    const queryLower = query.toLowerCase();
    let hasRelevantTerm = false;
    for (const term of recentTerms) {
      if (queryLower.includes(term)) {
        hasRelevantTerm = true;
        break;
      }
    }

    // 如果当前查询没有明确的技术术语，可能是在延续之前的话题
    if (!hasRelevantTerm) {
      for (const term of recentTerms) {
        contextualQuery.expanded.push(`${query} ${term}`);
        contextualQuery.expanded.push(`${term} ${query}`);
      }
    }
  }

  return contextualQuery;
}

/**
 * 智能查询改写（主入口）
 */
export function smartQueryRewrite(query, options = {}) {
  const { enableExpansion = true, enableContext = false, recentQueries = [] } = options;

  const result = {
    original: query,
    variants: [query],
    strategy: []
  };

  // 1. 查询扩展
  if (enableExpansion) {
    const expanded = expandQuery(query);
    result.variants.push(...expanded);
    result.strategy.push('expansion');
  }

  // 2. 上下文增强
  if (enableContext && recentQueries.length > 0) {
    const contextual = addQueryContext(query, recentQueries);
    result.variants.push(...contextual.expanded);
    result.strategy.push('context');
  }

  // 去重
  result.variants = [...new Set(result.variants)];

  console.log(`[QueryExpansion] 原查询: "${query}" → 生成${result.variants.length}个变体`);

  return result;
}
