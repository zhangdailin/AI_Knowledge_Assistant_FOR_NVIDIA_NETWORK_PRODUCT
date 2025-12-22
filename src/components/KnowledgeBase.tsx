import React, { useState, useEffect } from 'react';
import { Upload, File, Search, Trash2, Download, Eye, Plus, FolderOpen, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { unifiedStorageManager, Document } from '../lib/localStorage';
import { parsePDFToText, parseDocxToText, parsePDFToTextAdvanced, parsePDFToTextSelective, diagnosePDFTextExtraction, extractViaServer, extractViaCloudOCR } from '../lib/fileParsers';
import { retrieval } from '../lib/retrieval';
import { llmIndexDocument } from '../lib/indexing';
import DocumentChunksStatus from './DocumentChunksStatus';
import { enhancedParentChildChunking } from '../lib/chunkingEnhancements';

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
  const [pdfPageLimit, setPdfPageLimit] = useState(0);
  const [pdfGroupByPos, setPdfGroupByPos] = useState(true);
  const [regeneratingDocs, setRegeneratingDocs] = useState<Set<string>>(new Set());
  // 为每个文档的文本片段输入框维护独立的状态
  const [manualChunkTexts, setManualChunkTexts] = useState<Record<string, string>>({});

  const { user } = useAuthStore();

  useEffect(() => {
    if (user) {
      loadDocuments();
    }
  }, [user]);

  // 轮询逻辑：如果有文档正在处理中，每3秒刷新一次状态
  useEffect(() => {
    const hasProcessing = documents.some(doc => doc.status === 'processing');
    if (hasProcessing) {
      const timer = setInterval(() => {
        loadDocuments();
      }, 3000);
      return () => clearInterval(timer);
    }
  }, [documents]);

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
    
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          // 直接上传到后台处理，不再在前端解析
          await unifiedStorageManager.uploadDocument(file, user.id, 'default');
        } catch (error) {
          console.error(`上传文件 ${file.name} 失败:`, error);
          alert(`上传 ${file.name} 失败`);
        }
      }
      // 上传完成后刷新列表，此时文档状态应为 processing
      loadDocuments();
    } catch (error) {
      console.error('批量上传失败:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const readFileContent = async (file: File): Promise<string> => {
    const type = file.type;
    try {
      if (type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const via = await extractViaServer(file);
        if (via && via.length > 50) {
          return via;
        }
        const cloud = await extractViaCloudOCR(file);
        if (cloud && cloud.length > 50) {
          return cloud;
        }
        const text = await parsePDFToTextSelective(file, { maxPages: pdfPageLimit, charLimit: 20000, groupByPosition: pdfGroupByPos });
        if (text && !/^PDF文件:/.test(text) && text.length > 50) {
          return text;
        }
        return `PDF文件: ${file.name}`;
      }
      if (
        type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        type === 'application/msword' ||
        file.name.toLowerCase().endsWith('.docx') ||
        file.name.toLowerCase().endsWith('.doc')
      ) {
        const via = await extractViaServer(file);
        if (via && via.length > 20) return via;
        const text = await parseDocxToText(file);
        return text || `Word文档: ${file.name}`;
      }
      // 纯文本与Markdown
      const reader = new FileReader();
      return await new Promise((resolve, reject) => {
        reader.onload = (e) => resolve((e.target?.result as string) || '');
        reader.onerror = reject;
        reader.readAsText(file);
      });
    } catch (err) {
      console.error('解析文件失败，回退到简要描述:', err);
      return `${type.includes('pdf') ? 'PDF' : type.includes('word') ? 'Word' : '文件'}: ${file.name}`;
    }
  };

  const diagnoseAndServerExtract = async (file: File): Promise<string | null> => {
    try {
      const maybe = await diagnosePDFTextExtraction(file, { inspectPages: 10, groupByPosition: pdfGroupByPos });
      if (/加载失败|跨域|策略阻止/.test(maybe)) {
        const via = await extractViaServer(file);
        if (via && via.length > 50) return via;
      }
      return null;
    } catch {
      return null;
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

  const processDocumentContent = (content: string) => {
    // 使用增强的父子分片策略（考虑语义边界）
    const enhancedChunks = enhancedParentChildChunking(content, 4000, 500, 150);
    
    // 转换为原有格式（保持兼容性）
    return enhancedChunks.map(chunk => ({
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
      parentId: chunk.parentId,
      chunkType: chunk.chunkType
    }));
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
      const chunks = await unifiedStorageManager.getChunks(documentId);
      const chunksWithoutEmbedding = chunks.filter(ch => !ch.embedding || !Array.isArray(ch.embedding) || ch.embedding.length === 0);
      
      if (chunksWithoutEmbedding.length === 0) {
        alert('该文档的所有 chunks 都已经有 embedding 了！');
        return;
      }
      
      // 创建后台任务生成 embedding
      await unifiedStorageManager.createEmbeddingTask(documentId);
      alert(`已开始后台生成 Embedding（${chunksWithoutEmbedding.length} 个 chunks），请查看进度...`);
      loadDocuments();
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

  const reprocessDocument = async (documentId: string) => {
    if (regeneratingDocs.has(documentId)) return;
    
    const doc = documents.find(d => d.id === documentId);
    if (!doc) {
      alert('文档不存在！');
      return;
    }
    
    if (!window.confirm(`确定要重新处理文档 "${doc.filename}" 吗？\n\n注意：由于原始文件内容已不可用，建议删除此文档后重新上传文件以获得完整内容。\n\n如果文档的预览内容足够，将基于预览内容重新处理。`)) {
      return;
    }
    
    setRegeneratingDocs(prev => new Set(prev).add(documentId));
    try {
      // 删除旧的 chunks（通过删除并重新创建文档的方式）
      // 注意：这里只能使用 contentPreview，因为原始文件内容已经丢失
      if (doc.contentPreview && doc.contentPreview.length > 100 && !doc.contentPreview.startsWith('PDF文件:') && !doc.contentPreview.startsWith('Word文档:')) {
        // 删除旧的 chunks
        const oldChunks = await unifiedStorageManager.getChunks(documentId);
        if (oldChunks.length > 0) {
          // 通过删除文档来删除 chunks，然后重新创建文档
          const deleted = await unifiedStorageManager.deleteDocument(documentId);
          if (!deleted) {
            console.warn('删除文档失败，但继续重新处理');
          }
          const newDoc = await unifiedStorageManager.createDocument(
            user!.id,
            doc.filename,
            doc.fileType,
            doc.fileSize,
            doc.contentPreview,
            doc.category || 'default'
          );
          
          // 重新处理文档内容
          const chunks = processDocumentContent(doc.contentPreview);
          await unifiedStorageManager.createChunks(newDoc.id, chunks);
          // 创建后台任务生成 embedding
          try {
            await unifiedStorageManager.createEmbeddingTask(newDoc.id);
            alert(`文档重新处理完成！已开始后台生成 Embedding（${chunks.length} 个 chunks），请查看进度...\n\n注意：由于原始文件内容已不可用，只基于预览内容（${doc.contentPreview.length} 字符）创建了 ${chunks.length} 个 chunks。\n\n建议删除此文档后重新上传完整文件以获得更好的检索效果。`);
          } catch (error) {
            console.error('创建 embedding 任务失败:', error);
            alert(`文档重新处理完成，但创建 Embedding 任务失败：${error.message}\n\n注意：由于原始文件内容已不可用，只基于预览内容（${doc.contentPreview.length} 字符）创建了 ${chunks.length} 个 chunks。`);
          }
        } else {
          // 没有旧的 chunks，直接创建新的
          const chunks = processDocumentContent(doc.contentPreview);
          await unifiedStorageManager.createChunks(documentId, chunks);
          // 创建后台任务生成 embedding
          try {
            await unifiedStorageManager.createEmbeddingTask(documentId);
            alert(`文档重新处理完成！已开始后台生成 Embedding（${chunks.length} 个 chunks），请查看进度...\n\n注意：由于原始文件内容已不可用，只基于预览内容（${doc.contentPreview.length} 字符）创建了 ${chunks.length} 个 chunks。\n\n建议删除此文档后重新上传完整文件以获得更好的检索效果。`);
          } catch (error) {
            console.error('创建 embedding 任务失败:', error);
            alert(`文档重新处理完成，但创建 Embedding 任务失败：${error.message}\n\n注意：由于原始文件内容已不可用，只基于预览内容（${doc.contentPreview.length} 字符）创建了 ${chunks.length} 个 chunks。`);
          }
        }
        loadDocuments();
      } else {
        alert('文档的预览内容不足或无法解析，无法重新处理。请删除此文档后重新上传文件。');
      }
    } catch (error) {
      console.error('重新处理文档失败:', error);
      alert(`重新处理文档失败: ${error instanceof Error ? error.message : String(error)}`);
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
              支持 PDF、Word、TXT 等格式的文档
            </p>
            <input
              type="file"
              multiple
              accept=".txt,.md,.pdf,.doc,.docx"
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

        <div className="mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-800 mb-3">PDF解析选项</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">解析页数上限（0 不限）</label>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={pdfPageLimit}
                  onChange={(e) => setPdfPageLimit(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={pdfGroupByPos}
                  onChange={(e) => setPdfGroupByPos(e.target.checked)}
                  className="h-4 w-4"
                />
                <label className="text-sm text-gray-700">按行位置合并文本</label>
              </div>
            </div>
          </div>
        </div>
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
                  const doc = await unifiedStorageManager.createDocument(
                    user.id,
                    manualTitle || '手动文本文档',
                    'text/plain',
                    text.length,
                    text.substring(0, 500),
                    manualCategory || 'default'
                  );
                  const chunks = processDocumentContent(text);
                  await unifiedStorageManager.createChunks(doc.id, chunks);
                  setManualContent('');
                  setShowManualEditor(false);
                  loadDocuments();
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
                    <File className="w-5 h-5 text-blue-600" />
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
                  <button className="p-1 hover:bg-gray-100 rounded transition-colors">
                    <Eye className="w-4 h-4" />
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
                onReprocess={() => reprocessDocument(document.id)}
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

              {/* 手动添加文本片段用于检索（适用于PDF/Word无法解析的情况） */}
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
                      
                      // 清除之前的定时器
                      const timerKey = `saveTimer_${document.id}`;
                      if ((window as any)[timerKey]) {
                        clearTimeout((window as any)[timerKey]);
                      }
                      
                      // 如果文本长度足够，设置自动保存（2秒后）
                      if (text.trim().length >= 10) {
                        
                        (window as any)[timerKey] = setTimeout(async () => {
                          const currentText = manualChunkTexts[document.id] || text;
                          const trimmedText = currentText.trim();
                          
                          if (trimmedText.length >= 10) {
                            try {
                              await unifiedStorageManager.addManualChunk(document.id, trimmedText);
                              
                              // 清空输入框
                              setManualChunkTexts(prev => ({ ...prev, [document.id]: '' }));
                              
                              // 显示保存成功的提示
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
                        }, 2000); // 2秒后自动保存
                      }
                    }}
                    onBlur={async (e) => {
                      const text = (manualChunkTexts[document.id] || '').trim();
                      
                      // 清除定时器，立即保存
                      const timerKey = `saveTimer_${document.id}`;
                      if ((window as any)[timerKey]) {
                        clearTimeout((window as any)[timerKey]);
                        delete (window as any)[timerKey];
                      }
                      
                      if (text.length >= 10) {
                        try {
                          await unifiedStorageManager.addManualChunk(document.id, text);
                          
                          // 清空输入框
                          setManualChunkTexts(prev => ({ ...prev, [document.id]: '' }));
                          
                          // 显示保存成功的提示
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
                  <button
                    type="button"
                    onClick={async () => {
                      const text = (manualChunkTexts[document.id] || '').trim();
                      if (text.length < 10) {
                        alert('请至少输入10个字符');
                        return;
                      }
                      
                      try {
                        await unifiedStorageManager.addManualChunk(document.id, text);
                        
                        // 保存后清空输入框（手动保存时清空）
                        setManualChunkTexts(prev => ({ ...prev, [document.id]: '' }));
                        
                        // 显示保存成功的提示
                        const labelElement = window.document.querySelector(`label[for-chunk-${document.id}]`) || 
                                     window.document.querySelector('.text-xs.text-gray-500');
                        const label = labelElement as HTMLElement | null;
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
                        alert('保存失败，请重试');
                      }
                    }}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors whitespace-nowrap"
                  >
                    保存
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-400">提示：输入后会自动保存（2秒后或失去焦点时，内容会保留）。点击"保存"按钮可手动保存并清空输入框。目前最佳效果为上传/粘贴 `TXT` 或 `MD` 文本。</p>
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