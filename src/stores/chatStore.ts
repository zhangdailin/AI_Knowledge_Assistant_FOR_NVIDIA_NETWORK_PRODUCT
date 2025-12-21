import { create } from 'zustand';
import { localStorageManager, unifiedStorageManager, Conversation, Message } from '../lib/localStorage';
import { aiModelManager, ChatRequest } from '../lib/aiModels';
import { retrieval } from '../lib/retrieval';

interface ChatState {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  messages: Message[];
  isLoading: boolean;
  currentModel: string;
  deepThinking: boolean; // 深度思考模式
  
  // 方法
  loadConversations: (userId: string) => void;
  createConversation: (userId: string, title: string) => void;
  selectConversation: (conversation: Conversation) => void;
  deleteConversation: (conversationId: string) => void;
  sendMessage: (content: string) => Promise<void>;
  setCurrentModel: (model: string) => void;
  setDeepThinking: (enabled: boolean) => void;
  clearHistory: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversation: null,
  messages: [],
  isLoading: false,
  currentModel: 'qwen3-32b',
  deepThinking: true, // 默认开启深度思考

  loadConversations: (userId: string) => {
    const conversations = localStorageManager.getConversations(userId);
    set({ conversations });
  },

  createConversation: (userId: string, title: string) => {
    const newConversation = localStorageManager.createConversation(userId, title);
    const conversations = localStorageManager.getConversations(userId);
    set({ conversations, currentConversation: newConversation, messages: [] });
  },

  selectConversation: (conversation: Conversation) => {
    const messages = localStorageManager.getMessages(conversation.id);
    set({ currentConversation: conversation, messages });
  },

  deleteConversation: (conversationId: string) => {
    const { currentConversation, conversations } = get();
    
    // 1. 获取 userId (用于重新加载列表)
    const targetConv = conversations.find(c => c.id === conversationId);
    const userId = targetConv?.userId;
    
    // 2. 执行物理删除
    localStorageManager.deleteConversation(conversationId);
    
    // 3. 无论如何，先从本地状态中移除，保证 UI 立即响应
    const remainingConversations = conversations.filter(c => c.id !== conversationId);
    
    // 4. 如果删除的是当前对话，需要切换到其他对话或清空
    if (currentConversation?.id === conversationId) {
      if (remainingConversations.length > 0) {
        const nextConversation = remainingConversations[0];
        const messages = localStorageManager.getMessages(nextConversation.id);
        set({ 
          conversations: remainingConversations, 
          currentConversation: nextConversation, 
          messages 
        });
      } else {
        set({ 
          conversations: [], 
          currentConversation: null, 
          messages: [] 
        });
      }
    } else {
      // 只是删除非当前对话
      set({ conversations: remainingConversations });
    }
    
    // 5. 如果获取到了 userId，可以再次从 localStorage 同步（双重保险，但非必须，因为本地状态已经更新）
    // 为了性能，这里省略，因为上面的逻辑已经足够保证一致性
  },

