import { create } from 'zustand';
import { localStorageManager, Conversation, Message } from '../lib/localStorage';
import { AI_MODEL_CONFIG, CONVERSATION_CONFIG } from '../lib/constants';
import { enhancedNetworkKeywordExtractor } from '../lib/enhancedNetworkKeywordExtractor';
import { extractSNs } from './toolStore';
import { getApiServerUrl } from '../utils/apiUtils';

interface ChatState {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  messages: Message[];
  isLoading: boolean;
  deepThinking: boolean;
  abortController: AbortController | null;

  loadConversations: (userId: string) => void;
  createConversation: (userId: string, title: string) => void;
  selectConversation: (conversation: Conversation) => void;
  deleteConversation: (conversationId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  setDeepThinking: (value: boolean) => void;
  stopGeneration: () => void;
  clearHistory: () => void;
  submitFeedback: (messageId: string, verdict: 'up' | 'down') => Promise<void>;
}

type KnowledgeSearchResult = {
  id?: string;
  documentId?: string;
  chunkIndex?: number;
  metadata?: {
    header?: string;
    summary?: string;
    breadcrumbs?: string[];
  };
  title: string;
  content: string;
  score: number;
  rrfScore: number;
  rerankScore: number;
};

async function searchKnowledgeBase(
  query: string,
  categoryId?: string,
  limit: number = 20
): Promise<KnowledgeSearchResult[]> {
  try {
    // 增加搜索数量以获得更好的结果（从10增加到20）
    const categoryParam = categoryId ? `&categoryId=${encodeURIComponent(categoryId)}` : '';
    const res = await fetch(`${getApiServerUrl()}/api/chunks/search?q=${encodeURIComponent(query)}&limit=${limit}${categoryParam}`);
    if (!res.ok) return [];
    const data = await res.json();

    // 调试：检查第一个chunk的结构
    if (data.chunks && data.chunks.length > 0) {
      console.log('[Search] 第一个chunk的原始数据:', {
        _score: data.chunks[0]._score,
        rerank_score: data.chunks[0].rerank_score,
        score: data.chunks[0].score,
        allKeys: Object.keys(data.chunks[0])
      });
    }

    const results = (data.chunks || []).map((chunk: any) => {
      // 后端返回的分数字段是 score（已经是混合分数或rerank分数）
      const finalScore = typeof chunk.score === 'number' ? chunk.score : 0;

      // 保留原始分数用于调试
      const rrfScore = typeof chunk._score === 'number' ? chunk._score : 0;
      const rerankScore = typeof chunk.rerank_score === 'number' ? chunk.rerank_score : 0;

      const chunkTitle =
        chunk?.metadata?.header ||
        chunk?.metadata?.title ||
        chunk?.sectionTitle ||
        chunk?.title ||
        (chunk.documentId ? `文档 ${chunk.documentId}` : '知识库片段');
      return {
        id: chunk.id,
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        metadata: chunk.metadata,
        title: chunkTitle,
        content: chunk.content,
        score: finalScore,
        rrfScore,
        rerankScore
      };
    });

    // 按分数降序排序
    return results.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error('[Search] 知识库搜索失败:', error);
    return [];
  }
}

type QueryIntent = {
  isConfig: boolean;
  isTroubleshoot: boolean;
  isShow: boolean;
  isConcept: boolean;
};

function inferQueryIntent(query: string): QueryIntent {
  const lower = query.toLowerCase();
  return {
    isConfig: /配置|设置|安装|部署|步骤|how to|configure|configuration|setup/i.test(query),
    isTroubleshoot: /故障|异常|错误|问题|排错|debug|troubleshoot|error|fail|issue/i.test(lower),
    isShow: /查看|查询|显示|状态|show|display|list|get|status|state/i.test(lower),
    isConcept: /什么是|含义|定义|原理|概念|overview|introduction|what is|definition/i.test(lower)
  };
}

function isConfigHeavyQuery(query: string): boolean {
  return inferQueryIntent(query).isConfig;
}

// 提取查询关键词（简单实现）
function extractKeywords(query: string): string[] {
  const stopWords = ['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这'];
  const words = (query.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]{2,}/g) || [])
    .filter(w => w.length > 1 && !stopWords.includes(w));
  return words;
}

