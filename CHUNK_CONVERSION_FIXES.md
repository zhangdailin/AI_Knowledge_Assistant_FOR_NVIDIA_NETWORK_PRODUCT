# Chunk转换问题分析和修复

## 问题诊断

### 1. **Markdown结构破坏问题**
**症状**：
- 前端查询"如何配置BGP"时，返回"文档里面没有"
- Embedding速度特别快，数量变得特别少
- Chunks内容混乱，代码块被破坏

**根本原因**：
在 `server/chunking.mjs` 的 `improveMarkdownStructure()` 函数中，存在过度的正则替换：
```javascript
// 问题代码：修改标题层级，导致结构混乱
result = result.replace(/^# ([^\n]+)\n\n# /gm, '## $1\n\n# ');

// 问题代码：转换短代码块为行内代码，丢失重要信息
result = result.replace(/```\n(.{1,20})\n```/g, '`$1`');

// 问题代码：修改NOTE/IMPORTANT块格式
result = result.replace(/^# (NOTE|IMPORTANT)\n\n/gm, '\n> **$1**\n\n');
```

这些操作导致：
- 代码块被破坏（如 `txt` 标记被分离）
- 标题层级混乱，导致breadcrumbs错误
- 内容结构被破坏

### 2. **Retrieval过度过滤问题**
**症状**：
- 即使chunks存在，也无法被检索到
- 查询"BGP"时，如果文档名称不包含"BGP"，就被过滤掉

**根本原因**：
在 `src/lib/retrieval.ts` 中，相关性阈值计算过高：
```typescript
// 问题代码：阈值过高，导致chunks被过度过滤
const baseRelevanceThreshold = maxAvgScore * 0.3;
const relevanceThreshold = Math.min(adaptiveThreshold, baseRelevanceThreshold);
```

同时，过滤逻辑过于复杂，有多层条件判断，导致chunks被多次过滤。

## 修复方案

### 1. **修复Markdown处理** (server/chunking.mjs)
**改进**：采用保守策略，只进行必要的修复
```javascript
function improveMarkdownStructure(text) {
  let result = text;

  // 1. 只修复多个连续空行（最安全的操作）
  result = result.replace(/\n\n\n+/g, '\n\n');

  // 2. 修复列表缩进问题 - 标准化为 2 个空格（只处理过度缩进）
  result = result.replace(/^(\s{4,})(-|\*|\+)\s/gm, '  $2 ');

  // 3. 修复数学符号为普通文本（只处理特定的数学符号）
  result = result.replace(/\$\\equiv\$/g, '=');
  result = result.replace(/\$=\$/g, '=');

  // 移除了以下可能破坏内容的操作：
  // - 不再修改标题层级
  // - 不再转换短代码块为行内代码
  // - 不再修改 NOTE/IMPORTANT 块格式

  return result;
}
```

**效果**：
- ✅ 保护代码块完整性
- ✅ 保持标题层级正确
- ✅ 保留原始内容结构

### 2. **修复Retrieval过滤逻辑** (src/lib/retrieval.ts)
**改进**：降低相关性阈值，简化过滤逻辑
```typescript
// 降低基础阈值到 0.2（从 0.3）
const baseRelevanceThreshold = maxAvgScore * 0.2;

// 简化过滤逻辑
const relevantDocs = new Set<string>();
docAvgScores.forEach((avgScore, docId) => {
  const keywordScore = docKeywordScores.get(docId) || 0;
  const hasKeywords = docHasKeywords.get(docId) || false;

  // 只要分数超过阈值，就认为是相关的
  if (avgScore >= relevanceThreshold) {
    relevantDocs.add(docId);
  }
  // 如果关键词匹配度很高，直接认为是相关的
  else if (keywordScore >= 1.0) {
    relevantDocs.add(docId);
  }
  // 如果包含任何关键词且分数不是极低，也认为是相关的
  else if (hasKeywords && avgScore >= relevanceThreshold * 0.5) {
    relevantDocs.add(docId);
  }
});
```

**效果**：
- ✅ 减少chunks被过度过滤
- ✅ 即使文档名称不包含关键词，内容相关的chunks也能被检索到
- ✅ 提高检索召回率

## 验证步骤

### 1. 清理旧数据
```bash
rm -f data/chunks/*.json
```

### 2. 重新上传文档
- 在前端重新上传Cumulus Linux文档
- 系统会使用新的chunking算法进行转换

### 3. 测试查询
```
查询：如何配置BGP
预期：返回BGP相关的chunks（即使文档名称不包含BGP）

查询：NVUE命令
预期：返回NVUE命令相关的chunks
```

## 预期改进

| 指标 | 修复前 | 修复后 |
|------|-------|-------|
| Chunks总数 | 696 | ≈800-1000（更多内容被保留） |
| 平均Chunk大小 | 1493字符 | ≈1500-2000字符（内容更完整） |
| BGP相关chunks | 30 | ≈50-80（更多相关内容） |
| 检索召回率 | 低（过度过滤） | 高（宽松过滤） |
| Embedding速度 | 快（chunks少） | 正常（chunks多） |

## 后续优化建议

1. **监控Embedding质量**
   - 检查embedding向量的维度和分布
   - 确保embedding模型正确生成

2. **优化Rerank模型**
   - 当前使用BAAI/bge-reranker-v2-m3
   - 可考虑调整rerank候选数量

3. **改进关键词提取**
   - 当前使用LLM生成关键词
   - 可添加更多技术术语的识别

4. **增加调试日志**
   - 在chunking过程中添加更多日志
   - 便于诊断未来的问题
