/**
 * 参考文档展示优化工具
 * 负责去重、合并相邻分片、优化元数据显示
 */

/**
 * 优化搜索结果用于展示
 * @param {Array} results - 搜索结果 chunks
 * @param {Object} options - 配置选项
 * @returns {Array} 优化后的引用列表
 */
export function optimizeReferences(results, options = {}) {
    const {
        maxReferences = 10,
        mergeAdjacent = true,
        snippetLength = 300 // 合并后的每个引用最大预览长度（实际内容用于生成，但引用卡片往往只需预览）
    } = options;

    if (!results || results.length === 0) return [];

    // 1. 按文档分组
    const docsMap = new Map();

    results.forEach(item => {
        // 确保有 documentId，如果没有则作为未知文档处理
        const docId = item.documentId || 'unknown';

        if (!docsMap.has(docId)) {
            docsMap.set(docId, {
                docId,
                docTitle: item.documentName || item.metadata?.title || '未命名文档',
                chunks: []
            });
        }

        const docGroup = docsMap.get(docId);
        docGroup.chunks.push(item);
    });

    const optimizedRefs = [];

    // 2. 处理每个文档的分片
    for (const group of docsMap.values()) {
        // 按 chunkIndex 排序
        const sortedChunks = group.chunks.sort((a, b) => {
            const idxA = typeof a.chunkIndex === 'number' ? a.chunkIndex : -1;
            const idxB = typeof b.chunkIndex === 'number' ? b.chunkIndex : -1;
            return idxA - idxB;
        });

        if (!mergeAdjacent) {
            optimizedRefs.push(...sortedChunks);
            continue;
        }

        // 合并相邻分片
        let currentMerged = null;

        for (const chunk of sortedChunks) {
            if (!currentMerged) {
                currentMerged = createMergedRef(chunk, group.docTitle);
                continue;
            }

            // 检查是否相邻
            const isAdjacent = (
                chunk.chunkIndex === currentMerged.lastIndex + 1 || // 索引连续
                chunk.chunkIndex === currentMerged.lastIndex // 允许索引重叠（虽然不太可能）
            );

            // 检查元数据兼容性（例如同一个 section 下）
            // const isSameSection = chunk.metadata?.sectionId === currentMerged.firstMetadata?.sectionId;

            if (isAdjacent) {
                // 合并
                currentMerged.content += '\n\n' + chunk.content;
                currentMerged.lastIndex = chunk.chunkIndex;
                // 更新分数：取最大值
                currentMerged.score = Math.max(currentMerged.score, chunk.score || 0);
                // 累积来源信息
                if (chunk._sources) {
                    chunk._sources.forEach(s => currentMerged.sources.add(s));
                }
                currentMerged.mergedIds.push(chunk.id);
            } else {
                // 不相邻，保存当前合并块并开始新的
                finalizeMergedRef(currentMerged);
                optimizedRefs.push(currentMerged);

                currentMerged = createMergedRef(chunk, group.docTitle);
            }
        }

        if (currentMerged) {
            finalizeMergedRef(currentMerged);
            optimizedRefs.push(currentMerged);
        }
    }

    // 3. 全局排序 (按合并后的最高分)
    optimizedRefs.sort((a, b) => b.score - a.score);

    // 4. 限制数量
    return optimizedRefs.slice(0, maxReferences);
}

function createMergedRef(chunk, docTitle) {
    return {
        id: chunk.id, // 使用第一个chunk的ID作为主ID
        mergedIds: [chunk.id], // 记录合并了哪些ID
        documentId: chunk.documentId,
        documentName: docTitle,
        // 基础内容
        content: chunk.content,
        // 元数据
        metadata: { ...chunk.metadata },
        // 排序辅助
        chunkIndex: chunk.chunkIndex,
        lastIndex: chunk.chunkIndex,
        score: chunk.score || 0,
        sources: new Set(chunk._sources || []),
        // 标记为已优化引用
        isOptimized: true
    };
}

function finalizeMergedRef(ref) {
    // 转换 Set 为 Array
    ref._sources = Array.from(ref.sources);
    delete ref.sources;
    delete ref.lastIndex;
}
