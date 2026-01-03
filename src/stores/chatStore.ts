import { create } from 'zustand';
import { localStorageManager, Conversation, Message } from '../lib/localStorage';
import { AI_MODEL_CONFIG, CONVERSATION_CONFIG } from '../lib/constants';
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
  title: string;
  content: string;
  score: number;
  rrfScore: number;
  rerankScore: number;
};


async function searchKnowledgeBase(query: string): Promise<KnowledgeSearchResult[]> {
  try {
    // 增加搜索数量以获得更好的结果
    const res = await fetch(`${getApiServerUrl()}/api/chunks/search?q=${encodeURIComponent(query)}&limit=10`);
    if (!res.ok) return [];
    const data = await res.json();

    const results = (data.chunks || []).map((chunk: any) => {
      const rrfScore = typeof chunk._score === 'number' ? chunk._score : 0;
      const rerankScore = typeof chunk.rerank_score === 'number' ? chunk.rerank_score : 0;
      // 优先使用 rerank 分数，因为它通常更准确
      const finalScore = rerankScore > 0 ? rerankScore : rrfScore;
      const chunkTitle =
        chunk?.metadata?.header ||
        chunk?.metadata?.title ||
        chunk?.sectionTitle ||
        chunk?.title ||
        (chunk.documentId ? `文档 ${chunk.documentId}` : '知识库片段');
      return {
        id: chunk.id,
        documentId: chunk.documentId,
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

// 提取查询关键词（简单实现）
function extractKeywords(query: string): string[] {
  // 移除常见停用词
  const stopWords = ['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这'];
  const words = query.split(/[\s,，。！？、；：""''（）【】《》\[\]]+/).filter(w => w.length > 1 && !stopWords.includes(w));
  return words;
}

// 多级检索策略
async function multiLevelSearch(query: string): Promise<{
  results: Array<{ content: string; score: number }>;
  searchLevel: number;
  hasRelevantKnowledge: boolean;
}> {
  console.log('[Search] 开始多级检索，查询:', query);

  // 第一级：标准检索
  let results = await searchKnowledgeBase(query);
  const maxScore = results.reduce((max, r) => Math.max(max, r.score), 0);
  const avgScore = results.length > 0
    ? results.slice(0, 3).reduce((sum, r) => sum + r.score, 0) / Math.min(3, results.length)
    : 0;

  // 检查是否有 rerank 分数（更准确）
  const maxRerankScore = results.reduce((max, r) => Math.max(max, r.rerankScore || 0), 0);
  const hasRerank = maxRerankScore > 0;

  // 判断第一级是否成功
  // 优化：优先使用 rerank 分数判断，其阈值通常更高（0.7+表示高相关）
  const level1Pass = maxScore > 0.015 ||
                     (results.length >= 2 && avgScore > 0.01) ||
                     (hasRerank && maxRerankScore > 0.65);

  if (level1Pass) {
    console.log('[Search] 第一级检索成功，最高分:', maxScore.toFixed(4), hasRerank ? `(Rerank: ${maxRerankScore.toFixed(4)})` : '');
    return { results, searchLevel: 1, hasRelevantKnowledge: true };
  }

  console.log('[Search] 第一级检索分数较低，尝试第二级检索');

  // 第二级：降低阈值，接受更低分数的结果
  // 优化：rerank > 0.5 也认为有一定相关性
  const level2Pass = maxScore > 0.005 ||
                     (results.length >= 2 && avgScore > 0.003) ||
                     (hasRerank && maxRerankScore > 0.5);

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
    const keywordResults = await searchKnowledgeBase(keywordQuery);
    const keywordMaxScore = keywordResults.reduce((max, r) => Math.max(max, r.score), 0);
    const keywordMaxRerankScore = keywordResults.reduce((max, r) => Math.max(max, r.rerankScore || 0), 0);
    const keywordHasRerank = keywordMaxRerankScore > 0;

    // 优化：关键词搜索的阈值更低，但仍考虑 rerank 分数
    const level3Pass = (keywordMaxScore > 0.003 && keywordResults.length > 0) ||
                       (keywordHasRerank && keywordMaxRerankScore > 0.4);

    if (level3Pass) {
      console.log('[Search] 第三级检索成功（关键词），最高分:', keywordMaxScore.toFixed(4), keywordHasRerank ? `(Rerank: ${keywordMaxRerankScore.toFixed(4)})` : '');
      return { results: keywordResults, searchLevel: 3, hasRelevantKnowledge: true };
    }
  }

  console.log('[Search] 所有检索级别均未找到相关内容，使用 Gemini');
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
      const hasRelevantKnowledge = searchResult.hasRelevantKnowledge;
      const searchLevel = searchResult.searchLevel;

      console.log('[Chat] 检索级别:', searchLevel, '结果数量:', knowledgeResults.length);

      // Build context from knowledge base
      let knowledgeContext = '';
      let useGemini = false;

      const topReferences = knowledgeResults.slice(0, 5);

      if (hasRelevantKnowledge) {
        // 取前5条最相关的内容，提供更丰富的上下文
        const contextPrefix = searchLevel === 1
          ? '相关知识库内容：'
          : searchLevel === 2
          ? '相关知识库内容（扩展搜索）：'
          : '相关知识库内容（关键词匹配）：';

        knowledgeContext = '\n\n' + contextPrefix + '\n' +
          topReferences.map((r, i) => `[${i + 1}] ${r.content}`).join('\n\n');
      } else {
        // 知识库没有相关内容，使用 Gemini
        useGemini = true;
        console.log('[Chat] 知识库无相关内容，使用 Gemini');
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

      const systemPrompt = useGemini
        ? `你是一个专业的AI助手，名叫"小张"。当前日期是${dateStr}。请用中文回答用户的问题，回答要准确、专业、有条理。如果需要查询实时信息，请使用联网搜索。`
        : `你是一个专业的AI知识助手，名叫"小张"。你的任务是基于知识库内容回答用户问题。

规则：
1. 优先使用知识库中的内容回答问题
2. 如果知识库中没有相关内容，可以基于你的知识回答，但要说明这不是来自知识库
3. 回答要准确、专业、有条理
4. 使用中文回答${knowledgeContext}`;

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
          // 传递前5条参考文档用于验证，与上下文保持一致
          references: hasRelevantKnowledge ? topReferences.map((r, idx) => ({
            id: r.id || `ref-${idx}`,
            title: r.title || `参考文档 #${idx + 1}`,
            content: r.content,
            documentId: r.documentId
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
          // 保存前5条参考文档，提供更完整的来源信息
          references: hasRelevantKnowledge ? topReferences.map((r, idx) => ({
            id: r.id || `ref-${idx}`,
            documentId: r.documentId,
            title: r.title || `参考文档 #${idx + 1}`,
            content: r.content,
            score: r.score
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
      }).catch(() => {}); // 静默失败

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
