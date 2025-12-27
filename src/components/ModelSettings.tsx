import React, { useState, useEffect } from 'react';
import { Cpu, MessageSquare, Search, RefreshCw, Check, AlertCircle, Sparkles, Eye, EyeOff, Key, Globe } from 'lucide-react';

interface Model {
  id: string;
  name: string;
  type: 'llm' | 'embedding' | 'reranking' | 'unknown';
  provider: string;
  description?: string;
}

interface ProviderConfig {
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
}

interface ModelSelection {
  llm: string;
  embedding: string;
  reranking: string;
}

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

// 根据模型名称判断类型
function classifyModel(modelId: string): 'llm' | 'embedding' | 'reranking' | 'unknown' {
  const id = modelId.toLowerCase();

  if (id.includes('embed') || id.includes('bge') || id.includes('e5') ||
      id.includes('gte') || id.includes('text-embedding') || id.includes('xiaobu')) {
    return 'embedding';
  }

  if (id.includes('rerank') || id.includes('ranker')) {
    return 'reranking';
  }

  if (id.includes('qwen') || id.includes('llama') || id.includes('mistral') ||
      id.includes('gemma') || id.includes('deepseek') || id.includes('yi-') ||
      id.includes('glm') || id.includes('baichuan') || id.includes('internlm') ||
      id.includes('chat') || id.includes('instruct') || id.includes('gemini') ||
      id.includes('gpt') || id.includes('claude')) {
    return 'llm';
  }

  return 'unknown';
}

