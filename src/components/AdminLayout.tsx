import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, History, Settings, Home, Wrench,
  ChevronLeft, ChevronRight, Bot, LogOut, User, Bell, Cpu
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

const AdminLayout: React.FC = () => {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuthStore();

  const navItems = [
    { path: '/admin/dashboard', label: '仪表盘', icon: LayoutDashboard },
    { path: '/admin/knowledge', label: '知识库', icon: FolderOpen },
    { path: '/admin/tools', label: 'AI工具', icon: Wrench },
    { path: '/admin/history', label: '历史记录', icon: History },
    { path: '/admin/models', label: '模型管理', icon: Cpu },
    { path: '/admin/settings', label: '设置', icon: Settings },
  ];

  return (
    <div className="h-screen bg-gray-50 flex overflow-hidden">
      {/* 侧边栏 */}
      <div
        className={`${
          collapsed ? 'w-20' : 'w-64'
        } bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col transition-all duration-300 ease-in-out`}
      >
        {/* Logo区域 */}
        <div className="p-4 border-b border-slate-700/50">
          <Link
            to="/"
            className="flex items-center gap-3 text-white hover:opacity-90 transition-opacity"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Bot className="w-6 h-6 text-white" />
            </div>
            {!collapsed && (
              <div className="overflow-hidden">
                <h1 className="font-bold text-lg leading-tight">AI知识助手</h1>
                <p className="text-xs text-slate-400">Enterprise Edition</p>
              </div>
            )}
          </Link>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                  isActive
                    ? 'bg-indigo-500/20 text-indigo-400 shadow-lg shadow-indigo-500/10'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
                title={collapsed ? item.label : undefined}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-indigo-400' : 'group-hover:text-white'}`} />
                {!collapsed && (
                  <span className="font-medium text-sm">{item.label}</span>
                )}
                {isActive && !collapsed && (
                  <div className="ml-auto w-1.5 h-1.5 bg-indigo-400 rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* 返回对话入口 */}
        <div className="p-3 border-t border-slate-700/50">
          <Link
            to="/"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all duration-200 ${
              collapsed ? 'justify-center' : ''
            }`}
            title={collapsed ? '返回对话' : undefined}
          >
            <Home className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="font-medium text-sm">返回对话</span>}
          </Link>
        </div>

        {/* 折叠按钮 */}
        <div className="p-3 border-t border-slate-700/50">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all duration-200"
          >
            {collapsed ? (
              <ChevronRight className="w-5 h-5" />
            ) : (
              <>
                <ChevronLeft className="w-5 h-5" />
                <span className="text-sm">收起菜单</span>
              </>
            )}
          </button>
        </div>

        {/* 版本信息 */}
        {!collapsed && (
          <div className="p-4 text-center">
            <span className="text-xs text-slate-500">v1.0.0 · Enterprise</span>
          </div>
        )}
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {navItems.find(item => item.path === location.pathname)?.label || '管理后台'}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {/* 通知按钮 - 暂无通知系统 */}
            <button className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors" title="暂无通知">
              <Bell className="w-5 h-5" />
            </button>

            {/* 用户菜单 - 使用真实用户信息 */}
            <div className="flex items-center gap-3 pl-3 border-l border-gray-200">
              <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-white" />
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-gray-900">{user?.name || '用户'}</p>
                <p className="text-xs text-gray-500">{user?.email || ''}</p>
              </div>
            </div>
          </div>
        </header>

        {/* 内容区域 */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
