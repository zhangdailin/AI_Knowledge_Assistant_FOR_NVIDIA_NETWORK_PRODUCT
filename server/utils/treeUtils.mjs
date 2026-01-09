/**
 * 树结构遍历和查询工具
 */

/**
 * 在树中查找满足条件的节点（深度优先搜索）
 * @param {Array} nodes - 树节点数组
 * @param {Function} predicate - 判断函数 (node) => boolean
 * @param {string} childrenKey - 子节点的键名，默认为 'children'
 * @returns {Object|null} - 找到的节点或null
 */
export function findInTree(nodes, predicate, childrenKey = 'children') {
  if (!Array.isArray(nodes)) return null;

  for (const node of nodes) {
    // 检查当前节点
    if (predicate(node)) {
      return node;
    }

    // 递归检查子节点
    if (node[childrenKey] && Array.isArray(node[childrenKey])) {
      const found = findInTree(node[childrenKey], predicate, childrenKey);
      if (found) return found;
    }
  }

  return null;
}

/**
 * 根据ID查找节点
 * @param {Array} nodes - 树节点数组
 * @param {string} id - 节点ID
 * @param {string} idKey - ID字段名，默认为 'id'
 * @param {string} childrenKey - 子节点的键名，默认为 'children'
 * @returns {Object|null} - 找到的节点或null
 */
export function findById(nodes, id, idKey = 'id', childrenKey = 'children') {
  return findInTree(nodes, node => node[idKey] === id, childrenKey);
}

/**
 * 根据名称查找节点
 * @param {Array} nodes - 树节点数组
 * @param {string} name - 节点名称
 * @param {string} nameKey - 名称字段名，默认为 'name'
 * @param {string} childrenKey - 子节点的键名，默认为 'children'
 * @returns {Object|null} - 找到的节点或null
 */
export function findByName(nodes, name, nameKey = 'name', childrenKey = 'children') {
  return findInTree(nodes, node => node[nameKey] === name, childrenKey);
}

/**
 * 查找所有满足条件的节点
 * @param {Array} nodes - 树节点数组
 * @param {Function} predicate - 判断函数 (node) => boolean
 * @param {string} childrenKey - 子节点的键名，默认为 'children'
 * @returns {Array} - 找到的所有节点
 */
export function findAllInTree(nodes, predicate, childrenKey = 'children') {
  if (!Array.isArray(nodes)) return [];

  const results = [];

  for (const node of nodes) {
    if (predicate(node)) {
      results.push(node);
    }

    if (node[childrenKey] && Array.isArray(node[childrenKey])) {
      const childResults = findAllInTree(node[childrenKey], predicate, childrenKey);
      results.push(...childResults);
    }
  }

  return results;
}

/**
 * 遍历树的所有节点（深度优先）
 * @param {Array} nodes - 树节点数组
 * @param {Function} callback - 回调函数 (node, depth, parent) => void
 * @param {string} childrenKey - 子节点的键名，默认为 'children'
 * @param {number} depth - 当前深度（内部使用）
 * @param {Object} parent - 父节点（内部使用）
 */
export function traverseTree(nodes, callback, childrenKey = 'children', depth = 0, parent = null) {
  if (!Array.isArray(nodes)) return;

  for (const node of nodes) {
    callback(node, depth, parent);

    if (node[childrenKey] && Array.isArray(node[childrenKey])) {
      traverseTree(node[childrenKey], callback, childrenKey, depth + 1, node);
    }
  }
}

/**
 * 将树转换为扁平数组
 * @param {Array} nodes - 树节点数组
 * @param {string} childrenKey - 子节点的键名，默认为 'children'
 * @returns {Array} - 扁平化的节点数组
 */
export function flattenTree(nodes, childrenKey = 'children') {
  const result = [];
  traverseTree(nodes, (node) => result.push(node), childrenKey);
  return result;
}

/**
 * 获取节点的路径（从根到该节点）
 * @param {Array} nodes - 树节点数组
 * @param {Function} predicate - 判断函数 (node) => boolean
 * @param {string} childrenKey - 子节点的键名，默认为 'children'
 * @returns {Array|null} - 节点路径数组或null
 */
export function getNodePath(nodes, predicate, childrenKey = 'children') {
  if (!Array.isArray(nodes)) return null;

  for (const node of nodes) {
    if (predicate(node)) {
      return [node];
    }

    if (node[childrenKey] && Array.isArray(node[childrenKey])) {
      const childPath = getNodePath(node[childrenKey], predicate, childrenKey);
      if (childPath) {
        return [node, ...childPath];
      }
    }
  }

  return null;
}

/**
 * 根据ID获取节点路径
 * @param {Array} nodes - 树节点数组
 * @param {string} id - 节点ID
 * @param {string} idKey - ID字段名，默认为 'id'
 * @param {string} childrenKey - 子节点的键名，默认为 'children'
 * @returns {Array|null} - 节点路径数组或null
 */
export function getPathById(nodes, id, idKey = 'id', childrenKey = 'children') {
  return getNodePath(nodes, node => node[idKey] === id, childrenKey);
}

/**
 * 计算树的最大深度
 * @param {Array} nodes - 树节点数组
 * @param {string} childrenKey - 子节点的键名，默认为 'children'
 * @returns {number} - 树的最大深度
 */
export function getTreeDepth(nodes, childrenKey = 'children') {
  if (!Array.isArray(nodes) || nodes.length === 0) return 0;

  let maxDepth = 1;

  for (const node of nodes) {
    if (node[childrenKey] && Array.isArray(node[childrenKey])) {
      const childDepth = getTreeDepth(node[childrenKey], childrenKey);
      maxDepth = Math.max(maxDepth, childDepth + 1);
    }
  }

  return maxDepth;
}

/**
 * 统计树中的节点数量
 * @param {Array} nodes - 树节点数组
 * @param {string} childrenKey - 子节点的键名，默认为 'children'
 * @returns {number} - 节点总数
 */
export function countNodes(nodes, childrenKey = 'children') {
  if (!Array.isArray(nodes)) return 0;

  let count = nodes.length;

  for (const node of nodes) {
    if (node[childrenKey] && Array.isArray(node[childrenKey])) {
      count += countNodes(node[childrenKey], childrenKey);
    }
  }

  return count;
}

/**
 * 过滤树（返回满足条件的节点及其祖先）
 * @param {Array} nodes - 树节点数组
 * @param {Function} predicate - 判断函数 (node) => boolean
 * @param {string} childrenKey - 子节点的键名，默认为 'children'
 * @returns {Array} - 过滤后的树
 */
export function filterTree(nodes, predicate, childrenKey = 'children') {
  if (!Array.isArray(nodes)) return [];

  const result = [];

  for (const node of nodes) {
    const matchesPredicate = predicate(node);
    const filteredChildren = node[childrenKey]
      ? filterTree(node[childrenKey], predicate, childrenKey)
      : [];

    // 如果节点本身匹配，或者有匹配的子节点，则保留该节点
    if (matchesPredicate || filteredChildren.length > 0) {
      const newNode = { ...node };
      if (filteredChildren.length > 0) {
        newNode[childrenKey] = filteredChildren;
      } else if (newNode[childrenKey]) {
        // 如果节点本身匹配但没有匹配的子节点，移除children属性
        delete newNode[childrenKey];
      }
      result.push(newNode);
    }
  }

  return result;
}
