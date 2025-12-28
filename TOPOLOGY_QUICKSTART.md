# 拓扑还原功能 - 快速参考指南

## 快速开始（5分钟）

### 1️⃣ 启动服务
```bash
cd server
npm install
node index.mjs
# 应看到: Extractor server listening at http://localhost:8787
```

### 2️⃣ 打开前端
访问 `http://localhost:xxxx/plugins/topology-restore`

### 3️⃣ 上传样本数据
- 文件：`test-data/ib-topology-sample.csv`
- 网络类型：IB 网络（InfiniBand）
- 配置：保持默认（自动识别）
- 点击"还原拓扑"

### 4️⃣ 验证结果
应显示：
```
成功解析 45 个节点, 80 条连接
```

并在浏览器中显示拓扑图，包含：
- 5 个 Core 层设备（红色，顶部）
- 10 个 Spine 层设备（蓝色，中部）
- 30 个 Leaf 层设备（绿色，底部）

---

## 功能速查表

| 功能 | 操作 | 预期结果 |
|------|------|---------|
| **加载拓扑** | 上传CSV/Excel文件 → 点击"还原拓扑" | 显示拓扑图和统计信息 |
| **切换POD** | 从"ALL"改为"POD1" | 拓扑重新过滤，仅显示POD1设备 |
| **隐藏层级** | 取消选中"SPINE"复选框 | 拓扑重新渲染，Spine层消失 |
| **搜索设备** | 输入"IBLF-POD1-001" → Enter | 设备被高亮标记（红色边框） |
| **查看设备详情** | 点击拓扑中的节点 | 右侧显示设备信息和连接关系 |
| **查看连接详情** | 点击拓扑中的连接线 | 右侧显示源设备、目标设备、端口信息 |
| **重新渲染** | 点击刷新按钮（↻） | 拓扑按当前设置重新绘制 |
| **自定义识别** | 配置 → 手动配置 → 输入正则 | 使用自定义规则识别层级 |

---

## 常见问题速解

### ❓ 拓扑不显示
**检查清单：**
- [ ] 服务器是否运行（`curl http://localhost:8787/api/settings`）
- [ ] 文件格式是否正确（CSV 或 Excel）
- [ ] 浏览器控制台是否有错误（F12 → Console）
- [ ] 网络请求是否成功（F12 → Network → 查找 topology-restore）

**诊断命令：**
```javascript
// 在浏览器控制台执行
console.log('nodesByLayer:', restoreResult.nodesByLayer);
console.log('connections:', restoreResult.connections);
console.log('nodes:', nodes);
```

### ❓ POD 选择器不显示
**原因：** 数据文件中没有 POD 信息

**解决：** 确保设备名称包含 "POD" 标识，如 "IBSP-POD1-001"

### ❓ 搜索找不到设备
**检查：**
- 设备名称大小写是否正确
- 是否输入了完整的设备 ID
- 该设备是否在当前可见的层级中

### ❓ 连接线不显示
**检查：**
- 源和目标节点是否都显示
- 节点 ID 大小写是否匹配
- 连接数据（connections）是否正确

---

## 文件位置速查

| 文件 | 位置 | 用途 |
|------|------|------|
| **前端组件** | `src/plugins/topology-restore/index.tsx` | 拓扑界面和交互 |
| **后端API** | `server/index.mjs` → `/api/topology-restore` | 拓扑解析和处理 |
| **拓扑框架** | `server/topology.mjs` | 通用CLOS拓扑算法 |
| **测试数据** | `test-data/ib-topology-sample.csv` | IB网络样本 |
| **测试指南** | `TOPOLOGY_TESTING.md` | 完整测试说明 |
| **诊断指南** | `TOPOLOGY_NO_DISPLAY_DEBUG.md` | 故障排查步骤 |

---

## 关键代码位置

### 前端坐标计算（解决不显示问题）
```
src/plugins/topology-restore/index.tsx:203-241
```

### 后端拓扑解析
```
server/index.mjs:1658-1709
```

### 层级检测算法
```
server/topology.mjs:12-65
```

### POD提取算法
```
server/topology.mjs:70-120
```

---

## 浏览器控制台快速诊断

### 检查API响应结构
```javascript
console.log('API Response:', restoreResult);
console.log('Nodes by Layer:', restoreResult.nodesByLayer);
console.log('Connections:', restoreResult.connections);
console.log('Metadata:', restoreResult.metadata);
```

### 检查前端渲染状态
```javascript
console.log('Frontend Nodes:', nodes);
console.log('Frontend Edges:', edges);
console.log('Layer Visibility:', layerVisibility);
console.log('Selected POD:', selectedPod);
```

### 手动调用buildTopology
```javascript
// （需要在组件内或有权访问这些变量的地方执行）
buildTopology(restoreResult, 'ALL', {core: true, spine: true, leaf: true});
```

---

## 配置选项参考

### 层级检测方法
- **自动识别**：基于节点度数分析（推荐）
- **手动配置**：输入自定义正则表达式

### POD 分组方式
- **正则表达式匹配**：`POD\d+` （默认）
- **前缀匹配**：按分隔符分割（如 "MDC-DH1E-POD1"，前缀长度=3）
- **无分组**：显示所有设备（不按POD分组）

---

## 性能基准

| 指标 | 目标 | 测试数据 |
|------|------|---------|
| 加载时间 | < 2秒 | 45节点, 80边 |
| 节点点击 | < 100ms | 任何节点 |
| POD切换 | < 500ms | POD1 → POD2 |
| 搜索 | < 100ms | 任何设备名 |
| 内存占用 | < 50MB | 初始加载 |

---

## 数据格式参考

### CSV 格式（IB/UFM）
```csv
System,Port,Peer Node,Peer Port
IBCR-001,1,IBSP-POD1-001,1
IBCR-001,2,IBSP-POD1-002,1
```

### Excel 格式（RoCE/NetQ）
| Hostname | Interface | Peer Hostname | Peer Interface |
|----------|-----------|---------------|----------------|
| ASW-001 | eth1 | SSW-POD1-001 | eth1 |
| ASW-001 | eth2 | SSW-POD1-002 | eth1 |

---

## 快速测试命令

### 使用 curl 测试 API
```bash
# 准备文件
FILE="test-data/ib-topology-sample.csv"

# 发送请求
curl -X POST http://localhost:8787/api/topology-restore \
  -F "file=@$FILE" \
  -F "networkType=ib" \
  -F 'config={"layerDetection":"auto","podExtraction":{"method":"regex","pattern":"POD\\d+"}}'

# 查看响应
# 应返回 JSON，包含 ok: true, nodesByLayer, connections 等
```

---

## 下一步

1. **完整测试**：参考 `TOPOLOGY_TESTING.md`
2. **遇到问题**：查看 `TOPOLOGY_NO_DISPLAY_DEBUG.md`
3. **扩展功能**：修改 `server/topology.mjs` 中的算法
4. **自定义样式**：修改 `src/plugins/topology-restore/index.tsx` 中的 CSS

---

**版本**: 1.0
**最后更新**: 2025-12-28
**适用版本**: 通用 CLOS 拓扑框架 v1.0+
