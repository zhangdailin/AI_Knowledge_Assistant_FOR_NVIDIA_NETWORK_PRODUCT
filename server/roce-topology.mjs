
/**
 * RoCE 网络拓扑分析器
 * 严格参考 Python 版本 (network_connection_analyzer.py) 实现
 * 包含: 设备类型识别, 2层路径发现, 7层布局算法, 严格排序
 */

/**
 * 识别设备类型 (参考 Python: _get_device_type)
 */
function getRoCEDeviceType(deviceName) {
    if (!deviceName) return 'other';
    const upper = deviceName.toUpperCase();

    // 严格顺序
    if (upper.includes('SOOB')) return 'soob';
    if (upper.includes('OOB')) return 'oob';
    if (upper.includes('LSW')) return 'lsw';

    // Core (CSW) - 包含同义词增强 (User requirement)
    if (upper.match(/CSW|CORE|ROUTER|BORDER|GATEWAY|-CR-/)) return 'csw';

    // Spine (SSW) - 包含同义词增强
    if (upper.match(/SSW|SPINE|AGG|-SP-/)) return 'ssw';

    // Leaf (ASW) - 包含同义词增强
    if (upper.match(/ASW|LEAF|ACCESS|TOR|-LF-/)) return 'asw';

    return 'other';
}

/**
 * 解析 RoCE 拓扑数据
 * @param {Array} data Excel 行数据数组
 */
