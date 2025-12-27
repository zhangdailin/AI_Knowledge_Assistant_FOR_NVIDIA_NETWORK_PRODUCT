import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { FolderOpen, History, Settings, Home, Search } from 'lucide-react';

const AdminLayout: React.FC = () => {
  const location = useLocation();

  const navItems = [
    { path: '/admin/knowledge', label: '知识库', icon: FolderOpen },
    { path: '/admin/history', label: '历史记录', icon: History },
    { path: '/admin/sn-iblf', label: 'SN-IBLF查询', icon: Search },
    { path: '/admin/settings', label: '设置', icon: Settings },
  ];

  return (
    <div className="h-screen bg-gray-50 flex">
      {/* 侧边栏导航 */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <Link 
            to="/" 
            className="flex items-center space-x-2 text-gray-700 hover:text-blue-600 transition-colors"
          >
            <Home className="w-5 h-5" />
            <span className="font-semibold">AI 知识助手</span>
          </Link>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center space-x-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
};

export default AdminLayout;

