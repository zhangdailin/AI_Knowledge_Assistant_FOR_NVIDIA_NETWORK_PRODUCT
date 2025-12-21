/**
 * 数据备份工具
 * 提供用户数据的导出和导入功能
 */

export interface BackupData {
  version: string;
  timestamp: string;
  userId: string;
  userEmail: string;
  data: {
    conversations: any[];
    messages: any[];
    documents: any[];
    chunks: any[];
    settings: any;
  };
}

export class DataBackupManager {
  private static readonly CURRENT_VERSION = '1.0.0';
  private static readonly BACKUP_FILENAME_PREFIX = 'ai-assistant-backup';

  /**
   * 导出用户数据
   */
  static async exportUserData(userId: string, userEmail: string): Promise<void> {
    try {
      // 从localStorage收集所有用户数据
      const data = this.collectUserData(userId);
      
      const backupData: BackupData = {
        version: this.CURRENT_VERSION,
        timestamp: new Date().toISOString(),
        userId,
        userEmail,
        data
      };

      // 创建下载文件
      const blob = new Blob([JSON.stringify(backupData, null, 2)], {
        type: 'application/json'
      });
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = new Date().toISOString().split('T')[0];
      link.download = `${this.BACKUP_FILENAME_PREFIX}-${userEmail}-${date}.json`;
      link.href = url;
      link.click();
      
      URL.revokeObjectURL(url);
      
      console.log('数据导出成功');
    } catch (error) {
      console.error('数据导出失败:', error);
      throw new Error('数据导出失败，请重试');
    }
  }

  /**
   * 导入用户数据
   */
  static async importUserData(file: File): Promise<BackupData> {
    try {
      const text = await file.text();
      const backupData: BackupData = JSON.parse(text);
      
      // 验证备份文件格式
      this.validateBackupData(backupData);
      
      // 检查版本兼容性
      if (!this.isVersionCompatible(backupData.version)) {
        throw new Error(`不兼容的备份文件版本: ${backupData.version}`);
      }
      
      return backupData;
    } catch (error) {
      console.error('数据导入失败:', error);
      if (error instanceof SyntaxError) {
        throw new Error('无效的JSON文件格式');
      }
      throw error;
    }
  }

  /**
   * 恢复用户数据
   */
  static async restoreUserData(backupData: BackupData): Promise<void> {
    try {
      const { userId, data } = backupData;
      
      // 备份当前数据（以防需要恢复）
      const currentData = this.collectUserData(userId);
      localStorage.setItem(`backup_before_restore_${Date.now()}`, JSON.stringify(currentData));
      
      // 清除现有数据
      this.clearUserData(userId);
      
      // 恢复数据
      this.restoreUserDataToStorage(userId, data);
      
      console.log('数据恢复成功');
    } catch (error) {
      console.error('数据恢复失败:', error);
      throw new Error('数据恢复失败，请重试');
    }
  }

  /**
   * 收集用户数据
   */
  private static collectUserData(userId: string): any {
    const data: any = {};
    
    // 收集对话数据
    const conversations = localStorage.getItem('ai_assistant_conversations');
    if (conversations) {
      const allConversations = JSON.parse(conversations);
      data.conversations = allConversations.filter((conv: any) => conv.userId === userId);
    } else {
      data.conversations = [];
    }
    
    // 收集消息数据
    const messages = localStorage.getItem('ai_assistant_messages');
    if (messages) {
      const allMessages = JSON.parse(messages);
      // 获取用户相关的对话ID
      const userConversationIds = data.conversations.map((conv: any) => conv.id);
      data.messages = allMessages.filter((msg: any) => 
        userConversationIds.includes(msg.conversationId)
      );
    } else {
      data.messages = [];
    }
    
    // 收集文档数据
    const documents = localStorage.getItem('ai_assistant_documents');
    if (documents) {
      const allDocuments = JSON.parse(documents);
      data.documents = allDocuments.filter((doc: any) => doc.userId === userId);
    } else {
      data.documents = [];
    }
    
    // 收集文档片段数据
    const chunks = localStorage.getItem('ai_assistant_chunks');
    if (chunks) {
      const allChunks = JSON.parse(chunks);
      // 获取用户相关的文档ID
      const userDocumentIds = data.documents.map((doc: any) => doc.id);
      data.chunks = allChunks.filter((chunk: any) => 
        userDocumentIds.includes(chunk.documentId)
      );
    } else {
      data.chunks = [];
    }
    
    // 收集用户设置
    const settings = localStorage.getItem('ai_assistant_user_settings');
    if (settings) {
      const allSettings = JSON.parse(settings);
      data.settings = allSettings[userId] || {};
    } else {
      data.settings = {};
    }
    
    return data;
  }

  /**
   * 验证备份数据格式
   */
  private static validateBackupData(data: any): void {
    const requiredFields = ['version', 'timestamp', 'userId', 'userEmail', 'data'];
    const requiredDataFields = ['conversations', 'messages', 'documents', 'chunks', 'settings'];
    
    for (const field of requiredFields) {
      if (!data[field]) {
        throw new Error(`备份文件缺少必要字段: ${field}`);
      }
    }
    
    for (const field of requiredDataFields) {
      if (!data.data[field] || !Array.isArray(data.data[field])) {
        if (field !== 'settings') {
          throw new Error(`备份文件数据格式错误: ${field}`);
        }
      }
    }
  }

