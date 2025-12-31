import React, { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown, TrendingUp, AlertCircle, CheckCircle, Clock } from 'lucide-react';

interface FeedbackEntry {
  id: string;
  messageId: string;
  verdict: 'up' | 'down';
  question: string;
  answer: string;
  conversationId: string;
  confidenceScore: number | null;
  timestamp: string;
}

interface FeedbackMetrics {
  total: number;
  positive: number;
  negative: number;
  positivityRate: number;
  recent: FeedbackEntry[];
}

const FeedbackAnalytics: React.FC = () => {
  const [metrics, setMetrics] = useState<FeedbackMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/metrics/feedback');
      const data = await response.json();

      if (data.ok) {
        setMetrics(data.metrics);
        setError(null);
      } else {
        setError(data.error || '获取数据失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
      console.error('Failed to fetch feedback metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    // 每30秒自动刷新
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">加载反馈数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <p className="text-red-700 font-medium">{error}</p>
        <button
          onClick={fetchMetrics}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  if (!metrics) {
    return null;
  }

  const positivityRate = metrics.positivityRate * 100;

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">反馈数据分析</h2>
          <p className="text-sm text-gray-500 mt-1">用户反馈统计与质量监控</p>
        </div>
        <button
          onClick={fetchMetrics}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
        >
          <Clock className="w-4 h-4" />
          刷新数据
        </button>
      </div>

      {/* 核心指标卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* 总反馈数 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">总反馈数</span>
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-indigo-600" />
            </div>
          </div>
          <div className="text-3xl font-bold text-gray-900">{metrics.total}</div>
          <p className="text-xs text-gray-500 mt-1">累计收到的反馈</p>
        </div>

        {/* 正面反馈 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">正面反馈</span>
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <ThumbsUp className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
          <div className="text-3xl font-bold text-emerald-600">{metrics.positive}</div>
          <p className="text-xs text-gray-500 mt-1">用户认为有帮助</p>
        </div>

        {/* 负面反馈 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">负面反馈</span>
            <div className="w-10 h-10 bg-rose-100 rounded-lg flex items-center justify-center">
              <ThumbsDown className="w-5 h-5 text-rose-600" />
            </div>
          </div>
          <div className="text-3xl font-bold text-rose-600">{metrics.negative}</div>
          <p className="text-xs text-gray-500 mt-1">需要改进的回答</p>
        </div>

        {/* 满意度 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">满意度</span>
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              positivityRate >= 70 ? 'bg-emerald-100' : positivityRate >= 50 ? 'bg-amber-100' : 'bg-rose-100'
            }`}>
              <CheckCircle className={`w-5 h-5 ${
                positivityRate >= 70 ? 'text-emerald-600' : positivityRate >= 50 ? 'text-amber-600' : 'text-rose-600'
              }`} />
            </div>
          </div>
          <div className={`text-3xl font-bold ${
            positivityRate >= 70 ? 'text-emerald-600' : positivityRate >= 50 ? 'text-amber-600' : 'text-rose-600'
          }`}>
            {positivityRate.toFixed(1)}%
          </div>
          <p className="text-xs text-gray-500 mt-1">正面反馈占比</p>
        </div>
      </div>

      {/* 满意度趋势图 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">满意度分布</h3>
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <ThumbsUp className="w-4 h-4 text-emerald-600" />
                正面反馈
              </span>
              <span className="text-sm font-medium text-gray-900">
                {metrics.positive} ({metrics.total > 0 ? ((metrics.positive / metrics.total) * 100).toFixed(1) : 0}%)
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-emerald-500 h-3 rounded-full transition-all"
                style={{ width: `${metrics.total > 0 ? (metrics.positive / metrics.total) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <ThumbsDown className="w-4 h-4 text-rose-600" />
                负面反馈
              </span>
              <span className="text-sm font-medium text-gray-900">
                {metrics.negative} ({metrics.total > 0 ? ((metrics.negative / metrics.total) * 100).toFixed(1) : 0}%)
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-rose-500 h-3 rounded-full transition-all"
                style={{ width: `${metrics.total > 0 ? (metrics.negative / metrics.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 最近反馈列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">最近反馈 (最新10条)</h3>
        {metrics.recent.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>暂无反馈数据</p>
          </div>
        ) : (
          <div className="space-y-3">
            {metrics.recent.map((entry) => (
              <div
                key={entry.id}
                className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {entry.verdict === 'up' ? (
                      <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                        <ThumbsUp className="w-4 h-4 text-emerald-600" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 bg-rose-100 rounded-lg flex items-center justify-center">
                        <ThumbsDown className="w-4 h-4 text-rose-600" />
                      </div>
                    )}
                    <span className={`text-sm font-medium ${
                      entry.verdict === 'up' ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {entry.verdict === 'up' ? '有帮助' : '待改进'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {entry.confidenceScore !== null && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        置信度: {(entry.confidenceScore * 100).toFixed(0)}%
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(entry.timestamp).toLocaleString('zh-CN')}
                    </span>
                  </div>
                </div>
                {entry.question && (
                  <div className="mb-2">
                    <span className="text-xs font-medium text-gray-500">问题：</span>
                    <p className="text-sm text-gray-700 mt-1 line-clamp-2">{entry.question}</p>
                  </div>
                )}
                {entry.answer && (
                  <div>
                    <span className="text-xs font-medium text-gray-500">回答：</span>
                    <p className="text-sm text-gray-600 mt-1 line-clamp-3">{entry.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 改进建议 */}
      {positivityRate < 70 && metrics.total > 5 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-amber-900 mb-2">改进建议</h4>
              <ul className="text-sm text-amber-800 space-y-1">
                <li>• 当前满意度为 {positivityRate.toFixed(1)}%，建议关注负面反馈的具体原因</li>
                <li>• 检查低置信度回答，优化知识库内容和检索策略</li>
                <li>• 分析待核实命令，补充相关文档或调整验证规则</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FeedbackAnalytics;
