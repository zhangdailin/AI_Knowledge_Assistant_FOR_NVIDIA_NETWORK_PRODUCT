import React, { useState } from 'react';
import { Copy, Check, Server, Network, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

interface Server {
  sn: string;
  hostname: string;
}

interface Group {
  iblfs: string[];
  servers: Server[];
}

export interface SnIblfResult {
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

interface Props {
  result: SnIblfResult;
  queriedSNs: string[];
}

const SnIblfResultCard: React.FC<Props> = ({ result, queriedSNs }) => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const copyResult = () => {
    let text = `SN到IBLF查询结果\n`;
    text += `查询: ${queriedSNs.join(', ')}\n`;
    text += `找到 ${result.summary.found}/${result.summary.total} 个匹配\n\n`;

    result.groups.forEach((group, idx) => {
      text += `组${idx + 1}: ${group.servers.map(s => `${s.sn}(${s.hostname})`).join(', ')}\n`;
      text += `IBLF: ${group.iblfs.join(', ')}\n\n`;
    });

    if (result.notFound.length > 0) {
      text += `未找到: ${result.notFound.join(', ')}\n`;
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-600">
        <div className="flex items-center gap-2 text-white">
          <Network className="w-4 h-4" />
          <span className="font-medium text-sm">SN-IBLF 查询结果</span>
        </div>
        <button
          onClick={copyResult}
          className="flex items-center gap-1 px-2 py-1 text-xs text-white/90 hover:text-white bg-white/20 hover:bg-white/30 rounded transition-colors"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      {/* 摘要 */}
      <div className="px-4 py-3 border-b border-slate-200">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-600">
            查询 <span className="font-semibold text-slate-900">{result.summary.total}</span> 个SN
          </span>
          <span className="text-green-600">
            ✓ 找到 <span className="font-semibold">{result.summary.found}</span>
          </span>
          {result.summary.notFound > 0 && (
            <span className="text-amber-600">
              ✗ 未找到 <span className="font-semibold">{result.summary.notFound}</span>
            </span>
          )}
        </div>
        {result.summary.groups > 1 && (
          <div className="flex items-center gap-2 mt-2 text-amber-600 text-xs">
            <AlertTriangle className="w-3 h-3" />
            <span>这些SN连接到 {result.summary.groups} 组不同的IBLF交换机</span>
          </div>
        )}
      </div>

      {/* 分组结果 */}
      <div className="px-4 py-3 space-y-3">
        {result.groups.map((group, idx) => (
          <div key={idx} className="bg-white rounded-lg p-3 border border-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <Server className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-medium text-slate-700">
                组{idx + 1}: {group.servers.length}台服务器
              </span>
            </div>

            {/* 服务器列表 */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {group.servers.map((server, i) => (
                <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs font-mono">
                  {server.sn}
                  <span className="text-slate-400 ml-1">({server.hostname})</span>
                </span>
              ))}
            </div>

            {/* IBLF列表 */}
            <div className="flex flex-wrap gap-1.5">
              {group.iblfs.slice(0, expanded ? undefined : 4).map((iblf, i) => (
                <span key={i} className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs font-mono border border-green-100">
                  {iblf}
                </span>
              ))}
              {!expanded && group.iblfs.length > 4 && (
                <span className="px-2 py-0.5 text-slate-400 text-xs">
                  +{group.iblfs.length - 4} 更多
                </span>
              )}
            </div>
          </div>
        ))}

        {/* 未找到的SN */}
        {result.notFound.length > 0 && (
          <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
            <span className="text-xs text-amber-700">
              未找到: {result.notFound.join(', ')}
            </span>
          </div>
        )}
      </div>

      {/* 展开/收起 */}
      {(result.groups.some(g => g.iblfs.length > 4) || result.details.length > 3) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 py-2 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors border-t border-slate-200"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? '收起详情' : '展开详情'}
        </button>
      )}
    </div>
  );
};

export default SnIblfResultCard;
