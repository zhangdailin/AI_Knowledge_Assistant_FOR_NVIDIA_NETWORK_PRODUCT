import { aiModelManager } from './aiModels';
import { unifiedStorageManager } from './localStorage';
import { retrieval } from './retrieval';

// 将 HTML 表格转换为 Markdown 格式
function convertHtmlTableToMarkdown(html: string): string {
  // 匹配 <table>...</table> 块
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, tableContent) => {
    const rows = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    if (rows.length === 0) return match;

    const markdownRows = rows.map(row => {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      const cellTexts = cells.map(cell => {
        // 提取 <td>...</td> 中的文本内容
        const text = cell.replace(/<td[^>]*>/gi, '').replace(/<\/td>/gi, '').trim();
        // 移除嵌套的 HTML 标签
        return text.replace(/<[^>]+>/g, '').trim();
      });
      return '| ' + cellTexts.join(' | ') + ' |';
    });

    if (markdownRows.length === 0) return match;

    // 添加分隔符行（在第一行后）
    const result = [markdownRows[0]];
    result.push('| ' + markdownRows[0].split('|').slice(1, -1).map(() => '---').join(' | ') + ' |');
    result.push(...markdownRows.slice(1));

    return '\n' + result.join('\n') + '\n';
  });
}

export async function llmIndexDocument(documentId: string, rawText: string) {
  // 预处理：将 HTML 表格转换为 Markdown 格式
  const processedText = convertHtmlTableToMarkdown(rawText);

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

原文：\n\n${processedText.substring(0, 12000)}`;

  // 对于长文本，增加超时时间（通过传递更长的 context 来触发索引任务模式）
  // prompt 已经包含了长文本，会自动触发 60 秒超时
  try {
    const res = await aiModelManager.generateAnswer({ question: prompt });
    const text = res.answer.trim();

    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');

    if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('LLM did not return valid JSON');
    }

    const jsonStr = text.slice(jsonStart, jsonEnd + 1);
    const data = JSON.parse(jsonStr);

    // ... (rest of the processing logic)

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
    console.warn(`[Indexing] LLM structuring failed for ${documentId}, falling back to rule-based chunking:`, e);
    // 回退：拆分为摘要段
    // 即使在回退模式下，也尽量保持 Parent-Child 结构

    // 简单分块逻辑：如果原文是 Markdown，按标题拆分
    // 如果不是，按固定长度拆分

    // 预处理：先转换 HTML 表格
    const processedFallbackText = convertHtmlTableToMarkdown(rawText);
    const isMarkdown = processedFallbackText.includes('# ');
    let sections: { title: string; content: string }[] = [];

    if (isMarkdown) {
         // 增强的 Markdown 解析
         const lines = processedFallbackText.split('\n');
         let currentSection = { title: 'Introduction', content: '' };
         let inCodeBlock = false;

         lines.forEach(line => {
             // 检测代码块状态
             if (line.trim().startsWith('```')) {
                 inCodeBlock = !inCodeBlock;
             }

             // 只有在非代码块时，才识别标题
             if (!inCodeBlock && line.startsWith('#')) {
                 if (currentSection.content.trim().length > 0) {
                     sections.push(currentSection);
                 }
                 // 清理标题中的 # 和多余空格
                 const title = line.replace(/^#+\s+/, '').trim();
                 currentSection = { title: title || 'Section', content: '' };
             } else {
                 currentSection.content += line + '\n';
             }
         });
         if (currentSection.content.trim().length > 0) {
             sections.push(currentSection);
         }
    } else {
        // 按长度拆分
        const cleaned = processedFallbackText.replace(/\s+/g, ' ').trim();
        for (let i = 0; i < cleaned.length; i += 1000) {
            sections.push({
                title: `Part ${Math.floor(i/1000) + 1}`,
                content: cleaned.substring(i, i + 1000)
            });
        }
    }

    // 限制 chunks 数量，避免爆炸
    // 如果 sections 太多，可以合并
    if (sections.length > 50) {
        // 合并
        const mergedSections = [];
        let current = sections[0];
        for (let i = 1; i < sections.length; i++) {
            if (current.content.length + sections[i].content.length < 1500) {
                current.content += '\n' + sections[i].content;
            } else {
                mergedSections.push(current);
                current = sections[i];
            }
        }
        mergedSections.push(current);
        sections = mergedSections;
    }

    // 1. 创建一个包含前2000字的"父块"（作为摘要）
    const summaryText = `[自动摘要] 由于LLM解析失败，使用规则分块。文档前文：\n${processedFallbackText.substring(0, 1000).replace(/\s+/g, ' ')}`;
    const parentChunks = await unifiedStorageManager.createChunks(documentId, [{
        content: summaryText,
        chunkType: 'parent',
        chunkIndex: 0,
        tokenCount: Math.ceil(summaryText.length / 4)
    }]);
    const parentId = parentChunks[0]?.id;

    if (parentId) {
        await Promise.all(sections.map((sec, idx) =>
            unifiedStorageManager.createChunks(documentId, [{
                content: `[${sec.title}]\n${sec.content}`,
                chunkType: 'child',
                parentId: parentId,
                chunkIndex: idx + 1,
                tokenCount: Math.ceil(sec.content.length / 4)
            }])
        ));
    } else {
        // 如果父块创建失败，回退到普通块
        await Promise.all(sections.map(sec => unifiedStorageManager.addManualChunk(documentId, `${sec.title}\n${sec.content}`)));
    }

    await retrieval.ensureEmbeddingsForDocument(documentId);
  }
}
