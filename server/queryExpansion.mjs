/**
 * 查询扩展与智能改写模块
 * 功能：自动生成查询变体，提升召回率
 *
 * v2.0 增强：
 * - 扩充同义词词典（动作词、技术术语、对象词）
 * - 增加中英文互转映射
 * - 支持意图感知的扩展策略
 */

import { EXTENDED_TECHNICAL_KEYWORDS, BASE_COMMAND_PATTERNS } from './constants.mjs';

// ========== 扩充的同义词词典 ==========

/**
 * 动作词同义词组（7组）
 */
const ACTION_SYNONYMS = {
  // 配置类
  '配置': ['设置', '设定', 'config', 'configure', 'setup', '部署', 'configuration'],
  '设置': ['配置', '设定', 'set', 'config'],
  'configure': ['config', 'setup', 'set up', '配置'],

  // 列出/获取类（新增）
  '列出': ['查看', '显示', 'list', 'show', 'display', '获取', 'get'],
  'list': ['show', 'display', 'get', '列出', '查看'],

  // 查看类
  '查看': ['查询', '检查', '显示', 'show', 'display', 'view', 'list', '看', '列出'],
  '显示': ['查看', '展示', 'show', 'display', 'list'],
  'show': ['display', 'view', 'list', 'get', '查看', '显示', '列出'],

  // 删除类
  '删除': ['移除', '清除', 'remove', 'delete', 'unset', 'clear', '去掉'],
  'remove': ['delete', 'unset', 'clear', '删除', '移除'],

  // 启用类
  '启用': ['开启', '激活', '打开', 'enable', 'activate', 'start', 'turn on'],
  'enable': ['activate', 'start', 'turn on', '启用', '开启'],

  // 禁用类
  '禁用': ['关闭', '停用', '停止', 'disable', 'deactivate', 'stop', 'turn off'],
  'disable': ['deactivate', 'stop', 'turn off', '禁用', '关闭'],

  // 验证类
  '验证': ['检验', '校验', '确认', 'verify', 'validate', 'check', 'confirm'],
  'verify': ['validate', 'check', 'confirm', '验证', '确认'],

  // 排查类
  '排查': ['排错', '调试', '诊断', 'troubleshoot', 'debug', 'diagnose', '故障排查'],
  'troubleshoot': ['debug', 'diagnose', 'fix', '排查', '排错', '诊断']
};

/**
 * 技术术语同义词组（12组）
 */
const TECH_SYNONYMS = {
  // 网络协议
  'bgp': ['边界网关协议', 'border gateway protocol', 'ebgp', 'ibgp', 'bgp协议'],
  'ospf': ['开放最短路径优先', 'open shortest path first', 'ospfv2', 'ospfv3'],
  'evpn': ['以太网vpn', 'ethernet vpn', 'evpn-vxlan'],
  'vxlan': ['虚拟扩展局域网', 'virtual extensible lan', 'vxlan隧道'],
  'mlag': ['多机箱链路聚合', 'multi-chassis link aggregation', 'mc-lag', 'vPC'],
  'vrrp': ['虚拟路由冗余协议', 'virtual router redundancy protocol', 'vrr'],
  'lacp': ['链路聚合控制协议', 'link aggregation control protocol', 'bond', '链路聚合'],
  'stp': ['生成树协议', 'spanning tree protocol', 'rstp', 'mstp', 'pvst'],
  'bfd': ['双向转发检测', 'bidirectional forwarding detection'],

  // 网络功能
  'vlan': ['虚拟局域网', 'virtual lan', '虚拟网络'],
  'vrf': ['虚拟路由转发', 'virtual routing and forwarding', 'vrf实例'],
  'acl': ['访问控制列表', 'access control list', '访问列表', '过滤规则'],

  // RoCE/RDMA
  'roce': ['rdma over converged ethernet', 'rocev1', 'rocev2', 'rdma网络'],
  'rdma': ['远程直接内存访问', 'remote direct memory access'],
  'pfc': ['优先级流控', 'priority flow control', '无损网络'],
  'ecn': ['显式拥塞通知', 'explicit congestion notification'],

  // 厂商特定
  'cumulus': ['cumulus linux', 'nvidia cumulus', 'nvidia网络'],
  'nvue': ['nvidia用户体验', 'nv命令', 'nv set', 'nv show'],
  'netq': ['网络监控', 'nvidia netq', 'netq agent'],

  // 配置相关（新增）
  'configuration': ['配置', 'config', 'running-config', 'startup-config', '配置文件'],
  'running': ['当前', '运行中', 'active', '生效中']
};

