import React, { useState } from 'react';
import { Search, Copy, Check, Network } from 'lucide-react';

interface AddressInfo {
  sn: string;
  hostname: string;
  inband: string;
  outband: string;
}

interface QueryResult {
  ok: boolean;
  summary: {
    total: number;
    found: number;
    notFound: number;
  };
  results: AddressInfo[];
  notFound: string[];
}

function getApiServerUrl(): string {
  const customUrl = localStorage.getItem('custom_api_server_url');
  if (customUrl) return customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  return `${protocol}//${hostname}:8787`;
}

const SnAddressTool: React.FC = () => {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleQuery = async () => {
    const snList = input.split(/[\n,\s]+/).filter(s => s.trim());
    if (snList.length === 0) {
      setError('请输入至少一个 SN');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch(`${getApiServerUrl()}/api/sn-to-address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snList })
      });

      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || '查询失败');
      }
      setResult(data);
    } catch (err: any) {
      setError(err.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const copyResult = () => {
    if (!result) return;

    let text = `SN地址查询结果\n`;
    text += `共查询 ${result.summary.total} 个SN，找到 ${result.summary.found} 个匹配。\n\n`;
    text += `SN\t主机名\t带内地址\t带外地址\n`;

    result.results.forEach(item => {
      text += `${item.sn}\t${item.hostname}\t${item.inband || '-'}\t${item.outband || '-'}\n`;
    });

    if (result.notFound.length > 0) {
      text += `\n未找到的SN: ${result.notFound.join(', ')}\n`;
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          输入 SN 列表（每行一个或用逗号分隔）
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-full h-40 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="GOG4X8312A0040&#10;GOG4X8312A0046&#10;GOG4X8312A0049"
        />
      </div>

      <div className="flex gap-3 mb-6">
        <button
          onClick={handleQuery}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Search className="w-4 h-4" />
          {loading ? '查询中...' : '查询'}
        </button>

        {result && (
          <button
            onClick={copyResult}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? '已复制' : '复制结果'}
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-bold text-blue-800 mb-2">查询结果</h3>
            <p>共查询 {result.summary.total} 个SN，找到 {result.summary.found} 个匹配。</p>
          </div>

          {/* 结果表格 */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">SN</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">主机名</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">
                      <span className="flex items-center gap-1">
                        <Network className="w-4 h-4" />
                        带内地址
                      </span>
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">
                      <span className="flex items-center gap-1">
                        <Network className="w-4 h-4" />
                        带外地址
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.results.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="py-3 px-4 font-mono text-xs">{item.sn}</td>
                      <td className="py-3 px-4">{item.hostname}</td>
                      <td className="py-3 px-4">
                        {item.inband ? (
                          <span className="px-2 py-1 bg-green-50 text-green-700 rounded font-mono text-xs">
                            {item.inband}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {item.outband ? (
                          <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded font-mono text-xs">
                            {item.outband}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.notFound.length > 0 && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h4 className="font-bold text-yellow-800 mb-2">未找到的SN ({result.notFound.length}个)</h4>
              <p className="text-sm text-yellow-700">{result.notFound.join(', ')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// 插件元数据
export const pluginMeta = {
  id: 'sn-address',
  name: 'SN 地址查询',
  description: '根据服务器 SN 查询带内/带外 IP 地址',
  icon: 'Network',
  version: '1.0.0'
};

export default SnAddressTool;
