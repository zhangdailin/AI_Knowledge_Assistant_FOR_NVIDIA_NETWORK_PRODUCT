import React, { useState, useRef, useEffect } from 'react';
import { FileDown, Link as LinkIcon } from 'lucide-react';

function getApiServerUrl(): string {
  const customUrl = localStorage.getItem('custom_api_server_url');
  if (customUrl) return customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  return `${protocol}//${hostname}:8787`;
}

const NvidiaDocPdfTool: React.FC = () => {
  const [url, setUrl] = useState('https://docs.nvidia.com/networking-ethernet-software/cumulus-linux-59/pdf/');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'pending' | 'processing' | 'completed' | 'failed'>('idle');
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) {
        window.clearTimeout(pollTimer.current);
      }
    };
  }, []);

  const resetState = () => {
    setError('');
    setSuccess('');
    setProgress(0);
    setStatus('idle');
    setTaskId(null);
  };

  const stopPolling = () => {
    if (pollTimer.current) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const fetchTaskStatus = async (id: string) => {
    const res = await fetch(`${getApiServerUrl()}/api/nvidia-doc-pdf/tasks/${id}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '获取任务状态失败');
    }
    return res.json();
  };

  const downloadTask = async (id: string) => {
    const res = await fetch(`${getApiServerUrl()}/api/nvidia-doc-pdf/tasks/${id}/download`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '下载失败');
    }
    const blob = await res.blob();
    const contentDisposition = res.headers.get('content-disposition') || '';
    const match = contentDisposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || 'nvidia-doc.pdf';

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  };

  const pollTask = async (id: string) => {
    try {
      const data = await fetchTaskStatus(id);
      const task = data.task;
      setProgress(task.progress || 0);
      setStatus(task.status);

      if (task.status === 'completed') {
        stopPolling();
        await downloadTask(id);
        setSuccess('PDF 已生成并开始下载');
        setLoading(false);
        return;
      }

      if (task.status === 'failed') {
        stopPolling();
        setError(task.error || '生成失败');
        setLoading(false);
        return;
      }

      pollTimer.current = window.setTimeout(() => pollTask(id), 2000);
    } catch (err: any) {
      stopPolling();
      setError(err.message || '获取任务状态失败');
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('请输入文档链接');
      return;
    }

    setLoading(true);
    resetState();
    setStatus('pending');

    try {
      const res = await fetch(`${getApiServerUrl()}/api/nvidia-doc-pdf/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '生成失败');
      }

      const data = await res.json();
      setTaskId(data.taskId);
      setStatus('processing');
      pollTask(data.taskId);
    } catch (err: any) {
      setError(err.message || '生成失败');
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          英伟达文档链接
        </label>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 flex-1 border border-gray-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent">
            <LinkIcon className="w-4 h-4 text-gray-400" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.nvidia.com/.../pdf/"
              className="flex-1 text-sm outline-none"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <FileDown className="w-4 h-4" />
            {loading ? '生成中...' : '生成 PDF'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          支持英伟达文档站点，系统会自动优化排版并输出可下载 PDF。
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
          正在生成 PDF... {progress}%
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {success}
        </div>
      )}
    </div>
  );
};

export const pluginMeta = {
  id: 'nvidia-doc-pdf',
  name: '英伟达文档转 PDF',
  description: '将 NVIDIA 文档页面优化输出为可下载 PDF',
  icon: 'FileDown',
  version: '1.1.0'
};

export default NvidiaDocPdfTool;
