# 意图识别系统增强 - 完整指南

## 📊 项目成果

### 1. 创建的文件

| 文件 | 说明 |
|------|------|
| `src/lib/advancedIntentDetector.ts` | 高级意图识别器（10种意图类型） |
| `src/lib/retrievalEnhancements.ts` | 已更新，集成新的意图识别器 |
| `test/improved-intent-test.mjs` | 改进的意图识别测试（77.3%准确率） |
| `test/intent-recognition-demo.mjs` | 演示版本测试 |

### 2. 意图识别系统特性

#### 支持的意图类型（10种）

```
1. command          - 命令查询：如何执行某个操作
2. troubleshoot     - 故障排查：问题诊断、错误解决
3. configuration    - 配置指导：如何配置、设置参数
4. explanation      - 概念解释：详细说明、原理讲解
5. comparison       - 对比分析：对比、区别、优缺点
6. performance      - 性能优化：性能调优、优化建议
7. best_practice    - 最佳实践：推荐做法、标准流程
8. verification     - 验证检查：验证配置、检查状态
9. question         - 问题类：为什么、是否、能否
10. general         - 通用查询：其他
```

#### 核心功能

✅ **置信度评分** - 0-1 范围，表示识别的可靠性
✅ **优先级规则** - 故障排查 > 性能 > 最佳实践 > 验证 > 配置 > 解释 > 对比 > 命令 > 问题
✅ **上下文感知** - 基于对话历史调整意图识别
✅ **复杂度分析** - 简单/中等/复杂三个等级
✅ **多步骤查询** - 检测子意图（多步骤查询）
✅ **自适应参数** - 根据意图调整检索参数

### 3. 测试结果

```
总体准确率: 77.3% (17/22)

分类统计：
  配置指导    : 100% (3/3)  ✅
  对比分析    : 100% (2/2)  ✅
  性能优化    : 100% (2/2)  ✅
  最佳实践    : 100% (2/2)  ✅
  验证检查    : 100% (2/2)  ✅
  故障排查    : 66.7% (2/3) ⚠️
  概念解释    : 66.7% (2/3) ⚠️
  问题类      : 50.0% (1/2) ⚠️
  命令类      : 33.3% (1/3) ⚠️
```

## 🚀 使用方法

### 1. 基本使用

```typescript
import { advancedIntentDetector } from './src/lib/advancedIntentDetector';

// 检测查询意图
const result = advancedIntentDetector.detect('如何查询接口状态');

console.log(result.intent);        // 'command'
console.log(result.confidence);    // 0.95
console.log(result.reasons);       // ['包含关键词: 如何', '匹配模式: 1个']
```

### 2. 获取检索参数

```typescript
// 根据意图获取自适应检索参数
const params = advancedIntentDetector.getRetrievalParams('troubleshoot', 0.8);

console.log(params);
// {
//   limit: 25,
//   rerankCandidates: 60,
//   minScore: 0.2
// }
```

### 3. 生成意图描述（调试用）

```typescript
const description = advancedIntentDetector.describeIntent(result);
console.log(description);
// 意图: command
// 置信度: 95.0%
// 原因: 包含关键词: 如何; 匹配模式: 1个
// 上下文: 包含命令, 复杂度: simple
```

## 🔧 集成到检索系统

### 1. 在 `src/lib/retrieval.ts` 中使用

```typescript
import { detectQueryIntentAdvanced } from './retrievalEnhancements';

export async function semanticSearch(query: string, limit: number = 20) {
  // 检测意图
  const intentResult = detectQueryIntentAdvanced(query);

  // 根据意图调整参数
  const params = advancedIntentDetector.getRetrievalParams(
    intentResult.intent,
    intentResult.confidence
  );

  // 使用调整后的参数进行检索
  const results = await performSearch(query, params);

  // 返回结果时附加意图信息
  return {
    results,
    intent: intentResult.intent,
    confidence: intentResult.confidence
  };
}
```

### 2. 在前端显示意图信息