/**
 * 对象词同义词组（7组）
 */
const OBJECT_SYNONYMS = {
  '接口': ['端口', 'interface', 'port', 'eth', 'swp', '网口'],
  '路由': ['路由表', 'route', 'routing', '路由条目', '路由信息'],
  '邻居': ['对等体', 'neighbor', 'peer', 'adjacency', '邻接', 'peering'],
  '链路': ['连接', 'link', 'connection', '链路状态'],
  '隧道': ['通道', 'tunnel', 'overlay', '封装'],
  '网关': ['默认网关', 'gateway', 'default gateway', 'next-hop'],
  '地址': ['IP地址', 'address', 'ip', 'ip addr', 'ip地址'],
  '设备': ['交换机', 'switch', 'device', '节点', 'node'],  // 新增
  '当前': ['current', 'running', 'active', '生效中']  // 新增
};

/**
 * 中英文互转映射（扩展版，9对+）
 */
const TRANSLATION_MAP = {
  // 动作词
  '配置': 'configure',
  '查看': 'show',
  '删除': 'remove',
  '启用': 'enable',
  '禁用': 'disable',
  '验证': 'verify',
  '排查': 'troubleshoot',
  '添加': 'add',
  '修改': 'modify',

  // 对象词
  '接口': 'interface',
  '路由': 'route',
  '邻居': 'neighbor',
  '状态': 'status',
  '网关': 'gateway',
  '地址': 'address',
  '链路': 'link',
  '隧道': 'tunnel',

  // 反向映射
  'configure': '配置',
  'config': '配置',
  'show': '查看',
  'display': '显示',
  'remove': '删除',
  'delete': '删除',
  'enable': '启用',
  'disable': '禁用',
  'verify': '验证',
  'troubleshoot': '排查',
  'interface': '接口',
  'route': '路由',
  'neighbor': '邻居',
  'status': '状态',
  'gateway': '网关',
  'address': '地址'
};

/**
 * 技术术语完整形式映射
 */
const ABBREVIATION_EXPANSIONS = {
  'bgp': 'border gateway protocol',
  'ospf': 'open shortest path first',
  'evpn': 'ethernet vpn',
  'vxlan': 'virtual extensible lan',
  'mlag': 'multi-chassis link aggregation',
  'vrrp': 'virtual router redundancy protocol',
  'lacp': 'link aggregation control protocol',
  'stp': 'spanning tree protocol',
  'rstp': 'rapid spanning tree protocol',
  'mstp': 'multiple spanning tree protocol',
  'bfd': 'bidirectional forwarding detection',
  'acl': 'access control list',
  'vlan': 'virtual lan',
  'vrf': 'virtual routing and forwarding',
  'roce': 'rdma over converged ethernet',
  'rdma': 'remote direct memory access',
  'pfc': 'priority flow control',
  'ecn': 'explicit congestion notification',
  'qos': 'quality of service',
  'ecmp': 'equal cost multi-path',
  'pim': 'protocol independent multicast',
  'igmp': 'internet group management protocol'
};

// ========== 实体提取 ==========

/**
 * 提取查询实体（命令、技术术语等）
 */
