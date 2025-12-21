import React, { useState, useEffect } from 'react';
import { User, Key, Bell, Shield, Palette, Save, Eye, EyeOff, Download, Upload, FileText, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { localStorageManager } from '../lib/localStorage';
import { DataBackupManager, BackupData } from '../lib/dataBackup';

interface UserSettings {
  name: string;
  email: string;
  theme: 'light' | 'dark' | 'auto';
  notifications: {
    email: boolean;
    push: boolean;
    chat: boolean;
  };
  privacy: {
    saveHistory: boolean;
    shareAnalytics: boolean;
  };
  apiKeys: {
    siliconflow?: string;
  };
}

export default function UserSettings() {
  const { user } = useAuthStore();
  const { clearHistory } = useChatStore();
  const [activeTab, setActiveTab] = useState<'profile' | 'api' | 'notifications' | 'privacy' | 'backup'>('profile');
  const [settings, setSettings] = useState<UserSettings>({
    name: '',
    email: '',
    theme: 'auto',
    notifications: {
      email: true,
      push: true,
      chat: true
    },
    privacy: {
      saveHistory: true,
      shareAnalytics: false
    },
    apiKeys: {
      siliconflow: ''
    }
  });
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    const loadSettings = async () => {
      if (user) {
        const savedSettings = localStorageManager.getUserSettings(user.id);
        const { unifiedStorageManager } = await import('../lib/localStorage');
        const serverSettings = await unifiedStorageManager.getSettings();
        
        // 确保始终包含需要的 API key 字段
        const defaultApiKeys = {
          siliconflow: ''
        };
        
        if (savedSettings) {
          const mergedApiKeys = {
            ...defaultApiKeys,
            ...(savedSettings.apiKeys || {}),
            ...(serverSettings.apiKeys || {})
          };
          // 删除不需要的字段
          delete mergedApiKeys.openai;
          delete mergedApiKeys.anthropic;
          delete mergedApiKeys.google;
          delete mergedApiKeys.openrouter;
          setSettings({
            ...savedSettings,
            apiKeys: mergedApiKeys
          });
        } else {
          const mergedApiKeys = {
            ...defaultApiKeys,
            ...(serverSettings.apiKeys || {})
          };
          // 删除不需要的字段
          delete mergedApiKeys.openai;
          delete mergedApiKeys.anthropic;
          delete mergedApiKeys.google;
          delete mergedApiKeys.openrouter;
          setSettings(prev => ({
            ...prev,
            name: user.name || '',
            email: user.email || '',
            apiKeys: mergedApiKeys
          }));
        }
      }
    };
    loadSettings();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    
    setSaveStatus('saving');
    try {
      // 保存用户个人设置到本地存储
      localStorageManager.saveUserSettings(user.id, {
        ...settings,
        // API keys 保存到服务器
        apiKeys: undefined // 不保存到本地
      });
      
      // API keys 保存到服务器（过滤掉已删除的 openai 和 anthropic）
      const { unifiedStorageManager } = await import('../lib/localStorage');
      const currentSettings = await unifiedStorageManager.getSettings();
      // 从当前设置中删除不需要的 API keys（如果存在）
      const cleanedApiKeys = { ...(currentSettings.apiKeys || {}) };
      delete cleanedApiKeys.openai;
      delete cleanedApiKeys.anthropic;
      delete cleanedApiKeys.google;
      delete cleanedApiKeys.openrouter;
      
      await unifiedStorageManager.updateSettings({
        ...currentSettings,
        apiKeys: {
          ...cleanedApiKeys,
          ...settings.apiKeys
        }
      });
      
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveStatus('idle');
    }
  };

  const handleClearHistory = async () => {
    if (confirm('确定要清除所有对话历史吗？此操作无法撤销。')) {
      clearHistory();
      alert('对话历史已清除');
    }
  };

  const toggleApiKeyVisibility = (key: string) => {
    setShowApiKeys(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const tabs = [
    { id: 'profile', label: '个人资料', icon: User },
    { id: 'api', label: 'API配置', icon: Key },
    { id: 'notifications', label: '通知设置', icon: Bell },
    { id: 'privacy', label: '隐私设置', icon: Shield },
    { id: 'backup', label: '数据备份', icon: FileText }
  ];

  return (
    <div className="h-screen bg-gray-50 flex">
      <div className="w-64 bg-white border-r border-gray-200">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">设置</h2>
          <nav className="space-y-1">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`w-full flex items-center space-x-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    activeTab === tab.id
                      ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-8">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold text-gray-900">
                  {tabs.find(tab => tab.id === activeTab)?.label}
                </h1>
                <button
                  onClick={handleSave}
                  disabled={saveStatus === 'saving'}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    saveStatus === 'saved'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {saveStatus === 'saving' ? '保存中...' : 
                     saveStatus === 'saved' ? '已保存' : '保存'}
                  </span>
                </button>
              </div>
            </div>

            <div className="p-6">
              {activeTab === 'profile' && (
                <div className="space-y-6">
                  <div className="flex items-center space-x-4 mb-6">
                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                      <User className="w-8 h-8 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-gray-900">{user?.name}</h3>
                      <p className="text-sm text-gray-500">{user?.email}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        用户名
                      </label>
                      <input
                        type="text"
                        value={settings.name}
                        onChange={(e) => setSettings(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        邮箱地址
                      </label>
                      <input
                        type="email"
                        value={settings.email}
                        onChange={(e) => setSettings(prev => ({ ...prev, email: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        主题模式
                      </label>
                      <select
                        value={settings.theme}
                        onChange={(e) => setSettings(prev => ({ ...prev, theme: e.target.value as any }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="auto">自动</option>
                        <option value="light">浅色</option>
                        <option value="dark">深色</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        用户角色
                      </label>
                      <input
                        type="text"
                        value={user?.role === 'admin' ? '管理员' : '普通用户'}
                        disabled
                        className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'api' && (
                <div className="space-y-6">
                  <div className="space-y-4">
                    {(() => {
                      const allApiKeysEntries = Object.entries(settings.apiKeys || {});
                      const apiKeysEntries = allApiKeysEntries.filter(([provider]) => 
                        provider !== 'openai' && provider !== 'anthropic'
                      );
                      return apiKeysEntries.map(([provider, key]) => (
                        <div key={provider}>
                          <label className="block text-sm font-medium text-gray-700 mb-2 capitalize">
                            {provider === 'siliconflow' ? 'SiliconFlow API Key' :
                             'API Key'}
                          </label>
                          <div className="relative">
                            <input
                              type={showApiKeys[provider] ? 'text' : 'password'}
                              value={key}
                              onChange={(e) => setSettings(prev => ({
                                ...prev,
                                apiKeys: { ...prev.apiKeys, [provider]: e.target.value }
                              }))}
                              placeholder={`输入您的${provider} API密钥`}
                              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                              type="button"
                              onClick={() => toggleApiKeyVisibility(provider)}
                              className="absolute inset-y-0 right-0 pr-3 flex items-center"
                            >
                              {showApiKeys[provider] ? (
                                <EyeOff className="w-4 h-4 text-gray-400" />
                              ) : (
                                <Eye className="w-4 h-4 text-gray-400" />
                              )}
                            </button>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}

              {activeTab === 'notifications' && (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">邮件通知</h4>
                        <p className="text-sm text-gray-500">接收重要更新和系统通知</p>
                      </div>
                      <button
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          notifications: { ...prev.notifications, email: !prev.notifications.email }
                        }))}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          settings.notifications.email ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          settings.notifications.email ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">推送通知</h4>
                        <p className="text-sm text-gray-500">浏览器推送消息提醒</p>
                      </div>
                      <button
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          notifications: { ...prev.notifications, push: !prev.notifications.push }
                        }))}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          settings.notifications.push ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          settings.notifications.push ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">聊天通知</h4>
                        <p className="text-sm text-gray-500">新消息到达时提醒</p>
                      </div>
                      <button
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          notifications: { ...prev.notifications, chat: !prev.notifications.chat }
                        }))}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          settings.notifications.chat ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          settings.notifications.chat ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'privacy' && (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">保存对话历史</h4>
                        <p className="text-sm text-gray-500">自动保存聊天记录到本地</p>
                      </div>
                      <button
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          privacy: { ...prev.privacy, saveHistory: !prev.privacy.saveHistory }
                        }))}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          settings.privacy.saveHistory ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          settings.privacy.saveHistory ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">分享使用分析</h4>
                        <p className="text-sm text-gray-500">匿名分享使用数据以改进服务</p>
                      </div>
                      <button
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          privacy: { ...prev.privacy, shareAnalytics: !prev.privacy.shareAnalytics }
                        }))}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          settings.privacy.shareAnalytics ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          settings.privacy.shareAnalytics ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-gray-200">
                    <h4 className="text-sm font-medium text-gray-900 mb-4">数据管理</h4>
                    <div className="space-y-3">
                      <button
                        onClick={handleClearHistory}
                        className="w-full md:w-auto px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 transition-colors"
                      >
                        清除对话历史
                      </button>
                      <p className="text-sm text-gray-500">
                        此操作将删除所有本地保存的对话记录，无法撤销。
                      </p>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                    <div className="flex">
                      <Shield className="w-5 h-5 text-blue-400 mt-0.5" />
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-blue-800">隐私保护</h3>
                        <p className="text-sm text-blue-700 mt-1">
                          所有数据都存储在本地，我们不会收集或上传您的个人信息到服务器。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'backup' && (
                <div className="space-y-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                    <div className="flex">
                      <FileText className="w-5 h-5 text-blue-400 mt-0.5" />
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-blue-800">数据备份</h3>
                        <p className="text-sm text-blue-700 mt-1">
                          导出您的所有数据（对话历史、知识库文档、设置等）到JSON文件，或从备份文件恢复数据。
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h4 className="text-lg font-medium text-gray-900">导出数据</h4>
                      <p className="text-sm text-gray-600">
                        将您的所有数据导出为JSON文件，包括对话历史、知识库文档和用户设置。
                      </p>
                      <button
                        onClick={async () => {
                          if (!user) return;
                          try {
                            await DataBackupManager.exportUserData(user.id, user.email);
                            alert('数据导出成功！');
                          } catch (error) {
                            alert('数据导出失败：' + (error as Error).message);
                          }
                        }}
                        className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        <span>导出数据</span>
                      </button>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-lg font-medium text-gray-900">导入数据</h4>
                      <p className="text-sm text-gray-600">
                        从JSON备份文件恢复您的数据。此操作将覆盖当前数据。
                      </p>
                      <div className="space-y-3">
                        <input
                          type="file"
                          accept=".json"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !user) return;
                            
                            try {
                              const backupData = await DataBackupManager.importUserData(file);
                              const info = DataBackupManager.getBackupInfo(backupData);
                              
                              if (confirm(`确定要恢复以下备份数据吗？\n\n${info}\n\n⚠️ 此操作将覆盖当前所有数据！`)) {
                                await DataBackupManager.restoreUserData(backupData);
                                alert('数据恢复成功！请刷新页面以查看恢复的数据。');
                              }
                            } catch (error) {
                              alert('数据导入失败：' + (error as Error).message);
                            }
                          }}
                          className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                    <div className="flex">
                      <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5" />
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-yellow-800">重要提醒</h3>
                        <div className="text-sm text-yellow-700 mt-1 space-y-1">
                          <p>• 导入数据前请备份当前数据</p>
                          <p>• 导入操作不可撤销</p>
                          <p>• 确保备份文件来自可信来源</p>
                          <p>• 不同版本的备份文件可能不兼容</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-200">
                    <h4 className="text-sm font-medium text-gray-900 mb-2">备份包含的内容</h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>✓ 所有对话历史和消息记录</li>
                      <li>✓ 知识库中的文档和分块数据</li>
                      <li>✓ 用户设置和偏好配置</li>
                      <li>✓ API密钥配置（加密存储）</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}