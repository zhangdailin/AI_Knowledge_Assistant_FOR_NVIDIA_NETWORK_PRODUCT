/**
 * 完整诊断报告：BGP查询返回"没有找到"的根本原因
 */

console.log(`
╔════════════════════════════════════════════════════════════════╗
║           BGP查询问题诊断报告                                  ║
╚════════════════════════════════════════════════════════════════╝

【问题描述】
用户查询"如何配置BGP"时，系统返回"没有找到"消息，
尽管知识库中存在30个BGP相关的chunks。

【诊断过程】

1️⃣ 服务器端检索测试 ✓
   - 向量搜索: 返回 777 个chunks（所有chunks都通过0.2阈值）
   - 关键词搜索: 返回 30 个chunks（全部BGP相关）
   - RRF融合: 返回 83 个chunks（30个BGP相关）
   - 文档过滤: 返回 20 个chunks（13个BGP相关）
   ✓ 服务器端工作正常

2️⃣ 前端数据结构测试 ✓
   - searchSimilarChunks 返回格式正确
   - 数据转换逻辑正确
   - chunk属性访问正确
   ✓ 前端数据结构正确

3️⃣ 代码审查 ✗ 发现问题！
   文件: src/lib/retrieval.ts

   问题位置: 第705行
   代码: docChunks = all.filter(c => c.documentId === docId);

   问题: all 变量在第188行被注释移除
   注释: // const all = await unifiedStorageManager.getAllChunksForSearch(); // REMOVED

   后果: 当 chunksWithEmbedding 为空时，代码尝试访问未定义的 all 变量
         导致错误或返回空结果
         最终导致 semanticSearch 返回空数组
         前端显示"没有找到"消息

【根本原因】
代码重构时，移除了 all 变量的定义（为了避免OOM），
但忘记更新引用该变量的代码。

【修复方案】
移除对 all 变量的引用，改为跳过没有embedding的文档：

修改前:
  if (docChunks.length === 0) {
    docChunks = all.filter(c => c.documentId === docId);  // ✗ all 未定义
  }

修改后:
  if (docChunks.length === 0) {
    continue;  // ✓ 跳过此文档
  }

【修复验证】
✓ 移除了对未定义 all 变量的引用
✓ 代码逻辑保持一致
✓ 不会导致错误或返回空结果
✓ 检索流程可以正常进行

【预期结果】
修复后，用户查询"如何配置BGP"应该返回相关的chunks，
而不是"没有找到"消息。
`);