function extractEntities(query) {
  const safeQuery = typeof query === 'string' ? query : '';
  const entities = {
    commands: [],
    protocols: [],
    actions: [],
    objects: []
  };

  if (!safeQuery) {
    return entities;
  }

  const queryLower = safeQuery.toLowerCase();

  // 命令模式（使用统一的基础模式，添加全局标志）
  const commandPatterns = BASE_COMMAND_PATTERNS.map(p => new RegExp(p.source, 'gi'));

  for (const pattern of commandPatterns) {
    let match;
    while ((match = pattern.exec(queryLower)) !== null) {
      entities.commands.push(match[0]);
    }
  }

  // 协议/技术术语（使用扩展列表）
  const protocolKeywords = EXTENDED_TECHNICAL_KEYWORDS || [
    'bgp', 'ospf', 'evpn', 'vxlan', 'mlag', 'lacp', 'stp', 'vlan',
    'vrf', 'acl', 'bfd', 'roce', 'rdma', 'pfc', 'ecn', 'vrrp',
    'rstp', 'mstp', 'pim', 'igmp', 'ldp', 'mpls', 'isis', 'qos', 'ecmp'
  ];
  for (const proto of protocolKeywords) {
    if (queryLower.includes(proto)) {
      entities.protocols.push(proto);
    }
  }

  // 动作词（扩展列表）
  const actionKeywords = Object.keys(ACTION_SYNONYMS).filter(k => /[\u4e00-\u9fa5]/.test(k));
  for (const action of actionKeywords) {
    if (safeQuery.includes(action)) {
      entities.actions.push(action);
    }
  }

  // 英文动作词
  const englishActions = ['configure', 'show', 'remove', 'enable', 'disable', 'verify', 'troubleshoot', 'add', 'delete'];
  for (const action of englishActions) {
    if (queryLower.includes(action)) {
      entities.actions.push(action);
    }
  }

  // 对象词（扩展列表）
  const objectKeywords = Object.keys(OBJECT_SYNONYMS).filter(k => /[\u4e00-\u9fa5]/.test(k));
  for (const obj of objectKeywords) {
    if (safeQuery.includes(obj)) {
      entities.objects.push(obj);
    }
  }

  // 英文对象词
  const englishObjects = ['interface', 'route', 'neighbor', 'link', 'tunnel', 'gateway', 'address', 'port'];
  for (const obj of englishObjects) {
    if (queryLower.includes(obj)) {
      entities.objects.push(obj);
    }
  }

  return entities;
}

/**
 * 生成查询变体（增强版）
 * @param {string} query - 原始查询
 * @param {Object} options - 扩展选项
 * @param {string} options.intent - 查询意图（可选）
 * @param {number} options.maxVariants - 最大变体数（默认15）
 * @returns {string[]} 查询变体列表
 */
