import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Send, Bot, User, Trash2, History, Brain, Square, BookOpen, Settings, Plus, MessageSquare, LayoutDashboard } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import MessageContent from './MessageContent';
import SnIblfResultCard from './SnIblfResultCard';
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
    deleteConversation,
    stopGeneration
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

  // 停止生成
  const handleStop = () => {
    stopGeneration();
    setIsSending(false); // 立即重置发送状态，允许用户发送新消息
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
    <div className="flex h-screen bg-gradient-to-br from-slate-50 to-gray-100">
      {/* 左侧边栏 - 深色主题 */}
      <div className="w-72 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col h-screen">
        {/* 顶部：Logo和新建按钮 */}
        <div className="p-4 border-b border-slate-700/50">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">AI知识助手</h2>
              <p className="text-slate-400 text-xs">智能问答系统</p>
            </div>
          </div>
          <button
            onClick={() => createConversation(user.id, '新对话')}
            className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-purple-700 transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            新建对话
          </button>
        </div>

        {/* 对话列表 */}
        <div className="flex-1 overflow-y-auto p-3">
          <p className="text-slate-500 text-xs font-medium px-2 mb-2 uppercase tracking-wider">对话历史</p>
          {sortedConversations.length === 0 ? (
            <div className="text-center text-slate-500 text-sm mt-8 px-4">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>暂无对话记录</p>
              <p className="text-xs mt-1 text-slate-600">点击上方按钮开始新对话</p>
            </div>
          ) : (
            <div className="space-y-1">
              {sortedConversations.map((conversation) => {
                const preview = getConversationPreview(conversation);
                const isActive = currentConversation?.id === conversation.id;
                return (
                  <div
                    key={conversation.id}
                    className={`group relative flex items-center rounded-xl transition-all duration-200 ${
                      isActive
                        ? 'bg-indigo-500/20 text-indigo-300'
                        : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                    }`}
                  >
                    <button
                      onClick={() => selectConversation(conversation)}
                      className="flex-1 text-left px-3 py-2.5 rounded-xl min-w-0 overflow-hidden w-full"
                    >
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 flex-shrink-0 opacity-60" />
                        <span className="truncate text-sm">
                          {preview || conversation.title || '新对话'}
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleDeleteConversation(e, conversation.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 mr-2 text-slate-500 hover:text-red-400 transition-all rounded-lg hover:bg-red-500/10"
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

        {/* 底部导航 */}
        <div className="p-3 border-t border-slate-700/50 space-y-1">
          <Link
            to="/admin/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all"
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-sm font-medium">管理后台</span>
          </Link>
        </div>
      </div>

      {/* 右侧主内容区 */}
      <div className="flex-1 flex flex-col h-screen min-w-0">
        {/* 头部工具栏 */}
        <div className="flex items-center justify-between px-6 py-3 bg-white/80 backdrop-blur-sm border-b border-gray-200/50">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">
              {currentConversation ? '当前对话' : '开始新对话'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Link
              to="/admin/knowledge"
              className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
              title="知识库"
            >
              <BookOpen className="w-5 h-5" />
            </Link>
            <Link
              to="/admin/settings"
              className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
              title="设置"
            >
              <Settings className="w-5 h-5" />
            </Link>
          </div>
        </div>

        {/* 对话内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center max-w-2xl mx-auto">
              <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-500/30 mb-6">
                <Bot className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">欢迎使用AI知识助手</h3>
              <p className="text-gray-500 mb-8 leading-relaxed">
                我是您的智能知识助手，可以回答基于知识库的各种问题。<br />
                请在下方输入您的问题，我会尽力为您提供准确的答案。
              </p>

              {/* 快捷提示卡片 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                <button
                  onClick={() => setInputValue('如何配置MLAG？')}
                  className="p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer group text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                      <BookOpen className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">查询配置</p>
                      <p className="text-xs text-gray-500">如何配置MLAG？</p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setInputValue('接口状态异常怎么办？')}
                  className="p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer group text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center group-hover:bg-purple-100 transition-colors">
                      <Brain className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">故障排查</p>
                      <p className="text-xs text-gray-500">接口状态异常怎么办？</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto">
              {messages.map((message) => (
                <div key={message.id} className={`flex items-start gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}>
                  {message.role === 'assistant' && (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/20 mt-1">
                      <Bot className="w-5 h-5 text-white" />
                    </div>
                  )}

                  <div className={`max-w-[85%] relative group ${
                    message.role === 'user'
                      ? 'order-1'
                      : 'order-2'
                  }`}>
                    {/* 消息气泡 */}
                    <div className={`px-5 py-4 shadow-sm ${
                      message.role === 'user'
                        ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-2xl rounded-tr-md'
                        : 'bg-white border border-gray-100 rounded-2xl rounded-tl-md shadow-md'
                    }`}>
                      <MessageContent content={message.content} role={message.role} />
                    </div>

                    {/* 工具结果卡片 */}
                    {message.role === 'assistant' && message.metadata?.toolResults?.snIblf && (
                      <SnIblfResultCard
                        result={message.metadata.toolResults.snIblf.result}
                        queriedSNs={message.metadata.toolResults.snIblf.queriedSNs}
                      />
                    )}

                    {/* 底部元数据 */}
                    <div className={`flex items-center gap-2 mt-1.5 text-xs text-gray-400 ${
                       message.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}>
                      {message.role === 'assistant' && message.metadata?.model && (
                        <span className="flex items-center gap-1 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">
                           <Bot className="w-3 h-3" />
                           {message.metadata.model}
                        </span>
                      )}

                      {message.role === 'assistant' && message.metadata?.deepThinking && (
                        <span className="flex items-center gap-1 text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                          <Brain className="w-3 h-3" />
                          深度思考
                        </span>
                      )}

                      <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                        {new Date(message.createdAt || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </span>
                    </div>
                  </div>

                  {message.role === 'user' && (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20 mt-1 order-2">
                      <User className="w-5 h-5 text-white" />
                    </div>
                  )}
                </div>
              ))}

              {/* 加载状态 */}
              {isLoading && (
                <div className="flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/20 mt-1">
                    <Bot className="w-5 h-5 text-white animate-pulse" />
                  </div>
                  <div className="flex flex-col gap-2 max-w-[85%] w-full">
                    {/* 状态栏：深度思考中 + 停止按钮 */}
                    <div className="flex items-center gap-3 text-sm text-gray-500 pl-1">
                      <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100 shadow-sm">
                        <Brain className="w-4 h-4 animate-pulse" />
                        <span className="font-medium">深度思考中...</span>
                      </div>
                      <button
                        onClick={handleStop}
                        className="flex items-center gap-1 px-3 py-1 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors border border-transparent hover:border-red-200"
                        title="停止响应"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        <span className="text-xs font-medium">停止</span>
                      </button>
                    </div>
                    
                    {/* 占位气泡 */}
                    <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm p-6 shadow-sm min-h-[80px] flex items-center">
                       <div className="flex space-x-2">
                        <div className="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                        <div className="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        <div className="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
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
        <div className="px-6 pb-6 pt-3 bg-gradient-to-t from-gray-100 to-transparent">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative">
            {/* 深度思考标签 */}
            <div className="absolute -top-8 left-4 flex items-center gap-3">
              <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-gradient-to-r from-indigo-500/10 to-purple-500/10 text-indigo-600 border border-indigo-200/50">
                <Brain className="w-3.5 h-3.5" />
                深度思考已启用
              </span>
            </div>

            <div className="flex items-end bg-white rounded-2xl shadow-xl border border-gray-200/50 px-4 py-3 transition-all hover:shadow-2xl hover:border-indigo-200/50 focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-500/10">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={isLoading ? 'AI正在思考中...' : '输入您的问题，按 Enter 发送...'}
                className="flex-1 bg-transparent border-0 resize-none focus:outline-none text-sm text-gray-900 placeholder-gray-400 pr-3 overflow-y-auto py-2"
                rows={1}
                disabled={isLoading || isSending}
                style={{ minHeight: '24px', maxHeight: '120px' }}
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isSending || isLoading}
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                  !inputValue.trim() || isSending || isLoading
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/25 transform hover:-translate-y-0.5'
                }`}
                title={isSending ? '发送中...' : '发送消息'}
              >
                {isSending || isLoading ? (
                  <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>

            {/* 底部提示 */}
            <p className="text-center text-xs text-gray-400 mt-3">
              AI知识助手基于您上传的文档提供回答，回答仅供参考
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;