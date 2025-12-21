/**
 * 本地存储管理器
 * 负责管理用户数据和对话历史（本地隐私存储）
 * 知识库文档和Chunks已迁移至服务器存储（unifiedStorage）
 */

import { User, Conversation, Message } from './types';

// 重新导出类型，保持向后兼容
export type { User, Conversation, Message };

class LocalStorageManager {
  private readonly PREFIX = 'ai_assistant_';

  // 用户相关
  private readonly USERS_KEY = this.PREFIX + 'users';
  private readonly CURRENT_USER_KEY = this.PREFIX + 'current_user';

  // 对话相关
  private readonly CONVERSATIONS_KEY = this.PREFIX + 'conversations';
  private readonly MESSAGES_KEY = this.PREFIX + 'messages';

  // 用户设置相关
  private readonly USER_SETTINGS_KEY = this.PREFIX + 'user_settings';

  // 初始化默认用户
  private initializeDefaultUsers() {
    if (!localStorage.getItem(this.USERS_KEY)) {
      const defaultUsers: User[] = [
        {
          id: 'admin-001',
          email: 'admin@example.com',
          name: '管理员',
          role: 'admin',
          createdAt: new Date().toISOString()
        },
        {
          id: 'user-001',
          email: 'user@example.com',
          name: '测试用户',
          role: 'user',
          createdAt: new Date().toISOString()
        }
      ];
      localStorage.setItem(this.USERS_KEY, JSON.stringify(defaultUsers));
    }
  }

  constructor() {
    this.initializeDefaultUsers();
  }

  setCurrentUser(user: User | null) {
    if (user) {
      localStorage.setItem(this.CURRENT_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(this.CURRENT_USER_KEY);
    }
  }

  getCurrentUser(): User | null {
    const user = localStorage.getItem(this.CURRENT_USER_KEY);
    return user ? JSON.parse(user) : null;
  }

  // 对话管理
  getConversations(userId: string): Conversation[] {
    const conversations = localStorage.getItem(this.CONVERSATIONS_KEY);
    const allConversations = conversations ? JSON.parse(conversations) : [];
    return allConversations.filter((conv: Conversation) => conv.userId === userId);
  }

  createConversation(userId: string, title: string): Conversation {
    const conversations = this.getConversations(userId);
    const newConversation: Conversation = {
      id: `conv-${Date.now()}`,
      userId,
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    // 这里需要获取所有对话，而不仅仅是当前用户的，否则写回时会覆盖其他用户的对话
    const allConversations = this.getAllConversations();
    allConversations.push(newConversation);
    
    try {
      localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(allConversations));
    } catch (error: any) {
      if (error.name === 'QuotaExceededError') {
        console.warn('localStorage 空间不足，正在清理旧数据...');
        this.cleanupOldData(userId);
        // 重试
        try {
          // 重新获取并保存
          const retryConversations = this.getAllConversations();
          retryConversations.push(newConversation);
          localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(retryConversations));
        } catch (retryError) {
          // 如果还是失败，只保留最近的对话
          const recentConversations = allConversations.slice(-10);
          localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(recentConversations));
          console.warn('已清理旧对话，只保留最近10个');
        }
      } else {
        throw error;
      }
    }
    