export function expandQuery(query, options = {}) {
  const { intent = null, maxVariants = 8 } = options;
  const normalizedQuery = typeof query === 'string' ? query : '';
  const variants = [normalizedQuery]; // 原始查询
  if (!normalizedQuery) {
    return variants;
  }

  const queryLower = normalizedQuery.toLowerCase();
  const entities = extractEntities(normalizedQuery);

  // 1. 中英文互转（使用扩展映射）
  for (const [term, translation] of Object.entries(TRANSLATION_MAP)) {
    if (normalizedQuery.includes(term) || queryLower.includes(term.toLowerCase())) {
      const regex = new RegExp(term, 'gi');
      const variant = normalizedQuery.replace(regex, translation);
      if (variant !== normalizedQuery) {
        variants.push(variant);
      }
    }
  }

  // 2. 添加技术缩写的完整形式（使用扩展映射）
  for (const [abbr, full] of Object.entries(ABBREVIATION_EXPANSIONS)) {
    if (queryLower.includes(abbr)) {
      variants.push(normalizedQuery.replace(new RegExp(abbr, 'gi'), full));
      // 同时生成中文变体（如果有）
      const techSyns = TECH_SYNONYMS[abbr];
      if (techSyns) {
        for (const syn of techSyns.slice(0, 2)) { // 只取前两个同义词
          if (syn !== full && !queryLower.includes(syn.toLowerCase())) {
            variants.push(normalizedQuery.replace(new RegExp(abbr, 'gi'), syn));
          }
        }
      }
    }
  }

  // 3. 问句转换为陈述句
  if (normalizedQuery.includes('如何') || normalizedQuery.includes('怎么') || normalizedQuery.includes('怎样')) {
    const withoutHow = normalizedQuery
      .replace(/如何|怎么|怎样/g, '')
      .replace(/？|\?/g, '')
      .trim();
    if (withoutHow) {
      variants.push(withoutHow);
      variants.push(withoutHow + ' 方法');
      variants.push(withoutHow + ' 步骤');
      variants.push(withoutHow + ' 配置');
    }
  }

  // 3.5 领域特定的查询改写（新增）
  // 针对"列出配置"类查询
  if (/列出.*配置|查看.*配置|显示.*配置|所有.*配置/.test(normalizedQuery)) {
    variants.push('nv config show');
    variants.push('nv show configuration');
    variants.push('show running-config');
    variants.push('show configuration');
    variants.push('running configuration');
  }

  // 针对"BGP邻居"类查询（增强版）
  if (/bgp.*邻居|bgp.*neighbor|查看.*bgp.*邻居|如何.*bgp.*邻居|bgp.*状态/i.test(normalizedQuery)) {
    variants.push('nv show vrf default router bgp neighbor');
    variants.push('nv show router bgp neighbor');
    variants.push('show bgp neighbor');
    variants.push('show ip bgp summary');
    variants.push('show bgp summary');
    variants.push('bgp neighbor status');
    variants.push('bgp peer status');
    variants.push('show bgp neighbor status');
    variants.push('check bgp neighbor');
    variants.push('view bgp neighbor');
    variants.push('vtysh show ip bgp summary');
    variants.push('BGP Route Information');
    variants.push('show bgp route');
  }

  // 针对"控制面防护/CoPP"类查询（新增）
  if (/控制面.*防护|control.*plane.*protection|copp|policer|控制面.*策略/i.test(normalizedQuery)) {
    variants.push('nv set system control-plane policeman');
    variants.push('control plane policer');
    variants.push('CoPP configuration');
    variants.push('nv set system control-plane');
    variants.push('control plane protection');
    variants.push('policers.conf');
    variants.push('control-plane rate limit');
    variants.push('system control-plane policeman');
  }

  // 4. 添加同义动作词（使用扩展词典）
  for (const action of entities.actions) {
    const synonyms = ACTION_SYNONYMS[action];
    if (synonyms) {
      for (const syn of synonyms.slice(0, 3)) { // 限制每个动作词的同义词数量
        const variant = normalizedQuery.replace(new RegExp(action, 'gi'), syn);
        if (variant !== normalizedQuery) {
          variants.push(variant);
        }
      }
    }
  }

  // 5. 添加同义对象词
  for (const obj of entities.objects) {
    const synonyms = OBJECT_SYNONYMS[obj];
    if (synonyms) {
      for (const syn of synonyms.slice(0, 2)) {
        const variant = normalizedQuery.replace(new RegExp(obj, 'gi'), syn);
        if (variant !== normalizedQuery) {
          variants.push(variant);
        }
      }
    }
  }

  // 6. 组合实体生成新查询
  if (entities.protocols.length > 0 && entities.actions.length > 0) {
    for (const proto of entities.protocols.slice(0, 2)) {
      for (const action of entities.actions.slice(0, 2)) {
        variants.push(`${action} ${proto}`);
        variants.push(`${proto} ${action}`);
      }
    }
  }

  // 7. 根据意图添加特定扩展
  if (intent) {
    addIntentBasedExpansions(normalizedQuery, queryLower, entities, intent, variants);
  }

  // 8. 故障排查类查询扩展
  if (/故障|错误|失败|不工作|无法|问题|error|fail|issue/i.test(normalizedQuery)) {
    variants.push(normalizedQuery.replace(/故障|错误|失败|问题/g, '排查'));
    variants.push(normalizedQuery.replace(/故障|错误|失败|问题/g, 'troubleshoot'));
    if (entities.protocols.length > 0) {
      variants.push(`${entities.protocols[0]} troubleshooting`);
      variants.push(`${entities.protocols[0]} 故障排查`);
    }
  }

  // 去重并限制数量
  const uniqueVariants = [...new Set(variants)].filter(v => v && v.trim());
  return uniqueVariants.slice(0, maxVariants);
}

