import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload,
  File as FileIcon,
  Search,
  Trash2,
  Download,
  Eye,
  Plus,
  FolderOpen,
  RefreshCw,
  MoreVertical,
  FileText,
  Table,
  Grid,
  Move,
  Share2,
  Activity,
  AlertTriangle
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { unifiedStorageManager, Document } from '../lib/localStorage';
import { serverStorageManager } from '../lib/serverStorage';
import { Category } from '../lib/types';
import DocumentChunksStatus from './DocumentChunksStatus';
import CategoryTree from './CategoryTree';
import { useWebSocket } from '../hooks/useWebSocket';

type ViewMode = 'grid' | 'table';
type KnowledgeGraphStats = {
  vendors: number;
  vendorsTotal: number;
  functions: number;
  functionsTotal: number;
  commands: number;
  commandsTotal: number;
  parameters: number;
  parametersTotal: number;
  relationships: number;
};

const defaultKgStats: KnowledgeGraphStats = {
  vendors: 0,
  vendorsTotal: 0,
  functions: 0,
  functionsTotal: 0,
  commands: 0,
  commandsTotal: 0,
  parameters: 0,
  parametersTotal: 0,
  relationships: 0
};

const getCategoryAndChildrenIds = (categoryId: string, cats: Category[]): string[] => {
  const ids: string[] = [categoryId];

  const collectDescendants = (node: Category) => {
    node.children?.forEach(child => {
      ids.push(child.id);
      collectDescendants(child);
    });
  };

  const findTarget = (nodes: Category[]): boolean => {
    for (const node of nodes) {
      if (node.id === categoryId) {
        collectDescendants(node);
        return true;
      }
      if (node.children && findTarget(node.children)) {
        return true;
      }
    }
    return false;
  };

  findTarget(cats);
  return ids;
};

const getCategoryNameById = (categoryId: string, cats: Category[]): string | null => {
  for (const node of cats) {
    if (node.id === categoryId) return node.name;
    if (node.children) {
      const found = getCategoryNameById(categoryId, node.children);
      if (found) return found;
    }
  }
  return null;
};

const getCategoryIdByName = (name: string, cats: Category[]): string | null => {
  for (const node of cats) {
    if (node.name === name) return node.id;
    if (node.children) {
      const found = getCategoryIdByName(name, node.children);
      if (found) return found;
    }
  }
  return null;
};