  /**
   * 检查版本兼容性
   */
  private static isVersionCompatible(version: string): boolean {
    const backupVersion = version.split('.');
    const currentVersion = this.CURRENT_VERSION.split('.');
    
    // 主版本号必须相同
    return backupVersion[0] === currentVersion[0];
  }

  /**
   * 清除用户数据
   */
  private static clearUserData(userId: string): void {
    // 清除对话数据
    const conversations = localStorage.getItem('ai_assistant_conversations');
    if (conversations) {
      const allConversations = JSON.parse(conversations);
      const filteredConversations = allConversations.filter((conv: any) => conv.userId !== userId);
      localStorage.setItem('ai_assistant_conversations', JSON.stringify(filteredConversations));
    }
    
    // 清除消息数据
    const messages = localStorage.getItem('ai_assistant_messages');
    if (messages) {
      const allMessages = JSON.parse(messages);
      // 获取需要保留的消息（其他用户的）
      const conversations = localStorage.getItem('ai_assistant_conversations');
      const remainingConversations = conversations ? JSON.parse(conversations) : [];
      const remainingConversationIds = remainingConversations.map((conv: any) => conv.id);
      
      const filteredMessages = allMessages.filter((msg: any) => 
        remainingConversationIds.includes(msg.conversationId)
      );
      localStorage.setItem('ai_assistant_messages', JSON.stringify(filteredMessages));
    }
    
    // 清除文档数据
    const documents = localStorage.getItem('ai_assistant_documents');
    if (documents) {
      const allDocuments = JSON.parse(documents);
      const filteredDocuments = allDocuments.filter((doc: any) => doc.userId !== userId);
      localStorage.setItem('ai_assistant_documents', JSON.stringify(filteredDocuments));
    }
    
    // 清除文档片段数据
    const chunks = localStorage.getItem('ai_assistant_chunks');
    if (chunks) {
      const allChunks = JSON.parse(chunks);
      const remainingDocuments = localStorage.getItem('ai_assistant_documents');
      const remainingDocIds = remainingDocuments ? JSON.parse(remainingDocuments).map((doc: any) => doc.id) : [];
      
      const filteredChunks = allChunks.filter((chunk: any) => 
        remainingDocIds.includes(chunk.documentId)
      );
      localStorage.setItem('ai_assistant_chunks', JSON.stringify(filteredChunks));
    }
    
    // 清除用户设置
    const settings = localStorage.getItem('ai_assistant_user_settings');
    if (settings) {
      const allSettings = JSON.parse(settings);
      delete allSettings[userId];
      localStorage.setItem('ai_assistant_user_settings', JSON.stringify(allSettings));
    }
  }

  /**
   * 恢复用户数据到存储
   */
  private static restoreUserDataToStorage(userId: string, data: any): void {
    // 恢复对话数据
    const conversations = localStorage.getItem('ai_assistant_conversations');
    const allConversations = conversations ? JSON.parse(conversations) : [];
    allConversations.push(...data.conversations);
    localStorage.setItem('ai_assistant_conversations', JSON.stringify(allConversations));
    
    // 恢复消息数据
    const messages = localStorage.getItem('ai_assistant_messages');
    const allMessages = messages ? JSON.parse(messages) : [];
    allMessages.push(...data.messages);
    localStorage.setItem('ai_assistant_messages', JSON.stringify(allMessages));
    
    // 恢复文档数据
    const documents = localStorage.getItem('ai_assistant_documents');
    const allDocuments = documents ? JSON.parse(documents) : [];
    allDocuments.push(...data.documents);
    localStorage.setItem('ai_assistant_documents', JSON.stringify(allDocuments));
    
    // 恢复文档片段数据
    const chunks = localStorage.getItem('ai_assistant_chunks');
    const allChunks = chunks ? JSON.parse(chunks) : [];
    allChunks.push(...data.chunks);
    localStorage.setItem('ai_assistant_chunks', JSON.stringify(allChunks));
    
    // 恢复用户设置
    const settings = localStorage.getItem('ai_assistant_user_settings');
    const allSettings = settings ? JSON.parse(settings) : {};
    allSettings[userId] = data.settings;
    localStorage.setItem('ai_assistant_user_settings', JSON.stringify(allSettings));
  }

  /**
   * 生成备份文件信息
   */
  static getBackupInfo(backupData: BackupData): string {
    const date = new Date(backupData.timestamp);
    const conversationCount = backupData.data.conversations.length;
    const messageCount = backupData.data.messages.length;
    const documentCount = backupData.data.documents.length;
    
    return `备份时间: ${date.toLocaleString()}\n` +
           `用户: ${backupData.userEmail}\n` +
           `对话数量: ${conversationCount}\n` +
           `消息数量: ${messageCount}\n` +
           `文档数量: ${documentCount}\n` +
           `版本: ${backupData.version}`;
  }
}