/**
 * 根据意图添加特定扩展
 */
function addIntentBasedExpansions(query, queryLower, entities, intent, variants) {
  switch (intent) {
    case 'isConfig':
    case 'config':
      // 配置类：添加命令格式变体
      if (entities.protocols.length > 0) {
        const proto = entities.protocols[0];
        variants.push(`nv set ${proto}`);
        variants.push(`${proto} configuration`);
        variants.push(`configure ${proto}`);
        variants.push(`${proto} 配置命令`);
      }
      break;

    case 'isTroubleshoot':
    case 'troubleshoot':
      // 故障类：添加诊断相关变体
      if (entities.protocols.length > 0) {
        const proto = entities.protocols[0];
        variants.push(`${proto} debug`);
        variants.push(`${proto} 问题`);
        variants.push(`${proto} not working`);
        variants.push(`nv show ${proto}`);
      }
      break;

    case 'isConcept':
    case 'concept':
      // 概念类：添加定义相关变体
      if (entities.protocols.length > 0) {
        const proto = entities.protocols[0];
        variants.push(`what is ${proto}`);
        variants.push(`${proto} overview`);
        variants.push(`${proto} 概念`);
        variants.push(`${proto} 原理`);
      }
      break;

    case 'isShow':
    case 'show':
      // 查看类：添加命令变体
      if (entities.protocols.length > 0) {
        const proto = entities.protocols[0];
        variants.push(`nv show ${proto}`);
        variants.push(`show ${proto}`);
        variants.push(`${proto} status`);
        variants.push(`${proto} 状态`);
      }
      break;

    case 'isComparison':
    case 'comparison':
      // 比较类：添加对比相关变体
      variants.push(query.replace(/区别|差异|不同/, 'vs'));
      variants.push(query.replace(/区别|差异|不同/, 'comparison'));
      break;

    case 'isListRequest':
    case 'listRequest':
      // 列举类：添加列表相关变体
      variants.push(query.replace(/有哪些|列出|列举/, 'list all'));
      variants.push(query.replace(/有哪些|列出|列举/, 'all'));
      break;
  }
}

/**
 * 为查询添加上下文（基于历史查询）- 增强版
 * @param {string} query - 当前查询
 * @param {string[]} recentQueries - 最近查询列表
 * @param {Object} options - 选项
 * @returns {Object} 带上下文的查询对象
 */
export function addQueryContext(query, recentQueries = [], options = {}) {
  const { maxContextTerms = 3 } = options;
  const contextualQuery = {
    original: query,
    expanded: [query],
    contextTerms: [],
    hasContext: false
  };

  if (recentQueries.length === 0) {
    return contextualQuery;
  }

  // 提取最近查询中的关键技术术语（使用扩展列表）
  const recentTerms = new Map(); // term -> count
  const technicalTerms = Object.keys(TECH_SYNONYMS);

  for (const recent of recentQueries.slice(0, 5)) {
    const recentLower = (recent || '').toLowerCase();
    for (const term of technicalTerms) {
      if (recentLower.includes(term)) {
        recentTerms.set(term, (recentTerms.get(term) || 0) + 1);
      }
    }
  }

  // 按出现频率排序
  const sortedTerms = [...recentTerms.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxContextTerms)
    .map(([term]) => term);

  // 如果当前查询很短且没有技术术语，尝试添加上下文
  const queryLower = query.toLowerCase();
  const queryHasTechTerm = technicalTerms.some(term => queryLower.includes(term));

  if (query.length < 20 && !queryHasTechTerm && sortedTerms.length > 0) {
    contextualQuery.hasContext = true;
    contextualQuery.contextTerms = sortedTerms;

    for (const term of sortedTerms) {
      // 在查询前后添加上下文
      contextualQuery.expanded.push(`${term} ${query}`);
      contextualQuery.expanded.push(`${query} ${term}`);

      // 添加技术术语的同义词变体
      const synonyms = TECH_SYNONYMS[term];
      if (synonyms && synonyms[0]) {
        contextualQuery.expanded.push(`${synonyms[0]} ${query}`);
      }
    }
  } else if (sortedTerms.length > 0) {
    // 即使查询已有技术术语，也记录上下文信息
    contextualQuery.contextTerms = sortedTerms;
  }

  return contextualQuery;
}

