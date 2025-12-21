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

    const add = async (content: string) => {
      if (content && content.trim().length >= 20) {
        await unifiedStorageManager.addManualChunk(documentId, content.trim());
      }
    };

    await add(data.summary);
    await Promise.all((data.topics || []).map((t: string) => add(`主题: ${t}`)));
    await Promise.all((data.sections || []).map((s: any) => add(`${s.title}\n${s.content}`)));
    await Promise.all((data.qa_pairs || []).map((qa: any) => add(`Q: ${qa.q}\nA: ${qa.a}`)));

    await retrieval.ensureEmbeddingsForDocument(documentId);
  } catch (e) {
    // 回退：拆分为摘要段
    const cleaned = rawText.replace(/\s+/g, ' ').trim();
    const chunks = [] as string[];
    for (let i = 0; i < cleaned.length; i += 1000) {
      chunks.push(cleaned.substring(i, i + 1000));
    }
    await Promise.all(chunks.slice(0, 6).map(c => unifiedStorageManager.addManualChunk(documentId, c)));
    await retrieval.ensureEmbeddingsForDocument(documentId);
  }
}
