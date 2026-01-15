import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';

interface Reference {
  id?: string;
  documentId?: string;
  title: string;
  content: string;
  score: number;
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

  // 只显示被引用的文档（在 highlights 中有记录的）
  const referencedDocs = references.filter((ref, index) => {
    // 检查多个可能的键形式
    const possibleKeys = [
      ref.id,
      `idx-${index}`,
      `ref-${index}`
    ].filter(Boolean) as string[];

    // 只要有任何一个键在 highlights 中有记录，就认为该文档被引用
    const isReferenced = possibleKeys.some(key => {
      const highlight = highlights?.[key];
      return highlight && (
        (highlight.commands && highlight.commands.length > 0) ||
        (highlight.excerpts && highlight.excerpts.length > 0)
      );
    });

    return isReferenced;
  });

  // 如果没有被引用的文档，不显示整个区域
  if (referencedDocs.length === 0) {
    return null;
  }

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-4 h-4 text-gray-500" />
        <span className="text-xs font-medium text-gray-600">参考文档 ({referencedDocs.length})</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {referencedDocs.map((ref, index) => {
          // 尝试所有可能的键形式来获取 highlight
          const possibleKeys = [
            ref.id,
            `idx-${index}`,
            `ref-${index}`
          ].filter(Boolean) as string[];

          // 找到第一个存在的 highlight
          let highlight: ReferenceHighlight | undefined;
          let refKey = '';
          for (const key of possibleKeys) {
            if (highlights?.[key]) {
              highlight = highlights[key];
              refKey = key;
              break;
            }
          }

          return (
            <div key={refKey || `ref-${index}`} className="relative group">
            <button
              onClick={() => toggleExpand(index)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs text-blue-700 transition-all"
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="font-medium">{ref.title}</span>
              <span className="text-blue-500 ml-1">
                {(ref.score * 100).toFixed(0)}%
              </span>
              {highlight && highlight.commands.length > 0 && (
                <span className="ml-1 text-[10px] text-emerald-600 font-semibold">
                  {highlight.commands.length}条引用
                </span>
              )}
              {expandedIndex === index ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>

            {/* 展开的内容面板 */}
            {expandedIndex === index && (
              <div className="absolute left-0 top-full mt-2 w-96 max-w-[90vw] bg-white border border-gray-200 rounded-lg shadow-xl z-50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-semibold text-gray-900">{ref.title}</span>
                  </div>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                    相关度: {(ref.score * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 p-3 rounded-lg border border-gray-200">
                    {ref.content}
                  </div>
                </div>
                {highlight && (
                  <div className="mt-3 space-y-2">
                    {highlight.commands.length > 0 && (
                      <div className="text-xs text-gray-600 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                        <p className="font-semibold text-indigo-700 mb-1">引用命令</p>
                        <ul className="space-y-1">
                          {highlight.commands.map((cmd, idx) => (
                            <li key={idx}>
                              <code className="font-mono">{cmd}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {highlight.excerpts && highlight.excerpts.length > 0 && (
                      <div className="text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        <p className="font-semibold text-amber-700 mb-1">引用段落</p>
                        <div className="space-y-1">
                          {highlight.excerpts.map((excerpt, idx) => (
                            <p key={idx} className="leading-relaxed whitespace-pre-wrap">
                              {excerpt}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => setExpandedIndex(null)}
                  className="mt-3 w-full text-xs text-gray-500 hover:text-gray-700 py-1"
                >
                  收起
                </button>
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