function collectIntentTokens(query: string): string[] {
  const tokens = new Set<string>();
  const lower = query.toLowerCase();

  if (/配置|设置|安装|部署|步骤|流程|how to|configure|configuration|setup/i.test(query)) {
    tokens.add('配置');
    tokens.add('步骤');
    tokens.add('configure');
    tokens.add('configuration');
    tokens.add('setup');
    tokens.add('steps');
  }

  if (/示例|例子|example/i.test(query)) {
    tokens.add('示例');
    tokens.add('example');
  }

  if (/要求|前提|依赖|准备|prerequisite|requirement/i.test(query)) {
    tokens.add('要求');
    tokens.add('requirements');
    tokens.add('prerequisite');
  }

  if (/查看|查询|显示|状态|show|display|list|get|status|state/i.test(lower)) {
    tokens.add('show');
    tokens.add('status');
  }

  if (/故障|异常|错误|问题|排错|debug|troubleshoot|error|fail|issue/i.test(lower)) {
    tokens.add('troubleshoot');
    tokens.add('error');
  }

  return Array.from(tokens);
}

function buildCoverageTokens(query: string): string[] {
  const tokens = new Set(extractKeywords(query).map(token => token.toLowerCase()));
  for (const token of collectIntentTokens(query)) {
    tokens.add(token.toLowerCase());
  }
  const acronyms = query.match(/\b[A-Z]{2,6}\b/g) || [];
  acronyms.forEach(token => tokens.add(token.toLowerCase()));
  return Array.from(tokens).filter(Boolean);
}

