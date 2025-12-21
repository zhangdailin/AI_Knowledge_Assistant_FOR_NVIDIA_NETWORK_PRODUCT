import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Send, Settings, Bot, User, History, FolderOpen, Brain, RefreshCw, CheckSquare, Trash2, X, Square } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import MessageContent from './MessageContent';
import { localStorageManager } from '../lib/localStorage';

const ChatInterface: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
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


  useEffect(() => {
    try {
      scrollToBottom();
    } catch (error) {
      console.error('scrollToBottom error:', error);
    }
  }, [messages]);

  useEffect(() => {
    try {
      // 加载对话列表
      if (user) {
        loadConversations(user.id);
      }
    } catch (error) {
      console.error('loadConversations error:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    try {
      // 如果没有当前对话，创建新对话
      if (user && !currentConversation) {
        createConversation(user.id, '新对话');
      }
    } catch (error) {
      console.error('createConversation error:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentConversation?.id]); // Only depend on IDs, not functions

  const handleNewConversation = () => {
    if (user) {
      createConversation(user.id, '新对话');
      // 重新加载对话列表以确保UI更新
      setTimeout(() => {
        loadConversations(user.id);
      }, 100);
    }
  };

  const handleDeleteConversation = (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation(); // 阻止触发选择对话
    if (window.confirm('确定要删除这个对话吗？')) {
      deleteConversation(conversationId);
      if (user) {
        // 重新加载对话列表
        setTimeout(() => {
          loadConversations(user.id);
        }, 100);
      }
    }
  };

  const getConversationPreview = (conversation: any) => {
    const convMessages = localStorageManager.getMessages(conversation.id);
    if (convMessages.length === 0) return '';
    const lastMessage = convMessages[convMessages.length - 1];
    return lastMessage.content.substring(0, 30) + (lastMessage.content.length > 30 ? '...' : '');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inputValue.trim() || isLoading) return;
    
    if (!currentConversation || !user) {
      console.error('没有活动的对话或用户');
      return;
    }

    await sendMessage(inputValue.trim());
    setInputValue('');
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

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 左侧边栏 */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen">
        {/* 顶部：助手名称 */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              {/* 浅橙色圆角方形图标，紫色机器人头像 */}
              <div className="w-8 h-8 bg-orange-200 flex items-center justify-center rounded">
                <Bot className="w-5 h-5 text-purple-600" />
              </div>
              <h1 className="text-base font-semibold text-gray-900">智能助手 - "小张"</h1>
            </div>
            {/* 右侧小方框图标 */}
            <Square className="w-4 h-4 text-gray-400" />
          </div>
          
          {/* 开启新对话按钮 */}
          <button
            onClick={handleNewConversation}
            className="w-full flex items-center space-x-2 px-3 py-2.5 bg-blue-600 text-white hover:bg-blue-700 transition-colors text-sm font-medium rounded shadow-sm"
          >
            <CheckSquare className="w-4 h-4 text-white" />
            <span>开启新对话</span>
          </button>
        </div>

        {/* 对话历史列表 - 可滚动区域（隐藏滚动条） */}
        <div className="flex-1 overflow-y-auto min-h-0 hide-scrollbar">
          {filteredConversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              暂无对话记录
            </div>
          ) : (
            <div className="p-2">
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
              <FolderOpen className="w-5 h-5" />
            </Link>
            <Link 
              to="/admin/settings" 
              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors" 
              title="设置"
            >
              <Settings className="w-5 h-5" />
            </Link>
          </div>
          
          {/* 刷新按钮 */}
          <button
            onClick={() => window.location.reload()}
            className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            title="刷新"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* 对话区域 */}
        <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6 bg-gray-50">
        {/* 欢迎消息 */}
        {messages.length === 0 && (
          <div className="flex items-start space-x-4">
            <div className="w-10 h-10 bg-orange-200 rounded-full flex items-center justify-center flex-shrink-0">
              <Bot className="w-5 h-5 text-purple-600" />
            </div>
            <div className="bg-white rounded-2xl p-6 max-w-3xl shadow-sm">
              <p className="text-gray-900 leading-relaxed">
                您好！我是智能助手 - "小张"，基于知识库为您提供专业的问答服务。
                <br />
                <span className="text-gray-600 text-sm mt-2 block">请输入您的问题，建议格式【型号+问题】（例如：SN5600 如何配置BGP？）</span>
              </p>
            </div>
          </div>
        )}

        {/* 消息列表 */}
        {messages.map((message) => {
          // 将 system 角色视为 assistant 进行渲染
          const displayRole = message.role === 'system' ? 'assistant' : message.role;
          const isUser = message.role === 'user';
          
          return (
            <div 
              key={message.id} 
              className={`flex items-start space-x-4 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
            >
              {/* 头像 */}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                isUser 
                  ? 'bg-blue-200' 
                  : 'bg-orange-200'
              }`}>
                {isUser ? (
                  <User className="w-5 h-5 text-blue-600" />
                ) : (
                  <Bot className="w-5 h-5 text-purple-600" />
                )}
              </div>
              
              {/* 消息气泡 */}
              <div className={`p-4 max-w-3xl rounded-2xl break-words shadow-sm ${
                isUser
                  ? 'bg-blue-100 text-gray-900'
                  : 'bg-white text-gray-900'
              }`}>
                <MessageContent content={message.content} role={displayRole as 'user' | 'assistant'} />
                
                {/* 显示模型信息 */}
                {message.role === 'assistant' && message.metadata?.model && (
                  <div className="mt-3 text-xs text-gray-500 font-mono">
                    <span className="font-semibold">模型:</span> {message.metadata.model}
                    {message.metadata?.usage?.tokens && (
                      <span className="ml-3">
                        <span className="font-semibold">Token:</span> {message.metadata.usage.tokens}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

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
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
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
              placeholder='和 智能助手 - "小张" 聊天'
              className="flex-1 bg-transparent border-0 resize-none focus:outline-none text-sm text-gray-900 placeholder-gray-500 pr-3 overflow-y-auto"
              rows={1}
              disabled={isLoading}
              style={{ minHeight: '24px', maxHeight: '120px' }}
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isLoading}
              className="w-10 h-10 bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors rounded-lg flex items-center justify-center flex-shrink-0"
              title="发送消息"
            >
              <Send className={`w-5 h-5 ${isLoading ? 'animate-pulse' : ''}`} />
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;