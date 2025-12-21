import React, { useState } from 'react';
import { Clock, Search, Trash2, Star, StarOff, MessageCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { localStorageManager, Conversation } from '../lib/localStorage';

const ConversationHistory: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  
  const { user } = useAuthStore();
  const { conversations, selectConversation, currentConversation } = useChatStore();

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <MessageCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p>请先登录以查看历史记录</p>
        </div>
      </div>
    );
  }

  // 计算编辑距离（Levenshtein距离）- 优化版本
  const levenshteinDistance = (str1: string, str2: string): number => {
    if (str1 === str2) return 0;
    if (str1.length === 0) return str2.length;
    if (str2.length === 0) return str1.length;

    const len1 = str1.length;
    const len2 = str2.length;
    
    // 使用滚动数组优化空间复杂度
    let prevRow = Array(len2 + 1).fill(0).map((_, i) => i);
    let currRow = Array(len2 + 1).fill(0);

    for (let i = 1; i <= len1; i++) {
      currRow[0] = i;
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        currRow[j] = Math.min(
          prevRow[j] + 1,        // 删除
          currRow[j - 1] + 1,    // 插入
          prevRow[j - 1] + cost  // 替换
        );
      }
      [prevRow, currRow] = [currRow, prevRow];
    }

    return prevRow[len2];
  };

  // 模糊匹配函数
  const fuzzyMatch = (text: string, query: string): boolean => {
    if (!query.trim()) return true;
    
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    
    // 1. 精确匹配（最高优先级）
    if (textLower.includes(queryLower)) {
      return true;
    }
    
    // 2. 如果查询词很短（<=2个字符），只使用精确匹配
    if (queryLower.length <= 2) {
      return false;
    }
    
    // 3. 检查是否包含查询词的所有字符（顺序可以不同）
    const queryChars = queryLower.split('').filter(c => c.trim());
    const hasAllChars = queryChars.every(char => textLower.includes(char));
    if (!hasAllChars) {
      return false;
    }
    
    // 4. 滑动窗口检查子串的编辑距离
    const maxDistance = Math.max(1, Math.floor(queryLower.length * 0.3));
    const windowSize = queryLower.length;
    
    // 检查所有可能的子串
    for (let i = 0; i <= textLower.length - windowSize; i++) {
      const substring = textLower.substring(i, i + windowSize);
      const distance = levenshteinDistance(queryLower, substring);
      if (distance <= maxDistance) {
        return true;
      }
    }
    
    // 5. 如果文本比查询词长，检查整体相似度（但只对较短的查询词）
    if (queryLower.length <= 10 && textLower.length <= queryLower.length * 2) {
      const distance = levenshteinDistance(queryLower, textLower);
      const maxOverallDistance = Math.max(1, Math.floor(queryLower.length * 0.4));
      if (distance <= maxOverallDistance) {
        return true;
      }
    }
    
    return false;
  };

  const filteredConversations = conversations.filter(conv => {
    // 过滤掉空会话（没有消息的对话）
    const messages = localStorageManager.getMessages(conv.id);
    if (messages.length === 0) {
      return false;
    }
    
    // 使用模糊匹配
    const matchesSearch = !searchTerm.trim() || fuzzyMatch(conv.title, searchTerm);
    const matchesFavorites = !showFavoritesOnly || conv.title.includes('⭐');
    return matchesSearch && matchesFavorites;
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return '今天';
    } else if (diffDays === 1) {
      return '昨天';
    } else if (diffDays < 7) {
      return `${diffDays}天前`;
    } else {
      return date.toLocaleDateString('zh-CN');
    }
  };

  // 获取对话的消息预览
  const getConversationPreview = (conversationId: string): string => {
    const messages = localStorageManager.getMessages(conversationId);
    if (messages.length === 0) {
      return '暂无对话内容';
    }
    
    // 获取最后几条消息（最多3条）
    const recentMessages = messages
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-3);
    
    // 格式化预览文本
    const previewParts = recentMessages.map(msg => {
      const roleLabel = msg.role === 'user' ? '你' : 'AI';
      // 清理内容：移除markdown标记、HTML标签等，只保留纯文本
      let cleanContent = msg.content
        .replace(/```[\s\S]*?```/g, '[代码]') // 移除代码块
        .replace(/`[^`]+`/g, '[代码]') // 移除行内代码
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // 移除markdown链接，保留文本
        .replace(/[#*_~]/g, '') // 移除markdown格式标记
        .replace(/<[^>]+>/g, '') // 移除HTML标签
        .trim();
      
      // 限制每条消息的长度
      if (cleanContent.length > 80) {
        cleanContent = cleanContent.substring(0, 80) + '...';
      }
      
      return `${roleLabel}: ${cleanContent}`;
    });
    
    return previewParts.join(' | ');
  };

  const deleteConversation = (conversationId: string) => {
    if (window.confirm('确定要删除这个对话吗？')) {
      // 删除对话相关的消息
      const messages = localStorageManager.getMessages(conversationId);
      messages.forEach(msg => {
        // 这里需要添加删除单个消息的方法，简化处理
      });
      
      // 重新加载对话列表
      const updatedConversations = conversations.filter(conv => conv.id !== conversationId);
      useChatStore.setState({ conversations: updatedConversations });
      
      // 如果删除的是当前对话，清空当前对话
      if (currentConversation?.id === conversationId) {
        useChatStore.setState({ 
          currentConversation: null, 
          messages: [] 
        });
      }
    }
  };

  const toggleFavorite = (conversation: Conversation) => {
    const isFavorite = conversation.title.includes('⭐');
    const newTitle = isFavorite 
      ? conversation.title.replace('⭐ ', '')
      : `⭐ ${conversation.title}`;
    
    localStorageManager.updateConversation(conversation.id, { title: newTitle });
    
    // 更新本地状态
    const updatedConversations = conversations.map(conv =>
      conv.id === conversation.id ? { ...conv, title: newTitle } : conv
    );
    useChatStore.setState({ conversations: updatedConversations });
  };

  return (
    <div className="h-full bg-gradient-to-br from-blue-50 to-cyan-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* 标题和搜索 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">历史记录</h1>
          <p className="text-gray-600">查看和管理您的对话历史</p>
        </div>

        {/* 搜索和筛选 */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="搜索对话历史..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              showFavoritesOnly
                ? 'bg-yellow-100 border-yellow-300 text-yellow-800'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Star className="w-4 h-4 inline mr-2" />
            {showFavoritesOnly ? '显示全部' : '仅显示收藏'}
          </button>
        </div>

        {/* 对话列表 */}
        <div className="space-y-4">
          {filteredConversations
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .map((conversation) => (
              <div
                key={conversation.id}
                className={`bg-white rounded-xl shadow-sm border p-4 hover:shadow-md transition-all cursor-pointer ${
                  currentConversation?.id === conversation.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200'
                }`}
                onClick={() => selectConversation(conversation)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-2">
                      <h3 className="text-lg font-medium text-gray-800 truncate">
                        {conversation.title}
                      </h3>
                      {conversation.title.includes('⭐') && (
                        <Star className="w-4 h-4 text-yellow-500 fill-current" />
                      )}
                    </div>
                    <div className="flex items-center space-x-4 text-sm text-gray-500 mb-2">
                      <div className="flex items-center space-x-1">
                        <Clock className="w-4 h-4" />
                        <span>{formatDate(conversation.updatedAt)}</span>
                      </div>
                      <span>创建于 {new Date(conversation.createdAt).toLocaleDateString()}</span>
                    </div>
                    {/* 对话内容预览 */}
                    <div className="text-sm text-gray-600 line-clamp-2 mt-2">
                      {getConversationPreview(conversation.id)}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(conversation);
                      }}
                      className="p-2 text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 rounded-lg transition-colors"
                    >
                      {conversation.title.includes('⭐') ? (
                        <Star className="w-4 h-4 fill-current" />
                      ) : (
                        <StarOff className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(conversation.id);
                      }}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
        </div>

        {filteredConversations.length === 0 && (
          <div className="text-center py-12">
            <MessageCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-500 mb-2">
              {searchTerm || showFavoritesOnly ? '没有找到匹配的历史记录' : '暂无对话历史'}
            </h3>
            <p className="text-gray-400">
              {searchTerm || showFavoritesOnly 
                ? '尝试调整搜索条件或筛选条件'
                : '开始与AI助手对话，您的历史记录将显示在这里'
              }
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationHistory;
