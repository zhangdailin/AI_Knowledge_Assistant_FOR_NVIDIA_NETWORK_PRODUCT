import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Send, Bot, User, Trash2, History, Brain, Square, BookOpen, Settings } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import MessageContent from './MessageContent';
import { localStorageManager } from '../lib/localStorage';

const ChatInterface: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false); // 新增：发送状态
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const { user } = useAuthStore();
  const { 
    currentConversation, 
    messages, 
    isLoading, 
    sendMessage, 
    createConversation,
    deepThinking,
    setDeepThinking,
    conversations,
    selectConversation,
    loadConversations,
    deleteConversation
  } = useChatStore();

  // 初始化对话：加强版
  useEffect(() => {
    if (user) {
      // 立即加载
      loadConversations(user.id);
      
      // 双重保险：确保数据已加载（解决某些极端情况下的时序问题）
      const timer = setTimeout(() => {
        const currentConvs = useChatStore.getState().conversations;
        if (currentConvs.length === 0) {
          loadConversations(user.id);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [user]); // 保持对 user 的依赖

  // 自动选择或创建对话
  useEffect(() => {
    if (!user) return;

    // 如果有对话但没有选中，选中第一个（最新的）
    if (conversations.length > 0 && !currentConversation) {
      const sorted = [...conversations].sort((a, b) => {
        const timeA = new Date(a.updatedAt).getTime() || 0;
        const timeB = new Date(b.updatedAt).getTime() || 0;
        return timeB - timeA;
      });
      selectConversation(sorted[0]);
    }
  }, [user, conversations, currentConversation]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 修改：优化发送处理
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inputValue.trim() || isLoading || isSending) return; // 增加发送状态检查
    
    if (!user) {
      console.error('没有用户');
      return;
    }

    const messageContent = inputValue.trim();
    setInputValue(''); // 立即清空输入框
    setIsSending(true); // 设置发送状态
    
    try {
      // 如果没有当前对话，自动创建一个
      if (!currentConversation) {
        createConversation(user.id, '新对话');
        // createConversation 是同步更新 store 的，sendMessage 内部通过 get() 获取最新状态
      }
      
      await sendMessage(messageContent);
    } catch (error) {
      console.error('发送消息失败:', error);
    } finally {
      setIsSending(false); // 重置发送状态
    }
  };

  // 新增：中断处理
  const handleStop = () => {
    // 这里可以添加中断逻辑，比如取消API请求
    console.log('用户中断处理');
    // 可以添加一个中断标志到chatStore
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  // 自动调整textarea高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <Bot className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p>请先登录以使用AI助手</p>
        </div>
      </div>
    );
  }

  // 不再过滤空对话，直接显示所有对话，按更新时间倒序排列
  const sortedConversations = React.useMemo(() => {
    return [...conversations].sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [conversations]);

  const getConversationPreview = (conversation: any) => {
    const convMessages = localStorageManager.getMessages(conversation.id);
    if (convMessages.length === 0) return '';
    
    const lastMessage = convMessages[convMessages.length - 1];
    return lastMessage.content.substring(0, 50) + (lastMessage.content.length > 50 ? '...' : '');
  };

  const handleDeleteConversation = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    
    if (window.confirm('确定要删除这个对话吗？')) {
      await deleteConversation(conversationId);
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 左侧边栏 */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen">
        {/* 顶部：助手名称 */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center">
            <Bot className="w-5 h-5 mr-2 text-blue-600" />
            AI知识助手
          </h2>
          <button
            onClick={() => createConversation(user.id, '新对话')}
            className="w-full bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            新建对话
          </button>
        </div>

        {/* 对话列表 */}
        <div className="flex-1 overflow-y-auto p-3">
          {sortedConversations.length === 0 ? (
            <div className="text-center text-gray-500 text-sm mt-4">
              <p>暂无对话记录</p>
              <p className="text-xs mt-1">点击上方按钮创建新对话</p>
            </div>
          ) : (
            <div className="space-y-1">
              {sortedConversations.map((conversation) => {
                const preview = getConversationPreview(conversation);
                const isActive = currentConversation?.id === conversation.id;
                return (
                  <div
                    key={conversation.id}
                    className={`group relative flex items-center mb-0.5 rounded text-sm transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <button
                      onClick={() => selectConversation(conversation)}
                      className="flex-1 text-left px-3 py-2 rounded min-w-0 overflow-hidden w-full"
                    >
                      <div className="truncate text-sm">
                        {preview || conversation.title || '新对话'}
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleDeleteConversation(e, conversation.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 mr-1 text-gray-400 hover:text-red-600 transition-opacity rounded flex-shrink-0"
                      title="删除对话"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部链接 - 已删除 */}
      </div>

      {/* 右侧主内容区 */}
      <div className="flex-1 flex flex-col h-screen min-w-0">
        {/* 头部工具栏 */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
          <div className="flex items-center space-x-1">
            <Link 
              to="/admin/history" 
              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors" 
              title="历史记录"
            >
              <History className="w-5 h-5" />
            </Link>
            <Link 
              to="/admin/knowledge" 
              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
              title="知识库"
            >
              <BookOpen className="w-5 h-5" />
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/admin/settings"
              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors rounded-lg"
              title="设置"
            >
              <Settings className="w-5 h-5" />
            </Link>
          </div>
        </div>

        {/* 对话内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Bot className="w-16 h-16 text-blue-600 mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">欢迎使用AI知识助手</h3>
              <p className="text-gray-600 max-w-md">
                我是您的智能知识助手，可以回答基于知识库的各种问题。请在下方输入您的问题，我会尽力为您提供准确的答案。
              </p>
              <div className="mt-6 text-sm text-gray-500">
                <p>💡 提示：您可以上传文档到知识库，我会基于这些文档回答您的问题</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto">
              {messages.map((message) => (
                <div key={message.id} className={`flex items-start gap-4 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}>
                  {message.role === 'assistant' && (
                    <div className="w-10 h-10 bg-orange-200 rounded-full flex items-center justify-center flex-shrink-0">
                      <Bot className="w-5 h-5 text-purple-600" />
                    </div>
                  )}
                  
                  <div className={`max-w-3xl ${
                    message.role === 'user' 
                      ? 'order-1 bg-blue-100 text-gray-900 rounded-2xl' 
                      : 'order-2 bg-white rounded-2xl shadow-sm'
                  } px-6 py-4`}>
                    <MessageContent content={message.content} role={message.role} />
                    
                    {message.role === 'assistant' && message.metadata?.model && (
                      <div className="text-xs mt-2 text-gray-500">
                        {message.metadata.model}
                        {message.metadata.deepThinking && (
                          <span className="ml-2 inline-flex items-center gap-1">
                            <Brain className="w-3 h-3" />
                            深度思考
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {message.role === 'user' && (
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 order-2">
                      <User className="w-5 h-5 text-blue-600" />
                    </div>
                  )}
                </div>
              ))}
              
              {/* 加载状态 */}
              {isLoading && (
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-orange-200 rounded-full flex items-center justify-center flex-shrink-0">
                    <Bot className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="flex flex-col gap-2 max-w-3xl w-full">
                    {/* 状态栏：深度思考中 + 停止按钮 */}
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4 animate-pulse text-purple-600" />
                        <span>深度思考中...</span>
                      </div>
                      <button
                        onClick={handleStop}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors border border-transparent hover:border-red-200"
                        title="停止响应"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        <span className="text-xs">停止响应</span>
                      </button>
                    </div>
                    
                    {/* 占位气泡 */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm min-h-[100px] flex items-center justify-center">
                       <div className="flex space-x-2">
                        <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                        <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区域 */}
        <div className="px-6 pb-6 pt-2 bg-gray-50">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative">
            {/* 深度思考默认开启，UI已隐藏 */}
            <div className="absolute -top-10 left-0 flex items-center gap-3">
              <span className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-full shadow-sm bg-purple-100 text-purple-700">
                <Brain className="w-3.5 h-3.5" />
                <span>深度思考模式</span>
              </span>
            </div>

            <div className="flex items-end bg-white rounded-[2rem] shadow-lg border border-gray-100 px-4 py-3 transition-shadow hover:shadow-xl">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={isLoading ? 'AI正在思考中...' : '和 智能助手 - "小张" 聊天'} 
                className="flex-1 bg-transparent border-0 resize-none focus:outline-none text-sm text-gray-900 placeholder-gray-400 pr-3 overflow-y-auto py-2"
                rows={1}
                disabled={isLoading || isSending} 
                style={{ minHeight: '24px', maxHeight: '120px' }}
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isSending || isLoading} 
                className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                  !inputValue.trim() || isSending || isLoading
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md hover:shadow-lg transform hover:-translate-y-0.5'
                }`}
                title={isSending ? '发送中...' : '发送消息'} 
              >
                {isSending || isLoading ? (
                  <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="w-5 h-5 ml-0.5" />
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;