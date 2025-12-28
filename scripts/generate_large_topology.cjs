const fs = require('fs');
const path = require('path');

// 目标：生成大约 2500 个节点的拓扑，触发 Cytoscape 模式
// 结构：
// Core: 8 台
// PODs: 50 个
// 每个 POD: 4 台 Spine, 48 台 Leaf
// 总计: 8 + 50 * (4 + 48) = 8 + 50 * 52 = 2608 台设备

const NUM_PODS = 50;
const SPINES_PER_POD = 4;
const LEAFS_PER_POD = 48;
const NUM_CORE = 8;

let csv = 'System,Port,Peer Node,Peer Port\n';

// Core Switches
const coreSwitches = [];
for (let i = 1; i <= NUM_CORE; i++) {
    coreSwitches.push(`IBCR0${i}`);
}

console.log(`Generating topology with ${NUM_PODS} PODs...`);

// Generate PODs
for (let p = 1; p <= NUM_PODS; p++) {
    const podId = String(p).padStart(2, '0');
    const podName = `POD${podId}`;
    const spines = [];

    // Create Spines
    for (let s = 1; s <= SPINES_PER_POD; s++) {
        const spineName = `${podName}-IBSP0${s}`;
        spines.push(spineName);

        // Connect Spine to All Cores
        // 每个 Spine 上连所有 Core
        coreSwitches.forEach((core, cIdx) => {
            // 写入双向连接 (模拟真实数据中可能只有一端，或者双端都有)
            // 这里只需要写一端即可，后端会自动补全
            csv += `${spineName},Uplink-C${cIdx + 1},${core},Downlink-P${podId}-S${s}\n`;
        });
    }

    // Create Leafs
    for (let l = 1; l <= LEAFS_PER_POD; l++) {
        const leafName = `${podName}-IBLF${String(l).padStart(2, '0')}`;

        // Connect Leaf to All Spines in this POD
        spines.forEach((spine, sIdx) => {
            csv += `${leafName},Uplink-S${sIdx + 1},${spine},Downlink-L${l}\n`;
        });
    }
}

const outputPath = path.join(__dirname, '../large_topology_2500.csv');
fs.writeFileSync(outputPath, csv);
console.log(`Created ${outputPath}`);
console.log(`Total nodes: ${NUM_CORE + NUM_PODS * (SPINES_PER_POD + LEAFS_PER_POD)}`);
