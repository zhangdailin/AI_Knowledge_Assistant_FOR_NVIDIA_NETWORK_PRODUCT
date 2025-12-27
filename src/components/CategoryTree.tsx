import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Plus, Edit2, Trash2, Check, X } from 'lucide-react';
import { Category } from '../lib/types';

interface CategoryTreeProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (parentId: string | null, name: string) => void;
  onUpdate: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  documentCounts: Record<string, number>;
}

interface TreeNodeProps {
  node: Category;
  level: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (parentId: string | null, name: string) => void;
  onUpdate: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  documentCounts: Record<string, number>;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  level,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  onDelete,
  documentCounts
}) => {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.id;
  const count = documentCounts[node.id] || 0;

  const handleSaveEdit = () => {
    if (editName.trim()) {
      onUpdate(node.id, editName.trim());
      setEditing(false);
    }
  };

  const handleAddChild = () => {
    if (newName.trim()) {
      onAdd(node.id, newName.trim());
      setNewName('');
      setAdding(false);
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${
          isSelected ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {/* 展开/折叠按钮 */}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="p-0.5 hover:bg-gray-200 rounded"
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
          ) : (
            <span className="w-4 h-4" />
          )}
        </button>

        {/* 图标 */}
        {expanded && hasChildren ? (
          <FolderOpen className="w-4 h-4 text-yellow-500" />
        ) : (
          <Folder className="w-4 h-4 text-yellow-500" />
        )}

        {/* 名称 */}
        {editing ? (
          <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="flex-1 px-2 py-0.5 text-sm border rounded"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <button onClick={handleSaveEdit} className="p-1 text-green-600 hover:bg-green-50 rounded">
              <Check className="w-3 h-3" />
            </button>
            <button onClick={() => setEditing(false)} className="p-1 text-gray-500 hover:bg-gray-100 rounded">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <span
            className="flex-1 text-sm truncate"
            onClick={() => onSelect(node.id)}
          >
            {node.name}
          </span>
        )}

        {/* 文档数量 */}
        {count > 0 && !editing && (
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {count}
          </span>
        )}

        {/* 操作按钮 */}
        {!editing && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); setAdding(true); }}
              className="p-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
              title="添加子分类"
            >
              <Plus className="w-3 h-3" />
            </button>
            {node.id !== 'default' && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditing(true); setEditName(node.name); }}
                  className="p-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                  title="编辑"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
                  className="p-1 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                  title="删除"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 添加子分类输入框 */}
      {adding && (
        <div
          className="flex items-center gap-1 px-2 py-1"
          style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }}
        >
          <Folder className="w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新分类名称"
            className="flex-1 px-2 py-0.5 text-sm border rounded"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddChild();
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <button onClick={handleAddChild} className="p-1 text-green-600 hover:bg-green-50 rounded">
            <Check className="w-3 h-3" />
          </button>
          <button onClick={() => setAdding(false)} className="p-1 text-gray-500 hover:bg-gray-100 rounded">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* 子节点 */}
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onAdd={onAdd}
              onUpdate={onUpdate}
              onDelete={onDelete}
              documentCounts={documentCounts}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const CategoryTree: React.FC<CategoryTreeProps> = ({
  categories,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  onDelete,
  documentCounts
}) => {
  const [addingRoot, setAddingRoot] = useState(false);
  const [newRootName, setNewRootName] = useState('');

  const totalCount = Object.values(documentCounts).reduce((a, b) => a + b, 0);

  const handleAddRoot = () => {
    if (newRootName.trim()) {
      onAdd(null, newRootName.trim());
      setNewRootName('');
      setAddingRoot(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 全部文档 + 添加按钮 */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`flex-1 flex items-center gap-2 px-3 py-2 cursor-pointer rounded-lg ${
            selectedId === null ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
          }`}
          onClick={() => onSelect(null)}
        >
          <FolderOpen className="w-4 h-4" />
          <span className="text-sm font-medium">全部文档</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded ml-auto">
            {totalCount}
          </span>
        </div>
        <button
          onClick={() => setAddingRoot(true)}
          className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
          title="添加分类"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* 添加根分类输入框 */}
      {addingRoot && (
        <div className="flex items-center gap-1 px-2 py-2 mb-2 bg-gray-50 rounded-lg">
          <input
            type="text"
            value={newRootName}
            onChange={(e) => setNewRootName(e.target.value)}
            placeholder="新分类名称"
            className="flex-1 px-2 py-1 text-sm border rounded"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddRoot();
              if (e.key === 'Escape') setAddingRoot(false);
            }}
          />
          <button onClick={handleAddRoot} className="p-1 text-green-600 hover:bg-green-50 rounded">
            <Check className="w-4 h-4" />
          </button>
          <button onClick={() => setAddingRoot(false)} className="p-1 text-gray-500 hover:bg-gray-100 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 分类树 */}
      <div className="flex-1 overflow-y-auto">
        {categories.map((cat) => (
          <TreeNode
            key={cat.id}
            node={cat}
            level={0}
            selectedId={selectedId}
            onSelect={onSelect}
            onAdd={onAdd}
            onUpdate={onUpdate}
            onDelete={onDelete}
            documentCounts={documentCounts}
          />
        ))}
      </div>
    </div>
  );
};

export default CategoryTree;