const KnowledgeBase: React.FC = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [regeneratingDocs, setRegeneratingDocs] = useState<Set<string>>(new Set());
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [viewingChunks, setViewingChunks] = useState<any[]>([]);
  const [showChunkViewer, setShowChunkViewer] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [movingDoc, setMovingDoc] = useState<Document | null>(null);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDocs, setTotalDocs] = useState(0);
  const [kgStats, setKgStats] = useState<KnowledgeGraphStats>(defaultKgStats);
  const [kgStatus, setKgStatus] = useState<'idle' | 'active' | 'error'>('idle');
  const [kgLoading, setKgLoading] = useState(false);
  const [kgMessage, setKgMessage] = useState('');
  const [kgLastUpdated, setKgLastUpdated] = useState<Date | null>(null);
  const [kgAction, setKgAction] = useState<'idle' | 'init' | 'build' | 'refresh'>('idle');
  const pageSize = 50;

  const { user } = useAuthStore();


  const loadCategories = useCallback(async () => {
    try {
      const data = await serverStorageManager.getCategories();
      setCategories(data.tree || []);
    } catch (error) {
      console.error('加载分类失败:', error);
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    if (user) {
      try {
        const result = await unifiedStorageManager.getDocumentsWithPagination(user.id, {
          page: currentPage,
          limit: pageSize,
          category: selectedCategoryId || undefined,
          search: searchTerm || undefined
        });
        setDocuments(result.documents);
        if (result.pagination) {
          setTotalPages(result.pagination.totalPages);
          setTotalDocs(result.pagination.total);
        }
      } catch (error) {
        console.error('加载文档失败:', error);
        // 保持现有文档列表，避免清空
      }
    }
  }, [user, currentPage, selectedCategoryId, searchTerm]);

  useEffect(() => {
    if (user) {
      loadDocuments();
      loadCategories();
    }
  }, [user, loadDocuments, loadCategories]);

  const fetchKnowledgeGraphStatus = useCallback(async (markAction: boolean = false) => {
    if (kgLoading) return;
    if (markAction) setKgAction('refresh');
    setKgLoading(true);
    setKgMessage('');
    try {
      const data = await serverStorageManager.getKnowledgeGraphStats();
      console.log('[KnowledgeBase] 知识图谱状态响应:', data);

      // 检查响应数据结构
      if (!data || typeof data !== 'object') {
        throw new Error('无效的响应数据');
      }

      const stats = data.knowledgeGraph || {};
      setKgStats({ ...defaultKgStats, ...stats });
      setKgStatus((data.status as 'active' | 'error') || 'active');

      if (data.error) {
        setKgMessage(`警告: ${data.error}`);
      } else {
        setKgMessage('');
      }
      setKgLastUpdated(new Date());
    } catch (error) {
      console.error('[KnowledgeBase] 获取知识图谱状态失败:', error);
      setKgStatus('error');
      setKgMessage(error instanceof Error ? error.message : '无法获取知识图谱状态');
    } finally {
      setKgLoading(false);
      setKgAction('idle');
    }
  }, []); // 移除 kgLoading 依赖，避免无限循环

  useEffect(() => {
    fetchKnowledgeGraphStatus();
  }, []); // 只在组件挂载时执行一次

  // 当搜索词或分类变化时，重置到第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategoryId]);



  const handleAddCategory = async (parentId: string | null, name: string) => {
    try {
      await serverStorageManager.addCategory(parentId, name);
      await loadCategories();
    } catch (error) {
      console.error('添加分类失败:', error);
      alert('添加分类失败');
    }
  };

  const handleUpdateCategory = async (id: string, name: string) => {
    try {
      await serverStorageManager.updateCategory(id, name);
      await loadCategories();
    } catch (error) {
      console.error('更新分类失败:', error);
      alert('更新分类失败');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!window.confirm('确定要删除这个分类吗？该分类下的文档将移至默认分类。')) return;
    try {
      await serverStorageManager.deleteCategory(id);
      await loadCategories();
      if (selectedCategoryId === id) setSelectedCategoryId(null);
    } catch (error) {
      console.error('删除分类失败:', error);
      alert('删除分类失败');
    }
  };

  // WebSocket 实时更新
  const handleWebSocketMessage = useCallback((message: any) => {
    if (message.type === 'document_update' && message.document && typeof message.document === 'object' && message.document.id) {
      setDocuments(prev => {
        const index = prev.findIndex(d => d.id === message.document.id);
        if (index >= 0) {
          const newDocs = [...prev];
          newDocs[index] = message.document;
          return newDocs;
        }
        return prev;
      });
    }
  }, []);

  useWebSocket(handleWebSocketMessage);

  const handleInitKnowledgeGraph = async () => {
    setKgAction('init');
    setKgMessage('正在初始化知识图谱连接...');
    try {
      await serverStorageManager.initKnowledgeGraph();
      setKgMessage('初始化完成');
      await fetchKnowledgeGraphStatus();
    } catch (error) {
      setKgMessage(error instanceof Error ? error.message : '初始化失败');
    } finally {
      setKgAction('idle');
    }
  };

  const handleBuildKnowledgeGraph = async () => {
    if (!window.confirm('确定要手动触发知识图谱构建吗？该操作可能需要一些时间。')) {
      return;
    }
    setKgAction('build');
    setKgMessage('正在构建知识图谱...');
    try {
      await serverStorageManager.buildKnowledgeGraph();
      setKgMessage('构建任务已启动');
      await fetchKnowledgeGraphStatus();
    } catch (error) {
      setKgMessage(error instanceof Error ? error.message : '构建失败');
    } finally {
      setKgAction('idle');
    }
  };

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
          await unifiedStorageManager.uploadDocument(file, user.id, selectedCategoryId || 'default');
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
    const categoryName = doc.categoryId ? getCategoryNameById(doc.categoryId, categories) : null;
    const categoryLabel = categoryName || doc.category;
    if (categoryLabel) {
      markdown += `**分类**: ${categoryLabel}\n\n`;
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

  const handleMoveDocument = async (targetCategoryId: string) => {
    if (!movingDoc) return;
    try {
      const success = await serverStorageManager.moveDocumentCategory(movingDoc.id, targetCategoryId);
      if (success) {
        loadDocuments();
        setShowMoveDialog(false);
        setMovingDoc(null);
      } else {
        alert('移动文档失败');
      }
    } catch (error) {
      console.error('移动文档失败:', error);
      alert(`移动文档失败: ${error instanceof Error ? error.message : String(error)}`);
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

  // 计算每个分类的文档数量
  const documentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    documents.forEach(doc => {
      const catId = doc.categoryId || (doc.category ? getCategoryIdByName(doc.category, categories) : null) || 'default';
      counts[catId] = (counts[catId] || 0) + 1;
    });
    return counts;
  }, [documents, categories]);

  // 服务器端已经处理了筛选和分页，这里直接使用 documents
  const filteredDocuments = documents;

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
    <div className="admin-page overflow-auto">
      <div className="max-w-[1600px] mx-auto">
        {/* 标题栏 */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">知识库管理</h1>
          <p className="text-sm text-gray-500 mt-1">上传和管理您的文档资料</p>
        </div>

        {/* 知识图谱状态 */}
        <div className="admin-card p-5 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Share2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  知识图谱状态
                  {kgLoading && <RefreshCw className="w-4 h-4 animate-spin text-gray-400" />}
                </h2>
                <p className="text-sm text-gray-500">
                  {kgLastUpdated ? `最近更新：${kgLastUpdated.toLocaleString()}` : '尚未获取最新状态'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`px-3 py-1 text-xs font-medium rounded-full ${kgStatus === 'active'
                  ? 'bg-green-100 text-green-700'
                  : kgStatus === 'error'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-700'
                  }`}
              >
                {kgStatus === 'active' ? '运行中' : kgStatus === 'error' ? '异常' : '待检测'}
              </span>
              <button
                onClick={() => fetchKnowledgeGraphStatus(true)}
                disabled={kgAction !== 'idle'}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className="w-4 h-4" />
                刷新状态
              </button>
              <button
                onClick={handleInitKnowledgeGraph}
                disabled={kgAction !== 'idle'}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-blue-100 text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              >
                <Activity className="w-4 h-4" />
                初始化连接
              </button>
              <button
                onClick={handleBuildKnowledgeGraph}
                disabled={kgAction !== 'idle'}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Share2 className="w-4 h-4" />
                手动构建
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-5">
            {[
              { label: '厂商', key: 'vendors', totalKey: 'vendorsTotal' },
              { label: '功能', key: 'functions', totalKey: 'functionsTotal' },
              { label: '命令', key: 'commands', totalKey: 'commandsTotal' },
              { label: '参数', key: 'parameters', totalKey: 'parametersTotal' },
              { label: '关系', key: 'relationships' }
            ].map(item => {
              const totalKey = item.totalKey as keyof KnowledgeGraphStats | undefined;
              const totalValue = totalKey ? kgStats[totalKey] : undefined;
              const displayValue = totalValue ?? kgStats[item.key as keyof KnowledgeGraphStats] ?? 0;
              return (
              <div key={item.key} className="p-3 rounded-xl bg-gray-50">
                <p className="text-xs text-gray-500">{item.label}</p>
                <p className="text-xl font-semibold text-gray-900 mt-1">
                  {kgLoading ? '...' : displayValue}
                </p>
              </div>
              );
            })}
          </div>
          {kgMessage && (
            <div className={`mt-4 flex items-center gap-2 text-sm ${kgStatus === 'error' ? 'text-red-600' : 'text-gray-600'}`}>
              <AlertTriangle className="w-4 h-4" />
              {kgMessage}
            </div>
          )}
        </div>

        <div className="flex gap-4 h-[calc(100%-80px)]">
          {/* 左侧分类树 */}
          <div className="w-64 flex-shrink-0 admin-card p-3 overflow-y-auto overflow-x-hidden">
            <h3 className="text-sm font-medium text-gray-700 mb-2">文档分类</h3>
            <CategoryTree
              categories={categories}
              selectedId={selectedCategoryId}
              onSelect={setSelectedCategoryId}
              onAdd={handleAddCategory}
              onUpdate={handleUpdateCategory}
              onDelete={handleDeleteCategory}
              documentCounts={documentCounts}
            />
          </div>

          {/* 右侧主内容区 */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* 顶部工具栏 */}
            <div className="admin-card p-3 mb-4">
              <div className="flex items-center gap-3 flex-wrap">
                {/* 搜索框 */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="搜索文档..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* 上传按钮 */}
                <input type="file" multiple accept=".txt,.md,.pdf,.doc,.docx,.xlsx,.xls" onChange={handleFileInput} className="hidden" id="file-upload" />
                <label htmlFor="file-upload" className="inline-flex items-center px-4 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 cursor-pointer">
                  <Upload className="w-4 h-4 mr-1.5" />
                  上传文档
                </label>

                {/* 刷新按钮 */}
                <button onClick={loadDocuments} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg" title="刷新">
                  <RefreshCw className="w-4 h-4" />
                </button>

                {/* 视图切换 */}
                <div className="flex border border-gray-200 rounded-lg overflow-hidden">
                  <button onClick={() => setViewMode('table')} className={`p-2 ${viewMode === 'table' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`} title="列表视图">
                    <Table className="w-4 h-4" />
                  </button>
                  <button onClick={() => setViewMode('grid')} className={`p-2 ${viewMode === 'grid' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`} title="网格视图">
                    <Grid className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* 拖拽上传提示 */}
              <div
                className={`mt-3 border-2 border-dashed rounded-lg p-3 text-center text-sm transition-all ${dragActive ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-400'}`}
                onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              >
                {isUploading ? '上传中...' : '拖拽文件到此处上传 (PDF/Word/Excel/TXT)'}
              </div>
            </div>

            {/* 文档片段查看器 Modal */}
            {showChunkViewer && viewingDoc && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                  <div className="p-4 border-b flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-gray-800">{viewingDoc.filename}</h3>
                      <p className="text-sm text-gray-500">共 {viewingChunks.length} 个片段 | {viewingChunks.filter(c => c.embedding?.length > 0).length} 已索引</p>
                    </div>
                    <button onClick={() => setShowChunkViewer(false)} className="p-2 hover:bg-gray-100 rounded-full">×</button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                    {viewingChunks.length === 0 ? (
                      <div className="text-center py-12 text-gray-500">暂无切片内容</div>
                    ) : (
                      <div className="space-y-3">
                        {viewingChunks.sort((a, b) => a.chunkIndex - b.chunkIndex).map((chunk, idx) => (
                          <div key={chunk.id || idx} className="bg-white p-3 rounded-lg border text-sm">
                            <div className="flex gap-2 items-center mb-2">
                              <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">#{chunk.chunkIndex + 1}</span>
                              <span className={`text-xs px-2 py-0.5 rounded ${chunk.embedding?.length > 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                                {chunk.embedding?.length > 0 ? '✓ 已索引' : '✗ 未索引'}
                              </span>
                            </div>
                            <div className="text-gray-700 whitespace-pre-wrap bg-gray-50 p-2 rounded text-xs font-mono max-h-40 overflow-y-auto">{chunk.content}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="p-3 border-t flex justify-end">
                    <button onClick={() => setShowChunkViewer(false)} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm">关闭</button>
                  </div>
                </div>
              </div>
            )}

            {/* 移动文档对话框 */}
            {showMoveDialog && movingDoc && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
                  <div className="p-4 border-b">
                    <h3 className="font-bold text-gray-800">移动文档</h3>
                    <p className="text-sm text-gray-500 mt-1">将 "{movingDoc.filename}" 移动到：</p>
                  </div>
                  <div className="p-4 max-h-64 overflow-y-auto">
                    {/* 递归渲染分类列表 */}
                    {(() => {
                      const currentCategoryId = (movingDoc.categoryId && getCategoryNameById(movingDoc.categoryId, categories))
                        ? movingDoc.categoryId
                        : (movingDoc.category ? getCategoryIdByName(movingDoc.category, categories) : null) || 'default';
                      const renderCategoryList = (nodes: Category[], level = 0): React.ReactNode => {
                        return nodes.map(node => (
                          <div key={node.id}>
                            <button
                              onClick={() => handleMoveDocument(node.id)}
                              className={`w-full text-left px-3 py-2 rounded-lg hover:bg-purple-50 text-sm flex items-center gap-2 ${currentCategoryId === node.id ? 'bg-purple-100 text-purple-700' : 'text-gray-700'
                                }`}
                              style={{ paddingLeft: `${12 + level * 16}px` }}
                            >
                              <FolderOpen className="w-4 h-4" />
                              {node.name}
                              {currentCategoryId === node.id && (
                                <span className="text-xs text-gray-400 ml-auto">(当前)</span>
                              )}
                            </button>
                            {node.children && node.children.length > 0 && renderCategoryList(node.children, level + 1)}
                          </div>
                        ));
                      };
                      return renderCategoryList(categories);
                    })()}
                  </div>
                  <div className="p-3 border-t flex justify-end gap-2">
                    <button onClick={() => { setShowMoveDialog(false); setMovingDoc(null); }} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm">取消</button>
                  </div>
                </div>
              </div>
            )}

            {/* 文档列表 */}
            <div className="flex-1 admin-card overflow-hidden">
              {filteredDocuments.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-16 text-gray-400">
                  <FolderOpen className="w-12 h-12 mb-3 opacity-50" />
                  {searchTerm || selectedCategoryId ? (
                    <>
                      <p className="text-base mb-2">没有找到匹配的文档</p>
                      <p className="text-sm">尝试调整搜索条件或分类筛选</p>
                    </>
                  ) : (
                    <>
                      <p className="text-base mb-2">暂无文档</p>
                      <p className="text-sm">点击上方"上传文档"按钮开始添加</p>
                    </>
                  )}
                </div>
              ) : viewMode === 'table' ? (
                /* 表格视图 */
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">文件名</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 w-24">大小</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 w-32">状态</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600 w-28">上传时间</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600 w-24">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredDocuments.map((doc) => (
                        <tr key={doc.id} className="hover:bg-gray-50 group">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <FileIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                              <span className="truncate max-w-xs" title={doc.filename}>{doc.filename}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{formatFileSize(doc.fileSize)}</td>
                          <td className="px-4 py-3">
                            {doc.status === 'processing' ? (
                              <span className="inline-flex items-center text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded">
                                <RefreshCw className="w-3 h-3 mr-1 animate-spin" />处理中
                              </span>
                            ) : doc.status === 'error' ? (
                              <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded" title={doc.errorMessage}>失败</span>
                            ) : (
                              <span className="text-xs bg-green-100 text-green-600 px-2 py-1 rounded">就绪</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500">{new Date(doc.uploadedAt).toLocaleDateString()}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => openChunkViewer(doc)} className="p-1.5 hover:bg-blue-50 rounded text-blue-500" title="查看切片">
                                <Eye className="w-4 h-4" />
                              </button>
                              <button onClick={() => { setMovingDoc(doc); setShowMoveDialog(true); }} className="p-1.5 hover:bg-purple-50 rounded text-purple-500" title="移动分类">
                                <Move className="w-4 h-4" />
                              </button>
                              <button onClick={async () => {
                                const chunks = await unifiedStorageManager.getChunks(doc.id);
                                downloadMarkdown(generateMarkdownFromDocument(doc, chunks), doc.filename);
                              }} className="p-1.5 hover:bg-gray-100 rounded text-gray-500" title="导出">
                                <Download className="w-4 h-4" />
                              </button>
                              <button onClick={() => deleteDocument(doc.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500" title="删除">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* 网格视图 */
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredDocuments.map((doc) => (
                    <div key={doc.id} className="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 bg-blue-100 rounded flex items-center justify-center flex-shrink-0">
                            <FileIcon className="w-4 h-4 text-blue-600" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-medium text-gray-800 truncate text-sm" title={doc.filename}>{doc.filename}</h4>
                            <p className="text-xs text-gray-500">{formatFileSize(doc.fileSize)}</p>
                          </div>
                        </div>
                        <button onClick={() => deleteDocument(doc.id)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <p className="text-xs text-gray-600 line-clamp-2 mb-3">{doc.contentPreview || ''}</p>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">{new Date(doc.uploadedAt).toLocaleDateString()}</span>
                        <div className="flex items-center gap-1">
                          {doc.status === 'processing' ? (
                            <span className="inline-flex items-center text-blue-600"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />处理中</span>
                          ) : doc.status === 'error' ? (
                            <span className="text-red-500">失败</span>
                          ) : (
                            <span className="text-green-500">就绪</span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t flex gap-2">
                        <button onClick={() => openChunkViewer(doc)} className="flex-1 text-xs py-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">查看切片</button>
                        <button onClick={async () => {
                          const chunks = await unifiedStorageManager.getChunks(doc.id);
                          downloadMarkdown(generateMarkdownFromDocument(doc, chunks), doc.filename);
                        }} className="flex-1 text-xs py-1.5 bg-gray-50 text-gray-600 rounded hover:bg-gray-100">导出</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 底部统计和分页 */}
            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <div>
                共 {totalDocs} 个文档 {selectedCategoryId && `(已筛选)`}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 rounded border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    上一页
                  </button>
                  <span>
                    第 {currentPage} / {totalPages} 页
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 rounded border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeBase;
