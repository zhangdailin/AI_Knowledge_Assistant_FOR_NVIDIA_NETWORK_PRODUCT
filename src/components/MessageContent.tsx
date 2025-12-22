import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Check } from 'lucide-react';

interface MessageContentProps {
  content: string;
  role: 'user' | 'assistant' | 'system';
}

const MessageContent: React.FC<MessageContentProps> = ({ content, role }) => {
  const [copiedCode, setCopiedCode] = useState<Set<string>>(new Set());


  const handleCopyCode = async (code: string, key: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(prev => new Set(prev).add(key));
      setTimeout(() => {
        setCopiedCode(prev => {
          const newSet = new Set(prev);
          newSet.delete(key);
          return newSet;
        });
      }, 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <div className="prose prose-sm max-w-none" style={{ wordBreak: 'normal', overflowWrap: 'normal' }}>
      <ReactMarkdown
        remarkPlugins={[]}
        rehypePlugins={[]}
        components={{
          // 标题样式
          h1: ({node, ...props}) => <h1 className="text-xl font-bold mt-6 mb-3 text-gray-900" {...props} />,
          h2: ({node, ...props}) => <h2 className="text-lg font-semibold mt-5 mb-2 text-gray-900" {...props} />,
          h3: ({node, ...props}) => <h3 className="text-base font-semibold mt-4 mb-2 text-gray-900" {...props} />,
          // 段落样式 - 彻底移除检测逻辑，统一使用p标签
          p: ({node, children, ...props}: any) => {
            return <p className="mb-3 leading-relaxed text-gray-900 whitespace-pre-wrap" {...props}>{children}</p>;
          },
          // 列表样式
          ul: ({node, ...props}) => <ul className="list-disc list-inside mb-3 space-y-1 text-gray-900" {...props} />,
          ol: ({node, ...props}) => <ol className="list-decimal list-inside mb-3 space-y-1 text-gray-900" {...props} />,
          li: ({node, ...props}) => <li className="ml-4 text-gray-900" {...props} />,
          // 代码块样式（仅bash代码块显示特殊样式）
          code: ({node, inline, className, children, ...props}: any) => {
            if (inline) {
              return (
                <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-gray-900" {...props}>
                  {children}
                </code>
              );
            }

            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const codeString = String(children).replace(/\n$/, '');
            
            // 只有bash代码块才显示特殊样式（带行号和复制按钮）
            if (language && language.toLowerCase() === 'bash') {
              // 使用代码内容的hash作为唯一标识
              const codeHash = codeString.substring(0, 50).replace(/\s/g, '');
              const copyKey = `code-${codeHash}`;
              const isCopied = copiedCode.has(copyKey);
              const lines = codeString.split('\n');

              return (
                <div className="relative my-4 rounded-lg overflow-hidden border border-gray-200 bg-white">
                  {/* 工具栏：语言标签和复制按钮 */}
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
                    <span className="text-xs font-mono text-gray-500 uppercase">{language}</span>
                    <button
                      onClick={() => handleCopyCode(codeString, copyKey)}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                      title="复制代码"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-green-600" />
                          <span className="text-green-600">已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>复制</span>
                        </>
                      )}
                    </button>
                  </div>
                  {/* 代码内容（带行号） */}
                  <div className="overflow-x-auto bg-gray-50">
                    <pre className="m-0 p-0">
                      <code className="block text-sm font-mono text-gray-900 leading-relaxed">
                        {lines.map((line: string, i: number) => (
                          <div key={i} className="flex hover:bg-gray-100">
                            <span className="select-none text-gray-400 mr-4 px-4 py-0.5 w-12 text-right flex-shrink-0 bg-gray-100">
                              {i + 1}
                            </span>
                            <span className="flex-1 px-4 py-0.5 whitespace-pre">{line || ' '}</span>
                          </div>
                        ))}
                      </code>
                    </pre>
                  </div>
                </div>
              );
            }
            
            // 其他代码块：只显示红色文字，不显示代码框，不自动换行
            // 使用span实现完全行内化，彻底消除换行问题
            return (
              <span 
                style={{
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  color: '#dc2626',
                }}
                {...props}
              >
                {codeString}
              </span>
            );
          },
          // 其他元素保持默认样式
          blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-gray-300 pl-4 italic my-3 text-gray-700" {...props} />,
          strong: ({node, ...props}) => <strong className="font-semibold text-gray-900" {...props} />,
          em: ({node, ...props}) => <em className="italic text-gray-900" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MessageContent;