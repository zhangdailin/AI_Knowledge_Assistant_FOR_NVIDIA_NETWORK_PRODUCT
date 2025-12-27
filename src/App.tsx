import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useChatStore } from './stores/chatStore';
import ChatInterface from './components/ChatInterface';
import KnowledgeBase from './components/KnowledgeBase';
import ConversationHistory from './components/ConversationHistory';
import UserSettings from './components/UserSettings';
import ErrorBoundary from './components/ErrorBoundary';
import AdminLayout from './components/AdminLayout';
import SnToIblfTool from './components/SnToIblfTool';

function App() {
  const { isAuthenticated, checkAuth, user } = useAuthStore();
  const { loadConversations } = useChatStore();

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) {
      loadConversations(user.id);
    }
  }, [user]);

  return (
    <Router>
      <ErrorBoundary
        fallback={
          <div className="flex items-center justify-center h-screen">
            <div className="text-center p-8 bg-red-50 border border-red-200 rounded-lg max-w-md">
              <h2 className="text-xl font-bold text-red-800 mb-4">应用出现错误</h2>
              <p className="text-red-600 mb-4">页面加载时发生了错误，请刷新页面重试。</p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                刷新页面
              </button>
            </div>
          </div>
        }
      >
        <Routes>
          {/* 首页 - 问答页面，无导航栏 */}
          <Route 
            path="/" 
            element={
              <div className="h-screen">
                <ChatInterface />
              </div>
            } 
          />
          
          {/* 管理后台 - 包含导航栏 */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/knowledge" replace />} />
            <Route 
              path="knowledge" 
              element={
                <div className="h-full">
                  <KnowledgeBase />
                </div>
              } 
            />
            <Route 
              path="history" 
              element={
                <div className="h-full">
                  <ConversationHistory />
                </div>
              } 
            />
            <Route
              path="settings"
              element={
                <div className="h-full">
                  <UserSettings />
                </div>
              }
            />
            <Route
              path="sn-iblf"
              element={
                <div className="h-full overflow-auto">
                  <SnToIblfTool />
                </div>
              }
            />
          </Route>
          
          {/* 重定向旧路由到新路由 */}
          <Route path="/knowledge" element={<Navigate to="/admin/knowledge" replace />} />
          <Route path="/history" element={<Navigate to="/admin/history" replace />} />
          <Route path="/settings" element={<Navigate to="/admin/settings" replace />} />
        </Routes>
      </ErrorBoundary>
    </Router>
  );
}

export default App;