function classifyReference(text: string): Set<string> {
  const lower = text.toLowerCase();
  const categories = new Set<string>();

  if (/basic configuration|基础配置/.test(lower)) categories.add('basic');
  if (/configuration example|示例|example/.test(lower)) categories.add('example');
  if (/requirements|prerequisite|前提|要求/.test(lower)) categories.add('requirements');
  if (/steps|procedure|步骤|流程|follow these steps/.test(lower) || /(^|\n)\s*(?:step\s*)?\d+\s*[.)]/i.test(text)) {
    categories.add('steps');
  }
  if (/overview|introduction|概述|简介/.test(lower)) categories.add('overview');
  if (/nv set|\bset\b|\bconfigure\b|\bconfiguration\b/.test(lower)) categories.add('command_set');
  if (/nv show|\bshow\b|\bdisplay\b|\blist\b|\bget\b/.test(lower)) categories.add('command_show');
  if (/command|cli|```/.test(lower)) categories.add('commands');
  if (/troubleshooting|排错|故障|错误/.test(lower)) categories.add('troubleshooting');

  return categories;
}

function getCategoryWeights(intent: QueryIntent): Record<string, number> {
  if (intent.isConfig) {
    return {
      basic: 3,
      steps: 4,
      example: 2.5,
      requirements: 2,
      command_set: 2,
      commands: 1,
      command_show: -1,
      troubleshooting: -2,
      overview: 0.5
    };
  }

  if (intent.isTroubleshoot) {
    return {
      troubleshooting: 4,
      command_show: 2,
      commands: 1.5,
      steps: 1,
      basic: 0.5,
      example: 0.5
    };
  }

  if (intent.isShow) {
    return {
      command_show: 3,
      commands: 1.5,
      basic: 0.5,
      steps: 0.5,
      example: 0.5,
      troubleshooting: 0.5
    };
  }

  if (intent.isConcept) {
    return {
      overview: 3,
      basic: 1,
      steps: 0.5,
      example: 0.5,
      commands: -1
    };
  }

  return {
    basic: 1,
    steps: 1,
    example: 1,
    requirements: 0.5,
    command_set: 0.5,
    command_show: 0.5
  };
}

function selectReferencesForQuery(
  results: KnowledgeSearchResult[],
  query: string,
  maxRefs: number
): KnowledgeSearchResult[] {
  if (results.length <= maxRefs) return results;

  const intent = inferQueryIntent(query);
  const tokens = buildCoverageTokens(query);
  const coveredTokens = new Set<string>();
  const coveredCategories = new Set<string>();
  const selected: KnowledgeSearchResult[] = [];
  const used = new Set<string>();

  const candidates = results.map(result => {
    const title = result.title || '';
    const content = result.content || '';
    const summary = result.metadata?.summary || '';
    const combined = `${title}\n${summary}\n${content}`.toLowerCase();
    const matchedTokens = new Set(tokens.filter(token => combined.includes(token)));
    const categories = classifyReference(combined);
    return { result, matchedTokens, categories };
  });

  const categoryWeights = getCategoryWeights(intent);
  const primaryDocId = intent.isConfig
    ? candidates
      .filter(entry => entry.result.documentId && (entry.categories.has('basic') || entry.categories.has('steps') || entry.categories.has('example')))
      .sort((a, b) => (b.result.score || 0) - (a.result.score || 0))[0]?.result.documentId
    : null;

  for (let i = 0; i < maxRefs; i += 1) {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let idx = 0; idx < candidates.length; idx += 1) {
      const entry = candidates[idx];
      const identity = entry.result.id || entry.result.title || String(idx);
      if (used.has(identity)) continue;

      let tokenGain = 0;
      for (const token of entry.matchedTokens) {
        if (!coveredTokens.has(token)) tokenGain += 1;
      }

      let categoryGain = 0;
      for (const category of entry.categories) {
        const weight = categoryWeights[category] ?? 0.5;
        const novelty = coveredCategories.has(category) ? 0.2 : 1;
        categoryGain += weight * novelty;
      }

      // 对于配置类查询，提高原始分数的权重，确保高分文档优先
      let baseScore = typeof entry.result.score === 'number' ? entry.result.score : 0;
      if (intent.isConfig) {
        // 配置查询：直接使用原始分数并放大权重（不压缩）
        baseScore = baseScore * 2.5;
      } else {
        // 非配置查询：使用对数压缩，平衡多样性
        baseScore = Math.log1p(baseScore);
      }

      const docAffinity = primaryDocId && entry.result.documentId === primaryDocId ? 1.2 : 0;
      let adjacencyBonus = 0;
      if (entry.result.documentId && typeof entry.result.chunkIndex === 'number') {
        for (const chosen of selected) {
          if (chosen.documentId !== entry.result.documentId || typeof chosen.chunkIndex !== 'number') continue;
          const distance = Math.abs(entry.result.chunkIndex - chosen.chunkIndex);
          if (distance === 1) adjacencyBonus = Math.max(adjacencyBonus, 2.5);
          else if (distance === 2) adjacencyBonus = Math.max(adjacencyBonus, 1.5);
          else if (distance === 3) adjacencyBonus = Math.max(adjacencyBonus, 0.8);
        }
      }
      if (intent.isConfig) adjacencyBonus *= 1.2;

      // 对于配置查询，降低多样性因子的权重，让相关性主导
      const diversityWeight = intent.isConfig ? 0.8 : 1.3;
      const score = baseScore + tokenGain * diversityWeight + categoryGain + docAffinity + adjacencyBonus;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = idx;
      }
    }

    if (bestIndex === -1) break;
    const chosen = candidates[bestIndex];
    const chosenId = chosen.result.id || chosen.result.title || String(bestIndex);
    used.add(chosenId);
    selected.push(chosen.result);

    for (const token of chosen.matchedTokens) coveredTokens.add(token);
    for (const category of chosen.categories) coveredCategories.add(category);
  }

  return selected;
}

// 智能拆解复杂查询为多个子查询
function decomposeComplexQuery(query: string): string[] {
  const subQueries: string[] = [];
  const queryLower = query.toLowerCase();

  // 检测网络配置相关的技术术语
  const techPatterns = [
    { keywords: ['mlag', 'multi-chassis', '多机箱'], subQuery: 'MLAG配置' },
    { keywords: ['vrrp', 'vrr', 'virtual router', '虚拟路由', '虚拟网关'], subQuery: 'VRRP虚拟网关配置' },
    { keywords: ['vlan', '虚拟局域网'], subQuery: 'VLAN配置' },
    { keywords: ['route', 'routing', '路由', '默认路由', 'default route'], subQuery: '路由配置' },
    { keywords: ['gateway', '网关'], subQuery: '网关配置' },
    { keywords: ['bgp', 'border gateway'], subQuery: 'BGP配置' },
    { keywords: ['ospf', 'open shortest'], subQuery: 'OSPF配置' },
    { keywords: ['evpn', 'ethernet vpn'], subQuery: 'EVPN配置' },
    { keywords: ['vxlan', 'virtual extensible'], subQuery: 'VXLAN配置' },
    { keywords: ['bond', 'lacp', 'link aggregation', '链路聚合'], subQuery: 'Bond链路聚合配置' },
  ];

  // 检测匹配的技术领域
  for (const pattern of techPatterns) {
    if (pattern.keywords.some(kw => queryLower.includes(kw))) {
      subQueries.push(pattern.subQuery);
    }
  }

  // 如果检测到多个技术领域，说明是复杂查询
  if (subQueries.length >= 2) {
    const uniqueQueries = Array.from(new Set([query, ...subQueries]));
    console.log('[QueryDecompose] 检测到复杂查询，拆解为:', uniqueQueries);
    return uniqueQueries;
  }

  // 单一技术领域或无法识别，返回原查询
  return [query];
}

// 自动检测查询应该搜索的分类
async function detectCategory(query: string): Promise<string | undefined> {
  const queryLower = query.toLowerCase();
  const extractedVendors = enhancedNetworkKeywordExtractor.extractKeywords(query).vendors || [];
  const normalizedVendors = new Set(
    extractedVendors
      .map(v => v.toLowerCase().replace(/^the\s+/, '').trim())
      .filter(Boolean)
  );

  // 获取所有分类
  try {
    const res = await fetch(`${getApiServerUrl()}/api/categories`);
    if (!res.ok) return undefined;
    const data = await res.json();
    const categories = data.tree || [];

    // 递归查找匹配的分类
    const findMatchingCategory = (nodes: any[]): string | undefined => {
      for (const node of nodes) {
        const nameLower = node.name.toLowerCase();
        if (nameLower === 'default' || nameLower === '默认分类') {
          continue;
        }

        // 检查分类名称是否在查询中
        if (queryLower.includes(nameLower)) {
          console.log(`[CategoryDetect] 检测到分类: ${node.name} (ID: ${node.id})`);
          return node.id;
        }

        if (normalizedVendors.has(nameLower)) {
          console.log(`[CategoryDetect] 检测到厂商分类: ${node.name} (ID: ${node.id})`);
          return node.id;
        }

        for (const vendor of normalizedVendors) {
          if (vendor.includes(nameLower) || nameLower.includes(vendor)) {
            console.log(`[CategoryDetect] 模糊匹配厂商分类: ${node.name} (ID: ${node.id})`);
            return node.id;
          }
        }

        // 检查子分类
        if (node.children && node.children.length > 0) {
          const childMatch = findMatchingCategory(node.children);
          if (childMatch) return childMatch;
        }
      }
      return undefined;
    };

    return findMatchingCategory(categories);
  } catch (error) {
    console.error('[CategoryDetect] 分类检测失败:', error);
    return undefined;
  }
}


// 合并去重多个检索结果
function mergeSearchResults(resultsList: KnowledgeSearchResult[][]): KnowledgeSearchResult[] {
  const mergedMap = new Map<string, KnowledgeSearchResult>();

  for (const results of resultsList) {
    for (const result of results) {
      const key = result.id || result.content.substring(0, 100);
      if (!mergedMap.has(key)) {
        mergedMap.set(key, result);
      } else {
        // 如果已存在，保留分数更高的
        const existing = mergedMap.get(key)!;
        if (result.score > existing.score) {
          mergedMap.set(key, result);
        }
      }
    }
  }

  // 按分数降序排序
  return Array.from(mergedMap.values()).sort((a, b) => b.score - a.score);
}

// 多级检索策略（增强版：支持复杂查询自动拆解 + 自动分类检测）
async function multiLevelSearch(query: string): Promise<{
  results: KnowledgeSearchResult[];
  searchLevel: number;
  hasRelevantKnowledge: boolean;
}> {
  console.log('[Search] 开始多级检索，查询:', query);
  const searchLimit = isConfigHeavyQuery(query) ? 160 : 20;

  // 步骤0A：自动检测分类
  const detectedCategoryId = await detectCategory(query);
  if (detectedCategoryId) {
    console.log(`[Search] 将限制搜索范围到分类: ${detectedCategoryId}`);
  }

  // 步骤0B：智能拆解复杂查询
  const subQueries = decomposeComplexQuery(query);
  let allResults: KnowledgeSearchResult[] = [];

  if (subQueries.length > 1) {
    // 复杂查询：对每个子查询进行检索
    console.log('[Search] 执行多轮检索，子查询数量:', subQueries.length);
    const resultsList: KnowledgeSearchResult[][] = [];

    for (const subQuery of subQueries) {
      console.log('[Search] 检索子查询:', subQuery);
      const subResults = await searchKnowledgeBase(subQuery, detectedCategoryId, searchLimit);
      if (subResults.length > 0) {
        resultsList.push(subResults);
      }
    }

    // 合并所有子查询的结果
    allResults = mergeSearchResults(resultsList);
    console.log('[Search] 多轮检索完成，合并后结果数量:', allResults.length);
  } else {
    // 简单查询：直接检索
    allResults = await searchKnowledgeBase(query, detectedCategoryId, searchLimit);
  }

  // 第一级：标准检索
  let results = allResults;
  const maxScore = results.reduce((max, r) => Math.max(max, r.score), 0);
  const avgScore = results.length > 0
    ? results.slice(0, 3).reduce((sum, r) => sum + r.score, 0) / Math.min(3, results.length)
    : 0;

  // 检查是否有 rerank 分数（更准确）
  const maxRerankScore = results.reduce((max, r) => Math.max(max, r.rerankScore || 0), 0);
  const hasRerank = maxRerankScore > 0;

  // 判断第一级是否成功
  // 关键优化：如果有 rerank 分数，优先使用 rerank 判断（更准确）
  // rerank 分数范围 0-1，0.6+ 表示高相关，0.45+ 表示中等相关
  const level1Pass = hasRerank
    ? maxRerankScore > 0.6  // 有 rerank 时只看 rerank 分数（从0.7降低到0.6）
    : (maxScore > 0.020 || (results.length >= 2 && avgScore > 0.015));  // 无 rerank 时看 embedding 分数

  if (level1Pass) {
    console.log('[Search] 第一级检索成功，最高分:', maxScore.toFixed(4), hasRerank ? `(Rerank: ${maxRerankScore.toFixed(4)})` : '');
    return { results, searchLevel: 1, hasRelevantKnowledge: true };
  }

  console.log('[Search] 第一级检索分数较低，尝试第二级检索');

  // 第二级：降低阈值，接受更低分数的结果
  const level2Pass = hasRerank
    ? maxRerankScore > 0.48  // 有 rerank 时只看 rerank 分数（从0.55降低到0.48）
    : (maxScore > 0.010 || (results.length >= 2 && avgScore > 0.007));  // 无 rerank 时看 embedding 分数

  if (level2Pass) {
    console.log('[Search] 第二级检索成功（降低阈值），最高分:', maxScore.toFixed(4), hasRerank ? `(Rerank: ${maxRerankScore.toFixed(4)})` : '');
    return { results, searchLevel: 2, hasRelevantKnowledge: true };
  }

  console.log('[Search] 第二级检索失败，尝试第三级检索（关键词搜索）');

  // 第三级：提取关键词，逐个搜索
  const keywords = extractKeywords(query);
  if (keywords.length > 0) {
    console.log('[Search] 提取关键词:', keywords);
    const keywordQuery = keywords.slice(0, 3).join(' '); // 取前3个关键词
    const keywordResults = await searchKnowledgeBase(keywordQuery, detectedCategoryId, searchLimit);
    const keywordMaxScore = keywordResults.reduce((max, r) => Math.max(max, r.score), 0);
    const keywordMaxRerankScore = keywordResults.reduce((max, r) => Math.max(max, r.rerankScore || 0), 0);
    const keywordHasRerank = keywordMaxRerankScore > 0;

    // 关键词搜索的阈值
    const level3Pass = keywordHasRerank
      ? keywordMaxRerankScore > 0.40  // 有 rerank 时只看 rerank 分数（从0.45降低到0.40）
      : (keywordMaxScore > 0.006 && keywordResults.length > 0);  // 无 rerank 时看 embedding 分数

    if (level3Pass) {
      console.log('[Search] 第三级检索成功（关键词），最高分:', keywordMaxScore.toFixed(4), keywordHasRerank ? `(Rerank: ${keywordMaxRerankScore.toFixed(4)})` : '');
      return { results: keywordResults, searchLevel: 3, hasRelevantKnowledge: true };
    }
  }

  // 第四级：即使分数很低，只要有结果就返回，让LLM自己判断是否相关
  if (results.length > 0) {
    console.log('[Search] 分数较低但仍有检索结果，返回给LLM判断，结果数:', results.length);
    return { results, searchLevel: 4, hasRelevantKnowledge: true };
  }

  console.log('[Search] 真的没有任何检索结果，使用 Gemini');
  return { results: [], searchLevel: 4, hasRelevantKnowledge: false };
}

// SN-IBLF 工具调用
async function callSnIblfTool(snList: string[]): Promise<any> {
  try {
    const res = await fetch(`${getApiServerUrl()}/api/sn-to-iblf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snList })
    });
    const data = await res.json();
    return data.ok ? data : null;
  } catch {
    return null;
  }
}

