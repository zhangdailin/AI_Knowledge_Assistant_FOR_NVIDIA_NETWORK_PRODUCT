import React, { useState, useEffect } from 'react';
import {
  FileText, MessageSquare, Users, TrendingUp,
  Clock, Database, Zap, AlertCircle
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar
} from 'recharts';

import { getApiServerUrl } from '../utils/apiUtils';

interface Stats {
  totalDocuments: number;
  totalChunks: number;
  totalQueries: number;
  avgResponseTime: number;
  recentQueries: { date: string; count: number }[];
  topQuestions: { question: string; count: number }[];
  documentsByCategory: { category: string; count: number }[];
}

type SystemStatus = 'checking' | 'online' | 'offline' | 'error';

// 统一的系统状态配置
const STATUS_CONFIG: Record<SystemStatus, {
  title: string;
  description: string;
  gradient: string;
  indicatorColor: string;
  label: string;
}> = {
  checking: {
    title: '正在检测...',
    description: '正在连接后端服务...',
    gradient: 'bg-gradient-to-r from-gray-400 to-gray-500',
    indicatorColor: 'bg-yellow-400 animate-pulse',
    label: '检测中'
  },
  online: {
    title: '系统运行正常',
    description: '后端服务响应正常，知识库已就绪',
    gradient: 'bg-gradient-to-r from-indigo-500 to-purple-600',
    indicatorColor: 'bg-green-400 animate-pulse',
    label: '在线'
  },
  offline: {
    title: '服务器离线',
    description: '无法连接到后端服务',
    gradient: 'bg-gradient-to-r from-red-500 to-orange-500',
    indicatorColor: 'bg-red-400',
    label: '离线'
  },
  error: {
    title: '服务异常',
    description: '无法连接到后端服务',
    gradient: 'bg-gradient-to-r from-red-500 to-orange-500',
    indicatorColor: 'bg-red-400',
    label: '异常'
  }
};

// 统一的状态更新函数类型
interface SystemState {
  stats: Stats | null;
  status: SystemStatus;
  error: string;
  loading: boolean;
}

const Dashboard: React.FC = () => {
  const [state, setState] = useState<SystemState>({
    stats: null,
    status: 'checking',
    error: '',
    loading: true
  });

  // 统一的状态更新方法
  const updateState = (updates: Partial<SystemState>) => {
    setState(prev => ({ ...prev, ...updates }));
  };

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchStats = async () => {
    updateState({ status: 'checking', error: '' });
    try {
      const response = await fetch(`${getApiServerUrl()}/api/stats`);
      if (response.ok) {
        const data = await response.json();
        if (data.ok !== false) {
          updateState({ stats: data, status: 'online', loading: false });
        } else {
          updateState({ stats: null, status: 'error', error: data.error || '获取数据失败', loading: false });
        }
      } else {
        updateState({ stats: null, status: 'offline', error: `服务器响应错误: ${response.status}`, loading: false });
      }
    } catch (error) {
      console.error('获取统计数据失败:', error);
      updateState({
        stats: null,
        status: 'offline',
        error: error instanceof Error ? error.message : '无法连接到服务器',
        loading: false
      });
    }
  };

  // 解构状态以便使用
  const { stats, status, error, loading } = state;
  const statusConfig = STATUS_CONFIG[status];

  if (loading) {
    return (
      <div className="admin-page space-y-6 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-gray-200 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-80 bg-gray-200 rounded-xl" />
          <div className="h-80 bg-gray-200 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!stats) {
    // API 失败时显示错误状态 - 使用统一的状态配置
    return (
      <div className="admin-page">
        <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">数据概览</h1>
            <p className="text-sm text-gray-500 mt-1">知识库运行状态概览</p>
          </div>
          <button
            onClick={fetchStats}
            className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <Clock className="w-4 h-4" />
            重新连接
          </button>
        </div>

        {/* 错误提示 */}
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-red-700">无法获取统计数据</h3>
          <p className="text-red-600 mt-2">{error || '请检查后端服务是否正常运行'}</p>
        </div>

        {/* 系统状态 - 使用统一配置 */}
        <div className={`${statusConfig.gradient} rounded-xl p-6 text-white`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{statusConfig.title}</h3>
              <p className="text-white/80 mt-1">{error || statusConfig.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${statusConfig.indicatorColor}`} />
              <span className="text-sm font-medium">{statusConfig.label}</span>
            </div>
          </div>
        </div>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: '文档总数',
      value: stats.totalDocuments,
      icon: FileText,
      color: 'bg-blue-500',
      lightColor: 'bg-blue-50',
      textColor: 'text-blue-600',
    },
    {
      title: '知识片段',
      value: stats.totalChunks.toLocaleString(),
      icon: Database,
      color: 'bg-emerald-500',
      lightColor: 'bg-emerald-50',
      textColor: 'text-emerald-600',
    },
    {
      title: '问答次数',
      value: stats.totalQueries,
      icon: MessageSquare,
      color: 'bg-purple-500',
      lightColor: 'bg-purple-50',
      textColor: 'text-purple-600',
    },
    {
      title: '平均响应',
      value: `${stats.avgResponseTime}s`,
      icon: Zap,
      color: 'bg-amber-500',
      lightColor: 'bg-amber-50',
      textColor: 'text-amber-600',
    },
  ];

  return (
    <div className="admin-page">
      <div className="max-w-6xl mx-auto space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">数据概览</h1>
          <p className="text-sm text-gray-500 mt-1">知识库运行状态概览</p>
        </div>
        <button
          onClick={fetchStats}
          className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-2"
        >
          <Clock className="w-4 h-4" />
          刷新数据
        </button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <div
              key={index}
              className="admin-card p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">{card.title}</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{card.value}</p>
                </div>
                <div className={`w-12 h-12 ${card.lightColor} rounded-xl flex items-center justify-center`}>
                  <Icon className={`w-6 h-6 ${card.textColor}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 问答趋势 */}
        <div className="admin-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">问答趋势</h3>
            <span className="text-sm text-gray-500">最近7天</span>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={stats.recentQueries || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#6366f1"
                strokeWidth={3}
                dot={{ fill: '#6366f1', strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, fill: '#6366f1' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 热门问题 */}
        <div className="admin-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">热门问题</h3>
            <span className="text-sm text-gray-500">Top 5</span>
          </div>
          <div className="space-y-4">
            {(stats.topQuestions || []).map((item, index) => (
              <div key={index} className="flex items-center gap-4">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  index === 0 ? 'bg-amber-100 text-amber-600' :
                  index === 1 ? 'bg-gray-100 text-gray-600' :
                  index === 2 ? 'bg-orange-100 text-orange-600' :
                  'bg-gray-50 text-gray-500'
                }`}>
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.question}</p>
                  <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all"
                      style={{ width: `${(item.count / (stats.topQuestions?.[0]?.count || 1)) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm font-medium text-gray-500">{item.count}次</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 文档分类统计 */}
      <div className="admin-card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">文档分类</h3>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={stats.documentsByCategory || []} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" stroke="#9ca3af" fontSize={12} />
            <YAxis dataKey="category" type="category" stroke="#9ca3af" fontSize={12} width={80} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px'
              }}
            />
            <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 系统状态 - 使用统一配置 */}
      <div className={`${statusConfig.gradient} rounded-xl p-6 text-white`}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{statusConfig.title}</h3>
            <p className="text-white/80 mt-1">
              {status === 'online' ? statusConfig.description : (error || statusConfig.description)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${statusConfig.indicatorColor}`} />
            <span className="text-sm font-medium">{statusConfig.label}</span>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default Dashboard;
