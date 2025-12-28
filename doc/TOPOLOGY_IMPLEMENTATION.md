# CLOS拓扑还原系统 - 实现总结

## 系统概述

这是一个完整的、可扩展的CLOS（Core-Spine-Leaf）三层网络拓扑自动还原系统。支持多种数据中心命名规则、多种文件格式、以及可配置的拓扑检测和分组策略。

## 核心特性

### 1. 通用拓扑解析框架 (`server/topology.mjs`)

一个与具体命名规则无关的拓扑分析引擎，提供以下核心功能：

#### 自动层级检测 (`autoDetectLayers`)
- **原理**: 基于图论中的度数分析
- **算法**:
  1. 计算每个设备的连接度数（有多少条边连接）
  2. 度数最低的设备 → Core层（控制平面）
  3. 度数中等的设备 → Spine层（汇聚层）
  4. 度数最高的设备 → Leaf层（接入层）
- **优势**: 不依赖设备名称规则，适应多种数据中心命名规范
- **输出**:
  ```javascript
  {
    layers: { core: [...], spine: [...], leaf: [...] },
    degreeMap: Map<device, degree>,
    stats: { coreCount, spineCount, leafCount, avgDegree }
  }
  ```

#### POD分组规则引擎 (`extractPodIdentifiers`)
支持三种POD提取方法：

**1. 正则表达式匹配** (默认: `POD\d+`)
```javascript
// 示例数据
MDC-DH1E-POD1-G01-IBLF-001 → 匹配 POD1
MDC-DH1E-POD2-G01-IBLF-001 → 匹配 POD2
```

**2. 前缀匹配** (基于分隔符)
```javascript
// prefixLength=2, delimiter='-'
MDC-DH1E-POD1-G01-IBLF-001 → 提取前2段 → MDC-DH1E
```

**3. 无分组** (所有设备归入ALL组)
```javascript
// 适用于小规模拓扑或不需要POD分组的场景
```

#### 三层链路追溯 (`traceThreeLayerChains`)
- **目标**: 找出所有 设备A → 设备B → 设备C 的完整路径
- **用途**: 提供用户可理解的链路信息
- **实现**:
  1. 遍历端口映射表
  2. 对每个设备A，找其对端B
  3. 再找B的对端C
  4. 记录[A,B,C]三元组

#### 综合拓扑构建 (`buildTopologyStructure`)
- 整合以上所有函数
- 生成最终的拓扑数据结构
- 支持按POD分组的节点和边
- 生成层级边映射用于前端动态加载

### 2. 后端API改进 (`server/index.mjs`)

#### CSV解析 (`parseCSVPortMap`)
```javascript
// UFM导出格式
System,Port,Peer Node,Peer Port
MDC-DH1E-POD1-G01-IBLF-001,1,MDC-DH1E-POD1-G01-IBSP-001,1

// 功能
- 自动检测列位置（支持不同的列顺序）
- 处理BOM（字节序标记）
- 跳过无效行（包含NaN或空值）
- 输出Map<"device|port", {peer, peerPort}>
```

#### Excel解析 (`parseExcelPortMap`)
```javascript
// NetQ导出格式（支持多种列名）
- Hostname / Device / System
- Interface / Ifname / Port
- Peer Hostname / Peer Device / Peer Node
- Peer Interface / Peer Port

// 功能
- 自动识别列（大小写不敏感）
- 过滤GPU设备
- 生成标准端口映射
```

#### 统一API端点 (`/api/topology-restore`)
```javascript
POST /api/topology-restore
Content-Type: multipart/form-data

// 请求体
{
  file: <File>,
  networkType: 'ib' | 'roce',
  config: JSON.stringify({
    layerDetection: 'auto' | 'manual',
    manualLayers: {
      corePattern: 'IBCR|CORE',      // 可选
      spinePattern: 'IBSP|SPINE',
      leafPattern: 'IBLF|LEAF'
    },
    podExtraction: {
      method: 'regex' | 'prefix' | 'none',
      pattern: 'POD\\d+',              // regex方式
      prefixLength: 2                  // prefix方式
    }
  })
}

// 响应体
{
  ok: true,
  success: true,
  nodes: { <pod1>: [...], <pod2>: [...], ALL: [...] },
  edges: { <pod1>: [...], <pod2>: [...], ALL: [...] },
  hierarchyEdges: {
    <pod1>: { <spine_device>: [...] },
    ...
  },
  metadata: {
    layerDetection: 'auto',
    layers: { core: [...], spine: [...], leaf: [...] },
    pods: ['ALL', 'POD1', 'POD2', ...],
    stats: { ... }
  },
  nodeCount: 156,
  edgeCount: 234,
  chainsCount: 189
}
```

### 3. 前端拓扑配置UI (`src/plugins/topology-restore/index.tsx`)

#### 配置面板
- **网络类型选择**: IB (InfiniBand) / RoCE (RDMA over Ethernet)
- **层级检测方式**:
  - 自动检测（推荐）：基于拓扑度数分析
  - 手动配置：输入自定义正则表达式
- **POD分组方式**:
  - 正则表达式：灵活匹配任意模式
  - 前缀匹配：基于分隔符的简单分组
  - 无分组：显示所有设备

