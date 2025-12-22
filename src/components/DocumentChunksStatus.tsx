import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { unifiedStorageManager, Document } from '../lib/localStorage';

interface DocumentChunksStatusProps {
  document: Document;
  isRegenerating: boolean;
  onRegenerate: () => Promise<void>;
  onReprocess: () => Promise<void>;
}

const DocumentChunksStatus: React.FC<DocumentChunksStatusProps> = ({
  document,
  isRegenerating,
  onRegenerate,
  onReprocess
}) => {
  const [chunks, setChunks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<any>(null);
  const [taskProgress, setTaskProgress] = useState(0);

  useEffect(() => {
    const loadChunks = async () => {
      try {
        const docChunks = await unifiedStorageManager.getChunks(document.id);
        setChunks(docChunks);
      } catch (error) {
        console.error('加载 chunks 失败:', error);
        setChunks([]);
      } finally {
        setLoading(false);
      }
    };
    loadChunks();
  }, [document.id]);

  // 轮询任务状态
  useEffect(() => {
    const checkTask = async () => {
      try {
        const tasks = await unifiedStorageManager.getDocumentTasks(document.id);
        const activeTask = tasks.find(t => t.status === 'pending' || t.status === 'processing');
        if (activeTask) {
          setTask(activeTask);
          setTaskProgress(activeTask.progress || 0);
        } else {
          setTask(null);
          // 如果有已完成的任务，刷新 chunks
          const completedTask = tasks.find(t => t.status === 'completed');
          if (completedTask) {
            const docChunks = await unifiedStorageManager.getChunks(document.id);
            setChunks(docChunks);
          }
        }
      } catch (error) {
        console.error('检查任务状态失败:', error);
      }
    };

    checkTask();
    const interval = setInterval(checkTask, 2000); // 每2秒检查一次
    return () => clearInterval(interval);
  }, [document.id]);

  // 计算 chunks 统计（必须在所有条件渲染之前）
  // 1. 统计父块和子块
  const parentChunks = chunks.filter(ch => ch.chunkType === 'parent');
  const childChunks = chunks.filter(ch => ch.chunkType === 'child');
  const normalChunks = chunks.filter(ch => ch.chunkType !== 'parent' && ch.chunkType !== 'child');
  
  const parentChunksCount = parentChunks.length;
  const childChunksCount = childChunks.length;
  const normalChunksCount = normalChunks.length;
  
  // 2. 统计 Embedding 状态
  // 注意：父块通常不需要 Embedding（主要用于上下文），子块和普通块需要 Embedding（用于检索）
  // 因此，"未生成"的数量应该只计算需要 Embedding 的块
  
  const chunksRequiringEmbedding = [...childChunks, ...normalChunks];
  const totalChunksRequiringEmbedding = chunksRequiringEmbedding.length;
  
  const chunksWithEmbedding = chunksRequiringEmbedding.filter(ch => Array.isArray(ch.embedding) && ch.embedding.length > 0).length;
  const chunksWithoutEmbedding = totalChunksRequiringEmbedding - chunksWithEmbedding;
  
  const hasNoChunks = chunks.length === 0;
  const isLikelyPreviewOnly = document.fileSize > 100000 && chunks.length <= 1 && document.contentPreview.length < 1000;

  if (loading) {
    return <div className="text-xs text-gray-500">加载中...</div>;
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <div className="flex flex-col gap-1 text-xs text-gray-500 mb-2">
        <div className="flex items-center justify-between">
          <span>Embedding 状态:</span>
          <span className={hasNoChunks ? 'text-red-600' : chunksWithoutEmbedding === 0 ? (isLikelyPreviewOnly ? 'text-orange-600' : 'text-green-600') : 'text-orange-600'}>
            {hasNoChunks ? '无 chunks' : `${chunksWithEmbedding}/${totalChunksRequiringEmbedding} 已生成${isLikelyPreviewOnly ? ' (仅预览)' : ''}`}
          </span>
        </div>
        
        {/* 显示结构统计 */}
        {!hasNoChunks && (
          <div className="flex items-center justify-between border-t border-gray-100 pt-1 mt-1">
            <span>结构统计:</span>
            <span className="text-gray-600">
              {parentChunksCount > 0 ? (
                <>
                  <span className="text-purple-600">{parentChunksCount} 父</span>
                  <span className="mx-1">/</span>
                  <span className="text-green-600">{childChunksCount} 子</span>
                  {normalChunksCount > 0 && <span className="text-gray-400"> ({normalChunksCount} 普通)</span>}
                </>
              ) : (
                <span>{normalChunksCount} 普通片段</span>
              )}
            </span>
          </div>
        )}
        
        {/* 显示父块说明 */}
        {parentChunksCount > 0 && (
          <div className="text-[10px] text-gray-400 mt-1">
            * 父块仅作上下文，不参与 Embedding 索引
          </div>
        )}
      </div>
      
      {/* 任务进度显示 */}
      {task && task.status === 'processing' && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
            <span>正在生成 Embedding...</span>
            <span>{task.current}/{task.total} ({taskProgress}%)</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${taskProgress}%` }}
            />
          </div>
        </div>
      )}
      
      {task && task.status === 'completed' && (
        <div className="mb-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
          ✓ Embedding 生成完成！成功: {task.result?.successCount || 0}, 失败: {task.result?.failCount || 0}
        </div>
      )}
      
      {task && task.status === 'failed' && (
        <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          ✗ Embedding 生成失败: {task.error}
        </div>
      )}
      {isLikelyPreviewOnly && (
        <div className="mb-2 p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-700">
          ⚠️ 此文档可能只有预览内容（{document.contentPreview.length} 字符），建议删除后重新上传完整文件以获得更好的检索效果
        </div>
      )}
      {hasNoChunks ? (
        <button
          onClick={onReprocess}
          disabled={isRegenerating}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
          {isRegenerating ? '处理中...' : '重新处理文档'}
        </button>
      ) : chunksWithoutEmbedding > 0 && (
        <button
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
          {isRegenerating ? '生成中...' : '重新生成 Embedding'}
        </button>
      )}
    </div>
  );
};

export default DocumentChunksStatus;
