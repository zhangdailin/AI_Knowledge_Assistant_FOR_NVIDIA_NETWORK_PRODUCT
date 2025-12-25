import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Upload, File as FileIcon, Search, Trash2, Download, Eye, Plus, FolderOpen, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { unifiedStorageManager, Document } from '../lib/localStorage';
import DocumentChunksStatus from './DocumentChunksStatus';

const KnowledgeBase: React.FC = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showManualEditor, setShowManualEditor] = useState(false);
  const [manualTitle, setManualTitle] = useState('手动文本文档');
  const [manualCategory, setManualCategory] = useState('default');
  const [manualContent, setManualContent] = useState('');
  const [regeneratingDocs, setRegeneratingDocs] = useState<Set<string>>(new Set());
  // 为每个文档的文本片段输入框维护独立的状态
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [viewingChunks, setViewingChunks] = useState<any[]>([]);
  const [showChunkViewer, setShowChunkViewer] = useState(false);

  const [manualChunkTexts, setManualChunkTexts] = useState<Record<string, string>>({});
  
  const { user } = useAuthStore();

  useEffect(() => {
    if (user) {
      loadDocuments();
    }
  }, [user]);

  // 轮询逻辑：如果有文档正在处理中，每3秒刷新一次状态
  // 此外，如果发现有文档 Embedding 未完成（但状态是 ready），也进行轮询，以便及时更新进度
  useEffect(() => {
    const shouldPoll = documents.some(doc => {
        // 1. 文档状态本身是 processing
        if (doc.status === 'processing') return true;
        // 2. 文档状态是 ready，但我们不知道它的 embedding 是否全部完成
        // 这里无法直接判断 chunks 状态，但可以根据 regenerationDocs 集合来判断
        if (regeneratingDocs.has(doc.id)) return true;
        return false;
    });

    if (shouldPoll) {
      const timer = setInterval(() => {
        loadDocuments();
      }, 3000);
      return () => clearInterval(timer);
    }
  }, [documents, regeneratingDocs]);

  const openChunkViewer = async (doc: Document) => {
    try {
      const chunks = await unifiedStorageManager.getChunks(doc.id);
      setViewingDoc(doc);
      setViewingChunks(chunks);
      setShowChunkViewer(true);
    } catch (error) {
      console.error('加载文档片段失败:', error);
      alert('加载文档片段失败');
    }
  };

  const loadDocuments = async () => {
    if (user) {
      const docs = await unifiedStorageManager.getDocuments(user.id);
      setDocuments(docs);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = async (files: FileList) => {
    if (!user) return;

    setIsUploading(true);
    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          // 直接上传到后台处理，不再在前端解析
          await unifiedStorageManager.uploadDocument(file, user.id, 'default');
          successCount++;
        } catch (error) {
          failureCount++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`上传文件 ${file.name} 失败:`, error);
          errors.push(`${file.name}: ${errorMsg}`);
        }
      }

      // 上传完成后刷新列表，此时文档状态应为 processing
      if (successCount > 0) {
        loadDocuments();
      }

      // 显示上传结果
      if (failureCount > 0) {
        const errorSummary = errors.slice(0, 3).join('\n');
        const moreErrors = failureCount > 3 ? `\n... 还有 ${failureCount - 3} 个文件上传失败` : '';
        alert(`上传完成\n成功: ${successCount} 个\n失败: ${failureCount} 个\n\n${errorSummary}${moreErrors}`);
      } else if (successCount > 0) {
        alert(`成功上传 ${successCount} 个文件`);
      }
    } catch (error) {
      console.error('批量上传失败:', error);
      alert('批量上传失败，请检查网络连接');
    } finally {
      setIsUploading(false);
    }
  };

  const generateMarkdownFromDocument = (doc: Document, chunks: any[]): string => {
    let markdown = `# ${doc.filename}\n\n`;
    markdown += `**上传时间**: ${new Date(doc.uploadedAt).toLocaleString()}\n\n`;
    markdown += `**文件大小**: ${formatFileSize(doc.fileSize)}\n\n`;
    if (doc.category) {
      markdown += `**分类**: ${doc.category}\n\n`;
    }
    markdown += `---\n\n`;
    
    // 按 chunkIndex 排序
    const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    
    // 如果是父子切块，按父块分组
    const parentChunks = sortedChunks.filter(c => c.chunkType === 'parent' || !c.chunkType);
    const childChunks = sortedChunks.filter(c => c.chunkType === 'child');
    
    if (parentChunks.length > 0) {
      markdown += `## 文档内容\n\n`;
      parentChunks.forEach((chunk, idx) => {
        markdown += `### 片段 ${idx + 1}\n\n`;
        markdown += `${chunk.content}\n\n`;
        
        // 如果有子块，也包含子块
        if (chunk.chunkType === 'parent') {
          const relatedChildren = childChunks.filter(c => c.parentId === chunk.id);
          if (relatedChildren.length > 0) {
            markdown += `#### 子片段\n\n`;
            relatedChildren.forEach((child, childIdx) => {
              markdown += `**子片段 ${childIdx + 1}**:\n\n${child.content}\n\n`;
            });
          }
        }
      });
    } else {
      // 如果没有父块，直接输出所有块
      sortedChunks.forEach((chunk, idx) => {
        markdown += `### 片段 ${idx + 1}\n\n`;
        markdown += `${chunk.content}\n\n`;
      });
    }
    
    return markdown;
  };

  const downloadMarkdown = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const baseName = filename.replace(/\.[^/.]+$/, '');
    link.download = `${baseName}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const deleteDocument = async (documentId: string) => {
    if (window.confirm('确定要删除这个文档吗？')) {
      try {
        const deleted = await unifiedStorageManager.deleteDocument(documentId);
        if (!deleted) {
          alert('删除文档失败，请查看控制台了解详情');
        }
        loadDocuments();
      } catch (error) {
        console.error('删除文档失败:', error);
        alert(`删除文档失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const regenerateEmbeddings = async (documentId: string) => {
    if (regeneratingDocs.has(documentId)) return;
    
    setRegeneratingDocs(prev => new Set(prev).add(documentId));
    try {
      const stats = await unifiedStorageManager.getChunkStats(documentId);
      const chunksWithoutEmbedding = stats.requiringEmbedding - stats.withEmbedding;
      
      if (chunksWithoutEmbedding === 0) {
        alert('该文档的所有 chunks 都已经有 embedding 了！');
        return;
      }
      
      // 创建后台任务生成 embedding
      await unifiedStorageManager.createEmbeddingTask(documentId);
      alert(`已开始后台生成 Embedding（${chunksWithoutEmbedding} 个 chunks），请查看进度...`);
      
      // 立即刷新一次
      loadDocuments();
      
      // 强制触发轮询（通过 setRegeneratingDocs 已经触发了 useEffect，但为了保险起见，这里不需要额外操作）
    } catch (error) {
      console.error('重新生成 embedding 失败:', error);
      alert(`重新生成 embedding 失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRegeneratingDocs(prev => {
        const next = new Set(prev);
        next.delete(documentId);
        return next;
      });
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = doc.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         doc.contentPreview.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || doc.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ['all', ...Array.from(new Set(documents.map(doc => doc.category || 'default')))];

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <FolderOpen className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p>请先登录以管理知识库</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gradient-to-br from-blue-50 to-cyan-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* 标题和上传区域 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">知识库管理</h1>
          <div className="flex items-center gap-2">
            <p className="text-gray-600">上传和管理您的知识库文档</p>
            <button 
              onClick={loadDocuments} 
              className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
              title="刷新列表"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 文档片段查看器 Modal */}
        {showChunkViewer && viewingDoc && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
              <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-xl">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">{viewingDoc.filename}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    共 {viewingChunks.length} 个片段 | {viewingChunks.filter(c => c.embedding && c.embedding.length > 0).length} 已索引
                  </p>
                </div>
                <button 
                  onClick={() => setShowChunkViewer(false)}
                  className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                >
                  <span className="text-2xl text-gray-500">×</span>
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                {viewingChunks.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p>暂无切片内容</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {viewingChunks.sort((a, b) => a.chunkIndex - b.chunkIndex).map((chunk, idx) => (
                      <div key={chunk.id || idx} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex gap-2 items-center">
                            <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded font-mono">
                              #{chunk.chunkIndex + 1}
                            </span>
                            {chunk.chunkType && (
                               <span className={`text-xs px-2 py-1 rounded ${
                                 chunk.chunkType === 'parent' ? 'bg-purple-100 text-purple-700' : 
                                 chunk.chunkType === 'child' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                               }`}>
                                 {chunk.chunkType === 'parent' ? '父块 (Parent)' : chunk.chunkType === 'child' ? '子块 (Child)' : '普通块'}
                               </span>
                            )}
                            <span className={`text-xs px-2 py-1 rounded ${
                              chunk.embedding && chunk.embedding.length > 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                            }`}>
                              {chunk.embedding && chunk.embedding.length > 0 ? '✓ 已Embedding' : '✗ 未Embedding'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-400">
                            ID: {chunk.id?.substring(0, 8)}...
                          </div>
                        </div>
                        <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded font-mono leading-relaxed">
                          {chunk.content}
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center text-xs text-gray-500">
                          <span>长度: {chunk.content.length} 字符</span>
                          {chunk.parentId && (
                            <span className="text-purple-600">所属父块: {chunk.parentId.substring(0, 8)}...</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="p-4 border-t border-gray-200 flex justify-end gap-3 bg-white rounded-b-xl">
                <button
                  onClick={() => setShowChunkViewer(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 上传区域 */}
        <div className="mb-8">
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
              dragActive
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 bg-white hover:border-gray-400'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">
              拖拽文件到此处上传
            </h3>
            <p className="text-gray-500 mb-4">
              支持 PDF、Word、Excel、TXT 等格式的文档
            </p>
            <input
              type="file"
              multiple
              accept=".txt,.md,.pdf,.doc,.docx,.xlsx,.xls"
              onChange={handleFileInput}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="inline-flex items-center px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors cursor-pointer"
            >
              <Plus className="w-5 h-5 mr-2" />
              选择文件
            </label>
            <button
              type="button"
              onClick={() => setShowManualEditor(v => !v)}
              className="ml-3 inline-flex items-center px-6 py-3 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
            >
              <Plus className="w-5 h-5 mr-2" />
              新建文本文档
            </button>
          </div>
          </div>

        {/* 新建文本文档编辑器 */}
        {showManualEditor && (
          <div className="mb-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-800 mb-4">新建文本文档</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <input
                type="text"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="文档标题"
              />
              <input
                type="text"
                value={manualCategory}
                onChange={(e) => setManualCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="分类，如 BGP、S6250"
              />
            </div>
            <textarea
              rows={8}
              value={manualContent}
              onChange={(e) => setManualContent(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="粘贴与该文档相关的正文内容（建议直接从PDF/手册复制粘贴到这里）"
            />
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={async () => {
                  if (!user) return;
                  const text = manualContent.trim();
                  if (text.length < 20) { alert('请至少粘贴20个字符的正文'); return; }
                  
                  try {
                    // 创建一个 Blob 对象
                    const blob = new Blob([text], { type: 'text/plain' });
                    // 创建 File 对象 (注意：在某些旧浏览器可能不兼容，但在现代浏览器没问题)
                    const filename = (manualTitle || '新建文本文档').endsWith('.txt') 
                      ? (manualTitle || '新建文本文档') 
                      : `${manualTitle || '新建文本文档'}.txt`;
                    
                    const file = new File([blob], filename, { type: 'text/plain' });
                    
                    // 使用统一的上传接口
                    await unifiedStorageManager.uploadDocument(file, user.id, manualCategory || 'default');
                    
                    setManualContent('');
                    setShowManualEditor(false);
                    loadDocuments();
                    alert('文档已创建并上传到后台处理');
                  } catch (error) {
                    console.error('创建文档失败:', error);
                    alert('创建文档失败');
                  }
                }}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                保存到知识库
              </button>
              <button
                type="button"
                onClick={() => { setShowManualEditor(false); setManualContent(''); }}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 搜索和筛选 */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="搜索文档..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {categories.map(category => (
              <option key={category} value={category}>
                {category === 'all' ? '所有分类' : category}
              </option>
            ))}
          </select>
        </div>

        {/* 文档列表 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDocuments.map((document) => (
            <div key={document.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileIcon className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 
                      className="font-medium text-gray-800 truncate" 
                      title={document.filename}
                      style={{
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {document.filename}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {formatFileSize(document.fileSize)}
                    </p>
                  </div>
                </div>

                {/* 状态显示 */}
                <div className="flex flex-col items-end mr-2">
                  {document.status === 'processing' && (
                    <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded whitespace-nowrap flex items-center">
                      <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                      处理中...
                    </span>
                  )}
                  {document.status === 'error' && (
                    <div className="flex flex-col items-end">
                      <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded whitespace-nowrap mb-1" title={document.errorMessage}>
                        处理失败
                      </span>
                      {document.errorMessage && (
                        <span className="text-[10px] text-red-500 max-w-[150px] truncate" title={document.errorMessage}>
                          {document.errorMessage}
                        </span>
                      )}
                      {/* 如果是 API Key 错误，显示设置链接 */}
                      {document.errorMessage && (document.errorMessage.includes('API key') || document.errorMessage.includes('Key')) && (
                         <Link to="/admin/settings" className="text-[10px] text-blue-500 hover:underline mt-1">
                           去配置 API Key &rarr;
                         </Link>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => deleteDocument(document.id)}
                  className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0 ml-2"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600 line-clamp-3">
                  {document.contentPreview}
                </p>
              </div>

              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>{new Date(document.uploadedAt).toLocaleDateString()}</span>
                <div className="flex space-x-2">
                  <button 
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                    onClick={() => openChunkViewer(document)}
                    title="查看文档切片与Embedding详情"
                  >
                    <Eye className="w-4 h-4 text-blue-500" />
                  </button>
                  <button 
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                    onClick={async () => {
                      try {
                        const chunks = await unifiedStorageManager.getChunks(document.id);
                        const markdownContent = generateMarkdownFromDocument(document, chunks);
                        downloadMarkdown(markdownContent, document.filename);
                      } catch (error) {
                        console.error('导出 Markdown 失败:', error);
                        alert('导出 Markdown 失败: ' + (error instanceof Error ? error.message : String(error)));
                      }
                    }}
                    title="导出为 Markdown"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Embedding 状态和重新生成按钮 */}
              <DocumentChunksStatus
                document={document}
                isRegenerating={regeneratingDocs.has(document.id)}
                onRegenerate={() => regenerateEmbeddings(document.id)}
                onReprocess={undefined} // 移除了前端重新处理功能
              />

              <div className="mt-4">
                <label className="text-xs text-gray-500">分类</label>
                <input
                  type="text"
                  defaultValue={document.category || 'default'}
                  onBlur={async (e) => {
                    await unifiedStorageManager.updateDocument(document.id, { category: e.target.value.trim() || 'default' });
                    loadDocuments();
                  }}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="输入或修改分类"
                />
              </div>

              {/* 手动添加文本片段用于检索 */}
              <div className="mt-4">
                <label className="text-xs text-gray-500">添加可检索的文本片段（推荐粘贴TXT/MD内容）</label>
                <div className="mt-1 flex gap-2">
                <textarea
                  rows={3}
                    value={manualChunkTexts[document.id] || ''}
                  placeholder="粘贴与该文档相关的关键内容，以提升检索效果"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onChange={(e) => {
                      const text = e.target.value;
                      setManualChunkTexts(prev => ({ ...prev, [document.id]: text }));
                      
                      const timerKey = `saveTimer_${document.id}`;
                      if ((window as any)[timerKey]) {
                        clearTimeout((window as any)[timerKey]);
                      }
                      
                      if (text.trim().length >= 10) {
                        (window as any)[timerKey] = setTimeout(async () => {
                          const currentText = manualChunkTexts[document.id] || text;
                          const trimmedText = currentText.trim();
                          
                          if (trimmedText.length >= 10) {
                            try {
                              await unifiedStorageManager.addManualChunk(document.id, trimmedText);
                              setManualChunkTexts(prev => ({ ...prev, [document.id]: '' }));
                              const label = e.target.parentElement?.parentElement?.querySelector('label');
                              if (label) {
                                const originalText = label.textContent;
                                label.textContent = '✓ 已保存';
                                label.className = 'text-xs text-green-500';
                                setTimeout(() => {
                                  if (label) {
                                    label.textContent = originalText || '';
                                    label.className = 'text-xs text-gray-500';
                                  }
                                }, 2000);
                              }
                            } catch (error) {
                              console.error('保存文本片段失败:', error);
                            }
                          }
                          delete (window as any)[timerKey];
                        }, 2000);
                      }
                    }}
                    onBlur={async (e) => {
                      const text = (manualChunkTexts[document.id] || '').trim();
                      const timerKey = `saveTimer_${document.id}`;
                      if ((window as any)[timerKey]) {
                        clearTimeout((window as any)[timerKey]);
                        delete (window as any)[timerKey];
                      }
                      
                      if (text.length >= 10) {
                        try {
                          await unifiedStorageManager.addManualChunk(document.id, text);
                          setManualChunkTexts(prev => ({ ...prev, [document.id]: '' }));
                          const label = e.target.parentElement?.parentElement?.querySelector('label');
                          if (label) {
                            const originalText = label.textContent;
                            label.textContent = '✓ 已保存';
                            label.className = 'text-xs text-green-500';
                            setTimeout(() => {
                              if (label) {
                                label.textContent = originalText || '';
                                label.className = 'text-xs text-gray-500';
                              }
                            }, 2000);
                          }
                        } catch (error) {
                          console.error('保存文本片段失败:', error);
                        }
                    }
                  }}
                />
                </div>
                <p className="mt-1 text-xs text-gray-400">提示：输入后会自动保存（2秒后或失去焦点时）。目前最佳效果为上传/粘贴 `TXT` 或 `MD` 文本。</p>
              </div>
            </div>
          ))}
        </div>

        {filteredDocuments.length === 0 && (
          <div className="text-center py-12">
            <FolderOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-500 mb-2">暂无文档</h3>
            <p className="text-gray-400">
              {searchTerm ? '没有找到匹配的文档' : '请上传您的第一个文档'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default KnowledgeBase;