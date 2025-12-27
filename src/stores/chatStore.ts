import { create } from 'zustand';
import { localStorageManager, Conversation, Message } from '../lib/localStorage';
import { AI_MODEL_CONFIG, CONVERSATION_CONFIG } from '../lib/constants';

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
}

function getApiServerUrl(): string {
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('custom_api_server_url');
    if (customUrl) return customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
  }
  const envUrl = import.meta.env.VITE_API_SERVER_URL;
  if (envUrl) {
    return envUrl.endsWith('/') ? envUrl.slice(0, -1) : envUrl;
  }
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:8787`;
  }
  return 'http://localhost:8787';
}

async function searchKnowledgeBase(query: string): Promise<Array<{ content: string; score: number }>> {
  try {
    // 减少搜索数量，加快速度
    const res = await fetch(`${getApiServerUrl()}/api/chunks/search?q=${encodeURIComponent(query)}&limit=5`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.chunks || []).map((chunk: any) => ({
      content: chunk.content,
      score: chunk._score || 0
    }));
  } catch {
    return [];
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversation: null,
  messages: [],
  isLoading: false,
  deepThinking: true,
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
    const { currentConversation, messages, deepThinking } = get();

    if (!currentConversation) {
      console.error('No current conversation');
      return;
    }

    const userMessage = localStorageManager.addMessage({
      conversationId: currentConversation.id,
      role: 'user',
      content
    });

    set({
      messages: [...messages, userMessage],
      isLoading: true
    });

    const abortController = new AbortController();
    set({ abortController });

    try {
      // Search knowledge base
      const knowledgeResults = await searchKnowledgeBase(content);

      // 判断是否有相关知识库内容（RRF分数阈值调高到0.02）
      const hasRelevantKnowledge = knowledgeResults.length > 0 && knowledgeResults[0].score > 0.02;
      console.log('[Chat] 知识库搜索结果:', knowledgeResults.length, '条, 最高分:', knowledgeResults[0]?.score || 0);

      // Build context from knowledge base
      let knowledgeContext = '';
      let useGemini = false;

      if (hasRelevantKnowledge) {
        // 只取前3条最相关的内容，减少 token 消耗
        knowledgeContext = '\n\n相关知识库内容：\n' +
          knowledgeResults.slice(0, 3).map((r, i) => `[${i + 1}] ${r.content}`).join('\n\n');
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
          model: deepThinking ? AI_MODEL_CONFIG.QWEN_MODEL : AI_MODEL_CONFIG.FAST_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            ...historyMessages,
            { role: 'user', content }
          ],
          max_tokens: AI_MODEL_CONFIG.MAX_TOKENS,
          temperature: deepThinking ? AI_MODEL_CONFIG.DEEP_THINKING_TEMPERATURE : AI_MODEL_CONFIG.DEFAULT_TEMPERATURE,
          useGemini
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API 请求失败: ${response.status}`);
      }

      const data = await response.json();
      const assistantContent = data.choices?.[0]?.message?.content || '抱歉，我无法生成回复。';
      const modelUsed = data.source === 'gemini' ? 'Gemini' : (deepThinking ? AI_MODEL_CONFIG.QWEN_MODEL : AI_MODEL_CONFIG.FAST_MODEL);

      const assistantMessage = localStorageManager.addMessage({
        conversationId: currentConversation.id,
        role: 'assistant',
        content: assistantContent,
        metadata: {
          model: modelUsed,
          deepThinking,
          references: hasRelevantKnowledge ? knowledgeResults.slice(0, 3).map(r => ({
            title: '知识库',
            content: r.content.substring(0, 200),
            score: r.score
          })) : []
        }
      });

      set(state => ({
        messages: [...state.messages, assistantMessage],
        isLoading: false,
        abortController: null
      }));

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
  }
}));
