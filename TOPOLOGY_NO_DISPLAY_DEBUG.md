# 拓扑还原 - 没有显示拓扑图的诊断指南

## 问题现象
✓ 显示"成功解析 50 个节点, 322 条连接"
✗ 但拓扑图没有显示

## 诊断步骤

### 步骤1：打开浏览器开发者工具
1. 在拓扑还原页面按 **F12** 打开开发者工具
2. 切换到 **Console** 标签页

### 步骤2：查看诊断日志
重新点击"还原拓扑"，观察console中的以下日志：

```
[TopologyRestore] Result: {...}
[TopologyRestore] nodesByLayer 内容: {...}
[TopologyRestore] 初始化可见层级: [...]
[TopologyRestore] 拓扑渲染完成: {...}
```

### 步骤3：检查关键信息

#### 检查点A：nodesByLayer是否有内容？

查看日志：
```
[TopologyRestore] nodesByLayer 内容: {
  keys: ['core', 'spine', 'leaf'],  // 应该有这三个键
  structure: [
    {layer: 'core', nodeCount: 5, ...},
    {layer: 'spine', nodeCount: 15, ...},
    {layer: 'leaf', nodeCount: 30, ...}
  ]
}
```

**问题排查**：
- 如果 `keys: []` 为空 → 后端没有返回nodesByLayer
- 如果某个层的 `nodeCount: 0` → 该层没有设备

#### 检查点B：可见层级是否正确初始化？

查看日志：
```
[TopologyRestore] 初始化可见层级: ['core', 'spine', 'leaf'],
  {core: true, spine: true, leaf: true}
```

**问题排查**：
- 如果数组为空 → 没有检测到任何层级
- 如果某个值为false → 该层级被隐藏

#### 检查点C：拓扑渲染是否成功？

查看日志：
```
[TopologyRestore] 拓扑渲染完成: {
  nodeCount: 50,      // 应该 > 0
  edgeCount: 322,     // 应该 > 0
  sampleNodes: [...],  // 前3个节点
  nodesByLayerKeys: ['core', 'spine', 'leaf']
}
```

**问题排查**：
- 如果 `nodeCount: 0` → 没有生成任何节点，见下面的"没有节点"部分
- 如果 `edgeCount: 0` → 没有生成任何边

## 常见问题

### 问题1：nodesByLayer 为空对象 {}

**症状**：
```
[TopologyRestore] nodesByLayer 内容: {
  keys: [],
  structure: null
}
```

**原因**：后端没有返回nodesByLayer或返回了空对象

**解决方案**：
1. 检查后端是否正确执行了拓扑解析
2. 查看后端日志：`[TopologyRestore] 拓扑解析完成: ...`
3. 确保CSV/Excel文件格式正确

### 问题2：某些层没有节点

**症状**：
```
structure: [
  {layer: 'core', nodeCount: 0},
  {layer: 'spine', nodeCount: 0},
  {layer: 'leaf', nodeCount: 50}
]
```

**原因**：自动层级检测可能不够准确

**解决方案**：
1. 尝试切换到"手动配置"
2. 输入自定义的正则表达式来识别Core/Spine/Leaf设备
3. 根据你的数据中的设备命名规则调整

### 问题3：拓扑渲染了但看不到

**症状**：
```
nodeCount: 50,
edgeCount: 322,
但是画布是空白的
```

**原因**：节点可能超出了可视范围或重叠

**解决方案**：
1. 点击拓扑图右上角的"⊡"按钮（适配屏幕）
2. 或使用鼠标滚轮缩放
3. 尝试拖拽移动节点来查看是否真的存在

### 问题4：没有生成任何节点

**症状**：
```
[TopologyRestore] 警告：没有生成任何节点！
nodeCount: 0,
```

**原因**：
- nodesByLayer中所有层级都是空数组
- visibility设置不正确
- buildTopology中的过滤逻辑有问题

**解决方案**：
1. 检查后端的层级检测是否成功
2. 查看nodes array是否为空：
   ```javascript
   // 在console中执行
   console.log('Nodes:', nodes);
   console.log('Edges:', edges);
   ```
3. 检查visibility是否都为true

## 深度诊断

### 在浏览器console中手动测试

```javascript
// 1. 查看最新的React组件状态
console.log('restoreResult:', restoreResult);
console.log('nodes:', nodes);
console.log('edges:', edges);
console.log('layerVisibility:', layerVisibility);

// 2. 手动调用buildTopology
// (假设restoreResult已存在)
buildTopology(restoreResult, 'ALL', Object.fromEntries(
  Object.keys(restoreResult.nodesByLayer || {}).map(k => [k, true])
));

// 3. 检查React Flow是否正确挂载
console.log('ReactFlow mounted:', document.querySelector('[data-react-flow]'));
```

### 后端日志诊断

查看服务器的console输出：
```
[TopologyRestore] 开始解析 ib 网络拓扑，文件: ...
[TopologyRestore] CSV解析完成: XX 条端口映射
[TopologyRestore] 拓扑解析完成: XX 设备, XX 链路
```

如果看不到这些日志 → 后端请求没有到达或有错误

## 网络请求诊断

1. F12打开开发者工具 → **Network** 标签
2. 重新点击"还原拓扑"
3. 找到 `/api/topology-restore` 请求
4. 检查：
   - **Status**: 应该是200
   - **Response**: 应该包含:
     ```json
     {
       "ok": true,
       "nodeCount": 50,
       "nodesByLayer": {
         "core": [...],
         "spine": [...],
         "leaf": [...]
       },
       ...
     }
     ```

如果Status不是200 → 后端返回了错误

## 快速测试清单

- [ ] nodesByLayer不为空
- [ ] 有多个层级有节点
- [ ] layerVisibility都是true
- [ ] buildTopology生成了节点（nodeCount > 0）
- [ ] ReactFlow容器可见（height: 600px）
- [ ] 按Ctrl+A全选，检查是否有节点被高亮
- [ ] 缩放或移动视图看是否有隐藏的节点

## 获取帮助

如果按照以上步骤仍未解决，请提供以下信息：

1. **浏览器console的完整输出**
2. **Network请求的Response内容**
3. **上传的数据文件格式样本** (前3行)
4. **后端日志输出**

---

**最后更新**: 2025-01-28
