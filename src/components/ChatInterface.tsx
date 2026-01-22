import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Send, Bot, User, Trash2, Brain, Square, BookOpen, Settings, Plus, MessageSquare, LayoutDashboard, ShieldCheck, AlertTriangle, ThumbsUp, ThumbsDown, Info } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import MessageContent from './MessageContent';
import SnIblfResultCard from '../plugins/sn-iblf/SnIblfResultCard';
import ReferenceDocuments from './ReferenceDocuments';
import { localStorageManager } from '../lib/localStorage';
import type { ReferenceMetadata } from '../lib/types';

type CommandMatch = {
  command: string;
  confidence?: number;
  referenceId?: string | null;
  referenceTitle?: string | null;
  referenceIndex?: number | null;
  excerpt?: string;
};

type ReferenceHighlight = {
  referenceId?: string | null;
  referenceTitle?: string | null;
  referenceIndex?: number | null;
  commands: string[];
  excerpts: string[];
};

// 验证方法标签映射
const getValidationMethodLabel = (method: string): string => {
  const labels: Record<string, string> = {
    'content-length': '基于内容长度',
    'no-reference-few-commands': '无参考文档（少量命令）',
    'no-reference-many-commands': '无参考文档（较多命令）',
    'content-match-high': '高内容匹配度',
    'content-match-medium': '中等内容匹配度',
    'content-match-low': '低内容匹配度',
    'full-validation-no-hallucination': '完整验证（无幻觉）',
    'full-validation-few-hallucinations': '完整验证（少量幻觉）',
    'full-validation-many-hallucinations': '完整验证（较多幻觉）'
  };
  return labels[method] || method;
};

const normalizeCommandMatches = (items: any): CommandMatch[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => {
      if (typeof item === 'string') {
        return { command: item };
      }
      if (item && typeof item.command === 'string') {
        return {
          command: item.command,
          confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
          referenceId: item.referenceId ?? null,
          referenceTitle: item.referenceTitle ?? null,
          referenceIndex: typeof item.referenceIndex === 'number' ? item.referenceIndex : (item.referenceIndex ?? null),
          excerpt: item.excerpt
        } as CommandMatch;
      }
      return null;
    })
    .filter((match): match is CommandMatch => match !== null && Boolean(match.command));
};

const normalizeHallucinations = (items: any): Array<{ command: string; reason?: string }> => {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => {
      if (typeof item === 'string') {
        return { command: item };
      }
      if (item && typeof item.command === 'string') {
        return item;
      }
      return null;
    })
    .filter((entry): entry is { command: string; reason?: string } => Boolean(entry?.command));
};

const buildReferenceHighlightMap = (validation: any): Record<string, ReferenceHighlight> => {
  if (!validation) return {};

  if (Array.isArray(validation.referenceMatches) && validation.referenceMatches.length > 0) {
    return validation.referenceMatches.reduce((acc: Record<string, ReferenceHighlight>, match: any) => {
      const key = match.referenceId || `idx-${match.referenceIndex ?? 'unknown'}`;
      acc[key] = {
        referenceId: match.referenceId ?? null,
        referenceTitle: match.referenceTitle ?? null,
        referenceIndex: match.referenceIndex ?? null,
        commands: Array.isArray(match.commands) ? match.commands : [],
        excerpts: Array.isArray(match.excerpts) ? match.excerpts : []
      };
      return acc;
    }, {});
  }

  const combinedMatches = [
    ...normalizeCommandMatches(validation.verifiedCommands),
    ...normalizeCommandMatches(validation.partialMatches)
  ];

  return combinedMatches.reduce<Record<string, ReferenceHighlight>>((acc, match) => {
    const key = match.referenceId || `idx-${match.referenceIndex ?? 'unknown'}`;
    if (!match.referenceId && match.referenceIndex == null) return acc;
    if (!acc[key]) {
      acc[key] = {
        referenceId: match.referenceId ?? null,
        referenceTitle: match.referenceTitle ?? null,
        referenceIndex: match.referenceIndex ?? null,
        commands: [],
        excerpts: []
      };
    }
    acc[key].commands.push(match.command);
    if (match.excerpt) {
      acc[key].excerpts.push(match.excerpt);
    }
    return acc;
  }, {});
};

