import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';

interface Reference {
  title: string;
  content: string;
  score: number;
}

interface ReferenceDocumentsProps {
  references: Reference[];
}

const ReferenceDocuments: React.FC<ReferenceDocumentsProps> = ({ references }) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!references || references.length === 0) {
    return null;
  }

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-4 h-4 text-gray-500" />
        <span className="text-xs font-medium text-gray-600">参考文档 ({references.length})</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {references.map((ref, index) => (
          <div key={index} className="relative group">
            <button
              onClick={() => toggleExpand(index)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs text-blue-700 transition-all"
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="font-medium">{ref.title}</span>
              <span className="text-blue-500 ml-1">
                {(ref.score * 100).toFixed(0)}%
              </span>
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
                <button
                  onClick={() => setExpandedIndex(null)}
                  className="mt-3 w-full text-xs text-gray-500 hover:text-gray-700 py-1"
                >
                  收起
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReferenceDocuments;
