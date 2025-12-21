import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Check } from 'lucide-react';

interface MessageContentProps {
  content: string;
  role: 'user' | 'assistant';
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
          // 段落样式 - 保持换行
          p: ({node, children, ...props}: any) => {
            // 检查是否包含代码块（pre或code元素），如果是则使用div而不是p
            const hasCodeBlock = React.Children.toArray(children).some((child: any) => {
              if (React.isValidElement(child)) {
                const childType = child.type;
                return childType === 'pre' || childType === 'code' || 
                       (typeof childType === 'function' && (childType.name === 'pre' || childType.name === 'code'));
              }
              return false;
            });


            if (hasCodeBlock) {
              // 对于代码块，不使用 whitespace-pre-wrap，让代码块自己控制换行
              return <div className="mb-3 leading-relaxed text-gray-900" style={{ wordBreak: 'normal', overflowWrap: 'normal' }} {...props}>{children}</div>;
            }
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
            // 重构：使用简单的 div 结构，避免复杂的嵌套
            // #region agent log
            const logRedCodeBlockStyles = (element: HTMLDivElement | null) => {
              if (!element) return;
              
              // 使用 setTimeout 确保 DOM 已完全渲染
              setTimeout(() => {
                const computedStyle = window.getComputedStyle(element);
                const parentElement = element.parentElement;
                const parentComputedStyle = parentElement ? window.getComputedStyle(parentElement) : null;
                const grandParentElement = parentElement?.parentElement;
                const grandParentComputedStyle = grandParentElement ? window.getComputedStyle(grandParentElement) : null;
                const greatGrandParentElement = grandParentElement?.parentElement;
                const greatGrandParentComputedStyle = greatGrandParentElement ? window.getComputedStyle(greatGrandParentElement) : null;
                
                fetch('http://127.0.0.1:7245/ingest/f1cd008e-c417-4a3f-893c-d13caab5074b', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    location: 'MessageContent.tsx:red-command-content',
                    message: '红色代码块样式诊断',
                    data: {
                      codeString: codeString.substring(0, 100),
                      codeStringLength: codeString.length,
                      elementStyles: {
                        whiteSpace: computedStyle.whiteSpace,
                        wordBreak: computedStyle.wordBreak,
                        overflowWrap: computedStyle.overflowWrap,
                        wordWrap: computedStyle.wordWrap,
                        width: computedStyle.width,
                        maxWidth: computedStyle.maxWidth,
                        display: computedStyle.display,
                        color: computedStyle.color,
                        className: element.className
                      },
                      parentStyles: parentComputedStyle ? {
                        whiteSpace: parentComputedStyle.whiteSpace,
                        wordBreak: parentComputedStyle.wordBreak,
                        overflowWrap: parentComputedStyle.overflowWrap,
                        wordWrap: parentComputedStyle.wordWrap,
                        width: parentComputedStyle.width,
                        maxWidth: parentComputedStyle.maxWidth,
                        display: parentComputedStyle.display,
                        className: parentElement.className
                      } : null,
                      grandParentStyles: grandParentComputedStyle ? {
                        whiteSpace: grandParentComputedStyle.whiteSpace,
                        wordBreak: grandParentComputedStyle.wordBreak,
                        overflowWrap: grandParentComputedStyle.overflowWrap,
                        wordWrap: grandParentComputedStyle.wordWrap,
                        width: grandParentComputedStyle.width,
                        maxWidth: grandParentComputedStyle.maxWidth,
                        display: grandParentComputedStyle.display,
                        className: grandParentElement.className
                      } : null,
                      greatGrandParentStyles: greatGrandParentComputedStyle ? {
                        whiteSpace: greatGrandParentComputedStyle.whiteSpace,
                        wordBreak: greatGrandParentComputedStyle.wordBreak,
                        overflowWrap: greatGrandParentComputedStyle.overflowWrap,
                        wordWrap: greatGrandParentComputedStyle.wordWrap,
                        width: greatGrandParentComputedStyle.width,
                        maxWidth: greatGrandParentComputedStyle.maxWidth,
                        display: greatGrandParentComputedStyle.display,
                        className: greatGrandParentElement.className
                      } : null,
                      elementOffsetWidth: element.offsetWidth,
                      elementScrollWidth: element.scrollWidth,
                      parentOffsetWidth: parentElement?.offsetWidth,
                      parentScrollWidth: parentElement?.scrollWidth,
                      isWrapping: element.offsetWidth < element.scrollWidth
                    },
                    timestamp: Date.now(),
                    sessionId: 'debug-session',
                    runId: 'run1',
                    hypothesisId: 'A'
                  })
                }).catch(() => {});
              }, 100);
            };
            // #endregion
            return (
              <div 
                className="red-command-block"
                style={{ 
                  margin: '0.5rem 0',
                  overflowX: 'auto',
                  overflowY: 'visible',
                  maxWidth: '100%',
                  display: 'block'
                }}
              >
                <div
                  ref={logRedCodeBlockStyles}
                  className="red-command-content"
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '0.875rem',
                    color: '#dc2626',
                    whiteSpace: 'pre',
                    wordBreak: 'keep-all',
                    overflowWrap: 'normal',
                    wordWrap: 'normal',
                    display: 'block',
                    margin: 0,
                    padding: 0,
                    width: 'max-content',
                    minWidth: '100%'
                  }}
                  {...props}
                >
                  {codeString}
                </div>
              </div>
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