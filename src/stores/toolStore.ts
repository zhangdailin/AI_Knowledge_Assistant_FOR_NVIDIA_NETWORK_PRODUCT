import { create } from 'zustand';

export interface ToolConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggerMode: 'auto' | 'keyword' | 'manual';
}

interface ToolState {
  tools: ToolConfig[];
  loadTools: () => void;
  updateTool: (id: string, updates: Partial<ToolConfig>) => void;
  isToolEnabled: (id: string) => boolean;
}

const DEFAULT_TOOLS: ToolConfig[] = [
  {
    id: 'sn-iblf',
    name: 'SN-IBLF 查询工具',
    description: '自动识别SN号码并查询对应的IBLF交换机信息',
    enabled: true,
    triggerMode: 'auto'
  }
];

export const useToolStore = create<ToolState>((set, get) => ({
  tools: DEFAULT_TOOLS,

  loadTools: () => {
    const saved = localStorage.getItem('ai_tools_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        set({ tools: parsed });
      } catch {
        set({ tools: DEFAULT_TOOLS });
      }
    }
  },

  updateTool: (id, updates) => {
    set(state => {
      const newTools = state.tools.map(t =>
        t.id === id ? { ...t, ...updates } : t
      );
      localStorage.setItem('ai_tools_config', JSON.stringify(newTools));
      return { tools: newTools };
    });
  },

  isToolEnabled: (id) => {
    const tool = get().tools.find(t => t.id === id);
    return tool?.enabled ?? false;
  }
}));

// SN号码检测正则（先匹配候选，再做严格过滤）
export const SN_PATTERN = /\b[A-Z0-9]{10,16}\b/gi;

const isLikelySn = (value: string): boolean => {
  if (!value) return false;
  const upper = value.toUpperCase();
  const digits = upper.match(/\d/g) || [];
  const letters = upper.match(/[A-Z]/g) || [];
  if (digits.length < 2) return false;
  if (letters.length < 3) return false;
  if (/^[A-Z]+$/.test(upper)) return false;
  return true;
};

export function extractSNs(text: string): string[] {
  const matches = text.match(SN_PATTERN) || [];
  const normalized = matches
    .map(match => match.toUpperCase())
    .filter(isLikelySn);
  return [...new Set(normalized)];
}
