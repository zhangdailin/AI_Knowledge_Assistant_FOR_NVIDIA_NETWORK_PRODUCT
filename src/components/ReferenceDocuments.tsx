import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';

interface Reference {
  id?: string;
  documentId?: string;
  title: string;
  content: string;
  score: number;
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

  // 只显示前4个，或者点击查看更多
  const displayRefs = references;

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <div className="mt-6 pt-4 border-t border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-gray-500" />
        <span className="text-sm font-semibold text-gray-700">参考来源</span>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {displayRefs.map((ref, index) => {
          const isExpanded = expandedIndex === index;

          return (
            <div
              key={ref.id || index}
              id={`ref-item-${index}`}
              className={`
                relative group flex flex-col bg-white border rounded-xl overflow-hidden transition-all duration-200
                ${isExpanded
                  ? 'border-blue-200 shadow-md ring-1 ring-blue-100 col-span-full sm:col-span-full lg:col-span-full z-10'
                  : 'border-gray-200 hover:border-blue-200 hover:shadow-sm cursor-pointer h-24'
                }
              `}
              onClick={() => !isExpanded && toggleExpand(index)}
            >
              {/* 卡片头部 */}
              <div className="flex items-start gap-3 p-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-md bg-gray-50 flex items-center justify-center border border-gray-100 text-xs font-mono font-medium text-gray-500">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-gray-900 leading-tight line-clamp-2 mb-1" title={ref.title}>
                    {ref.title}
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                      相关度 {(ref.score * 100).toFixed(0)}%
                    </span>
                    {ref.mergedIds && ref.mergedIds.length > 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                        {ref.mergedIds.length} 片段
                      </span>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(index); }}
                    className="text-gray-400 hover:text-gray-600 p-1"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* 预览文字 (仅收起状态) */}
              {!isExpanded && (
                <div className="px-3 pb-3">
                  <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                    {ref.content.slice(0, 100).replace(/[\n\r]+/g, ' ')}...
                  </p>
                </div>
              )}

              {/* 展开内容 */}
              {isExpanded && (
                <div className="px-3 pb-3 animate-in fade-in slide-in-from-top-1 duration-200">
                  {/* 章节覆盖 Badge */}
                  {ref.mergedHeaders && ref.mergedHeaders.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {ref.mergedHeaders.map((h, i) => (
                        <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100">
                          {h}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 完整内容 */}
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 text-sm text-gray-700 leading-relaxed font-mono whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                    {ref.content}
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