function analyzeRoCETopology(data) {
    console.log('[RoCE Analyzer] 开始分析...');

    if (!data || data.length === 0) throw new Error('Excel数据为空');

    const firstRow = data[0];
    const keys = Object.keys(firstRow);

    // 1. 列名识别 (参考 Python: parse_connections)
    let hostnameCol = keys.find(k => k.toLowerCase().includes('hostname')) || 'Hostname';
    let ifnameCol = keys.find(k => k.toLowerCase().includes('ifname')) || 'Ifname';
    let peerNodeCol = keys.find(k => k.toLowerCase().includes('peer') && k.toLowerCase().includes('node')) || 'Peer Node';
    let peerPortCol = keys.find(k => k.toLowerCase().includes('peer') && k.toLowerCase().includes('port')) || 'Peer Port';

    console.log(`[RoCE Analyzer] 列映射: Host=${hostnameCol}, If=${ifnameCol}, Peer=${peerNodeCol}, PPort=${peerPortCol}`);

    // 2. 解析连接 (参考 Python: parse_connections)
    const connections = new Map(); // connId -> info
    const deviceConnections = new Map(); // device -> [connIds]
    const allDevices = new Set();

    // GPU 过滤正则 (参考 Python: export_html_topology + User Req)
    const gpuRegex = /GPU|COMPUTE|WORKER|NODE|HOST|SERVER|DGX|H100|A100|H800|A800|SRV|-N\d+|PSNODE/i;

    for (const row of data) {
        const hostname = String(row[hostnameCol] || '').trim();
        const ifname = String(row[ifnameCol] || '').trim();
        const peerNode = String(row[peerNodeCol] || '').trim();
        const peerPort = String(row[peerPortCol] || '').trim();

        if (!hostname || !peerNode || hostname === 'nan' || peerNode === 'nan') continue;

        // GPU 过滤
        if (gpuRegex.test(hostname) || gpuRegex.test(peerNode)) continue;

        allDevices.add(hostname);
        allDevices.add(peerNode);

        const connId = `${hostname}|${ifname}|${peerNode}|${peerPort}`;

        connections.set(connId, {
            localDevice: hostname,
            localInterface: ifname,
            peerDevice: peerNode,
            peerInterface: peerPort
        });

        if (!deviceConnections.has(hostname)) deviceConnections.set(hostname, []);
        if (!deviceConnections.has(peerNode)) deviceConnections.set(peerNode, []);
        deviceConnections.get(hostname).push(connId);
        deviceConnections.get(peerNode).push(connId);
    }

    console.log(`[RoCE Analyzer] 解析完成: ${allDevices.size} 设备, ${connections.size} 连接`);

    // 3. 发现路径 (参考 Python: discover_network_topology, max_depth=2)
    const discoveredPaths = [];

    // Python 逻辑其实只是把所有连接作为第一层路径，然后找对端作为第二层
    // 实际上我们可以简化：直接遍历所有连接，因为 connectionGraph 已经是完整的L1
    // 但为了完全匹配 "2层跳" 逻辑 (用于发现间接关系?)：
    // Python code loops over ALL devices as start_node.

    for (const startDevice of allDevices) {
        const startConns = deviceConnections.get(startDevice) || [];
        for (const connId of startConns) {
            const conn = connections.get(connId);
            // 确定对端
            const peerDevice = conn.localDevice === startDevice ? conn.peerDevice : conn.localDevice;
            if (peerDevice === startDevice) continue;

            // Path 1: A -> B
            discoveredPaths.push([startDevice, peerDevice]);

            // Path 2: A -> B -> C (L2)
            const peerConns = deviceConnections.get(peerDevice) || [];
            for (const subConnId of peerConns) {
                const subConn = connections.get(subConnId);
                const subPeer = subConn.localDevice === peerDevice ? subConn.peerDevice : subConn.localDevice;

                if (subPeer !== peerDevice && subPeer !== startDevice) {
                    discoveredPaths.push([startDevice, peerDevice, subPeer]);
                }
            }
        }
    }

    // 去重路径
    // Python logic extracts NODES and EDGES from paths.
    // So we just need the set of Edges and Nodes involved in these paths.
    const validEdges = new Set();
    const validNodes = new Set();

    for (const path of discoveredPaths) {
        for (let i = 0; i < path.length - 1; i++) {
            const a = path[i];
            const b = path[i + 1];
            validNodes.add(a);
            validNodes.add(b);
            validEdges.add([a, b].sort().join('|'));
        }
    }

    // 4. 分类和排序 (参考 Python: export_html_topology, steps 1, 2, 3)
    const devicesByType = { other: [], oob: [], soob: [], lsw: [], csw: [], ssw: [], asw: [] };

    for (const node of validNodes) {
        const type = getRoCEDeviceType(node);
        devicesByType[type].push(node);
    }

    // 默认排序
    Object.values(devicesByType).forEach(arr => arr.sort());

    // CSW 特殊排序 (Python: csw_sort_key)
    devicesByType.csw.sort((a, b) => {
        const getNum = (name) => {
            const m = name.toUpperCase().match(/CSW[-_]?0*(\d+)/);
            return m ? parseInt(m[1]) : 9999;
        };
        return getNum(a) - getNum(b);
    });

    // SSW/ASW POD排序 (Python: extract_pod_and_num)
    const podNumSort = (a, b) => {
        const getPodNum = (name) => {
            const m = name.toUpperCase().match(/POD(\d+)[^\d]*(\d{1,4})$/);
            return m ? [parseInt(m[1]), parseInt(m[2])] : [9999, 9999];
        };
        const [podA, numA] = getPodNum(a);
        const [podB, numB] = getPodNum(b);
        return podA !== podB ? podA - podB : numA - numB;
    };
    devicesByType.ssw.sort(podNumSort);
    devicesByType.asw.sort(podNumSort);

    // 5. 布局坐标计算 (参考 Python: step 4)
    // Layout: OTHER(0) -> OOB(1) -> SOOB(2) -> LSW(3) -> CSW(4) -> SSW(5) -> ASW(6)
    // Y values: [100, 200, 300, 400, 500, 700, 900]
    const layerOrder = ['other', 'oob', 'soob', 'lsw', 'csw', 'ssw', 'asw'];
    const layerYValues = [100, 200, 300, 400, 500, 700, 900];
    const layerY = {};
    const nodesByLayer = {};

    let layerIndex = 0;
    for (let i = 0; i < layerOrder.length; i++) {
        const layer = layerOrder[i];
        const devices = devicesByType[layer];

        if (devices.length > 0) {
            const y = layerYValues[i];
            layerY[layer] = y;

            // X 轴布局逻辑
            let startX, endX;
            if (layer === 'oob') { // Python: OOB Compact
                startX = 150; endX = 1850;
            } else if (layer === 'other') { // Python: OTHER
                startX = 100; endX = 1900;
            } else { // Python: Centered
                startX = 600; endX = 1400;
            }

            const gap = devices.length > 1 ? (endX - startX) / (devices.length - 1) : 0;

            nodesByLayer[layer] = devices.map((dev, idx) => {
                const podMatch = dev.match(/POD[-_]?(\d+)/i);
                const pod = podMatch ? `POD${podMatch[1]}` : undefined;
                return {
                    id: dev,
                    label: dev,
                    pod: pod,
                    x: devices.length > 1 ? startX + idx * gap : (startX + endX) / 2,
                    y: y
                };
            });

            layerIndex++; // Only increment visual layer index if layer has items?
            // Python logic: `y = layer_y[layer_index]` where `layer_index` increments ONLY if `layer_nodes` exist.
            // Wait, Python code:
            // for layer_index, layer_nodes in enumerate(layers): ... if layer_nodes: ...
            // Ah, Python uses `enumerate` on the LIST of node lists.
            // But `layer_y` is indexed by `layer_index` from enumerate.
            // So if `other` is empty, `layer_index` 0 is empty. `oob` is `layer_index` 1.
            // So Y is fixed per TYPE.
            // Wait, Python:
            // layers = [other_nodes, oob_nodes...]
            // for layer_index, layer_nodes in enumerate(layers):
            //    if layer_nodes: ly = layer_y[layer_index]
            // This means Y IS FIXED to the TYPE. (e.g. OOB is always 200).
            // My implementation above `layerYValues[i]` matches this.
        }
    }

    // 6. 构建最终连接列表 (需包含端口)
    const finalConnections = [];
    const usedEdges = new Set();

    // Python iterates `filtered_edges` (sorted tuples).
    // Node.js needs to find the port info again.
    // Iterating `validEdges` which are `A|B`.
    // We need to find ONE connection for this pair to get ports.

    // Reverse lookup helper
    // Easier: Iterate `connections` and check if in `validEdges`.
    for (const conn of connections.values()) {
        const edgeKey = [conn.localDevice, conn.peerDevice].sort().join('|');
        if (validEdges.has(edgeKey) && !usedEdges.has(edgeKey)) {
            // Check if nodes exist in final layout (should be yes unless filtered in step 4? No filtering there)
            // Python filters: `if e[0] in all_layer_nodes ...` but all_layer_nodes includes all.

            usedEdges.add(edgeKey);
            finalConnections.push({
                source: conn.localDevice,
                target: conn.peerDevice,
                srcPort: conn.localInterface,
                dstPort: conn.peerInterface
            });
        }
    }

    const activeLayers = Object.keys(nodesByLayer);

    // 7. 提取 POD 列表 (用于前端过滤)
    const podSet = new Set();
    const podRegex = /POD[-_]?(\d+)/i;
    for (const node of validNodes) {
        const match = node.match(podRegex);
        if (match) {
            podSet.add(`POD${match[1]}`);
        }
    }
    const sortedPods = Array.from(podSet).sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''));
        const numB = parseInt(b.replace(/\D/g, ''));
        return numA - numB;
    });

    console.log(`[RoCE Analyzer] 分析完成. 节点: ${validNodes.size}, 边: ${finalConnections.length}, 层级: ${activeLayers.join(', ')}, PODs: ${sortedPods.length}`);

    return {
        success: true,
        networkType: 'roce',
        nodeCount: validNodes.size,
        edgeCount: finalConnections.length,
        nodesByLayer,
        connections: finalConnections,
        layerY,
        metadata: {
            layers: activeLayers,
            pods: sortedPods,
            stats: {
                nodeCount: validNodes.size,
                edgeCount: finalConnections.length
            },
            layerDetection: 'roce-pattern-imitation'
        }
    };
}

export { analyzeRoCETopology, getRoCEDeviceType };
