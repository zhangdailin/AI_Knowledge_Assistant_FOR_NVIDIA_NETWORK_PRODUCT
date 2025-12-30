import React, { useState, useEffect } from 'react';
import { Settings, Zap, Search, Database, Save, Check, RotateCcw, Info } from 'lucide-react';

interface RetrievalConfig {
    searchCacheSize: number;
    searchCacheTTL: number;
    chunkCacheTTL: number;
    chunkCacheMaxEntries: number;
    searchLimit: number;
    rrfK: number;
    keywordWeight: number;
    vectorWeight: number;
    vectorMinScore: number;
    rerankTopN: number;
}

const defaultConfig: RetrievalConfig = {
    searchCacheSize: 200,
    searchCacheTTL: 30000,
    chunkCacheTTL: 30000,
    chunkCacheMaxEntries: 20,
    searchLimit: 30,
    rrfK: 60,
    keywordWeight: 1.0,
    vectorWeight: 1.0,
    vectorMinScore: 0.2,
    rerankTopN: 10
};

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

export default function RetrievalSettings() {
    const [config, setConfig] = useState<RetrievalConfig>(defaultConfig);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const res = await fetch(`${getApiServerUrl()}/api/settings`);
            if (res.ok) {
                const data = await res.json();
                if (data.settings?.retrieval) {
                    setConfig({ ...defaultConfig, ...data.settings.retrieval });
                }
            }
        } catch (e) {
            console.error('加载检索设置失败:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaveStatus('saving');
        try {
            await fetch(`${getApiServerUrl()}/api/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ retrieval: config })
            });
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (e) {
            console.error('保存失败:', e);
            setSaveStatus('idle');
        }
    };

    const handleReset = () => {
        if (confirm('确定要重置为默认值吗？')) {
            setConfig(defaultConfig);
        }
    };

    const updateConfig = (key: keyof RetrievalConfig, value: number) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    // 配置项组件
    const ConfigItem = ({
        label,
        description,
        value,
        onChange,
        min,
        max,
        step = 1,
        unit = ''
    }: {
        label: string;
        description: string;
        value: number;
        onChange: (v: number) => void;
        min: number;
        max: number;
        step?: number;
        unit?: string;
    }) => (
        <div className="p-4 admin-card-muted">
            <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-900">{label}</label>
                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        value={value}
                        onChange={(e) => onChange(Number(e.target.value))}
                        min={min}
                        max={max}
                        step={step}
                        className="w-24 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                    {unit && <span className="text-sm text-gray-500 w-8">{unit}</span>}
                </div>
            </div>
            <p className="text-xs text-gray-500">{description}</p>
            <input
                type="range"
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                min={min}
                max={max}
                step={step}
                className="w-full mt-2 accent-blue-500"
            />
        </div>
    );

    if (loading) {
        return (
        <div className="admin-page flex items-center justify-center">
                <div className="text-gray-500">加载中...</div>
            </div>
        );
    }

    return (
        <div className="admin-page">
            <div className="max-w-4xl mx-auto space-y-6">
                {/* 标题栏 */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">检索设置</h1>
                        <p className="text-sm text-gray-500 mt-1">调整搜索参数以优化问答准确率</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleReset}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
                        >
                            <RotateCcw className="w-4 h-4" />
                            重置默认
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saveStatus === 'saving'}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${saveStatus === 'saved'
                                    ? 'bg-green-500 text-white'
                                    : saveStatus === 'saving'
                                        ? 'bg-gray-200 text-gray-400'
                                        : 'bg-blue-500 text-white hover:bg-blue-600'
                                }`}
                        >
                            {saveStatus === 'saved' ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : '保存配置'}
                        </button>
                    </div>
                </div>

                {/* 提示 */}
                <div className="flex gap-4 p-4 admin-card-muted">
                    <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <h4 className="text-sm font-medium text-blue-900">配置说明</h4>
                        <p className="text-sm text-blue-700 mt-1">
                            修改设置后需要保存，新的配置将立即生效。搜索缓存会在下次查询时使用新参数。
                        </p>
                    </div>
                </div>

                {/* 缓存设置 */}
                <div className="admin-card p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                            <Database className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">缓存设置</h2>
                            <p className="text-sm text-gray-500">控制内存使用和响应速度</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <ConfigItem
                            label="搜索缓存大小"
                            description="缓存的搜索结果数量，越大响应越快但占用更多内存"
                            value={config.searchCacheSize}
                            onChange={(v) => updateConfig('searchCacheSize', v)}
                            min={50}
                            max={500}
                            unit="条"
                        />
                        <ConfigItem
                            label="搜索缓存时间"
                            description="搜索结果的有效时间，过期后会重新检索"
                            value={config.searchCacheTTL / 1000}
                            onChange={(v) => updateConfig('searchCacheTTL', v * 1000)}
                            min={5}
                            max={300}
                            unit="秒"
                        />
                        <ConfigItem
                            label="Chunk 缓存时间"
                            description="文档块在内存中的保留时间，越长命中率越高"
                            value={config.chunkCacheTTL / 1000}
                            onChange={(v) => updateConfig('chunkCacheTTL', v * 1000)}
                            min={10}
                            max={300}
                            unit="秒"
                        />
                        <ConfigItem
                            label="Chunk 缓存文件数"
                            description="同时缓存的文档文件数量，限制内存使用"
                            value={config.chunkCacheMaxEntries}
                            onChange={(v) => updateConfig('chunkCacheMaxEntries', v)}
                            min={5}
                            max={50}
                            unit="个"
                        />
                        <ConfigItem
                            label="搜索结果上限"
                            description="每次搜索返回的最大结果数量"
                            value={config.searchLimit}
                            onChange={(v) => updateConfig('searchLimit', v)}
                            min={10}
                            max={100}
                            unit="条"
                        />
                    </div>
                </div>

                {/* 融合算法设置 */}
                <div className="admin-card p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                            <Zap className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">RRF 融合算法</h2>
                            <p className="text-sm text-gray-500">调整关键词搜索和向量搜索的融合方式</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <ConfigItem
                            label="RRF K 值"
                            description="Reciprocal Rank Fusion 常数，越大排名越平滑"
                            value={config.rrfK}
                            onChange={(v) => updateConfig('rrfK', v)}
                            min={20}
                            max={100}
                        />
                        <ConfigItem
                            label="关键词权重"
                            description="关键词搜索结果的基础权重"
                            value={config.keywordWeight}
                            onChange={(v) => updateConfig('keywordWeight', v)}
                            min={0.5}
                            max={2.0}
                            step={0.1}
                        />
                        <ConfigItem
                            label="向量权重"
                            description="向量搜索结果的基础权重"
                            value={config.vectorWeight}
                            onChange={(v) => updateConfig('vectorWeight', v)}
                            min={0.5}
                            max={2.0}
                            step={0.1}
                        />
                        <ConfigItem
                            label="向量搜索阈值"
                            description="向量相似度低于此值的结果将被过滤"
                            value={config.vectorMinScore}
                            onChange={(v) => updateConfig('vectorMinScore', v)}
                            min={0.1}
                            max={0.8}
                            step={0.05}
                        />
                    </div>
                </div>

                {/* Rerank 设置 */}
                <div className="admin-card p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                            <Search className="w-5 h-5 text-orange-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">重排序 (Rerank)</h2>
                            <p className="text-sm text-gray-500">精排阶段的参数配置</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <ConfigItem
                            label="Rerank 返回数量"
                            description="重排序后返回的最终结果数量"
                            value={config.rerankTopN}
                            onChange={(v) => updateConfig('rerankTopN', v)}
                            min={3}
                            max={30}
                            unit="条"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
