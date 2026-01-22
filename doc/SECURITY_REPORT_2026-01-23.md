# 安全漏洞报告

## 发现时间
2026-01-23

## 漏洞详情

### xlsx 包漏洞

**包名:** xlsx
**严重性:** 高
**影响版本:** 所有版本
**状态:** 无自动修复方案

**漏洞类型:**
1. **原型污染 (Prototype Pollution)**
   - CVE: GHSA-4r6h-8v6p-xvw6
   - 链接: https://github.com/advisories/GHSA-4r6h-8v6p-xvw6

2. **正则表达式拒绝服务 (ReDoS)**
   - CVE: GHSA-5pgg-2g8v-p4x9
   - 链接: https://github.com/advisories/GHSA-5pgg-2g8v-p4x9

## 影响分析

### 当前使用情况
- **包版本:** ^0.18.5
- **使用场景:** Excel 文件解析和导出
- **文件位置:** 主要在文档上传和拓扑分析功能中使用

### 风险评估

**风险等级:** 中等

**理由:**
1. ✅ xlsx 仅在服务器端使用（非浏览器环境）
2. ✅ 主要用于受信任的用户上传文件
3. ✅ 有文件类型和大小验证
4. ⚠️ 如果处理恶意构造的 Excel 文件，可能触发漏洞
5. ⚠️ 原型污染可能影响其他代码逻辑

**实际风险:**
- **低风险:** 在私有部署环境中，用户可信
- **中风险:** 在公开环境中，可能接收恶意文件
- **高风险:** 在多租户环境中，存在潜在攻击面

## 解决方案

### 方案 1: 继续使用并加强防护（推荐用于当前阶段）

**优点:**
- 无需代码修改
- 功能完全保留
- 快速实施

**实施步骤:**

1. **加强输入验证**
   ```javascript
   // 在 fileValidation.mjs 中添加额外检查
   - 严格限制文件大小（当前已有）
   - 添加文件内容结构验证
   - 实施上传频率限制
   ```

2. **隔离处理环境**
   ```javascript
   // 使用 Worker Threads 或独立进程处理 Excel 文件
   import { Worker } from 'worker_threads';

   // 在单独的沙盒环境中解析文件
   const worker = new Worker('./excelWorker.mjs');
   worker.postMessage({ file: excelData });
   ```

3. **添加错误处理和监控**
   ```javascript
   try {
     const workbook = XLSX.read(buffer, { type: 'buffer' });
   } catch (error) {
     logger.error('Excel parsing failed', {
       error: error.message,
       filename
     });
     // 记录可疑文件用于安全审计
   }
   ```

### 方案 2: 替换为更安全的库

**可选替代方案:**

1. **exceljs** (更安全，功能丰富)
   ```bash
   npm install exceljs
   ```
   - ✅ 更现代的实现
   - ✅ 更好的安全性
   - ✅ 更活跃的维护
   - ⚠️ 需要代码重构

2. **node-xlsx** (轻量级)
   ```bash
   npm install node-xlsx
   ```
   - ✅ 基于 xlsx.js（不同实现）
   - ✅ 简单易用
   - ⚠️ 功能较少

3. **fast-xlsx** (高性能)
   ```bash
   npm install fast-xlsx
   ```
   - ✅ 性能优化
   - ✅ 现代化 API
   - ⚠️ 社区较小

**迁移工作量评估:**
- 受影响文件: 2-3 个
- 预计工作量: 2-4 小时
- 测试工作量: 1-2 小时

### 方案 3: 移除 Excel 支持（不推荐）

仅当 Excel 功能非核心时考虑。

## 推荐行动计划

### 立即执行（本周）

1. ✅ **加强文件验证**
   - 在 `server/fileValidation.mjs` 中添加更严格的 Excel 文件检查
   - 限制文件大小为 10MB（当前 50MB）
   - 添加文件内容格式验证

2. ✅ **添加安全监控**
   - 使用新的 logger 系统记录所有 Excel 解析操作
   - 监控异常解析错误
   - 设置告警阈值

3. ✅ **更新文档**
   - 在 README 中标注安全注意事项
   - 提醒用户仅上传可信文件

### 短期计划（本月）

4. ⏳ **评估迁移到 exceljs**
   - 在开发环境测试 exceljs
   - 评估兼容性和性能
   - 准备迁移方案

5. ⏳ **实施沙盒化处理**
   - 使用 Worker Threads 隔离 Excel 解析
   - 添加超时和资源限制

### 长期计划（未来）

6. ⏳ **完全迁移到安全库**
   - 如果 exceljs 测试通过，进行完整迁移
   - 更新所有相关代码和测试
   - 部署到生产环境

## 临时缓解措施

在完成迁移前，可以采取以下措施降低风险：

```javascript
// server/utils/excelSanitizer.mjs
export function sanitizeExcelData(data) {
  // 移除可能的原型污染
  if (data && typeof data === 'object') {
    delete data.__proto__;
    delete data.constructor;
    delete data.prototype;
  }
  return data;
}

// 使用
const workbook = XLSX.read(buffer, { type: 'buffer' });
const sanitizedData = sanitizeExcelData(workbook);
```

## 监控指标

建议监控以下指标以识别潜在攻击：

1. Excel 文件解析失败率（阈值: >5%）
2. 解析时间异常（阈值: >30秒）
3. 文件大小异常（阈值: >10MB）
4. 单用户上传频率（阈值: >10次/分钟）

## 参考链接

- [xlsx GitHub](https://github.com/SheetJS/sheetjs)
- [exceljs GitHub](https://github.com/exceljs/exceljs)
- [OWASP - Prototype Pollution](https://owasp.org/www-community/attacks/Prototype_Pollution)
- [npm audit 文档](https://docs.npmjs.com/cli/v8/commands/npm-audit)

## 更新记录

| 日期 | 操作 | 状态 |
|------|------|------|
| 2026-01-23 | 发现漏洞 | ✅ |
| 2026-01-23 | 风险评估 | ✅ |
| 2026-01-23 | 制定方案 | ✅ |
| - | 实施缓解措施 | ⏳ |
| - | 迁移到安全库 | ⏳ |

---

**报告人:** AI Assistant (Claude Sonnet 4.5)
**审核状态:** 待开发团队审核
**优先级:** 中