  sendMessage: async (content: string) => {
    const { currentConversation, currentModel, deepThinking } = get();
    
    if (!currentConversation) {
      console.error('没有选择对话');
      return;
    }

    set({ isLoading: true });

    try {
      // 添加用户消息
      const userMessage = localStorageManager.addMessage({
        conversationId: currentConversation.id,
        role: 'user',
        content,
        metadata: { model: currentModel }
      });

      // 立即更新UI显示用户消息，并刷新对话列表（确保新对话能立即显示）
      const userId = currentConversation.userId;
      const updatedConversations = localStorageManager.getConversations(userId);
      
      set({ 
        conversations: updatedConversations,
        messages: [...get().messages, userMessage],
        isLoading: true 
      });

      // 多路召回检索 + Rerank 重排（top k = 20）
      
      // 获取对话历史用于查询增强和AI模型上下文
      const recentMessages = get().messages.slice(-10);
      const conversationHistoryForSearch = recentMessages
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .map(msg => msg.content);
      
      const searchResults = await retrieval.semanticSearch(content, 20, conversationHistoryForSearch);
      
      // 确保references包含多个文档的chunks，而不是只选择分数最高的
      // 按文档分组，确保每个文档至少有一些chunks被选中
      const refsByDocMap = new Map<string, typeof searchResults>();
      searchResults.forEach(r => {
        if (!refsByDocMap.has(r.chunk.documentId)) {
          refsByDocMap.set(r.chunk.documentId, []);
        }
        refsByDocMap.get(r.chunk.documentId)!.push(r);
      });
      
      // 从每个文档中选择至少1个chunk，确保多样性
      // 增加上下文数量，从3个增加到20个（与检索的limit一致）
      const referencesList: string[] = [];
      const refCount = 20; // 增加上下文数量，提供更多信息
      const docCount = refsByDocMap.size;
      const minPerDoc = Math.max(1, Math.floor(refCount / docCount)); // 每个文档至少选择的数量
      
      // 第一步：从每个文档中选择至少minPerDoc个chunks（保证多样性）
      const guaranteedByDoc = new Map<string, string[]>();
      refsByDocMap.forEach((docRefs, docId) => {
        const sorted = docRefs.sort((a, b) => b.score - a.score);
        const selected = sorted.slice(0, Math.min(minPerDoc, sorted.length));
        const selectedContents = selected.map(r => r.chunk.content);
        guaranteedByDoc.set(docId, selectedContents);
        referencesList.push(...selectedContents);
      });
      
      // 第二步：如果还有空间，从每个文档中轮流选择，确保多样性
      if (referencesList.length < refCount) {
        const remainingSlots = refCount - referencesList.length;
        const docIds = Array.from(refsByDocMap.keys());
        let slotIndex = 0;
        
        // 轮流从每个文档中选择，直到填满所有slot
        while (referencesList.length < refCount && slotIndex < remainingSlots * docCount) {
          const docIndex = slotIndex % docIds.length;
          const docId = docIds[docIndex];
          const docRefs = refsByDocMap.get(docId)!;
          const alreadySelected = guaranteedByDoc.get(docId) || [];
          const remainingFromDoc = docRefs
            .filter(r => !alreadySelected.includes(r.chunk.content) && !referencesList.includes(r.chunk.content))
            .sort((a, b) => b.score - a.score);
          
          if (remainingFromDoc.length > 0) {
            referencesList.push(remainingFromDoc[0].chunk.content);
            const updated = guaranteedByDoc.get(docId) || [];
            updated.push(remainingFromDoc[0].chunk.content);
            guaranteedByDoc.set(docId, updated);
          }
          
          slotIndex++;
        }
      }
      
      // 限制为refCount个
      const finalReferences = referencesList.slice(0, refCount);
      
      const references = finalReferences;
      
      // 检查搜索结果的相关性分数，如果最高分数太低，视为未命中
      const maxScore = searchResults.length > 0 
        ? Math.max(...searchResults.map(r => r.score))
        : 0;
      const relevanceThreshold = 0.35; // 降低相关性阈值，避免过滤掉相关但分数稍低的文档
      const isLowRelevance = searchResults.length > 0 && maxScore < relevanceThreshold;

      // 如果知识库未命中或相关性太低，直接使用 Qwen 8B 模型
      if (searchResults.length === 0 || isLowRelevance) {
        
        try {
          // 使用 Qwen 8B 模型（SiliconFlow）回答问题
          const qwenResponse = await aiModelManager.generateAnswer({
            question: content,
            model: currentModel,
            references: [],
            conversationHistory: undefined,
            deepThinking: deepThinking
          });
          
          // 添加 Qwen 8B 回复消息
          const assistantMessage = localStorageManager.addMessage({
            conversationId: currentConversation.id,
            role: 'assistant',
            content: qwenResponse.answer,
            metadata: {
              model: qwenResponse.model,
              usage: qwenResponse.usage,
              fallbackToQwen: true
            }
          });
          
          const msgs = [...get().messages, assistantMessage];
          set({ messages: msgs, isLoading: false });
          return;
        } catch (qwenError) {
          console.error('Qwen 8B调用失败:', qwenError);
          const errorMessage = qwenError instanceof Error ? qwenError.message : String(qwenError);
          
          // Qwen 8B 调用失败，显示提示消息
          try {
            const tipMessage = localStorageManager.addMessage({
              conversationId: currentConversation.id,
              role: 'assistant',
              content: '未在知识库命中文本片段，且 AI 模型调用失败。建议：\n1. 上传/粘贴 TXT 或 MD 文本到知识库\n2. 在知识库页面的文档卡片中添加"可检索的文本片段"\n3. 检查 API 密钥配置',
              metadata: { hint: true, error: true, errorMessage: errorMessage.substring(0, 200) }
            });
            const msgs = [...get().messages, tipMessage];
            set({ messages: msgs, isLoading: false });
            return;
          } catch (storageError) {
            console.error('存储提示消息失败:', storageError);
            // 如果存储失败，至少显示在界面上
            const tipMessage: Message = {
              id: `msg-${Date.now()}`,
              conversationId: currentConversation.id,
              role: 'assistant',
              content: '未在知识库命中文本片段，且 AI 模型调用失败。建议上传/粘贴 TXT 或 MD 文本，或在知识库页面的文档卡片中添加"可检索的文本片段"。',
              metadata: { hint: true, error: true, errorMessage: errorMessage.substring(0, 200) },
              createdAt: new Date().toISOString()
            };
            const msgs = [...get().messages, tipMessage];
            set({ messages: msgs, isLoading: false });
            return;
          }
        }
      }

      // 获取对话历史作为上下文（最近5轮对话）- 用于AI模型
      const conversationHistory = recentMessages
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .map(msg => `${msg.role === 'user' ? '用户' : '助手'}: ${msg.content}`)
        .join('\n\n');
      
      // 调用AI模型
      const chatRequest: ChatRequest = {
        question: content,
        model: currentModel,
        references,
        conversationHistory: conversationHistory || undefined, // 传递对话历史
        deepThinking: deepThinking // 传递深度思考模式
      };

      const response = await aiModelManager.generateAnswer(chatRequest);

      // 添加AI回复消息
      const assistantMessage = localStorageManager.addMessage({
        conversationId: currentConversation.id,
        role: 'assistant',
        content: response.answer,
        metadata: {
          model: response.model,
          usage: response.usage,
          references: response.references
        }
      });

      // 更新当前消息列表
      const messages = [...get().messages, assistantMessage];
      set({ messages, isLoading: false });

    } catch (error) {
      console.error('发送消息失败:', error);
      
      // 尝试添加错误消息，但如果存储失败，至少显示在界面上
      let errorMessage: Message;
      try {
        errorMessage = localStorageManager.addMessage({
          conversationId: currentConversation.id,
          role: 'assistant',
          content: '抱歉，处理您的消息时出现了错误。请稍后再试。',
          metadata: { error: true }
        });
      } catch (storageError) {
        console.error('存储错误消息失败:', storageError);
        // 如果存储失败，创建一个临时消息对象
        errorMessage = {
          id: `msg-${Date.now()}`,
          conversationId: currentConversation.id,
          role: 'assistant',
          content: '抱歉，处理您的消息时出现了错误。请稍后再试。',
          metadata: { error: true },
          createdAt: new Date().toISOString()
        };
      }

      const messages = [...get().messages, errorMessage];
      set({ messages, isLoading: false });
    }
  },

  setCurrentModel: (model: string) => {
    aiModelManager.setCurrentModel(model);
    set({ currentModel: model });
  },

  setDeepThinking: (enabled: boolean) => {
    set({ deepThinking: enabled });
  },

  clearHistory: () => {
    // 清空本地存储中的对话和消息
    localStorage.removeItem('ai_assistant_conversations');
    localStorage.removeItem('ai_assistant_messages');
    
    // 重置状态
    set({ 
      conversations: [], 
      currentConversation: null, 
      messages: [] 
    });
  }
}));