# RoCE 网络拓扑显示修复

## 问题描述

RoCE 网络（基于以太网的拓扑）无法显示拓扑，所有节点为空。

**原因分析**：

1. **层级检测不支持 RoCE 命名规则**
   - 旧版本仅支持 IB 命名：IBCR, IBSP, IBLF
   - RoCE 使用不同命名：CSW, SSW, ASW（或 CORE, SPINE, ACCESS）

2. **Excel 字段名称可能不匹配**
   - 不同的 NetQ 版本可能使用不同的列名
   - 需要灵活的字段名称识别

## 已完成的修复

### 1. 扩展层级检测算法 ✅

**文件**: `server/topology.mjs` (第 22-103 行)

```javascript
export function autoDetectLayers(portMap, manualPatterns = null, networkType = 'auto') {
  // 新增 networkType 参数，支持 'ib', 'roce', 'auto'

  // 自动检测网络类型（基于设备名称）
  if (detectedType === 'roce') {
    // RoCE 命名规则
    if (/^CSW|CORE/i.test(device)) → Core
    if (/^SSW|SPINE/i.test(device)) → Spine
    if (/^ASW|ACCESS|LEAF/i.test(device)) → Leaf
  } else {
    // IB 命名规则（默认）
    if (device.includes('IBCR')) → Core
    if (device.includes('IBSP')) → Spine
    if (device.includes('IBLF')) → Leaf
  }
}
```

**支持的 RoCE 命名规则**：

| 层级 | 支持的前缀 |
|-----|---------|
| **Core** | CSW, CORE |
| **Spine** | SSW, SPINE |
| **Leaf** | ASW, ACCESS, LEAF |

### 2. 改进 Excel 解析 ✅

**文件**: `server/index.mjs` (第 1761-1802 行)

```javascript
function parseExcelPortMap(data) {
  // 灵活的字段名识别
  const findField = (row, ...patterns) => {
    // 支持多种字段名称，例如：
    // - Hostname, Device, System, Node, Name
    // - Peer Hostname, Remote Device, 等等
  };
}
```

**支持的字段名称组合**：

- **设备名称**: Hostname, Device, System, Node, Name
- **端口**: Interface, Port, Eth
- **对端设备**: Peer Hostname, Peer Device, Peer Node, Peer Name, Remote Hostname, Remote Device
- **对端端口**: Peer Interface, Peer Port, Peer Eth, Remote Interface, Remote Port

### 3. 添加诊断日志 ✅

后端现在会输出详细的诊断信息，帮助调试：

```
[TopologyRestore] 开始解析 roce 网络拓扑，文件: roce-topology.xlsx
[TopologyRestore] Excel 原始数据行数: 20
[TopologyRestore] 样本行数据: {"Hostname": "CSW1", "Interface": "eth0", ...}
[ParseExcel] Excel 字段名: Hostname, Interface, Peer Hostname, Peer Interface
[AutoDetectLayers] 网络类型: roce
[AutoDetectLayers] 应用 RoCE 命名规则: CSW/CORE→Core, SSW/SPINE→Spine, ASW/ACCESS/LEAF→Leaf
[AutoDetectLayers] 检测结果: Core=2, Spine=4, Leaf=8
```

## 使用方法

### 1. 上传 RoCE 网络文件

1. 在"网络类型"选择 **"RoCE 网络 (以太网)"**
2. 上传 Excel 文件（支持 .xlsx, .xls）
3. 点击"还原拓扑"

### 2. 如果仍然无法显示

查看**浏览器开发者工具** (F12) 的 **Console** 标签，查找以下诊断日志：

```
[ParseExcel] Excel 字段名: ...
```

这会告诉您文件中实际的列名。如果列名与预期不同，有两个解决方案：

#### 方案 A：使用手动配置

1. 展开"高级选项"
2. 选择"手动配置"层级检测
3. 在正则表达式字段中输入您的设备命名规则

例如，如果您的 Core 设备以 "ROUTER" 开头：
- Core 设备: `^ROUTER`
- Spine 设备: `IBSP|SPINE`
- Leaf 设备: `IBLF|LEAF`

#### 方案 B：调整 Excel 文件格式

确保 Excel 文件包含以下列名（不区分大小写）：
- `Hostname` (设备名称)
- `Interface` (本端端口)
- `Peer Hostname` (对端设备)
- `Peer Interface` (对端端口)

## 测试验证

### 测试数据

`test-data/roce-topology-sample.xlsx` 包含测试用例：

| 设备 | 类型 | 个数 |
|-----|-----|-----|
| CSW1, CSW2 | Core | 2 |
| SSW1-4 | Spine | 4 |
| ASW1-8 | Leaf | 8 |
| 总连接 | - | 20+ |

### 验证步骤

1. 上传测试文件 `roce-topology-sample.xlsx`
2. 选择 RoCE 网络类型
3. 点击还原拓扑
4. 应该看到：
   - ✅ 2 个 Core 节点（红色）
   - ✅ 4 个 Spine 节点（蓝色）
   - ✅ 8 个 Leaf 节点（绿色）
   - ✅ 所有连接线正确显示

## 故障排除

### 问题：仍然显示空拓扑

**检查清单**：

1. ✅ 网络类型选择了 "RoCE 网络" 吗？
2. ✅ Excel 文件包含设备名称和对端设备列吗？
3. ✅ 设备名称是否以支持的前缀开头（CSW, SSW, ASW）？
4. ✅ 查看浏览器 Console 中的诊断日志

### 问题：看到日志 "[ParseExcel] 解析完成: 0 条端口映射"

**解决方案**：

1. 查看 "[ParseExcel] Excel 字段名" 的输出
2. 如果字段名与预期不符，编辑 Excel 文件，改为标准列名
3. 或使用手动配置指定正则表达式

### 问题：某些设备被分类到 "unknown" 层

**解决方案**：

使用手动配置，在层级检测中添加自定义正则表达式来识别这些设备。

## 后续改进

### 支持更多 RoCE 命名规则

如果您有特殊的命名规则（例如 "ROUTER", "SWITCH-CORE" 等），请提供示例，我们可以：

1. 添加到自动识别规则
2. 或使用手动配置灵活处理

### 支持两层 RoCE 拓扑

当前支持三层拓扑。如果需要支持只有 Spine 和 Leaf 的两层拓扑，请告知。

---

**更新时间**: 2025-12-28
**版本**: RoCE Support v1.0 ✅
**状态**: 已完成并验证
