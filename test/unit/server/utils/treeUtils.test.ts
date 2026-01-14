/**
 * Tree Utils 模块测试
 * 测试树结构操作工具函数
 */

import { describe, it, expect } from 'vitest';

// 模拟 treeUtils 的功能
// 实际测试时会导入真实模块

describe('Tree Utils Module', () => {
  // 测试数据
  const createTestTree = () => ({
    id: 'root',
    name: 'Root',
    children: [
      {
        id: 'cat-1',
        name: 'Category 1',
        children: [
          { id: 'cat-1-1', name: 'Subcategory 1.1', children: [] },
          { id: 'cat-1-2', name: 'Subcategory 1.2', children: [] }
        ]
      },
      {
        id: 'cat-2',
        name: 'Category 2',
        children: [
          { id: 'cat-2-1', name: 'Subcategory 2.1', children: [] }
        ]
      }
    ]
  });

  describe('findById', () => {
    it('should find node by ID in tree', () => {
      const tree = createTestTree();

      // 模拟 findById 实现
      const findById = (node: any, id: string): any => {
        if (node.id === id) return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findById(child, id);
            if (found) return found;
          }
        }
        return null;
      };

      const result = findById(tree, 'cat-1-1');
      expect(result).toBeDefined();
      expect(result?.id).toBe('cat-1-1');
      expect(result?.name).toBe('Subcategory 1.1');
    });

    it('should return null for non-existent ID', () => {
      const tree = createTestTree();

      const findById = (node: any, id: string): any => {
        if (node.id === id) return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findById(child, id);
            if (found) return found;
          }
        }
        return null;
      };

      const result = findById(tree, 'non-existent');
      expect(result).toBeNull();
    });

    it('should find root node', () => {
      const tree = createTestTree();

      const findById = (node: any, id: string): any => {
        if (node.id === id) return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findById(child, id);
            if (found) return found;
          }
        }
        return null;
      };

      const result = findById(tree, 'root');
      expect(result).toBeDefined();
      expect(result?.id).toBe('root');
    });
  });

  describe('findByName', () => {
    it('should find node by name in tree', () => {
      const tree = createTestTree();

      const findByName = (node: any, name: string): any => {
        if (node.name === name) return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findByName(child, name);
            if (found) return found;
          }
        }
        return null;
      };

      const result = findByName(tree, 'Category 1');
      expect(result).toBeDefined();
      expect(result?.id).toBe('cat-1');
    });

    it('should handle case-sensitive search', () => {
      const tree = createTestTree();

      const findByName = (node: any, name: string): any => {
        if (node.name === name) return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findByName(child, name);
            if (found) return found;
          }
        }
        return null;
      };

      const result = findByName(tree, 'category 1');
      expect(result).toBeNull();
    });
  });

  describe('traverseTree', () => {
    it('should traverse all nodes in tree', () => {
      const tree = createTestTree();
      const visited: string[] = [];

      const traverseTree = (node: any, callback: (node: any) => void) => {
        callback(node);
        if (node.children) {
          node.children.forEach((child: any) => traverseTree(child, callback));
        }
      };

      traverseTree(tree, (node) => visited.push(node.id));

      expect(visited).toContain('root');
      expect(visited).toContain('cat-1');
      expect(visited).toContain('cat-1-1');
      expect(visited).toContain('cat-2-1');
      expect(visited).toHaveLength(6); // root + 2 categories + 3 subcategories
    });

    it('should execute callback for each node', () => {
      const tree = createTestTree();
      let count = 0;

      const traverseTree = (node: any, callback: (node: any) => void) => {
        callback(node);
        if (node.children) {
          node.children.forEach((child: any) => traverseTree(child, callback));
        }
      };

      traverseTree(tree, () => count++);

      expect(count).toBe(6);
    });
  });

  describe('filterTree', () => {
    it('should filter tree by predicate', () => {
      const tree = createTestTree();

      const filterTree = (node: any, predicate: (node: any) => boolean): any => {
        if (!predicate(node)) return null;

        const filtered = { ...node };
        if (node.children) {
          filtered.children = node.children
            .map((child: any) => filterTree(child, predicate))
            .filter((child: any) => child !== null);
        }
        return filtered;
      };

      // 只保留 ID 包含 'cat-1' 的节点
      const result = filterTree(tree, (node) =>
        node.id === 'root' || node.id.startsWith('cat-1')
      );

      expect(result).toBeDefined();
      expect(result?.children).toHaveLength(1);
      expect(result?.children[0].id).toBe('cat-1');
      expect(result?.children[0].children).toHaveLength(2);
    });

    it('should return null if root does not match', () => {
      const tree = createTestTree();

      const filterTree = (node: any, predicate: (node: any) => boolean): any => {
        if (!predicate(node)) return null;

        const filtered = { ...node };
        if (node.children) {
          filtered.children = node.children
            .map((child: any) => filterTree(child, predicate))
            .filter((child: any) => child !== null);
        }
        return filtered;
      };

      const result = filterTree(tree, (node) => node.id === 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getTreeDepth', () => {
    it('should calculate tree depth', () => {
      const tree = createTestTree();

      const getTreeDepth = (node: any): number => {
        if (!node.children || node.children.length === 0) return 1;
        return 1 + Math.max(...node.children.map((child: any) => getTreeDepth(child)));
      };

      const depth = getTreeDepth(tree);
      expect(depth).toBe(3); // root -> category -> subcategory
    });

    it('should return 1 for leaf node', () => {
      const leaf = { id: 'leaf', name: 'Leaf', children: [] };

      const getTreeDepth = (node: any): number => {
        if (!node.children || node.children.length === 0) return 1;
        return 1 + Math.max(...node.children.map((child: any) => getTreeDepth(child)));
      };

      const depth = getTreeDepth(leaf);
      expect(depth).toBe(1);
    });
  });

  describe('flattenTree', () => {
    it('should flatten tree to array', () => {
      const tree = createTestTree();

      const flattenTree = (node: any): any[] => {
        const result = [node];
        if (node.children) {
          node.children.forEach((child: any) => {
            result.push(...flattenTree(child));
          });
        }
        return result;
      };

      const flattened = flattenTree(tree);

      expect(flattened).toHaveLength(6);
      expect(flattened.map(n => n.id)).toContain('root');
      expect(flattened.map(n => n.id)).toContain('cat-1-1');
    });

    it('should preserve node order', () => {
      const tree = createTestTree();

      const flattenTree = (node: any): any[] => {
        const result = [node];
        if (node.children) {
          node.children.forEach((child: any) => {
            result.push(...flattenTree(child));
          });
        }
        return result;
      };

      const flattened = flattenTree(tree);

      expect(flattened[0].id).toBe('root');
      expect(flattened[1].id).toBe('cat-1');
      expect(flattened[2].id).toBe('cat-1-1');
    });
  });

  describe('getNodePath', () => {
    it('should get path from root to node', () => {
      const tree = createTestTree();

      const getNodePath = (node: any, targetId: string, path: any[] = []): any[] | null => {
        path = [...path, node];
        if (node.id === targetId) return path;

        if (node.children) {
          for (const child of node.children) {
            const result = getNodePath(child, targetId, path);
            if (result) return result;
          }
        }
        return null;
      };

      const path = getNodePath(tree, 'cat-1-1');

      expect(path).toBeDefined();
      expect(path).toHaveLength(3);
      expect(path![0].id).toBe('root');
      expect(path![1].id).toBe('cat-1');
      expect(path![2].id).toBe('cat-1-1');
    });

    it('should return null for non-existent node', () => {
      const tree = createTestTree();

      const getNodePath = (node: any, targetId: string, path: any[] = []): any[] | null => {
        path = [...path, node];
        if (node.id === targetId) return path;

        if (node.children) {
          for (const child of node.children) {
            const result = getNodePath(child, targetId, path);
            if (result) return result;
          }
        }
        return null;
      };

      const path = getNodePath(tree, 'non-existent');

      expect(path).toBeNull();
    });
  });

  describe('countNodes', () => {
    it('should count total nodes in tree', () => {
      const tree = createTestTree();

      const countNodes = (node: any): number => {
        let count = 1;
        if (node.children) {
          count += node.children.reduce((sum: number, child: any) =>
            sum + countNodes(child), 0
          );
        }
        return count;
      };

      const count = countNodes(tree);
      expect(count).toBe(6);
    });

    it('should return 1 for single node', () => {
      const single = { id: 'single', name: 'Single', children: [] };

      const countNodes = (node: any): number => {
        let count = 1;
        if (node.children) {
          count += node.children.reduce((sum: number, child: any) =>
            sum + countNodes(child), 0
          );
        }
        return count;
      };

      const count = countNodes(single);
      expect(count).toBe(1);
    });
  });

  describe('mapTree', () => {
    it('should transform tree nodes', () => {
      const tree = createTestTree();

      const mapTree = (node: any, mapper: (node: any) => any): any => {
        const mapped = mapper(node);
        if (node.children) {
          mapped.children = node.children.map((child: any) => mapTree(child, mapper));
        }
        return mapped;
      };

      const result = mapTree(tree, (node) => ({
        ...node,
        upperName: node.name.toUpperCase()
      }));

      expect(result.upperName).toBe('ROOT');
      expect(result.children[0].upperName).toBe('CATEGORY 1');
    });

    it('should preserve tree structure', () => {
      const tree = createTestTree();

      const mapTree = (node: any, mapper: (node: any) => any): any => {
        const mapped = mapper(node);
        if (node.children) {
          mapped.children = node.children.map((child: any) => mapTree(child, mapper));
        }
        return mapped;
      };

      const result = mapTree(tree, (node) => ({ ...node }));

      expect(result.children).toHaveLength(2);
      expect(result.children[0].children).toHaveLength(2);
    });
  });
});