```typescript
// 在 ChatInterface.tsx 中
const [intentInfo, setIntentInfo] = useState(null);

const handleSendMessage = async (message: string) => {
  const intentResult = await detectQueryIntentAdvanced(message);
  setIntentInfo(intentResult);

  // 显示意图信息
  console.log(`识别意图: ${intentResult.intent} (置信度: ${intentResult.confidence})`);
};
```

## 📈 性能优化建议

### 1. 提高命令类识别准确率

当前问题：`nv show interface` 被识别为 `verification` 而不是 `command`

**解决方案**：
```typescript
// 在 advancedIntentDetector.ts 中调整规则
if (/^(nv show|show|display|list|get)/.test(queryLower)) {
  scores.command = 2.0;  // 提高权重
}
```

### 2. 改进故障排查识别

当前问题：`BGP邻居为什么起不来` 没有被识别为 `troubleshoot`

**解决方案**：
```typescript
// 添加更多故障排查关键词
if (/起不来|启不动|无法启动|启动失败|不能启动/.test(queryLower)) {
  scores.troubleshoot = 2.0;
}
```

### 3. 增强概念解释识别

当前问题：`RoCE的原理是什么` 没有被识别为 `explanation`

**解决方案**：
```typescript
// 改进模式匹配
if (/的原理|的概念|的含义|的定义/.test(queryLower)) {
  scores.explanation = 1.8;
}
```

## 🎯 下一步行动

### 优先级1：集成到检索系统
- [ ] 在 `src/lib/retrieval.ts` 中集成意图识别
- [ ] 根据意图调整检索参数
- [ ] 测试端到端流程

### 优先级2：前端集成
- [ ] 在聊天界面显示识别的意图
- [ ] 显示置信度信息
- [ ] 添加意图调整选项（用户可以手动修正）

### 优先级3：持续优化
- [ ] 收集用户反馈
- [ ] 分析识别错误的模式
- [ ] 迭代改进规则
- [ ] 添加机器学习模型（可选）

## 📚 参考资源

### 相关文件
- `src/lib/advancedIntentDetector.ts` - 完整的意图识别实现
- `src/lib/retrievalEnhancements.ts` - 集成点
- `test/improved-intent-test.mjs` - 测试用例

### 测试命令
```bash
# 运行意图识别测试
node test/improved-intent-test.mjs

# 运行演示版本
node test/intent-recognition-demo.mjs
```

## 💡 设计思想

### 为什么需要意图识别？

1. **自适应检索** - 不同意图需要不同的检索策略
2. **参数优化** - 根据意图调整 limit、minScore 等参数
3. **排序改进** - 不同意图的相关性排序方式不同
4. **用户体验** - 显示系统理解的用户意图，增强信任

### 优先级规则的逻辑

```
故障排查 (2.0)      - 用户遇到问题，需要立即帮助
性能优化 (1.8)      - 用户想改进系统，需要专业建议
最佳实践 (1.7)      - 用户寻求标准做法
验证检查 (1.9)      - 用户想确认配置
配置指导 (1.5)      - 用户想学习如何配置
概念解释 (1.6)      - 用户想理解概念
对比分析 (1.4)      - 用户想比较选项
命令类 (1.2)        - 用户想执行操作
问题类 (1.1)        - 用户有疑问
```

## 🔍 故障排查

### 问题：意图识别准确率低

**检查清单**：
1. 查看 `reasons` 字段，了解识别的原因
2. 检查 `confidence` 是否过低（< 0.5）
3. 查看 `context` 信息，了解查询的特征
4. 运行测试用例，对比预期结果

### 问题：某个意图总是被误识别

**解决步骤**：
1. 在 `test/improved-intent-test.mjs` 中添加测试用例
2. 运行测试，确认问题
3. 在 `advancedIntentDetector.ts` 中调整规则
4. 重新运行测试，验证修复

## 📞 支持

如有问题或建议，请：
1. 查看测试结果中的失败用例
2. 检查 `reasons` 字段了解识别逻辑
3. 根据"性能优化建议"部分调整规则
4. 运行测试验证修改效果
