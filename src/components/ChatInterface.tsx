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

  // 初始化对话
  useEffect(() => {
    if (user) {
      loadConversations(user.id);
      
      // 如果没有当前对话，创建新对话
      if (!currentConversation && conversations.length === 0) {
        createConversation('新对话');
      } else if (!currentConversation && conversations.length > 0) {
        selectConversation(conversations[0].id);
      }
    }
  }, [user, currentConversation, conversations.length]);

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
    
    if (!currentConversation || !user) {
      console.error('没有活动的对话或用户');
      return;
    }

    const messageContent = inputValue.trim();
    setInputValue(''); // 立即清空输入框
    setIsSending(true); // 设置发送状态
    
    try {
      await sendMessage(messageContent);
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

  // 过滤掉空对话
  const filteredConversations = conversations.filter(conv => {
    const convMessages = localStorageManager.getMessages(conv.id);
    return convMessages.length > 0;
  });

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
            onClick={() => createConversation('新对话')}
            className="w-full bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            新建对话
          </button>
        </div>

        {/* 对话列表 */}
        <div className="flex-1 overflow-y-auto p-3">
          {filteredConversations.length === 0 ? (
            <div className="text-center text-gray-500 text-sm mt-4">
              <p>暂无对话记录</p>
              <p className="text-xs mt-1">点击上方按钮创建新对话</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredConversations.map((conversation) => {
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
                      onClick={() => selectConversation(conversation.id)}
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

        {/* 底部链接 */}
        <div className="p-3 border-t border-gray-200 flex-shrink-0">
          <Link 
            to="/admin/history" 
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <History className="w-4 h-4" />
            历史记录
          </Link>
        </div>
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
            <button
              type="button"
              onClick={() => setDeepThinking(!deepThinking)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors rounded-lg ${
                deepThinking
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title={deepThinking ? '关闭深度思考模式' : '开启深度思考模式'}
            >
              <Brain className={`w-4 h-4 ${deepThinking ? 'animate-pulse' : ''}`} />
              <span>深度思考</span>
            </button>
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
                      ? 'order-1 bg-blue-600 text-white rounded-2xl' 
                      : 'order-2 bg-white rounded-2xl shadow-sm'
                  } px-6 py-4`}>
                    <MessageContent content={message.content} role={message.role} />
                    
                    {message.metadata?.model && (
                      <div className={`text-xs mt-2 ${
                        message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                      }`}>
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
                <div className="flex items-start space-x-4">
                  <div className="w-10 h-10 bg-orange-200 rounded-full flex items-center justify-center flex-shrink-0">
                    <Bot className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="bg-white rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center space-x-3">
                      <div className="flex space-x-1.5">
                        <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
                        <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                        <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                      </div>
                      <span className="text-sm text-gray-700 font-medium">正在思考中...</span>
                      {/* 新增：中断按钮 */}
                      {isLoading && (
                        <button
                          onClick={handleStop}
                          className="ml-2 p-1 text-gray-500 hover:text-red-600 transition-colors"
                          title="中断处理"
                        >
                          <Square className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区域 */}
        <div className="px-6 py-4 bg-gray-50">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-3">
              <button
                type="button"
                onClick={() => setDeepThinking(!deepThinking)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors rounded-lg ${
                  deepThinking
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title={deepThinking ? '关闭深度思考模式' : '开启深度思考模式'}
              >
                <Brain className={`w-4 h-4 ${deepThinking ? 'animate-pulse' : ''}`} />
                <span>深度思考</span>
              </button>
              {deepThinking && (
                <span className="text-xs text-gray-500 font-medium">AI将进行更深入的分析和推理</span>
              )}
            </div>
            <div className="flex items-center bg-white rounded-2xl shadow-md px-4 py-3">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={isLoading ? 'AI正在处理中...' : '请输入您的问题...'} // 修改：动态占位符
                className="flex-1 bg-transparent border-0 resize-none focus:outline-none text-sm text-gray-900 placeholder-gray-500 pr-3 overflow-y-auto"
                rows={1}
                disabled={isLoading || isSending} // 修改：增加发送状态禁用
                style={{ minHeight: '24px', maxHeight: '120px' }}
              />
              {/* 修改：发送按钮状态 */}
              {isLoading ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="w-10 h-10 bg-red-600 text-white hover:bg-red-700 transition-colors rounded-lg flex items-center justify-center flex-shrink-0"
                  title="中断处理"
                >
                  <Square className="w-5 h-5" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!inputValue.trim() || isSending} // 修改：使用发送状态
                  className="w-10 h-10 bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors rounded-lg flex items-center justify-center flex-shrink-0"
                  title={isSending ? '发送中...' : '发送消息'} // 修改：动态标题
                >
                  <Send className={`w-5 h-5 ${isSending ? 'animate-pulse' : ''}`} />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;