#### 文件上传
- 点击选择或拖拽上传
- CSV格式检验（IB模式）
- Excel格式检验（RoCE模式）

### 4. 前端动态拓扑渲染 (`src/plugins/topology-restore/index.tsx`)

#### ReactFlow集成
- **节点**: 按层级着色，显示设备ID
- **边**: 显示端口映射信息，箭头指向方向
- **布局**: 使用后端计算的坐标

#### 交互功能

**点击设备**
```
右侧信息面板显示:
├─ 设备ID (完整名称)
├─ 层级 (Core/Spine/Leaf/...)
├─ 位置 (X, Y坐标)
└─ 连接关系
   ├─ → 连接到的设备列表
   └─ ← 被连接的设备列表
```

**点击连接线**
```
右侧信息面板显示:
├─ 源设备ID
├─ 目标设备ID
└─ 端口信息 (源端口 - 目标端口)
```

**搜索**
- 输入设备名称片段
- 回车或点击搜索按钮
- 找到的设备高亮为红色边框
- 显示查询结果消息

**视图控制**
- POD选择器：在ALL（全部）和单个POD之间切换
- 层级可见性复选框：显示/隐藏各层级设备
- 拖拽移动节点
- 鼠标滚轮缩放
- 适配屏幕自动布局

#### 右侧信息面板
- 显示当前选中的设备或连接线详细信息
- 连接关系可视化
- 点击关闭按钮隐藏

### 5. 可扩展性设计

本系统设计时考虑了后续扩展需求：

#### 支持多种命名规则
无需修改代码，只需调整配置：
```javascript
// 例子：不同数据中心的命名规则
// 数据中心A：核心层用CORE, 叶子层用LEAF
config.manualLayers = {
  corePattern: 'CORE',
  spinePattern: '(AGG|SPINE)',
  leafPattern: 'LEAF'
}

// 数据中心B：POD命名为RACK-01, RACK-02
config.podExtraction = {
  method: 'regex',
  pattern: 'RACK-\\d+'
}
```

#### 支持新的网络类型
通过添加新的解析函数即可：
```javascript
// 例如支持CLOS-based的DDN网络
function parseNetAppCSV(csvContent) {
  // ... 解析逻辑
  return portMap; // 返回标准格式
}
```

#### 动态边加载支持
后端通过`hierarchyEdgesMap`提供跨层级边，前端可实现：
- 大规模拓扑下的惰性加载
- 点击Core设备时才加载Core-Spine边
- 动画展示边的加载过程

## 数据流示例

### IB网络拓扑还原流程

```
1. 用户上传UFM导出CSV
   文件内容: IBLF → IBSP → IBCR连接关系

2. 后端parseCSVPortMap解析
   输出: portMap {
     "IBLF-001|1": {peer: "IBSP-001", peerPort: "1"},
     "IBSP-001|1": {peer: "IBCR-001", peerPort: "1"},
     ...
   }

3. autoDetectLayers分析度数
   IBLF (度数高) → Leaf
   IBSP (度数中) → Spine
   IBCR (度数低) → Core

4. extractPodIdentifiers提取POD
   匹配POD1, POD2, ... 进行分组

5. traceThreeLayerChains追溯链路
   IBLF-001 → IBSP-001 → IBCR-001

6. buildTopologyStructure组织数据
   按POD分组的节点、边、元数据

7. 前端接收并渲染
   ├─ 节点着色(绿/蓝/红)
   ├─ 边连接正确
   ├─ 支持POD切换
   └─ 支持交互查看
```

## 性能考虑

### 时间复杂度
- 解析: O(n) - n为端口映射条数
- 层级检测: O(n log n) - 排序度数
- POD提取: O(n*m) - n为设备数，m为正则或模式匹配时间
- 三层追溯: O(n²) - 最坏情况需要遍历所有连接

### 优化建议
- 大型拓扑（>1000节点）：使用邻接表加速链路追溯
- 前端渲染：对超过500个节点使用虚拟滚动
- 搜索：对大型拓扑使用模糊匹配+缓存

## 文件结构

```
server/
├─ index.mjs                 # Express应用 + API端点
├─ topology.mjs              # 通用拓扑框架 (新增)
├─ storage.mjs               # 数据持久化
└─ ...

src/plugins/
└─ topology-restore/
   └─ index.tsx              # 前端拓扑还原工具
```

## 已通过验证

- ✓ CSV解析（UFM格式）
- ✓ Excel解析（NetQ格式）
- ✓ 自动层级检测
- ✓ 多种POD分组方式
- ✓ 三层链路追溯
- ✓ 前端交互功能
- ✓ 实时拓扑渲染
- ✓ 响应式设计

## 接下来的优化方向

1. **大规模拓扑优化**
   - 前端虚拟滚动
   - 后端邻接表缓存
   - 增量式边加载

2. **用户体验增强**
   - 自动布局算法（力导向图）
   - 动画过渡效果
   - 导出拓扑为图片/SVG

3. **扩展性增强**
   - 支持拓扑模板保存
   - 多文件合并拓扑
   - 实时监控模式

4. **文档完善**
   - 集成测试用例
   - API文档生成
   - 用户指南扩展

---

**系统版本**: 1.0.0
**最后更新**: 2025-01-28
**开发团队**: AI Knowledge Assistant
