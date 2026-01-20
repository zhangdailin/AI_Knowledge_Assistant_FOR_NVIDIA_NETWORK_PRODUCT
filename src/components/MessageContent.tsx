import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Check, Terminal } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css'; // 需要确保样式被引入，如果没有全局引入，可能需要手动处理样式

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
    <div className={`prose prose-sm max-w-none ${role === 'user' ? 'prose-invert' : ''}`} style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // 自定义文本渲染以处理 [1] 引用标记
          p: ({ node, children, ...props }: any) => {
            // 如果 children 是简单的字符串，尝试解析引用
            const processText = (text: string) => {
              if (typeof text !== 'string') return text;
              const parts = text.split(/(\[\d+\])/g);
              return parts.map((part, i) => {
                const match = part.match(/^\[(\d+)\]$/);
                if (match) {
                  const index = match[1];
                  return (
                    <sup
                      key={i}
                      className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-3.5 px-0.5 text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-sm cursor-pointer hover:bg-blue-100 hover:text-blue-700 select-none align-super transition-colors"
                      title={`跳转到参考文档 [${index}]`}
                      onClick={(e) => {
                        e.preventDefault();
                        const el = document.getElementById(`ref-item-${parseInt(index) - 1}`);
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el?.classList.add('bg-blue-50', 'ring-2', 'ring-blue-100');
                        setTimeout(() => el?.classList.remove('bg-blue-50', 'ring-2', 'ring-blue-100'), 2000);
                      }}
                    >
                      {index}
                    </sup>
                  );
                }
                return part;
              });
            };

            // 递归处理子元素
            const processChildren = (nodes: React.ReactNode): React.ReactNode => {
              return React.Children.map(nodes, (child) => {
                if (typeof child === 'string') {
                  return processText(child);
                }
                // @ts-ignore
                if (React.isValidElement(child) && child.props.children) {
                  // @ts-ignore
                  return React.cloneElement(child, {
                    // @ts-ignore
                    children: processChildren(child.props.children)
                  });
                }
                return child;
              });
            };

            return <p className="mb-2 last:mb-0 leading-relaxed" {...props}>{processChildren(children)}</p>;
          },
          // 标题样式
          h1: ({ node, ...props }) => <h1 className="text-xl font-bold mt-6 mb-3" {...props} />,
          // 列表样式
          ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-2 space-y-0.5" {...props} />,
          ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-2 space-y-0.5" {...props} />,
          li: ({ node, ...props }) => <li className="ml-4 [&>p]:my-0 [&>p]:inline-block" {...props} />,
          // 表格样式
          table: ({ node, ...props }) => <div className="overflow-x-auto my-4 rounded-lg border border-gray-200"><table className="min-w-full divide-y divide-gray-200" {...props} /></div>,
          thead: ({ node, ...props }) => <thead className="bg-gray-50" {...props} />,
          th: ({ node, ...props }) => <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" {...props} />,
          td: ({ node, ...props }) => <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 border-t border-gray-100" {...props} />,
          // 代码块样式
          code: ({ node, inline, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const codeString = String(children).replace(/\n$/, '');

            if (inline) {
              return (
                <code className={`${role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-pink-600'} px-1.5 py-0.5 rounded text-sm font-mono`} {...props}>
                  {children}
                </code>
              );
            }

            // 只有指定了语言的代码块，或者包含换行的代码块，才使用完整的代码框
            // 简单的单行或无语言标记的代码块，退化为红色文字样式（类似 inline）但作为块级显示
            // 修改：使用 span 渲染，使其像 inline 代码一样融入句子，不换行
            if (!language && !codeString.includes('\n') && codeString.length < 100) {
              return (
                <span className={`${role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-pink-600'} px-1.5 py-0.5 rounded text-sm font-mono mx-1`} {...props}>
                  {children}
                </span>
              );
            }

            // 使用代码内容的hash作为唯一标识
            const codeHash = codeString.substring(0, 50).replace(/\s/g, '');
            const copyKey = `code-${codeHash}-${Math.random()}`; // 加上随机数避免key重复
            const isCopied = copiedCode.has(copyKey);
            const lines = codeString.split('\n');

            return (
              <div className="relative my-4 rounded-lg overflow-hidden border border-gray-200 bg-[#0d1117] text-gray-300 shadow-sm group">
                {/* 工具栏：语言标签和复制按钮 */}
                <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-gray-700/50">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs font-mono text-gray-400 uppercase">{language || 'text'}</span>
                  </div>
                  <button
                    onClick={() => handleCopyCode(codeString, copyKey)}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition-colors"
                    title="复制代码"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-green-400" />
                        <span className="text-green-400">已复制</span>
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
                <div className="overflow-x-auto p-4">
                  <pre className="m-0 p-0 bg-transparent font-mono text-sm leading-relaxed">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                </div>
              </div>
            );
          },
          // 引用样式
          blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-blue-400 pl-4 italic my-3 text-gray-600 bg-gray-50 py-2 rounded-r" {...props} />,
          strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
          em: ({ node, ...props }) => <em className="italic" {...props} />,
          a: ({ node, ...props }) => <a className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MessageContent;