const ChatInterface: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false); // 新增：发送状态
  const [validationDetailModal, setValidationDetailModal] = useState<any>(null); // 验证详情弹窗
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const detailVerifiedCommands = validationDetailModal
    ? normalizeCommandMatches(validationDetailModal.verifiedCommands)
    : [];
  const detailPartialMatches = validationDetailModal
    ? normalizeCommandMatches(validationDetailModal.partialMatches)
    : [];
  const detailHallucinations = validationDetailModal
    ? normalizeHallucinations(validationDetailModal.hallucinations)
    : [];

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
    stopGeneration,
    submitFeedback
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
  }, [user, loadConversations]); // 保持对 user 的依赖

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
  }, [user, conversations, currentConversation, selectConversation]);

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

  const handleToggleDeepThinking = () => {
    if (isLoading || isSending) return;
    setDeepThinking(!deepThinking);
  };

  const handleFeedback = (messageId: string, verdict: 'up' | 'down') => {
    submitFeedback(messageId, verdict);
  };

  // 自动调整textarea高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  // 不再过滤空对话，直接显示所有对话，按更新时间倒序排列
  const sortedConversations = React.useMemo(() => {
    return [...conversations].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [conversations]);

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
    <>
      {/* 验证详情弹窗 */}
      {validationDetailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setValidationDetailModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                {validationDetailModal.isConsistent ? (
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                )}
                答案验证详情
              </h3>
              <button
                onClick={() => setValidationDetailModal(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 置信度评分 */}
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">置信度评分</span>
                  <span className={`text-2xl font-bold ${
                    validationDetailModal.confidenceScore >= 0.7 ? 'text-emerald-600' :
                    validationDetailModal.confidenceScore >= 0.4 ? 'text-amber-600' : 'text-rose-600'
                  }`}>
                    {(validationDetailModal.confidenceScore * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      validationDetailModal.confidenceScore >= 0.7 ? 'bg-emerald-500' :
                      validationDetailModal.confidenceScore >= 0.4 ? 'bg-amber-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${validationDetailModal.confidenceScore * 100}%` }}
                  />
                </div>
                {validationDetailModal.validationMethod && (
                  <div className="text-xs text-gray-500 mt-2">
                    验证方式: {getValidationMethodLabel(validationDetailModal.validationMethod)}
                    {!validationDetailModal.hasReferences && (
                      <span className="ml-2 text-amber-600">⚠ 无参考文档</span>
                    )}
                  </div>
                )}
              </div>

              {/* 命令统计 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="text-xs text-gray-500 mb-1">总命令数</div>
                  <div className="text-xl font-bold text-gray-900">{validationDetailModal.totalCommands || 0}</div>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                  <div className="text-xs text-emerald-600 mb-1">已验证</div>
                  <div className="text-xl font-bold text-emerald-700">{detailVerifiedCommands.length}</div>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                  <div className="text-xs text-amber-600 mb-1">待核实</div>
                  <div className="text-xl font-bold text-amber-700">{detailHallucinations.length}</div>
                </div>
              </div>

              {/* 已验证的命令 */}
              {detailVerifiedCommands.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    已验证命令 ({detailVerifiedCommands.length})
                  </h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {detailVerifiedCommands.map((match, idx) => (
                      <div key={idx} className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        <code className="text-xs text-emerald-800 font-mono">{match.command}</code>
                        <div className="text-[10px] text-emerald-700 mt-1 flex flex-wrap gap-2">
                          {match.referenceTitle && <span>来源: {match.referenceTitle}</span>}
                          {typeof match.confidence === 'number' && <span>置信度 {(match.confidence * 100).toFixed(0)}%</span>}
                        </div>
                        {match.excerpt && (
                          <p className="text-[11px] text-gray-600 mt-1 leading-relaxed whitespace-pre-wrap bg-white/60 rounded px-2 py-1">
                            {match.excerpt}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 部分匹配的命令 */}
              {detailPartialMatches.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-blue-600" />
                    部分匹配命令 ({detailPartialMatches.length})
                  </h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {detailPartialMatches.map((item, idx) => (
                      <div key={idx} className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                        <code className="text-xs text-blue-800 font-mono">{item.command}</code>
                        {typeof item.confidence === 'number' && (
                          <span className="ml-2 text-xs text-blue-600">({(item.confidence * 100).toFixed(0)}% 匹配)</span>
                        )}
                        {item.referenceTitle && (
                          <div className="text-[10px] text-blue-600 mt-1">来源: {item.referenceTitle}</div>
                        )}
                        {item.excerpt && (
                          <p className="text-[11px] text-gray-600 mt-1 leading-relaxed whitespace-pre-wrap bg-white rounded px-2 py-1">
                            {item.excerpt}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 待核实的命令 */}
              {detailHallucinations.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    待核实命令 ({detailHallucinations.length})
                  </h4>
                  <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
                    这些命令未在参考文档中找到，可能需要人工核实其准确性
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {detailHallucinations.map((item, idx) => (
                      <div key={idx} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <code className="text-xs text-amber-800 font-mono">{item.command}</code>
                        {item.reason && (
                          <span className="ml-2 text-[10px] text-amber-700">{item.reason}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 警告信息 */}
              {validationDetailModal.warnings && validationDetailModal.warnings.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-gray-700">注意事项</h4>
                  <ul className="space-y-1">
                    {validationDetailModal.warnings.map((warning: string, idx: number) => (
                      <li key={idx} className="text-xs text-gray-600 flex items-start gap-2">
                        <span className="text-amber-500 mt-0.5">⚠</span>
                        {warning}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 分析时间 */}
              {validationDetailModal.analyzedAt && (
                <div className="text-xs text-gray-400 text-center pt-2 border-t border-gray-100">
                  分析时间: {new Date(validationDetailModal.analyzedAt).toLocaleString('zh-CN')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    <div className="flex h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30">
      {/* 左侧边栏 - 优化版 */}
      <div className="w-72 bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 flex flex-col h-screen shadow-2xl">
        {/* 顶部：Logo和新建按钮 */}
        <div className="p-4 border-b border-gray-800/50">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-accent-600 rounded-2xl flex items-center justify-center shadow-lg shadow-primary-500/30 ring-2 ring-white">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">AI知识助手</h2>
              <p className="text-gray-400 text-xs">智能问答系统</p>
            </div>
          </div>
          <button
            onClick={() => createConversation(user.id, '新对话')}
            className="w-full bg-gradient-to-r from-primary-500 to-accent-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:from-primary-600 hover:to-accent-700 transition-all shadow-soft-lg hover:shadow-glow transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            新建对话
          </button>
        </div>

        {/* 对话列表 */}
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          <p className="text-gray-500 text-xs font-medium px-2 mb-2 uppercase tracking-wider">对话历史</p>
          {sortedConversations.length === 0 ? (
            <div className="text-center text-gray-500 text-sm mt-8 px-4">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>暂无对话记录</p>
              <p className="text-xs mt-1 text-gray-600">点击上方按钮开始新对话</p>
            </div>
          ) : (
            <div className="space-y-1">
              {sortedConversations.map((conversation) => {
                const preview = getConversationPreview(conversation);
                const isActive = currentConversation?.id === conversation.id;
                return (
                  <div
                    key={conversation.id}
                    className={`group relative flex items-center rounded-xl transition-all duration-200 ${isActive
                        ? 'bg-primary-500/20 text-primary-300 shadow-soft'
                        : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
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
                      className="opacity-0 group-hover:opacity-100 p-1.5 mr-2 text-gray-500 hover:text-red-400 transition-all rounded-lg hover:bg-red-500/10"
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
        <div className="p-3 border-t border-gray-800/50 space-y-1">
          <Link
            to="/admin/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-gray-800/50 transition-all group"
          >
            <LayoutDashboard className="w-5 h-5 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-medium">管理后台</span>
          </Link>
        </div>
      </div>

      {/* 右侧主内容区 */}
      <div className="flex-1 flex flex-col h-screen min-w-0">
        {/* 头部工具栏 - 优化版 */}
        <div className="flex items-center justify-between px-6 py-3 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 shadow-soft">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">
              {currentConversation ? '当前对话' : '开始新对话'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Link
              to="/admin/knowledge"
              className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-all"
              title="知识库"
            >
              <BookOpen className="w-5 h-5" />
            </Link>
            <Link
              to="/admin/settings"
              className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-all"
              title="设置"
            >
              <Settings className="w-5 h-5" />
            </Link>
          </div>
        </div>

        {/* 对话内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
          {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center max-w-2xl mx-auto">
              <div className="w-20 h-20 bg-gradient-to-br from-primary-500 to-accent-600 rounded-3xl flex items-center justify-center shadow-xl shadow-primary-500/40 mb-6 animate-bounce-subtle ring-4 ring-white">
                <Bot className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent mb-3">欢迎使用AI知识助手</h3>
              <p className="text-gray-500 mb-8 leading-relaxed">
                我是您的智能知识助手，可以回答基于知识库的各种问题。<br />
                请在下方输入您的问题，我会尽力为您提供准确的答案。
              </p>

              {/* 快捷提示卡片 - 优化版 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                <button
                  onClick={() => setInputValue('如何配置MLAG？')}
                  className="p-4 bg-white rounded-2xl border border-gray-100 shadow-soft hover:shadow-soft-lg transition-all cursor-pointer group text-left hover:border-primary-200 hover:-translate-y-0.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-soft">
                      <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">查询配置</p>
                      <p className="text-xs text-gray-500">如何配置MLAG？</p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setInputValue('接口状态异常怎么办？')}
                  className="p-4 bg-white rounded-2xl border border-gray-100 shadow-soft hover:shadow-soft-lg transition-all cursor-pointer group text-left hover:border-accent-200 hover:-translate-y-0.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-soft">
                      <Brain className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">故障排查</p>
                      <p className="text-xs text-gray-500">接口状态异常怎么办？</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto">
              {messages.map((message) => {
                const validationData = message.metadata?.validation;
                const referenceDocuments = (message.metadata?.references || []) as ReferenceMetadata[];
                const referenceHighlightMap = buildReferenceHighlightMap(validationData);
                const referenceBadgeEntries = Object.entries(referenceHighlightMap);
                const referenceLookup = new Map<string, (typeof referenceDocuments)[number]>();
                referenceDocuments.forEach((ref, idx) => {
                  // 添加多个键来确保匹配：原始ID、索引形式、ref-索引形式
                  if (ref.id) {
                    referenceLookup.set(ref.id, ref);
                  }
                  referenceLookup.set(`idx-${idx}`, ref);
                  referenceLookup.set(`ref-${idx}`, ref);
                });
                const hasReferenceBadges = referenceBadgeEntries.length > 0;

                return (
                <div key={message.id} className={`flex items-start gap-4 animate-slide-up ${message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}>
                  {message.role === 'assistant' && (
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary-500/30 mt-1 ring-2 ring-white">
                      <Bot className="w-5 h-5 text-white" />
                    </div>
                  )}

                  <div className={`max-w-[85%] relative group ${message.role === 'user'
                      ? 'order-1'
                      : 'order-2'
                    }`}>
                    {/* 消息气泡 - 优化版 */}
                    <div className={`px-5 py-4 ${message.role === 'user'
                        ? 'bg-gradient-to-br from-primary-500 to-accent-600 text-white rounded-3xl rounded-tr-lg shadow-soft-lg'
                        : 'bg-white border border-gray-100 rounded-3xl rounded-tl-lg shadow-soft-lg hover:shadow-soft-xl transition-shadow'
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
                    <div className={`flex items-center gap-2 mt-1.5 text-xs text-gray-400 ${message.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}>
                      {message.role === 'assistant' && message.metadata?.model && (
                        <span className="flex items-center gap-1 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">
                          <Bot className="w-3 h-3" />
                          {message.metadata.model}
                        </span>
                      )}

                      {message.role === 'assistant' && message.metadata?.deepThinking === true && (
                        <span className="flex items-center gap-1 text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                          <Brain className="w-3 h-3" />
                          深度思考
                        </span>
                      )}

                      {message.role === 'assistant' && message.metadata?.validation && (
                        <button
                          type="button"
                          onClick={() => setValidationDetailModal(message.metadata.validation)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs cursor-pointer hover:shadow-md transition-all ${
                            message.metadata.validation.isConsistent
                              ? 'text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                              : 'text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-100'
                          }`}
                        >
                          {message.metadata.validation.isConsistent ? (
                            <ShieldCheck className="w-3 h-3" />
                          ) : (
                            <AlertTriangle className="w-3 h-3" />
                          )}
                          置信度 {(((message.metadata.validation.confidenceScore ?? 0) * 100)).toFixed(0)}%
                          <Info className="w-3 h-3 ml-0.5 opacity-60" />
                        </button>
                      )}

                      {message.role === 'assistant' &&
                        message.metadata?.validation?.hallucinations &&
                        message.metadata.validation.hallucinations.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setValidationDetailModal(message.metadata.validation)}
                            className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 hover:bg-amber-100 hover:shadow-md transition-all cursor-pointer flex items-center gap-1"
                          >
                            待核实命令 {message.metadata.validation.hallucinations.length} 条
                            <Info className="w-3 h-3 opacity-60" />
                          </button>
                        )}

                      <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                        {new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* 参考文档展示 */}
                    {message.role === 'assistant' && referenceDocuments.length > 0 && hasReferenceBadges && (
                      <ReferenceDocuments references={referenceDocuments} highlights={referenceHighlightMap} />
                    )}

                    {message.role === 'assistant' && (
                      <div className={`flex items-center gap-2 mt-2 ${message.metadata?.feedback ? 'text-gray-500' : 'text-gray-400'}`}>
                        <button
                          type="button"
                          onClick={() => handleFeedback(message.id, 'up')}
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                            message.metadata?.feedback === 'up'
                              ? 'border-emerald-200 text-emerald-600 bg-emerald-50'
                              : 'border-gray-200 hover:border-emerald-200 hover:text-emerald-600 hover:bg-emerald-50'
                          }`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          有帮助
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFeedback(message.id, 'down')}
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                            message.metadata?.feedback === 'down'
                              ? 'border-rose-200 text-rose-600 bg-rose-50'
                              : 'border-gray-200 hover:border-rose-200 hover:text-rose-600 hover:bg-rose-50'
                          }`}
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                          待改进
                        </button>
                      </div>
                    )}
                  </div>

                  {message.role === 'user' && (
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/30 mt-1 order-2 ring-2 ring-white">
                      <User className="w-5 h-5 text-white" />
                    </div>
                  )}
                </div>
                );
              })}

              {/* 加载状态 - 优化版 */}
              {isLoading && (
                <div className="flex items-start gap-4 animate-slide-up">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary-500/30 mt-1 ring-2 ring-white">
                    <Bot className="w-5 h-5 text-white animate-pulse" />
                  </div>
                  <div className="flex flex-col gap-2 max-w-[85%] w-full">
                    {/* 状态栏 */}
                    <div className="flex items-center gap-3 text-sm text-gray-500 pl-1">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-primary-50 to-accent-50 text-primary-700 rounded-full border border-primary-100 shadow-soft">
                      <Brain className="w-4 h-4 animate-pulse" />
                      <span className="font-medium text-sm">{deepThinking ? '深度思考中...' : '思考中...'}</span>
                    </div>
                      <button
                        onClick={handleStop}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-600 transition-all border border-transparent hover:border-red-200 shadow-soft"
                        title="停止响应"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        <span className="text-xs font-medium">停止</span>
                      </button>
                    </div>

                    {/* 占位气泡 */}
                    <div className="bg-white border border-gray-100 rounded-3xl rounded-tl-lg p-6 shadow-soft-lg min-h-[80px] flex items-center">
                      <div className="flex space-x-2">
                        <div className="w-2.5 h-2.5 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                        <div className="w-2.5 h-2.5 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        <div className="w-2.5 h-2.5 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区域 - 优化版 */}
        <div className="px-6 pb-6 pt-3 bg-gradient-to-t from-white via-white to-transparent">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative">
            {/* 深度思考标签 */}
            <div className="absolute -top-8 left-4 flex items-center gap-3">
              <button
                type="button"
                onClick={handleToggleDeepThinking}
                disabled={isLoading || isSending}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-all shadow-soft ${deepThinking
                    ? 'bg-gradient-to-r from-primary-500/10 to-accent-500/10 text-primary-700 border-primary-200 shadow-glow'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  } ${isLoading || isSending ? 'opacity-60 cursor-not-allowed' : 'hover:border-primary-300 hover:scale-105 active:scale-95'}`}
                title={deepThinking ? '点击关闭深度思考' : '点击启用深度思考'}
              >
                <Brain className="w-3.5 h-3.5" />
                {deepThinking ? '深度思考已启用' : '深度思考'}
              </button>
            </div>

            <div className="flex items-end bg-white rounded-3xl shadow-soft-xl border border-gray-200/50 px-4 py-3 transition-all hover:shadow-glow focus-within:border-primary-300 focus-within:shadow-glow">
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
                className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all duration-200 ${!inputValue.trim() || isSending || isLoading
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-br from-primary-500 to-accent-600 text-white hover:from-primary-600 hover:to-accent-700 shadow-soft-lg hover:shadow-glow transform hover:scale-110 active:scale-95'
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
    </>
  );
};

export default ChatInterface;
