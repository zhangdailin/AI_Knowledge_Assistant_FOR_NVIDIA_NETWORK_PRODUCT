import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronUp, CheckCircle2, Quote } from 'lucide-react';

interface Reference {
  id?: string;
  documentId?: string;
  title: string;
  content: string;
  score: number;
  isTruncated?: boolean;
  mergedHeaders?: string[];
  mergedIds?: string[];
  isOptimized?: boolean;
}

interface ReferenceHighlight {
  referenceId?: string | null;
  referenceTitle?: string | null;
  referenceIndex?: number | null;
  commands: string[];
  excerpts?: string[];
}

interface ReferenceDocumentsProps {
  references: Reference[];
  highlights?: Record<string, ReferenceHighlight>;
}

const ReferenceDocuments: React.FC<ReferenceDocumentsProps> = ({ references, highlights }) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!references || references.length === 0) {
    return null;
  }

  // 获取某个参考文档的高亮信息
  const getHighlightForReference = (ref: Reference, index: number): ReferenceHighlight | null => {
    if (!highlights) return null;

    // 尝试多种键匹配方式
    const possibleKeys = [
      ref.id,
      `idx-${index}`,
      `ref-${index}`
    ].filter(Boolean);

    for (const key of possibleKeys) {
      if (highlights[key as string]) {
        return highlights[key as string];
      }
    }
    return null;
  };

  // 过滤出真正被引用的参考文档
  const referencedDocs = references
    .map((ref, index) => ({
      ref,
      originalIndex: index,
      highlight: getHighlightForReference(ref, index)
    }))
    .filter(item => item.highlight && item.highlight.commands.length > 0);

  // 如果没有被引用的文档，不显示参考来源区域
  if (referencedDocs.length === 0) {
    return null;
  }

  const toggleExpand = (originalIndex: number) => {
    setExpandedIndex(expandedIndex === originalIndex ? null : originalIndex);
  };

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-3.5 h-3.5 text-indigo-600" />
        <span className="text-xs font-semibold text-gray-700">参考来源 ({referencedDocs.length})</span>
      </div>

      <div className="space-y-2">
        {referencedDocs.map((item, displayIndex) => {
          const { ref, originalIndex, highlight } = item;
          const isExpanded = expandedIndex === originalIndex;

          return (
            <div
              key={ref.id || originalIndex}
              id={`ref-item-${originalIndex}`}
              className={`relative bg-white border rounded-lg overflow-hidden transition-all duration-200 cursor-pointer ${
                isExpanded
                  ? 'border-indigo-300 shadow-md'
                  : 'border-indigo-200 hover:border-indigo-300 hover:shadow-sm'
              }`}
              onClick={() => !isExpanded && toggleExpand(originalIndex)}
            >
              {/* 左侧标记条 */}
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-indigo-500 to-purple-500" />

              {/* 头部区域 - 紧凑版 */}
              <div className="flex items-center gap-2 p-2.5 pl-3">
                {/* 序号 */}
                <div className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                  {displayIndex + 1}
                </div>

                {/* 标题和标签 */}
                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                  <h4 className="text-xs font-semibold text-gray-900 truncate" title={ref.title}>
                    {ref.title}
                  </h4>

                  {/* 引用次数标签 */}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-0.5 flex-shrink-0">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    {highlight!.commands.length}处
                  </span>

                  {/* 相关度 */}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                    ref.score >= 0.7
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : ref.score >= 0.5
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'bg-gray-50 text-gray-600 border border-gray-200'
                  }`}>
                    {Math.min(100, Math.max(0, ref.score * 100)).toFixed(0)}%
                  </span>
                </div>

                {/* 展开/收起按钮 */}
                {!isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(originalIndex); }}
                    className="text-gray-400 hover:text-gray-600 p-0.5 flex-shrink-0"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* 展开内容 */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                  {/* 引用的命令列表 */}
                  <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-md p-2.5 border border-indigo-100">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Quote className="w-3 h-3 text-indigo-600" />
                      <h5 className="text-xs font-semibold text-indigo-900">引用内容</h5>
                    </div>
                    <div className="space-y-1.5">
                      {highlight!.commands.map((cmd, idx) => (
                        <div key={idx} className="bg-white rounded p-2 border border-indigo-100">
                          <code className="text-[11px] text-indigo-900 font-mono block font-semibold">
                            {cmd}
                          </code>
                          {highlight!.excerpts && highlight!.excerpts[idx] && (
                            <p className="text-[10px] text-gray-600 leading-relaxed mt-1 pl-2 border-l-2 border-indigo-200">
                              {highlight!.excerpts[idx]}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 章节标签 */}
                  {ref.mergedHeaders && ref.mergedHeaders.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] text-gray-500 font-medium">章节:</span>
                      {ref.mergedHeaders.map((h, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                          {h}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 完整文档内容 */}
                  <div>
                    <h5 className="text-[10px] font-semibold text-gray-700 mb-1.5">完整内容</h5>
                    <div className="bg-gray-50 rounded p-2.5 border border-gray-200 text-[11px] text-gray-800 leading-relaxed font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                      {ref.content}
                    </div>
                    {ref.isTruncated && (
                      <p className="mt-1 text-[10px] text-gray-400">
                        内容已截断以避免占用过多内存。
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ReferenceDocuments;
