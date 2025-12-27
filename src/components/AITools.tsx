import React, { useState } from 'react';
import { Search, Wrench, ChevronRight, X, Network } from 'lucide-react';

// 导入插件
import SnToIblfTool, { pluginMeta as snIblfMeta } from '../plugins/sn-iblf';
import SnAddressTool, { pluginMeta as snAddressMeta } from '../plugins/sn-address';

// 插件注册表
const plugins = [
  {
    ...snIblfMeta,
    component: SnToIblfTool
  },
  {
    ...snAddressMeta,
    component: SnAddressTool
  }
];

const AITools: React.FC = () => {
  const [activePlugin, setActivePlugin] = useState<string | null>(null);

  const ActiveComponent = activePlugin
    ? plugins.find(p => p.id === activePlugin)?.component
    : null;

  // 根据插件图标名称返回对应图标组件
  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Network': return Network;
      default: return Search;
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-full">
      <div className="max-w-6xl mx-auto">
        {/* 标题 */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">AI 工具箱</h1>
          <p className="text-sm text-gray-500 mt-1">实用工具集合，提升工作效率</p>
        </div>

        {/* 工具列表 */}
        {!activePlugin && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plugins.map(plugin => {
              const Icon = getIcon(plugin.icon);
              return (
                <button
                  key={plugin.id}
                  onClick={() => setActivePlugin(plugin.id)}
                  className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 hover:shadow-md hover:border-blue-300 transition-all text-left group"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center group-hover:bg-blue-500 transition-colors">
                      <Icon className="w-6 h-6 text-blue-600 group-hover:text-white transition-colors" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                        {plugin.name}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">{plugin.description}</p>
                      <div className="flex items-center gap-1 mt-3 text-sm text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span>打开工具</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}

            {/* 更多工具占位 */}
            <div className="bg-gray-100 rounded-xl p-6 border-2 border-dashed border-gray-300 flex items-center justify-center">
              <div className="text-center">
                <Wrench className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">更多工具开发中...</p>
              </div>
            </div>
          </div>
        )}

        {/* 活动插件 */}
        {activePlugin && ActiveComponent && (() => {
          const activePluginData = plugins.find(p => p.id === activePlugin);
          const Icon = activePluginData ? getIcon(activePluginData.icon) : Search;
          return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
              {/* 插件头部 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Icon className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">
                      {activePluginData?.name}
                    </h2>
                    <p className="text-xs text-gray-500">
                      {activePluginData?.description}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActivePlugin(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="关闭"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              {/* 插件内容 */}
              <div className="p-0">
                <ActiveComponent />
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default AITools;
