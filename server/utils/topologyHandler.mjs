import XLSX from 'xlsx';
import * as topology from '../topology.mjs';

/**
 * 拓扑处理工具类 - 用于处理网络拓扑文件和数据
 *
 * 这个工具类抽象了4个拓扑API端点的共同逻辑：
 * - /api/topology-restore
 * - /api/topology-restore-v2
 * - /api/topology-pod-details
 * - /api/topology-search
 */

/**
 * 获取文件扩展名
 * @param {string} filename - 文件名
 * @returns {string} - 扩展名
 */
function getFileExtension(filename) {
  if (!filename) return '';
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

/**
 * 解析上传的拓扑文件（CSV或Excel）
 * @param {Buffer} fileBuffer - 文件buffer
 * @param {string} fileName - 文件名
 * @returns {Object} - 解析后的数据 { kind: 'csv'|'excel', data: ..., csvContent: ... }
 */
export function parseTopologyFile(fileBuffer, fileName) {
  const ext = getFileExtension(fileName);
  if (ext === 'csv') {
    return { kind: 'csv', csvContent: fileBuffer.toString('utf-8') };
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return { kind: 'excel', data };
  }

  throw new Error('不支持的文件类型，请上传 CSV 或 Excel');
}

/**
 * 解析CSV格式的端口映射
 * @param {string} csvContent - CSV文本内容
 * @returns {Map} - 端口映射 Map
 */
export function parseCSVPortMap(csvContent) {
  const lines = csvContent.split('\n').filter(line => line.trim());
  if (lines.length === 0) throw new Error('CSV文件为空');

  const headerLine = lines[0].replace(/^\ufeff/, '');
  const headers = headerLine.split(',').map(h => h.trim());

  const systemIdx = headers.findIndex(h => {
    const lower = h.toLowerCase();
    return lower === 'system' || lower === 'hostname';
  });
  const portIdx = headers.findIndex(h => {
    const lower = h.toLowerCase();
    return lower === 'port' || lower === 'ifname' || lower.includes('interface');
  });
  const peerNodeIdx = headers.findIndex(h => {
    const lower = h.toLowerCase();
    return lower.includes('peer') && (lower.includes('node') || lower.includes('device') || lower.includes('hostname') || lower.includes('name'));
  });
  const peerPortIdx = headers.findIndex(h => {
    const lower = h.toLowerCase();
    return lower.includes('peer') && (lower.includes('port') || lower.includes('interface'));
  });

  if (systemIdx === -1 || peerNodeIdx === -1) {
    throw new Error('CSV格式错误：需要 System 和 Peer Node 列');
  }

  const portMap = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));

    if (cols.length <= Math.max(systemIdx, peerNodeIdx)) {
      console.warn(`[CSV] 第 ${i + 1} 行列数不足，跳过此行`);
      continue;
    }

    const sys = cols[systemIdx]?.trim();
    const port = portIdx >= 0 ? cols[portIdx]?.trim() : '';
    const peer = cols[peerNodeIdx]?.trim();
    const peerPort = peerPortIdx >= 0 ? cols[peerPortIdx]?.trim() : '';

    if (!sys || !peer || sys === 'nan' || peer === 'nan') continue;
    portMap.set(`${sys}|${port}`, { peer, peerPort });
  }

  console.log(`[TopologyRestore] CSV解析完成: ${portMap.size} 条端口映射. Sample: ${Array.from(portMap.keys())[0]}`);
  return portMap;
}

/**
 * 解析Excel格式的端口映射
 * @param {Array} data - Excel数据数组
 * @returns {Map} - 端口映射 Map
 */
export function parseExcelPortMap(data) {
  const portMap = new Map();

  if (!data || data.length === 0) {
    console.warn('[ParseExcel] 数据为空');
    return portMap;
  }

  const firstRow = data[0];
  const fieldNames = Object.keys(firstRow);
  console.log(`[ParseExcel] Excel 字段名: ${fieldNames.join(', ')}`);

  const findField = (row, ...patterns) => {
    for (const pattern of patterns) {
      const key = fieldNames.find(f => f.toLowerCase().includes(pattern.toLowerCase()));
      if (key && row[key]) {
        return row[key];
      }
    }
    return null;
  };

  for (const row of data) {
    const sys = findField(row, 'Hostname', 'hostname', 'device', 'system', 'node');
    const port = findField(row, 'Ifname', 'ifname', 'interface', 'port', 'eth');
    const peer = findField(row, 'Peer Node', 'peer node', 'peer hostname', 'peer device', 'peer name', 'remote hostname');
    const peerPort = findField(row, 'Peer Port', 'peer port', 'peer interface', 'peer eth', 'remote interface');

    if (!sys || !peer) {
      if (data.indexOf(row) < 3) {
        console.log(`[ParseExcel] 跳过行 #${data.indexOf(row)}: sys=${sys || 'NULL'}, peer=${peer || 'NULL'}`);
      }
      continue;
    }

    portMap.set(`${sys}|${port || ''}`, { peer, peerPort: peerPort || '' });
  }

  console.log(`[ParseExcel] 解析完成: ${portMap.size} 条端口映射`);

  if (portMap.size === 0) {
    console.error(`[ParseExcel] 警告: 未提取到任何连接! Excel字段名: ${fieldNames.join(', ')}`);
    console.error('[ParseExcel] 请检查Excel文件是否包含: Hostname/Peer Node 列');
  }

  return portMap;
}