/**
 * 智能查询改写（主入口）- 增强版
 * @param {string} query - 原始查询
 * @param {Object} options - 改写选项
 * @returns {Object} 改写结果
 */
export function smartQueryRewrite(query, options = {}) {
  const {
    enableExpansion = true,
    enableContext = false,
    recentQueries = [],
    intent = null,
    maxVariants = 15
  } = options;

  const result = {
    original: query,
    variants: [query],
    strategy: [],
    metadata: {
      intent,
      hasContext: false,
      contextTerms: [],
      expansionCount: 0
    }
  };

  // 1. 查询扩展
  if (enableExpansion) {
    const expanded = expandQuery(query, { intent, maxVariants });
    result.variants.push(...expanded);
    result.strategy.push('expansion');
    result.metadata.expansionCount = expanded.length - 1;
  }

  // 2. 上下文增强
  if (enableContext && recentQueries.length > 0) {
    const contextual = addQueryContext(query, recentQueries);
    result.variants.push(...contextual.expanded);
    result.strategy.push('context');
    result.metadata.hasContext = contextual.hasContext;
    result.metadata.contextTerms = contextual.contextTerms;
  }

  // 3. 根据意图调整变体顺序
  if (intent) {
    result.variants = prioritizeVariantsByIntent(result.variants, intent);
  }

  // 去重
  result.variants = [...new Set(result.variants)].filter(v => v && v.trim());

  console.log(`[QueryExpansion] 原查询: "${query}" → 生成${result.variants.length}个变体 (intent=${intent || 'default'})`);

  return result;
}

/**
 * 根据意图优先排序变体
 */
function prioritizeVariantsByIntent(variants, intent) {
  if (!intent || variants.length <= 1) return variants;

  const priorityPatterns = {
    'isConfig': [/nv\s+set/i, /configure/i, /config/i, /配置/],
    'config': [/nv\s+set/i, /configure/i, /config/i, /配置/],
    'isShow': [/nv\s+show/i, /show/i, /display/i, /查看/, /状态/],
    'show': [/nv\s+show/i, /show/i, /display/i, /查看/, /状态/],
    'isTroubleshoot': [/troubleshoot/i, /debug/i, /排查/, /故障/, /问题/],
    'troubleshoot': [/troubleshoot/i, /debug/i, /排查/, /故障/, /问题/],
    'isConcept': [/what is/i, /overview/i, /概念/, /原理/, /是什么/],
    'concept': [/what is/i, /overview/i, /概念/, /原理/, /是什么/]
  };

  const patterns = priorityPatterns[intent];
  if (!patterns) return variants;

  // 计算每个变体的优先级分数
  const scored = variants.map((v, index) => {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(v)) {
        score += 10;
      }
    }
    // 原始顺序作为次要排序依据
    score -= index * 0.01;
    return { variant: v, score };
  });

  // 按分数排序
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.variant);
}

/**
 * 导出词典供其他模块使用
 */
export const QUERY_EXPANSION_DICTIONARIES = {
  ACTION_SYNONYMS,
  TECH_SYNONYMS,
  OBJECT_SYNONYMS,
  TRANSLATION_MAP,
  ABBREVIATION_EXPANSIONS
};
