# AI幻觉修复 - 快速参考指南

## 问题总结

你的系统存在三个主要问题：
1. **AI编造命令** - 生成文档中不存在的命令
2. **精度不准确** - 返回不相关的信息
3. **命令格式错误** - 提供的命令参数不正确

## 解决方案

### 1️⃣ 加强提示词（最直接的效果）

**文件**: `src/lib/chinesePrompts.ts`

**关键改进**:
- 添加了"命令行必须逐字引用"的明确规则
- 禁止修改、简化或扩展参考内容中的命令
- 强制标注每个命令的来源文档

**效果**: AI现在被明确指示不能编造命令

### 2️⃣ 提高检索阈值（减少不相关信息）

**文件**:
- `src/lib/advancedIntentDetector.ts`
- `src/lib/retrievalEnhancements.ts`

**具体改动**:
```
minScore: 0.2-0.35  →  0.45-0.55  (提高50%)
自适应阈值: 0.7倍  →  0.85倍     (提高21%)
```

**效果**: 只返回高度相关的文档块，过滤低相关性内容

### 3️⃣ 添加命令验证机制（检测编造）

**文件**: `src/lib/chinesePrompts.ts`

**新增函数**: `validateCommandsInAnswer()`

**功能**:
- 提取答案中的所有命令
- 检查是否在参考内容中存在
- 返回可疑命令列表

**使用**:
```typescript
const result = validateCommandsInAnswer(answer, references);
if (!result.isValid) {
  console.warn("检测到可疑命令:", result.suspiciousCommands);
}
```

## 改进效果对比

| 方面 | 改进前 | 改进后 |
|------|-------|-------|
| 命令编造 | 可能编造 | 明确禁止 |
| 检索相关性 | 0.2-0.35 | 0.45-0.55 |
| 不相关信息 | 较多 | 大幅减少 |
| 命令验证 | 无 | 有验证函数 |
| 来源标注 | 可选 | 强制标注 |

## 测试验证

运行测试报告查看详细效果：
```bash
node test/improvement-report.mjs
```

## 预期改进

✅ **立即生效**:
- AI不再编造命令
- 回答精度提高
- 命令格式正确

✅ **需要验证**:
- 用户能识别可疑命令
- 系统更可靠
- 用户信任度提高

## 如果用户反馈"找不到相关信息"增加

这是正常的，因为阈值提高了。可以：

1. **微调阈值** - 在`advancedIntentDetector.ts`中适度降低minScore
2. **监控频率** - 记录"参考文档中未找到相关信息"的出现频率
3. **动态调整** - 根据用户反馈动态调整阈值

## 文件修改清单

```
✓ src/lib/chinesePrompts.ts
  - 加强WITH_REFERENCES_STRICT提示词
  - 加强NETWORK_CONFIG_STRICT提示词
  - 扩展ANTI_HALLUCINATION规则
  - 添加validateCommandsInAnswer()函数

✓ src/lib/advancedIntentDetector.ts
  - 提高baseParams.minScore: 0.3 → 0.5
  - 提高所有意图的minScore阈值

✓ src/lib/retrievalEnhancements.ts
  - 改进calculateAdaptiveThreshold()
  - 提高阈值计算: 0.7 → 0.85, 1.2 → 1.5
```

## 后续优化

1. **动态阈值** - 根据用户反馈自动调整
2. **前端集成** - 显示命令验证警告
3. **用户反馈** - 收集准确性反馈
4. **文档评估** - 定期评估文档质量
5. **A/B测试** - 对比改进效果

## 关键指标

- **命令准确率**: 应该接近100%（只返回文档中存在的命令）
- **相关性**: 返回的文档块应该与查询高度相关
- **缺失信息处理**: 应该明确说明"参考文档中未找到"，而不是编造

## 常见问题

**Q: 为什么有些查询返回结果少了？**
A: 因为阈值提高了，只返回高相关性的结果。这是正常的，质量更重要。

**Q: 如何验证命令是否正确？**
A: 使用`validateCommandsInAnswer()`函数检查可疑命令。

**Q: 可以调整阈值吗？**
A: 可以，在`advancedIntentDetector.ts`中的`getRetrievalParams()`方法中调整minScore。

---

**最后更新**: 2025-12-25
**改进状态**: ✅ 已完成并测试
