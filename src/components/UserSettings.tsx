import React, { useState, useEffect } from 'react';
import { User, Bell, Shield, Save, Download, FileText, AlertTriangle, Server, Check } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { localStorageManager } from '../lib/localStorage';
import { DataBackupManager } from '../lib/dataBackup';

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
}

type TabId = 'profile' | 'server' | 'notifications' | 'privacy' | 'backup';

const tabs: { id: TabId; label: string; icon: React.ElementType; description: string }[] = [
  { id: 'profile', label: '个人资料', icon: User, description: '管理您的账户信息' },
  { id: 'server', label: '服务器', icon: Server, description: '后端服务器配置' },
  { id: 'notifications', label: '通知', icon: Bell, description: '通知偏好设置' },
  { id: 'privacy', label: '隐私', icon: Shield, description: '隐私和数据管理' },
  { id: 'backup', label: '备份', icon: FileText, description: '数据导入导出' }
];

export default function UserSettings() {
  const { user } = useAuthStore();
  const { clearHistory } = useChatStore();
  const [activeTab, setActiveTab] = useState<TabId>('profile');
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
    }
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [customServerUrl, setCustomServerUrl] = useState('');

  useEffect(() => {
    // 加载自定义服务器地址
    const savedUrl = localStorage.getItem('custom_api_server_url');
    if (savedUrl) setCustomServerUrl(savedUrl);

    const loadSettings = async () => {
      if (user) {
        const savedSettings = localStorageManager.getUserSettings(user.id);

        if (savedSettings) {
          setSettings({
            name: savedSettings.name || user.name || '',
            email: savedSettings.email || user.email || '',
            theme: savedSettings.theme || 'auto',
            notifications: savedSettings.notifications || {
              email: true,
              push: true,
              chat: true
            },
            privacy: savedSettings.privacy || {
              saveHistory: true,
              shareAnalytics: false
            }
          });
        } else {
          setSettings(prev => ({
            ...prev,
            name: user.name || '',
            email: user.email || ''
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
      // 保存自定义服务器地址
      if (customServerUrl.trim()) {
        localStorage.setItem('custom_api_server_url', customServerUrl.trim());
      } else {
        localStorage.removeItem('custom_api_server_url');
      }

      // 保存用户个人设置到本地存储
      localStorageManager.saveUserSettings(user.id, settings as unknown as Record<string, unknown>);

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

  // Toggle 组件
  const Toggle = ({ enabled, onChange }: { enabled: boolean; onChange: () => void }) => (
    <button
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-all duration-200 ${
        enabled ? 'bg-gradient-to-r from-blue-500 to-indigo-500' : 'bg-gray-200'
      }`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${
        enabled ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  );

  // 设置项组件
  const SettingItem = ({ title, description, children }: { title: string; description: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0">
      <div className="flex-1 pr-4">
        <h4 className="text-sm font-medium text-gray-900">{title}</h4>
        <p className="text-sm text-gray-500 mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* 顶部区域 */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">管理您的账户和应用偏好</p>
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 shadow-sm ${
                saveStatus === 'saved'
                  ? 'bg-green-500 text-white'
                  : saveStatus === 'saving'
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:shadow-md hover:scale-[1.02]'
              }`}
            >
              {saveStatus === 'saved' ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              <span>{saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : '保存更改'}</span>
            </button>
          </div>

          {/* 标签导航 */}
          <div className="flex gap-1 mt-4 overflow-x-auto pb-px">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-xl transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-white text-blue-600 shadow-sm border-t border-x border-gray-200/50'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/50 overflow-hidden">
          <div className="p-6 sm:p-8">
            {activeTab === 'profile' && (
              <div className="space-y-8">
                {/* 用户头像卡片 */}
                <div className="flex items-center gap-6 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl">
                  <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                    <User className="w-10 h-10 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900">{user?.name || '用户'}</h3>
                    <p className="text-gray-500">{user?.email}</p>
                    <span className={`inline-flex items-center gap-1 mt-2 px-3 py-1 text-xs font-medium rounded-full ${
                      user?.role === 'admin'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {user?.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                  </div>
                </div>

                {/* 表单 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">用户名</label>
                    <input
                      type="text"
                      value={settings.name}
                      onChange={(e) => setSettings(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">邮箱地址</label>
                    <input
                      type="email"
                      value={settings.email}
                      onChange={(e) => setSettings(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">主题模式</label>
                    <div className="flex gap-3">
                      {[
                        { value: 'auto', label: '跟随系统' },
                        { value: 'light', label: '浅色模式' },
                        { value: 'dark', label: '深色模式' }
                      ].map(option => (
                        <button
                          key={option.value}
                          onClick={() => setSettings(prev => ({ ...prev, theme: option.value as any }))}
                          className={`flex-1 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                            settings.theme === option.value
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'server' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">后端服务器配置</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">服务器地址</label>
                    <div className="relative">
                      <Server className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        value={customServerUrl}
                        onChange={(e) => setCustomServerUrl(e.target.value)}
                        placeholder="http://localhost:8787"
                        className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      />
                    </div>
                    <p className="mt-2 text-sm text-gray-500">
                      默认: <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">http://localhost:8787</code>
                    </p>
                    <p className="mt-1 text-sm text-amber-600">
                      修改后需保存并刷新页面
                    </p>
                  </div>
                </div>

                {/* 提示 */}
                <div className="flex gap-4 p-4 bg-blue-50 rounded-xl">
                  <Server className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-blue-900">API 配置已移动</h4>
                    <p className="text-sm text-blue-700 mt-1">
                      API Key 和模型配置已移动到「模型管理」页面，请在左侧导航栏中找到。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-2">
                <SettingItem title="邮件通知" description="接收重要更新和系统通知">
                  <Toggle
                    enabled={settings.notifications.email}
                    onChange={() => setSettings(prev => ({
                      ...prev,
                      notifications: { ...prev.notifications, email: !prev.notifications.email }
                    }))}
                  />
                </SettingItem>
                <SettingItem title="推送通知" description="浏览器推送消息提醒">
                  <Toggle
                    enabled={settings.notifications.push}
                    onChange={() => setSettings(prev => ({
                      ...prev,
                      notifications: { ...prev.notifications, push: !prev.notifications.push }
                    }))}
                  />
                </SettingItem>
                <SettingItem title="聊天通知" description="新消息到达时提醒">
                  <Toggle
                    enabled={settings.notifications.chat}
                    onChange={() => setSettings(prev => ({
                      ...prev,
                      notifications: { ...prev.notifications, chat: !prev.notifications.chat }
                    }))}
                  />
                </SettingItem>
              </div>
            )}

            {activeTab === 'privacy' && (
              <div className="space-y-8">
                <div className="space-y-2">
                  <SettingItem title="保存对话历史" description="自动保存聊天记录到本地">
                    <Toggle
                      enabled={settings.privacy.saveHistory}
                      onChange={() => setSettings(prev => ({
                        ...prev,
                        privacy: { ...prev.privacy, saveHistory: !prev.privacy.saveHistory }
                      }))}
                    />
                  </SettingItem>
                  <SettingItem title="分享使用分析" description="匿名分享使用数据以改进服务">
                    <Toggle
                      enabled={settings.privacy.shareAnalytics}
                      onChange={() => setSettings(prev => ({
                        ...prev,
                        privacy: { ...prev.privacy, shareAnalytics: !prev.privacy.shareAnalytics }
                      }))}
                    />
                  </SettingItem>
                </div>

                {/* 数据管理 */}
                <div className="pt-6 border-t border-gray-100">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">数据管理</h3>
                  <button
                    onClick={handleClearHistory}
                    className="px-5 py-2.5 bg-red-500 text-white text-sm font-medium rounded-xl hover:bg-red-600 transition-colors"
                  >
                    清除对话历史
                  </button>
                  <p className="mt-2 text-sm text-gray-500">此操作将删除所有本地保存的对话记录，无法撤销。</p>
                </div>

                {/* 隐私提示 */}
                <div className="flex gap-4 p-4 bg-blue-50 rounded-xl">
                  <Shield className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-blue-900">隐私保护</h4>
                    <p className="text-sm text-blue-700 mt-1">
                      所有数据都存储在本地，我们不会收集或上传您的个人信息到服务器。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'backup' && (
              <div className="space-y-8">
                {/* 说明 */}
                <div className="flex gap-4 p-4 bg-blue-50 rounded-xl">
                  <FileText className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-blue-900">数据备份</h4>
                    <p className="text-sm text-blue-700 mt-1">
                      导出您的所有数据到 JSON 文件，或从备份文件恢复数据。
                    </p>
                  </div>
                </div>

                {/* 导入导出 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-6 bg-gray-50 rounded-xl">
                    <h4 className="text-lg font-semibold text-gray-900 mb-2">导出数据</h4>
                    <p className="text-sm text-gray-600 mb-4">将所有数据导出为 JSON 文件</p>
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
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl hover:shadow-md transition-all"
                    >
                      <Download className="w-4 h-4" />
                      <span>导出数据</span>
                    </button>
                  </div>

                  <div className="p-6 bg-gray-50 rounded-xl">
                    <h4 className="text-lg font-semibold text-gray-900 mb-2">导入数据</h4>
                    <p className="text-sm text-gray-600 mb-4">从 JSON 备份文件恢复数据</p>
                    <label className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 text-gray-600 rounded-xl hover:border-blue-400 hover:text-blue-600 cursor-pointer transition-all">
                      <input
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !user) return;
                          try {
                            const backupData = await DataBackupManager.importUserData(file);
                            const info = DataBackupManager.getBackupInfo(backupData);
                            if (confirm(`确定要恢复以下备份数据吗？\n\n${info}\n\n⚠️ 此操作将覆盖当前所有数据！`)) {
                              await DataBackupManager.restoreUserData(backupData);
                              alert('数据恢复成功！请刷新页面。');
                            }
                          } catch (error) {
                            alert('数据导入失败：' + (error as Error).message);
                          }
                        }}
                      />
                      <span>选择备份文件</span>
                    </label>
                  </div>
                </div>

                {/* 警告 */}
                <div className="flex gap-4 p-4 bg-amber-50 rounded-xl">
                  <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-amber-900">重要提醒</h4>
                    <ul className="text-sm text-amber-700 mt-1 space-y-0.5">
                      <li>• 导入数据前请备份当前数据</li>
                      <li>• 导入操作不可撤销</li>
                      <li>• 确保备份文件来自可信来源</li>
                    </ul>
                  </div>
                </div>

                {/* 备份内容 */}
                <div className="pt-6 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">备份包含的内容</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>对话历史和消息</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>知识库文档</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>用户设置</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>API 密钥配置</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