/**
 * 构建拓扑结构
 * @param {Map} portMap - 端口映射
 * @param {Object} options - 选项 { layerDetection, manualLayers, podExtraction, networkType }
 * @returns {Object} - 拓扑结构结果
 */
export async function buildTopologyStructure(portMap, options = {}) {
  try {
    const result = topology.buildTopologyStructure(portMap, {
      layerDetection: options.layerDetection || 'auto',
      manualLayers: options.manualLayers || null,
      podExtraction: options.podExtraction || { method: 'regex', pattern: 'POD\\\\d+' },
      networkType: options.networkType || 'ib'
    });

    if (!result || !result.success) {
      throw new Error('拓扑构建失败：' + (result?.error || '未知错误'));
    }

    return result;
  } catch (error) {
    console.error('[BuildTopology] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 拓扑文件处理管道
 * @param {Object} file - 上传的文件对象
 * @param {Object} options - 处理选项
 * @returns {Object} - 处理结果
 */
export async function processTopologyFile(file, options = {}) {
  // 1. 解析文件
  const input = parseTopologyFile(file.buffer, file.originalname);

  // 2. 解析端口映射
  const portMap = input.kind === 'csv'
    ? parseCSVPortMap(input.csvContent)
    : parseExcelPortMap(input.data);

  // 3. 构建拓扑
  const result = await buildTopologyStructure(portMap, options);

  return result;
}

/**
 * 通用拓扑API处理器
 * @param {string} operation - 操作类型 (restore|restore-v2|pod-details|search)
 * @param {Object} file - 上传的文件
 * @param {Object} params - 请求参数
 * @returns {Object} - API响应数据
 */
export async function handleTopologyOperation(operation, file, params = {}) {
  // 根据operation类型调用不同的处理逻辑
  // 但使用统一的文件解析和错误处理

  switch (operation) {
    case 'restore':
      return await handleTopologyRestore(file, params);
    case 'restore-v2':
      return await handleTopologyRestoreV2(file, params);
    case 'pod-details':
      return await handlePodDetails(file, params);
    case 'search':
      return await handleTopologySearch(file, params);
    default:
      throw new Error(`Unknown topology operation: ${operation}`);
  }
}

// 各个操作的具体实现
async function handleTopologyRestore(file, params) {
  // 参数提取
  const networkType = params.networkType || 'ib';
  const configStr = params.config;
  const config = configStr ? JSON.parse(configStr) : {};

  // 文件解析
  const input = parseTopologyFile(file.buffer, file.originalname);

  // 构建端口映射
  let result, portMap;
  if (networkType === 'ib') {
    if (input.kind === 'csv') {
      portMap = parseCSVPortMap(input.csvContent);
    } else {
      portMap = parseExcelPortMap(input.data);
    }

    // 构建拓扑结构
    result = await buildTopologyStructure(portMap, {
      layerDetection: config.layerDetection || 'auto',
      manualLayers: config.manualLayers || null,
      podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\\\d+' },
      networkType: networkType
    });
  } else if (networkType === 'roce') {
    if (input.kind === 'excel') {
      // 使用 topology 模块的 RoCE 分析功能
      result = topology.analyzeRoCETopology(input.data, config);
    } else {
      portMap = parseCSVPortMap(input.csvContent);
      result = await buildTopologyStructure(portMap, {
        layerDetection: config.layerDetection || 'auto',
        manualLayers: config.manualLayers || null,
        podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\\\d+' },
        networkType: networkType
      });
    }
  }

  // 错误处理
  if (!result || !result.success) {
    throw new Error('拓扑构建失败：' + (result?.error || '未知错误'));
  }

  return result.data;
}

async function handleTopologyRestoreV2(file, params) {
  // 参数提取
  const networkType = params.networkType || 'ib';
  const configStr = params.config;
  const config = configStr ? JSON.parse(configStr) : {};
  const isLazy = params.isLazy || false;

  // 获取响应对象以便流式传输
  const { res } = params; // Assuming res is passed in params

  // 文件解析
  const input = parseTopologyFile(file.buffer, file.originalname);

  // 构建端口映射
  let result, portMap;
  if (networkType === 'ib') {
    if (input.kind === 'csv') {
      portMap = parseCSVPortMap(input.csvContent);
    } else {
      portMap = parseExcelPortMap(input.data);
    }

    // 构建拓扑结构
    result = await buildTopologyStructure(portMap, {
      layerDetection: config.layerDetection || 'auto',
      manualLayers: config.manualLayers || null,
      podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\\\d+' },
      networkType: networkType
    });
  } else if (networkType === 'roce') {
    if (input.kind === 'excel') {
      result = topology.analyzeRoCETopology(input.data, config);
    } else {
      portMap = parseCSVPortMap(input.csvContent);
      result = await buildTopologyStructure(portMap, {
        layerDetection: config.layerDetection || 'auto',
        manualLayers: config.manualLayers || null,
        podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\\\d+' },
        networkType: networkType
      });
    }
  }

  // 错误处理
  if (!result || !result.success) {
    if (res) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: '拓扑构建失败：' + (result?.error || '未知错误') })}\n`);
      res.end();
    }
    throw new Error('拓扑构建失败：' + (result?.error || '未知错误'));
  }

  // 流式响应拓扑数据
  if (res) {
    // 决定渲染模式和 Lazy 策略
    const totalNodes = result.data.nodeCount || (result.data.nodes ? result.data.nodes.length : 0);
    let renderMode = 'reactflow';
    if (totalNodes > 2000) {
      renderMode = 'cytoscape';
    } else if (totalNodes > 1000) {
      renderMode = 'virtual-reactflow';
    }

    // 自动调整 Lazy 模式：如果节点少于 1500，强制关闭 Lazy，一次性发送所有数据
    let effectiveLazy = isLazy;
    if (effectiveLazy && totalNodes < 1500) {
      console.log(`[TopologyV2] 节点数 (${totalNodes}) 较少，自动关闭 Lazy 模式，直接全量发送。`);
      effectiveLazy = false;
    }

    console.log(`[TopologyV2] 节点数: ${totalNodes}, 模式: ${renderMode}, Final Lazy: ${effectiveLazy}`);

    // 设置响应头
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 发送元数据
    res.write(JSON.stringify({
      type: 'meta',
      data: {
        nodeCount: result.data.nodeCount || totalNodes,
        edgeCount: result.data.edgeCount || (result.data.edges ? result.data.edges.length : 0),
        renderMode,
        layers: result.data.metadata?.layers,
        pods: result.data.metadata?.pods,
        stats: result.data.metadata?.stats,
        networkType: result.data.networkType || networkType,
        isLazy: effectiveLazy,
        layerY: result.data.layerY
      }
    }) + '\n');

    // 发送所有层级节点 (动态层级)
    const allLayers = result.data.nodesByLayer ? Object.keys(result.data.nodesByLayer) : [];

    for (const layer of allLayers) {
      const nodes = result.data.nodesByLayer[layer];
      if (!nodes || nodes.length === 0) continue;

      if (effectiveLazy && layer === 'leaf') continue;

      // 分块发送节点
      const chunkSize = 500;
      for (let i = 0; i < nodes.length; i += chunkSize) {
        const chunk = nodes.slice(i, i + chunkSize);
        res.write(JSON.stringify({
          type: 'chunk',
          layer: layer,
          nodes: chunk
        }) + '\n');
        await new Promise(r => setImmediate(r));
      }
    }

    // 发送连接 (分块发送)
    const edges = result.data.connections || result.data.edges;
    if (edges && edges.length > 0) {
      let edgesToSend = edges;

      // Lazy 模式下，过滤掉连接到 leaf 的边
      if (effectiveLazy && result.data.nodesByLayer?.leaf) {
        const leafIds = new Set(result.data.nodesByLayer.leaf.map(n => n.id));
        edgesToSend = edges.filter(e => !leafIds.has(e.source) && !leafIds.has(e.target));
      }

      const chunkSize = 2000;
      for (let i = 0; i < edgesToSend.length; i += chunkSize) {
        const chunk = edgesToSend.slice(i, i + chunkSize);
        res.write(JSON.stringify({
          type: 'chunk',
          dataType: 'edges',
          items: chunk
        }) + '\n');
        await new Promise(r => setImmediate(r));
      }
    }

    // 结束响应
    res.end();
  }

  return result.data;
}

async function handlePodDetails(file, params) {
  // 参数提取
  const networkType = params.networkType || 'ib';
  const configStr = params.config;
  const config = configStr ? JSON.parse(configStr) : {};
  const podId = params.podId; // POD ID for filtering

  if (!podId) {
    throw new Error('缺少必需的参数：podId');
  }

  // 文件解析
  const input = parseTopologyFile(file.buffer, file.originalname);

  // 构建端口映射
  let result, portMap;
  if (networkType === 'ib') {
    if (input.kind === 'csv') {
      portMap = parseCSVPortMap(input.csvContent);
    } else {
      portMap = parseExcelPortMap(input.data);
    }

    // 构建拓扑结构
    result = await buildTopologyStructure(portMap, {
      layerDetection: config.layerDetection || 'auto',
      manualLayers: config.manualLayers || null,
      podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\\\d+' },
      networkType: networkType
    });
  } else if (networkType === 'roce') {
    if (input.kind === 'excel') {
      result = topology.analyzeRoCETopology(input.data, config);
    } else {
      portMap = parseCSVPortMap(input.csvContent);
      result = await buildTopologyStructure(portMap, {
        layerDetection: config.layerDetection || 'auto',
        manualLayers: config.manualLayers || null,
        podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\\\d+' },
        networkType: networkType
      });
    }
  }

  // 错误处理
  if (!result || !result.success) {
    throw new Error('拓扑构建失败：' + (result?.error || '未知错误'));
  }

  // 过滤出指定 POD 的详细信息
  const podNodes = result.data.nodes.filter(node =>
    node.podId === podId || (node.group && node.group === podId)
  );
  const podEdges = result.data.edges.filter(edge =>
    podNodes.some(node => node.id === edge.source || node.id === edge.target)
  );

  return {
    podId,
    nodes: podNodes,
    edges: podEdges,
    metadata: {
      nodeCount: podNodes.length,
      edgeCount: podEdges.length,
      ...result.metadata
    }
  };
}

async function handleTopologySearch(file, params) {
  // 参数提取
  const networkType = params.networkType || 'ib';
  const configStr = params.config;
  const config = configStr ? JSON.parse(configStr) : {};
  const query = params.query || ''; // 搜索查询字符串
  const limit = parseInt(params.limit) || 100; // 限制结果数量

  if (!query) {
    throw new Error('缺少必需的参数：query');
  }

  // 文件解析
  const input = parseTopologyFile(file.buffer, file.originalname);

  // 构建端口映射
  let result, portMap;
  if (networkType === 'ib') {
    if (input.kind === 'csv') {
      portMap = parseCSVPortMap(input.csvContent);
    } else {
      portMap = parseExcelPortMap(input.data);
    }

    // 构建拓扑结构
    result = await buildTopologyStructure(portMap, {
      layerDetection: config.layerDetection || 'auto',
      manualLayers: config.manualLayers || null,
      podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\\\d+' },
      networkType: networkType
    });
  } else if (networkType === 'roce') {
    if (input.kind === 'excel') {
      result = topology.analyzeRoCETopology(input.data, config);
    } else {
      portMap = parseCSVPortMap(input.csvContent);
      result = await buildTopologyStructure(portMap, {
        layerDetection: config.layerDetection || 'auto',
        manualLayers: config.manualLayers || null,
        podExtraction: config.podExtraction || { method: 'regex', pattern: 'POD\\\\d+' },
        networkType: networkType
      });
    }
  }

  // 错误处理
  if (!result || !result.success) {
    throw new Error('拓扑构建失败：' + (result?.error || '未知错误'));
  }

  // 在拓扑中搜索匹配的节点
  const searchResults = result.data.nodes.filter(node =>
    node.id.toLowerCase().includes(query.toLowerCase()) ||
    (node.label && node.label.toLowerCase().includes(query.toLowerCase())) ||
    (node.name && node.name.toLowerCase().includes(query.toLowerCase())) ||
    (node.hostname && node.hostname.toLowerCase().includes(query.toLowerCase())) ||
    (node.system && node.system.toLowerCase().includes(query.toLowerCase()))
  ).slice(0, limit);

  return {
    query,
    limit,
    results: searchResults,
    totalCount: result.data.nodes.length,
    matchedCount: searchResults.length,
    metadata: result.metadata
  };
}

/**
 * 使用示例：
 *
 * // 在 index.mjs 中
 * app.post('/api/topology/:operation', upload.single('file'), async (req, res) => {
 *   try {
 *     const { operation } = req.params;
 *     const file = req.file;
 *     const params = { ...req.body, ...req.query };
 *
 *     const result = await handleTopologyOperation(operation, file, params);
 *     ApiResponse.success(res, result);
 *   } catch (error) {
 *     console.error(`[Topology] ${operation} 失败:`, error);
 *     ApiResponse.internalError(res, error.message);
 *   }
 * });
 *
 * 这样可以将4个端点（约1250行代码）合并为1个端点（约30行代码）+ 工具类
 */
