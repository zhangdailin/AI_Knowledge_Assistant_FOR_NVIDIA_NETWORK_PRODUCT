import React, { useState } from 'react';
import { Search, Copy, Check } from 'lucide-react';

interface Server {
  sn: string;
  hostname: string;
}

interface Group {
  iblfs: string[];
  servers: Server[];
}

interface QueryResult {
  ok: boolean;
  summary: {
    total: number;
    found: number;
    notFound: number;
    groups: number;
  };
  groups: Group[];
  notFound: string[];
  details: Array<{ sn: string; hostname: string; iblfs: string[] }>;
}

function getApiServerUrl(): string {
  const customUrl = localStorage.getItem('custom_api_server_url');
  if (customUrl) return customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  return `${protocol}//${hostname}:8787`;
}

const SnToIblfTool: React.FC = () => {
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
      const res = await fetch(`${getApiServerUrl()}/api/sn-to-iblf`, {
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

    let text = `SN到IBLF查询结果\n`;
    text += `共查询 ${result.summary.total} 个SN，找到 ${result.summary.found} 个匹配。\n\n`;

    if (result.summary.groups > 1) {
      text += `⚠️ 这些SN连接到不同的IBLF交换机组\n\n`;
    }

    result.groups.forEach((group, idx) => {
      text += `组${idx + 1}: ${group.servers.length}台服务器\n`;
      text += `服务器: ${group.servers.map(s => `${s.sn} (${s.hostname})`).join(', ')}\n\n`;
      text += `连接的IBLF:\n`;
      group.iblfs.forEach(iblf => {
        text += `${iblf}\n`;
      });
      text += '\n';
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
      <h2 className="text-xl font-bold mb-4">SN 到 IBLF 查询工具</h2>

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
            {result.summary.groups > 1 && (
              <p className="text-orange-600 mt-2">
                ⚠️ 这些SN连接到不同的IBLF交换机组（共 {result.summary.groups} 组）
              </p>
            )}
          </div>

          {result.groups.map((group, idx) => (
            <div key={idx} className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
              <h4 className="font-bold text-gray-800 mb-3">
                组{idx + 1}: {group.servers.length}台服务器
              </h4>

              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">服务器:</p>
                <div className="flex flex-wrap gap-2">
                  {group.servers.map((server, i) => (
                    <span key={i} className="px-2 py-1 bg-gray-100 rounded text-sm">
                      {server.sn} ({server.hostname})
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm text-gray-600 mb-2">连接的IBLF:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {group.iblfs.map((iblf, i) => (
                    <span key={i} className="px-2 py-1 bg-green-50 text-green-800 rounded text-sm font-mono">
                      {iblf}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {result.notFound.length > 0 && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h4 className="font-bold text-yellow-800 mb-2">未找到的SN ({result.notFound.length}个)</h4>
              <p className="text-sm text-yellow-700">{result.notFound.join(', ')}</p>
            </div>
          )}

          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <h4 className="font-bold text-gray-800 mb-3">详细映射</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">SN</th>
                    <th className="text-left py-2 px-2">主机名</th>
                    <th className="text-left py-2 px-2">连接的IBLF</th>
                  </tr>
                </thead>
                <tbody>
                  {result.details.map((item, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-100">
                      <td className="py-2 px-2 font-mono">{item.sn}</td>
                      <td className="py-2 px-2">{item.hostname}</td>
                      <td className="py-2 px-2 text-xs">{item.iblfs.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SnToIblfTool;