    return newConversation;
  }

  updateConversation(conversationId: string, updates: Partial<Conversation>) {
    const conversations = this.getAllConversations();
    const index = conversations.findIndex(conv => conv.id === conversationId);
    if (index !== -1) {
      conversations[index] = { ...conversations[index], ...updates, updatedAt: new Date().toISOString() };
      localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(conversations));
    }
  }

  deleteConversation(conversationId: string) {
    // 删除对话
    const conversations = this.getAllConversations();
    const filteredConversations = conversations.filter(conv => conv.id !== conversationId);
    localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(filteredConversations));
    
    // 删除该对话的所有消息
    const messages = this.getAllMessages();
    const filteredMessages = messages.filter((msg: Message) => msg.conversationId !== conversationId);
    localStorage.setItem(this.MESSAGES_KEY, JSON.stringify(filteredMessages));
  }

  private getAllConversations(): Conversation[] {
    const conversations = localStorage.getItem(this.CONVERSATIONS_KEY);
    return conversations ? JSON.parse(conversations) : [];
  }

  // 消息管理
  getMessages(conversationId: string): Message[] {
    const messages = localStorage.getItem(this.MESSAGES_KEY);
    const allMessages = messages ? JSON.parse(messages) : [];
    return allMessages.filter((msg: Message) => msg.conversationId === conversationId);
  }

  addMessage(message: Omit<Message, 'id' | 'createdAt'>): Message {
    const newMessage: Message = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString()
    };
    
    let messages = this.getAllMessages();
    messages.push(newMessage);
    
    try {
      localStorage.setItem(this.MESSAGES_KEY, JSON.stringify(messages));
    } catch (error: any) {
      if (error.name === 'QuotaExceededError') {
        console.warn('localStorage 空间不足，正在清理旧消息...');
        
        // 按时间排序，最新的在前
        const sortedMessages = messages.sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        
        // 尝试保留最近500条
        try {
          const keptMessages = sortedMessages.slice(0, 500);
          if (!keptMessages.find(m => m.id === newMessage.id)) {
            keptMessages[keptMessages.length - 1] = newMessage;
          }
          localStorage.setItem(this.MESSAGES_KEY, JSON.stringify(keptMessages));
        } catch (e) {
          // 如果还是失败，只保留新消息
           localStorage.setItem(this.MESSAGES_KEY, JSON.stringify([newMessage]));
        }
      } else {
        throw error;
      }
    }
    
    // 更新对话时间
    try {
      this.updateConversation(message.conversationId, { updatedAt: new Date().toISOString() });
    } catch (error) {
      console.warn('更新对话时间失败:', error);
    }
    
    return newMessage;
  }

  private getAllMessages(): Message[] {
    const messages = localStorage.getItem(this.MESSAGES_KEY);
    return messages ? JSON.parse(messages) : [];
  }

  // 用户设置管理
  getUserSettings(userId: string): any {
    const settings = localStorage.getItem(this.USER_SETTINGS_KEY);
    const allSettings = settings ? JSON.parse(settings) : {};
    return allSettings[userId] || null;
  }

  saveUserSettings(userId: string, settings: any) {
    const existingSettings = localStorage.getItem(this.USER_SETTINGS_KEY);
    const allSettings = existingSettings ? JSON.parse(existingSettings) : {};
    allSettings[userId] = settings;
    localStorage.setItem(this.USER_SETTINGS_KEY, JSON.stringify(allSettings));
  }

  // 清理旧数据以释放存储空间
  private cleanupOldData(userId: string) {
    try {
      const allConversations = this.getAllConversations();
      const userConversations = allConversations.filter((conv: Conversation) => conv.userId === userId);
      const otherConversations = allConversations.filter((conv: Conversation) => conv.userId !== userId);
      
      // 按更新时间排序，保留最近20个
      userConversations.sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      const keptConversations = userConversations.slice(0, 20);
      const removedConversationIds = userConversations.slice(20).map(conv => conv.id);
      
      // 删除旧对话的消息
      if (removedConversationIds.length > 0) {
        const allMessages = this.getAllMessages();
        const filteredMessages = allMessages.filter(
          (msg: Message) => !removedConversationIds.includes(msg.conversationId)
        );
        localStorage.setItem(this.MESSAGES_KEY, JSON.stringify(filteredMessages));
      }
      
      // 保存清理后的对话
      const finalConversations = [...otherConversations, ...keptConversations];
      localStorage.setItem(this.CONVERSATIONS_KEY, JSON.stringify(finalConversations));
      
      console.log(`已清理 ${removedConversationIds.length} 个旧对话`);
    } catch (error) {
      console.error('清理旧数据时出错:', error);
    }
  }
}

export const localStorageManager = new LocalStorageManager();

// 重新导出类型和统一存储管理器（保持兼容性）
export * from './types';
export { unifiedStorageManager } from './unifiedStorage';