// 检查工具是否启用
function isToolEnabled(toolId: string): boolean {
  const saved = localStorage.getItem('ai_tools_config');
  if (!saved) return true; // 默认启用
  try {
    const tools = JSON.parse(saved);
    const tool = tools.find((t: any) => t.id === toolId);
    return tool?.enabled ?? true;
  } catch {
    return true;
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversation: null,
  messages: [],
  isLoading: false,
  deepThinking: false,
  abortController: null,

  loadConversations: (userId: string) => {
    const conversations = localStorageManager.getConversations(userId);
    set({ conversations });
  },

  createConversation: (userId: string, title: string) => {
    const newConversation = localStorageManager.createConversation(userId, title);
    const conversations = localStorageManager.getConversations(userId);
    set({
      conversations,
      currentConversation: newConversation,
      messages: []
    });
  },

  selectConversation: (conversation: Conversation) => {
    const messages = localStorageManager.getMessages(conversation.id);
    set({ currentConversation: conversation, messages });
  },

  deleteConversation: async (conversationId: string) => {
    const { currentConversation, conversations } = get();
    localStorageManager.deleteConversation(conversationId);

    const updatedConversations = conversations.filter(c => c.id !== conversationId);

    if (currentConversation?.id === conversationId) {
      const nextConversation = updatedConversations[0] || null;
      const nextMessages = nextConversation
        ? localStorageManager.getMessages(nextConversation.id)
        : [];
      set({
        conversations: updatedConversations,
        currentConversation: nextConversation,
        messages: nextMessages
      });
    } else {
      set({ conversations: updatedConversations });
    }
  },

  setDeepThinking: (value: boolean) => {
    set({ deepThinking: value });
  },

  stopGeneration: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
      set({ abortController: null, isLoading: false });
    }
  },

  sendMessage: async (content: string) => {
    const { currentConversation, messages, deepThinking, abortController: existingController } = get();

    if (!currentConversation) {
      console.error('No current conversation');
      return;
    }

    // 取消之前的请求（如果存在）
    if (existingController) {
      existingController.abort();
    }

    const userMessage = localStorageManager.addMessage({
      conversationId: currentConversation.id,
      role: 'user',
      content
    });

    const abortController = new AbortController();
    set({
      messages: [...messages, userMessage],
      isLoading: true,
      abortController
    });

    const startTime = Date.now(); // 记录开始时间

    try {
      // 检测是否需要调用 SN-IBLF 工具
      let snIblfResult = null;
      let queriedSNs: string[] = [];
      if (isToolEnabled('sn-iblf')) {
        queriedSNs = extractSNs(content);
        if (queriedSNs.length > 0) {
          console.log('[Chat] 检测到SN号码:', queriedSNs);
          snIblfResult = await callSnIblfTool(queriedSNs);
        }
      }

      // 使用多级检索策略搜索知识库
      const searchResult = await multiLevelSearch(content);
      const knowledgeResults = searchResult.results;
      const searchLevel = searchResult.searchLevel;

      console.log('[Chat] 检索级别:', searchLevel, '结果数量:', knowledgeResults.length);
      if (knowledgeResults.length > 0) {
        console.log('[Chat] 原始检索Top5:', knowledgeResults.slice(0, 5).map((r, i) =>
          `[${i + 1}] ${r.title} (score: ${r.score.toFixed(4)})`
        ).join(', '));
      }

      // Build context from knowledge base
      let knowledgeContext = '';
      let useGemini = false;

      const isConfigQuery = isConfigHeavyQuery(content);
      const maxReferences = isConfigQuery ? 14 : 8;
      const topReferences = isConfigQuery
        ? selectReferencesForQuery(knowledgeResults, content, maxReferences)
        : knowledgeResults.slice(0, maxReferences);

      // 关键修复：只要有检索结果，就提供给LLM，让LLM自己判断是否相关
      // 不再依赖阈值来决定是否使用知识库内容
      if (knowledgeResults.length > 0 && topReferences.length > 0) {
        // 取前8-14条最相关的内容，提供更丰富的上下文
        const contextPrefix = searchLevel === 1
          ? '相关知识库内容：'
          : searchLevel === 2
            ? '相关知识库内容（扩展搜索）：'
            : searchLevel === 3
              ? '相关知识库内容（关键词匹配）：'
              : '知识库检索结果：';

        knowledgeContext = '\n\n' + contextPrefix + '\n' +
          topReferences.map((r, i) => `[参考${i + 1}] 标题：${r.title || '无标题'}\n内容：${r.content}`).join('\n\n---\n\n');

        console.log(`[Chat] 已为LLM提供 ${topReferences.length} 条参考文档 (检索级别: ${searchLevel})`);
        console.log('[Chat] 参考文档标题:', topReferences.map((r, i) => `[${i + 1}] ${r.title}`).join(', '));
        console.log('[Chat] 参考文档分数:', topReferences.map((r, i) => `[${i + 1}] ${r.score.toFixed(4)}`).join(', '));
        console.log('[Chat] 知识库上下文长度:', knowledgeContext.length, '字符');
      } else {
        // 真的没有任何检索结果，使用 Gemini
        useGemini = true;
        console.log('[Chat] 知识库无检索结果，使用 Gemini');
      }

      // Build conversation history
      const recentMessages = messages.slice(-CONVERSATION_CONFIG.MAX_HISTORY_MESSAGES);
      const historyMessages = recentMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));

      // 获取当前日期
      const now = new Date();
      const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

      const CONFIG_TEMPLATE = `
对于配置类问题，请严格遵守以下输出格式：
1. **场景说明**：简要描述配置场景和目标。
2. **[设备名称]**：
   - NVUE CLI Commands:
   \`\`\`bash
   # <功能描述>
   nv set ...
   \`\`\`
   *(如果有多个设备，请重复此结构)*
3. **验证步骤**：
   - 列出 nv show 或 linux 命令
4. **实施注意事项** (Important Implementation Notes)：
   - 列出关键点、MAC地址要求、VLAN注意事项等
`;

      const systemPrompt = useGemini
        ? `你是AI助手"小张" (${dateStr})。请用中文专业、准确地回答问题。`
        : `你是AI知识助手"小张"。
任务：基于参考文档回答用户问题。
规则：
1. **严格基于参考文档**，禁止编造命令或配置。
2. 在回答中引用信息时，**必须在句末使用 [1]、[2] 等格式标注来源**，与参考文档序号对应。
3. 若文档无相关信息，请明确告知。
4. 保持专业、条理清晰，使用中文。
${isConfigQuery ? `5. 配置问题请严格使用以下模板：\n${CONFIG_TEMPLATE}` : ''}

参考文档：
${knowledgeContext}`;

      // Use backend proxy to avoid CORS
      const response = await fetch(`${getApiServerUrl()}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          // 不发送 model，让后端使用配置的模型
          messages: [
            { role: 'system', content: systemPrompt },
            ...historyMessages,
            { role: 'user', content }
          ],
          max_tokens: AI_MODEL_CONFIG.MAX_TOKENS,
          temperature: deepThinking ? AI_MODEL_CONFIG.DEEP_THINKING_TEMPERATURE : AI_MODEL_CONFIG.DEFAULT_TEMPERATURE,
          useGemini,
          question: content,
          // 传递前8-14条参考文档用于验证，与上下文保持一致
          references: topReferences.length > 0 ? topReferences.map((r, idx) => ({
            id: r.id ?? `ref-${idx}`,
            title: r.title ?? `参考文档 #${idx + 1}`,
            content: r.content,
            documentId: r.documentId ?? undefined
          })) : []
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API 请求失败: ${response.status}`);
      }

      const data = await response.json();
      const assistantContent = data.choices?.[0]?.message?.content || '抱歉，我无法生成回复。';
      const modelUsed = data.source === 'gemini' ? 'Gemini' : (data.model || '已配置模型');
      const validation = data.validation;

      const assistantMessage = localStorageManager.addMessage({
        conversationId: currentConversation.id,
        role: 'assistant',
        content: assistantContent,
        metadata: {
          model: modelUsed,
          deepThinking,
          // 保存前8-14条参考文档，提供更完整的来源信息
          references: topReferences.length > 0 ? topReferences.map((r, idx) => ({
            id: r.id ?? `ref-${idx}`,
            documentId: r.documentId ?? undefined,
            title: r.title ?? `参考文档 #${idx + 1}`,
            content: r.content,
            score: r.score,
            // 传递合并元数据
            mergedHeaders: (r as any).mergedHeaders,
            mergedIds: (r as any).mergedIds,
            isOptimized: (r as any).isOptimized
          })) : [],
          validation,
          relatedMessageId: userMessage.id,
          // 添加工具调用结果
          toolResults: snIblfResult ? {
            snIblf: {
              queriedSNs,
              result: snIblfResult
            }
          } : undefined
        }
      });

      set(state => ({
        messages: [...state.messages, assistantMessage],
        isLoading: false,
        abortController: null
      }));

      // 记录查询日志
      const responseTime = Date.now() - startTime;
      fetch(`${getApiServerUrl()}/api/query-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: content, responseTime })
      }).catch(() => { }); // 静默失败

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Generation stopped by user');
      } else {
        console.error('Send message error:', error);
        const errorMessage = localStorageManager.addMessage({
          conversationId: currentConversation.id,
          role: 'assistant',
          content: `抱歉，发生错误：${error.message}`,
          metadata: { error: true, errorMessage: error.message }
        });
        set(state => ({
          messages: [...state.messages, errorMessage]
        }));
      }
      set({ isLoading: false, abortController: null });
    }
  },

  clearHistory: () => {
    const { conversations } = get();
    // 删除所有对话
    conversations.forEach(conv => {
      localStorageManager.deleteConversation(conv.id);
    });
    set({
      conversations: [],
      currentConversation: null,
      messages: []
    });
  },

  submitFeedback: async (messageId: string, verdict: 'up' | 'down') => {
    const { messages, currentConversation } = get();
    const target = messages.find(msg => msg.id === messageId && msg.role === 'assistant');
    if (!target) return;

    const relatedMessageId = target.metadata?.relatedMessageId;
    let relatedQuestion = '';
    if (relatedMessageId) {
      relatedQuestion = messages.find(msg => msg.id === relatedMessageId)?.content || '';
    } else {
      const index = messages.findIndex(msg => msg.id === target.id);
      if (index > 0) {
        for (let i = index - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            relatedQuestion = messages[i].content;
            break;
          }
        }
      }
    }

    const payload = {
      messageId,
      verdict,
      question: relatedQuestion,
      answer: target.content,
      conversationId: currentConversation?.id || target.conversationId,
      confidenceScore: target.metadata?.validation?.confidenceScore ?? null
    };

    try {
      await fetch(`${getApiServerUrl()}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      console.error('Feedback submit failed:', error);
    }

    localStorageManager.updateMessageMetadata(messageId, { feedback: verdict });
    set(state => ({
      messages: state.messages.map(msg =>
        msg.id === messageId
          ? {
            ...msg,
            metadata: {
              ...msg.metadata,
              feedback: verdict
            }
          }
          : msg
      )
    }));
  }
}));
