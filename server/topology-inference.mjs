/**
 * 构建连接图 (从portMap提取邻接关系)
 */
function buildConnectionGraph(portMap) {
    const graph = new Map(); // device -> Set<neighbor devices>
    const degrees = new Map(); // device -> connection count

    for (const [key, value] of portMap.entries()) {
        const [device] = key.split('|');
        const peer = value.peer;

        if (!device || !peer) continue;

        // 初始化设备
        if (!graph.has(device)) {
            graph.set(device, new Set());
            degrees.set(device, 0);
        }
        if (!graph.has(peer)) {
            graph.set(peer, new Set());
            degrees.set(peer, 0);
        }

        // 添加双向连接
        graph.get(device).add(peer);
        graph.get(peer).add(device);
        degrees.set(device, degrees.get(device) + 1);
        degrees.set(peer, degrees.get(peer) + 1);
    }

    return { graph, degrees };
}

/**
 * 基于拓扑连接推断层级 (命名无关算法)
 * 原理: Spine-Leaf架构中,Leaf度数小且只连Spine,Spine连Core+Leaf,Core度数大
 */
function inferLayersFromTopology(portMap) {
    const { graph, degrees } = buildConnectionGraph(portMap);
    const devices = Array.from(graph.keys());

    if (devices.length === 0) {
        return { layers: { core: [], spine: [], leaf: [] }, confidence: 0, method: 'topology-inference-failed' };
    }

    const layers = { core: [], spine: [], leaf: [] };
    const assigned = new Set();

    // 计算度数统计
    const degreeList = devices.map(d => degrees.get(d));
    const avgDegree = degreeList.reduce((a, b) => a + b, 0) / devices.length;
    const minDegree = Math.min(...degreeList);
    const maxDegree = Math.max(...degreeList);

    console.log(`[TopoInfer] 设备总数: ${devices.length}, 度数范围: ${minDegree}-${maxDegree}, 平均: ${avgDegree.toFixed(1)}`);

    // Step 1: 识别Leaf候选 (度数最小的设备组)
    const leafThreshold = avgDegree * 0.6; // 小于平均度数60%的为Leaf候选
    const leafCandidates = devices.filter(d => degrees.get(d) <= leafThreshold);

    // Step 2: 收集Leaf的所有邻居作为Spine候选
    const spineSet = new Set();
    for (const leaf of leafCandidates) {
        const neighbors = graph.get(leaf);
        for (const neighbor of neighbors) {
            spineSet.add(neighbor);
        }
    }

    // Step 3: 验证Leaf候选 (Leaf之间不应该直连)
    let leafValid = true;
    for (const leaf of leafCandidates) {
        const neighbors = graph.get(leaf);
        for (const neighbor of neighbors) {
            if (leafCandidates.includes(neighbor)) {
                leafValid = false;
                break;
            }
        }
        if (!leafValid) break;
    }

    // Step 4: 如果验证通过,确认Leaf和Spine
    if (leafValid && leafCandidates.length > 0) {
        layers.leaf.push(...leafCandidates);
        leafCandidates.forEach(d => assigned.add(d));

        // 确认Spine: 连接到多个Leaf的设备
        const spineCandidates = Array.from(spineSet).filter(d => !assigned.has(d));
        for (const spine of spineCandidates) {
            const neighbors = graph.get(spine);
            const leafConnections = [...neighbors].filter(n => layers.leaf.includes(n));

            if (leafConnections.length >= 1) { // 至少连接1个Leaf (降低阈值以适应小规模拓扑)
                layers.spine.push(spine);
                assigned.add(spine);
            }
        }
    } else {
        console.log('[TopoInfer] Leaf验证失败,Leaf之间存在直连,可能不是标准Spine-Leaf拓扑');
    }

    // Step 5: 剩余设备根据度数和连接关系分配
    for (const device of devices) {
        if (assigned.has(device)) continue;

        const degree = degrees.get(device);
        const neighbors = graph.get(device);
        const spineConnections = [...neighbors].filter(n => layers.spine.includes(n));
        const leafConnections = [...neighbors].filter(n => layers.leaf.includes(n));

        // 连接Spine的很可能是Core
        if (spineConnections.length > 0 && degree >= avgDegree) {
            layers.core.push(device);
        }
        // 连接Core/Spine的中等度数设备可能是Spine
        else if (degree >= avgDegree * 0.8 && (spineConnections.length > 0 || leafConnections.length > 0)) {
            layers.spine.push(device);
        }
        // 其他低度数设备归为Leaf
        else {
            layers.leaf.push(device);
        }
    }

    console.log(`[TopoInfer] 推断结果: Core=${layers.core.length}, Spine=${layers.spine.length}, Leaf=${layers.leaf.length}`);

    // 计算置信度
    const confidence = calculateInferenceConfidence(layers, graph, degrees);

    return {
        layers,
        confidence,
        method: 'topology-inference',
        stats: {
            totalDevices: devices.length,
            avgDegree: avgDegree.toFixed(1),
            degreeRange: `${minDegree}-${maxDegree}`
        }
    };
}

/**
 * 计算拓扑推断的置信度
 */
function calculateInferenceConfidence(layers, graph, degrees) {
    let score = 0;
    let checks = 0;

    // 检查1: Leaf不应该互连
    if (layers.leaf.length > 0) {
        let leafIsolated = 0;
        for (const leaf of layers.leaf) {
            const neighbors = graph.get(leaf);
            const leafNeighbors = [...neighbors].filter(n => layers.leaf.includes(n));
            if (leafNeighbors.length === 0) leafIsolated++;
            checks++;
        }
        score += leafIsolated;
    }

    // 检查2: Spine应该连接Core和/或Leaf
    if (layers.spine.length > 0) {
        let spineValid = 0;
        for (const spine of layers.spine) {
            const neighbors = graph.get(spine);
            const hasCore = [...neighbors].some(n => layers.core.includes(n));
            const hasLeaf = [...neighbors].some(n => layers.leaf.includes(n));
            if (hasCore || hasLeaf) spineValid++;
            checks++;
        }
        score += spineValid;
    }

    // 检查3: Core应该只连Spine (不连Leaf)
    if (layers.core.length > 0) {
        let coreValid = 0;
        for (const core of layers.core) {
            const neighbors = graph.get(core);
            const hasLeaf = [...neighbors].some(n => layers.leaf.includes(n));
            if (!hasLeaf) coreValid++;
            checks++;
        }
        score += coreValid;
    }

    // 检查4: 层级完整性 (三层都存在)
    if (layers.core.length > 0 && layers.spine.length > 0 && layers.leaf.length > 0) {
        score += 2;
        checks += 2;
    } else if (layers.spine.length > 0 && layers.leaf.length > 0) {
        // 两层拓扑也可以接受
        score += 1;
        checks += 1;
    }

    const confidence = checks > 0 ? score / checks : 0;
    console.log(`[TopoInfer] 置信度: ${(confidence * 100).toFixed(1)}% (${score}/${checks} 检查通过)`);

    return confidence;
}

export { buildConnectionGraph, inferLayersFromTopology, calculateInferenceConfidence };
