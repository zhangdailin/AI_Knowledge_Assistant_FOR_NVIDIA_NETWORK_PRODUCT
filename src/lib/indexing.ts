import { aiModelManager } from './aiModels';
import { unifiedStorageManager } from './localStorage';
import { retrieval } from './retrieval';

export async function llmIndexDocument(documentId: string, rawText: string) {
  const prompt = `你是知识库索引器。请基于以下原文生成结构化JSON，字段如下：
{
  "summary": "简洁中文摘要",
  "topics": ["主题关键词"],
  "sections": [{ "title": "小节标题", "content": "适合检索的精炼正文" }],
  "qa_pairs": [{ "q": "常见问题", "a": "基于原文的答案" }]
}
要求：
- 仅输出合法JSON；
- 内容尽量中文、去除冗余；
- 每段不超过800字；
- 保留重要命令与配置示例；

原文：\n\n${rawText.substring(0, 12000)}`;

  // 对于长文本，增加超时时间（通过传递更长的 context 来触发索引任务模式）
  // prompt 已经包含了长文本，会自动触发 60 秒超时
  const res = await aiModelManager.generateAnswer({ question: prompt });
  const text = res.answer.trim();
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    const jsonStr = text.slice(jsonStart, jsonEnd + 1);
    const data = JSON.parse(jsonStr);

    const add = async (content: string, type: 'parent' | 'child' | 'normal' = 'normal', parentId?: string) => {
      if (content && content.trim().length >= 20) {
        // 构建 Chunk 对象
        // 注意：addManualChunk 的实现可能需要更新以支持 parentId 和 chunkType
        // 这里我们假设 unifiedStorageManager.createChunks 支持完整字段
        const chunkData = {
            content: content.trim(),
            chunkType: type,
            parentId: parentId,
            chunkIndex: 0, // 索引后续会自动调整或忽略
            tokenCount: Math.ceil(content.length / 4)
        };
        await unifiedStorageManager.createChunks(documentId, [chunkData]);
      }
    };

    // 1. 添加摘要作为父块
    const summaryContent = `文档摘要: ${data.summary}\n主题: ${(data.topics || []).join(', ')}`;
    // 先创建父块，并获取其 ID（这里需要 unifiedStorageManager 返回创建的 chunks）
    // 由于 addManualChunk 也是调用的 createChunks，我们可以稍微改造一下逻辑
    
    // 为了简化，我们直接使用 createChunks
    const parentChunks = await unifiedStorageManager.createChunks(documentId, [{
        content: summaryContent,
        chunkType: 'parent',
        chunkIndex: 0,
        tokenCount: Math.ceil(summaryContent.length / 4)
    }]);
    
    const parentId = parentChunks[0]?.id;

    if (parentId) {
        // 2. 将 QA 对作为子块添加到该父块下
        await Promise.all((data.qa_pairs || []).map((qa: any) => 
            unifiedStorageManager.createChunks(documentId, [{
                content: `Q: ${qa.q}\nA: ${qa.a}`,
                chunkType: 'child',
                parentId: parentId,
                chunkIndex: 0,
                tokenCount: Math.ceil((qa.q + qa.a).length / 4)
            }])
        ));
        
        // 3. 将 Section 作为子块添加到该父块下
        await Promise.all((data.sections || []).map((s: any) => 
             unifiedStorageManager.createChunks(documentId, [{
                content: `${s.title}\n${s.content}`,
                chunkType: 'child',
                parentId: parentId,
                chunkIndex: 0,
                tokenCount: Math.ceil((s.title + s.content).length / 4)
            }])
        ));
    } else {
        // 降级处理：如果父块创建失败，就当普通块添加
        await Promise.all((data.qa_pairs || []).map((qa: any) => add(`Q: ${qa.q}\nA: ${qa.a}`)));
        await Promise.all((data.sections || []).map((s: any) => add(`${s.title}\n${s.content}`)));
    }

    await retrieval.ensureEmbeddingsForDocument(documentId);
  } catch (e) {
    // 回退：拆分为摘要段
    // 即使在回退模式下，也尽量保持 Parent-Child 结构
    const cleaned = rawText.replace(/\s+/g, ' ').trim();
    
    // 1. 创建一个包含前2000字的“父块”（作为摘要）
    const summaryText = `[自动摘要] 由于文档解析受限，以下是文档前文内容：\n${cleaned.substring(0, 2000)}`;
    const parentChunks = await unifiedStorageManager.createChunks(documentId, [{
        content: summaryText,
        chunkType: 'parent',
        chunkIndex: 0,
        tokenCount: Math.ceil(summaryText.length / 4)
    }]);
    const parentId = parentChunks[0]?.id;

    // 2. 将全文按 1000 字切分，作为子块
    const chunks = [] as string[];
    for (let i = 0; i < cleaned.length; i += 1000) {
      chunks.push(cleaned.substring(i, i + 1000));
    }
    
    // 限制回退模式下的 chunks 数量，避免爆炸
    const limitedChunks = chunks.slice(0, 20); 
    
    if (parentId) {
        await Promise.all(limitedChunks.map((c, idx) => 
            unifiedStorageManager.createChunks(documentId, [{
                content: c,
                chunkType: 'child',
                parentId: parentId,
                chunkIndex: idx + 1, // 从 1 开始
                tokenCount: Math.ceil(c.length / 4)
            }])
        ));
    } else {
        // 如果父块创建失败，回退到普通块
        await Promise.all(limitedChunks.map(c => unifiedStorageManager.addManualChunk(documentId, c)));
    }

    await retrieval.ensureEmbeddingsForDocument(documentId);
  }
}