const ModelSettings: React.FC = () => {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({
    siliconflow: { name: '硅基流动', enabled: true, apiKey: '', baseUrl: 'https://api.siliconflow.cn' },
    gemini: { name: 'Gemini', enabled: true, apiKey: '', baseUrl: 'https://gemini.chinablog.xyz' }
  });

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<ModelSelection>({
    llm: '',
    embedding: '',
    reranking: ''
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [editingProvider, setEditingProvider] = useState<string | null>(null);

  useEffect(() => {
    loadSavedSettings();
  }, []);

  const loadSavedSettings = async () => {
    try {
      const res = await fetch(`${getApiServerUrl()}/api/settings`);
      if (res.ok) {
        const data = await res.json();
        if (data.settings?.modelSelection) {
          setSelection(data.settings.modelSelection);
        }
        if (data.settings?.providers) {
          setProviders(prev => {
            const merged = { ...prev };
            Object.keys(data.settings.providers).forEach(key => {
              if (merged[key]) {
                merged[key] = { ...merged[key], ...data.settings.providers[key] };
              }
            });
            return merged;
          });
        }
      }
    } catch (e) {
      console.error('加载设置失败:', e);
    }
  };

  const fetchModels = async (provider: string) => {
    setLoading(prev => ({ ...prev, [provider]: true }));
    setError(prev => ({ ...prev, [provider]: '' }));

    try {
      const res = await fetch(`${getApiServerUrl()}/api/models/${provider}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `获取模型列表失败: ${res.status}`);
      }

      const data = await res.json();
      const newModels = (data.models || []).map((m: any) => ({
        id: m.id,
        name: m.id.split('/').pop() || m.id,
        type: classifyModel(m.id),
        provider,
        description: m.description
      }));

      setModels(prev => [
        ...prev.filter(m => m.provider !== provider),
        ...newModels
      ]);
    } catch (e) {
      setError(prev => ({ ...prev, [provider]: (e as Error).message }));
    } finally {
      setLoading(prev => ({ ...prev, [provider]: false }));
    }
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await fetch(`${getApiServerUrl()}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelSelection: selection,
          providers
        })
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (e) {
      console.error('保存失败:', e);
      setSaveStatus('idle');
    }
  };

  const updateProvider = (key: string, field: keyof ProviderConfig, value: string | boolean) => {
    setProviders(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value }
    }));
  };

  const modelsByType = {
    llm: models.filter(m => m.type === 'llm'),
    embedding: models.filter(m => m.type === 'embedding'),
    reranking: models.filter(m => m.type === 'reranking'),
    unknown: models.filter(m => m.type === 'unknown')
  };

  const typeLabels = {
    llm: { label: 'LLM 对话模型', icon: MessageSquare, color: 'blue' },
    embedding: { label: '嵌入模型 (Embedding)', icon: Cpu, color: 'green' },
    reranking: { label: '重排序模型 (Reranking)', icon: Search, color: 'purple' }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-full">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">模型管理</h1>
            <p className="text-sm text-gray-500 mt-1">配置 API 密钥和选择 AI 模型</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              saveStatus === 'saved'
                ? 'bg-green-500 text-white'
                : saveStatus === 'saving'
                ? 'bg-gray-200 text-gray-400'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            {saveStatus === 'saved' ? <Check className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : '保存配置'}
          </button>
        </div>

        {/* 模型提供商配置 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">API 配置</h2>
          <div className="space-y-4">
            {Object.entries(providers).map(([key, provider]) => (
              <div key={key} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      key === 'siliconflow' ? 'bg-blue-100' : 'bg-purple-100'
                    }`}>
                      <Cpu className={`w-5 h-5 ${key === 'siliconflow' ? 'text-blue-600' : 'text-purple-600'}`} />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{provider.name}</h3>
                      <p className="text-xs text-gray-500">
                        {provider.apiKey ? '已配置 API Key' : '未配置 API Key'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingProvider(editingProvider === key ? null : key)}
                      className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      {editingProvider === key ? '收起' : '配置'}
                    </button>
                    <button
                      onClick={() => fetchModels(key)}
                      disabled={loading[key] || !provider.apiKey}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={!provider.apiKey ? '请先配置 API Key' : ''}
                    >
                      <RefreshCw className={`w-4 h-4 ${loading[key] ? 'animate-spin' : ''}`} />
                      {loading[key] ? '加载中' : '获取模型'}
                    </button>
                  </div>
                </div>

                {/* 配置表单 */}
                {editingProvider === key && (
                  <div className="space-y-3 pt-3 border-t border-gray-100">
                    {/* API Key */}
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                        <Key className="w-4 h-4" />
                        API Key
                      </label>
                      <div className="relative">
                        <input
                          type={showApiKey[key] ? 'text' : 'password'}
                          value={provider.apiKey}
                          onChange={(e) => updateProvider(key, 'apiKey', e.target.value)}
                          placeholder={`输入 ${provider.name} API Key`}
                          className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(prev => ({ ...prev, [key]: !prev[key] }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          {showApiKey[key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* API 地址 */}
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                        <Globe className="w-4 h-4" />
                        API 地址
                      </label>
                      <input
                        type="text"
                        value={provider.baseUrl}
                        onChange={(e) => updateProvider(key, 'baseUrl', e.target.value)}
                        placeholder="https://api.example.com"
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-sm"
                      />
                    </div>
                  </div>
                )}

                {/* 错误提示 */}
                {error[key] && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mt-3">
                    <AlertCircle className="w-4 h-4" />
                    {error[key]}
                  </div>
                )}

                {/* 成功提示 */}
                {!error[key] && models.filter(m => m.provider === key).length > 0 && (
                  <div className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg mt-3">
                    已加载 {models.filter(m => m.provider === key).length} 个模型
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 模型选择 */}
        {models.length > 0 && (
          <>
            {(['llm', 'embedding', 'reranking'] as const).map(type => {
              const config = typeLabels[type];
              const Icon = config.icon;
              const typeModels = modelsByType[type];

              if (typeModels.length === 0) return null;

              return (
                <div key={type} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-${config.color}-100`}>
                      <Icon className={`w-5 h-5 text-${config.color}-600`} />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">{config.label}</h2>
                      <p className="text-sm text-gray-500">共 {typeModels.length} 个可用模型</p>
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">当前选择</label>
                    <select
                      value={selection[type]}
                      onChange={(e) => setSelection(prev => ({ ...prev, [type]: e.target.value }))}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    >
                      <option value="">-- 请选择模型 --</option>
                      {typeModels.map(model => (
                        <option key={model.id} value={model.id}>
                          [{model.provider === 'siliconflow' ? '硅基' : 'Gemini'}] {model.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="max-h-60 overflow-y-auto border border-gray-100 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium text-gray-600">模型 ID</th>
                          <th className="text-left px-4 py-2 font-medium text-gray-600 w-24">提供商</th>
                          <th className="text-center px-4 py-2 font-medium text-gray-600 w-20">选择</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {typeModels.map(model => (
                          <tr key={model.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 font-mono text-xs">{model.id}</td>
                            <td className="px-4 py-2">
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                model.provider === 'siliconflow' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                              }`}>
                                {model.provider === 'siliconflow' ? '硅基' : 'Gemini'}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-center">
                              <button
                                onClick={() => setSelection(prev => ({ ...prev, [type]: model.id }))}
                                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                  selection[type] === model.id
                                    ? 'border-blue-500 bg-blue-500'
                                    : 'border-gray-300 hover:border-blue-400'
                                }`}
                              >
                                {selection[type] === model.id && <Check className="w-4 h-4 text-white" />}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* 未分类模型 */}
            {modelsByType.unknown.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">其他模型</h2>
                <div className="text-sm text-gray-500 space-y-1">
                  {modelsByType.unknown.map(model => (
                    <div key={model.id} className="font-mono">{model.id}</div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* 空状态 */}
        {models.length === 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <Cpu className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">暂无模型数据</h3>
            <p className="text-gray-500">请先配置 API Key，然后点击"获取模型"按钮加载可用模型列表</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ModelSettings;
