import React, { useState, useEffect } from 'react';
import {
  FileText, MessageSquare, Users, TrendingUp,
  Clock, Database, Zap, AlertCircle
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar
} from 'recharts';

function getApiServerUrl(): string {
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('custom_api_server_url');
    if (customUrl) return customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
  }
  const envUrl = import.meta.env.VITE_API_SERVER_URL;
  if (envUrl) return envUrl.endsWith('/') ? envUrl.slice(0, -1) : envUrl;
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }
  return 'http://localhost:8787';
}

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

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>('checking');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setSystemStatus('checking');
    setErrorMessage('');
    try {
      const response = await fetch(`${getApiServerUrl()}/api/stats`);
      if (response.ok) {
        const data = await response.json();
        if (data.ok !== false) {
          setStats(data);
          setSystemStatus('online');
        } else {
          setStats(null);
          setSystemStatus('error');
          setErrorMessage(data.error || '获取数据失败');
        }
      } else {
        setStats(null);
        setSystemStatus('offline');
        setErrorMessage(`服务器响应错误: ${response.status}`);
      }
    } catch (error) {
      console.error('获取统计数据失败:', error);
      setStats(null);
      setSystemStatus('offline');
      setErrorMessage(error instanceof Error ? error.message : '无法连接到服务器');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
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
    // API 失败时显示错误状态
    return (
      <div className="p-6 space-y-6 bg-gray-50 min-h-full">
        <div className="flex items-center justify-between">
          <p className="text-gray-500">知识库运行状态概览</p>
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
          <p className="text-red-600 mt-2">{errorMessage || '请检查后端服务是否正常运行'}</p>
        </div>

        {/* 系统状态 */}
        <div className="bg-gradient-to-r from-red-500 to-orange-500 rounded-xl p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">
                {systemStatus === 'offline' ? '服务器离线' : '服务异常'}
              </h3>
              <p className="text-white/80 mt-1">{errorMessage || '无法连接到后端服务'}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-400 rounded-full" />
              <span className="text-sm font-medium">{systemStatus === 'offline' ? '离线' : '异常'}</span>
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
    <div className="p-6 space-y-6 bg-gray-50 min-h-full">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <p className="text-gray-500">知识库运行状态概览</p>
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
              className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
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
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">问答趋势</h3>
            <span className="text-sm text-gray-500">最近7天</span>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={stats.recentQueries}>
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
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">热门问题</h3>
            <span className="text-sm text-gray-500">Top 5</span>
          </div>
          <div className="space-y-4">
            {stats.topQuestions.map((item, index) => (
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
                      style={{ width: `${(item.count / stats.topQuestions[0].count) * 100}%` }}
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
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">文档分类</h3>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={stats.documentsByCategory} layout="vertical">
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

      {/* 系统状态 - 真实检测 */}
      <div className={`rounded-xl p-6 text-white ${
        systemStatus === 'online' ? 'bg-gradient-to-r from-indigo-500 to-purple-600' :
        systemStatus === 'checking' ? 'bg-gradient-to-r from-gray-400 to-gray-500' :
        'bg-gradient-to-r from-red-500 to-orange-500'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              {systemStatus === 'online' && '系统运行正常'}
              {systemStatus === 'checking' && '正在检测...'}
              {systemStatus === 'offline' && '服务器离线'}
              {systemStatus === 'error' && '服务异常'}
            </h3>
            <p className="text-white/80 mt-1">
              {systemStatus === 'online' && '后端服务响应正常，知识库已就绪'}
              {systemStatus === 'checking' && '正在连接后端服务...'}
              {(systemStatus === 'offline' || systemStatus === 'error') && (errorMessage || '无法连接到后端服务')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${
              systemStatus === 'online' ? 'bg-green-400 animate-pulse' :
              systemStatus === 'checking' ? 'bg-yellow-400 animate-pulse' :
              'bg-red-400'
            }`} />
            <span className="text-sm font-medium">
              {systemStatus === 'online' && '在线'}
              {systemStatus === 'checking' && '检测中'}
              {systemStatus === 'offline' && '离线'}
              {systemStatus === 'error' && '异常'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
