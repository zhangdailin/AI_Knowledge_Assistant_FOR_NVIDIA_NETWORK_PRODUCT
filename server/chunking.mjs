/**
 * 语义增强的分片算法
 * 采用递归字符切分策略 (Recursive Character Text Splitting)
 * 优先保留段落、句子、代码块的完整性
 */

export function enhancedParentChildChunking(text, maxChunkSize = 4000, parentSize = 1000, childSize = 400) {
  const chunks = [];
  let globalChunkIndex = 0;

  // 1. 尝试基于 Markdown 结构切分 (Structure-Aware Split)
  // 如果文档包含 Headers (#, ##, ###)，则优先按 Headers 分组
  const hasHeaders = /^#{1,6}\s+.+$/m.test(text);
  
  if (hasHeaders) {
    console.log('[Chunking] Detected Markdown headers, using Structure-Aware splitting');
    const sections = splitByMarkdownHeaders(text);
    
    sections.forEach((section, sIndex) => {
       // 每个 Section 作为一个天然的父块 (Parent Chunk)
       const parentContent = section.content;
       const parentHeader = section.header;
       
       // 如果 section 内容过大 (超过 maxChunkSize)，可能需要进一步拆分 Parent
       // 但为了保持结构完整性，我们暂时允许 Parent 略大，或者对其进行 Recursive Split
       // 这里简单起见，如果 Parent 太大，我们还是得切，否则 Context Window 爆了
       
       let parentSubChunks = [parentContent];
       if (parentContent.length > maxChunkSize) {
           parentSubChunks = recursiveSplit(parentContent, maxChunkSize, 200);
       }
       
       parentSubChunks.forEach((subParentContent, subIndex) => {
           const parentId = `chunk-parent-${Date.now()}-${sIndex}-${subIndex}-${Math.random().toString(36).substr(2, 6)}`;
           
           // 添加父块
           chunks.push({
             id: parentId,
             content: subParentContent,
             chunkType: 'parent',
             chunkIndex: globalChunkIndex++,
             tokenCount: Math.ceil(subParentContent.length / 4),
             metadata: {
                 header: parentHeader // 保留标题信息
             }
           });
           
           // 2. 生成子块 (Recursive Split within Section)
           const childOverlap = Math.floor(childSize * 0.2);
           const childTexts = recursiveSplit(subParentContent, childSize, childOverlap);
           
           childTexts.forEach((childContent) => {
             // 优化：子块内容可以带上父块的 Header，增加语义 (可选)
             // const enrichedContent = parentHeader ? `[${parentHeader}]\n${childContent}` : childContent;
             chunks.push({
                content: childContent,
                chunkType: 'child',
                parentId: parentId,
                chunkIndex: globalChunkIndex++,
                tokenCount: Math.ceil(childContent.length / 4),
                metadata: {
                    header: parentHeader
                }
             });
           });
       });
    });
    
  } else {
    // Fallback: 传统的递归切分 (Recursive Split)
    console.log('[Chunking] No headers detected, using Recursive splitting');
    const parentOverlap = Math.floor(parentSize * 0.15);
    const parentTexts = recursiveSplit(text, parentSize, parentOverlap);
    
    parentTexts.forEach((parentContent, pIndex) => {
        const parentId = `chunk-parent-${Date.now()}-${pIndex}-${Math.random().toString(36).substr(2, 6)}`;
        chunks.push({
            id: parentId,
            content: parentContent,
            chunkType: 'parent',
            chunkIndex: globalChunkIndex++,
            tokenCount: Math.ceil(parentContent.length / 4)
        });
        
        const childOverlap = Math.floor(childSize * 0.2);
        const childTexts = recursiveSplit(parentContent, childSize, childOverlap);
        
        childTexts.forEach((childContent) => {
             chunks.push({
                content: childContent,
                chunkType: 'child',
                parentId: parentId,
                chunkIndex: globalChunkIndex++,
                tokenCount: Math.ceil(childContent.length / 4)
             });
        });
    });
  }
  
  return chunks;
}

// 辅助函数：按 Markdown 标题切分
function splitByMarkdownHeaders(text) {
    const lines = text.split('\n');
    const sections = [];
    let currentHeader = '';
    let currentBuffer = [];
    
    const flush = () => {
        if (currentBuffer.length > 0) {
            const content = currentBuffer.join('\n').trim();
            if (content.length > 0) {
                sections.push({
                    header: currentHeader,
                    content: content
                });
            }
        }
    };
    
    for (const line of lines) {
        // 匹配 # Header (H1-H3)
        // 只有当行首是 # 时才认为是标题，避免代码块内的注释被误判
        // 但这里简化处理，假设 Markdown 格式规范
        const match = line.match(/^(#{1,3})\s+(.*)/);
        if (match) {
            flush(); // 保存上一节
            currentHeader = match[2].trim(); // 提取标题文本
            currentBuffer = [line]; // 标题行也包含在内容中
        } else {
            currentBuffer.push(line);
        }
    }
    flush(); // 保存最后一节
    
    // 如果没有任何标题被匹配到（但 text.test 说有），可能是 regex 差异，兜底
    if (sections.length === 0 && text.trim().length > 0) {
        return [{ header: '', content: text }];
    }
    
    return sections;
}

// 递归切分核心逻辑
function recursiveSplit(text, chunkSize, chunkOverlap) {
  // 定义分隔符优先级：段落 > 换行 > 句子结束符 > 空格
  const separators = [
    "\n\n",   // 段落
    "\n",     // 换行
    /(?<=[。！？；!?;])/, // 句子结束符（保留标点）
    " ",      // 单词
    ""        // 字符（最后手段）
  ];
  
  // 1. 预处理：保护代码块不被切分
  // 将代码块替换为占位符，切分后再还原
  const codeBlocks = [];
  const placeholderPrefix = "___CODE_BLOCK_";
  
  // 匹配 Markdown 代码块 (```...```)
  const textWithPlaceholders = text.replace(/```[\s\S]*?```/g, (match) => {
    const placeholder = `${placeholderPrefix}${codeBlocks.length}___`;
    codeBlocks.push(match);
    return placeholder;
  });
  
  // 2. 执行切分
  const rawChunks = splitText(textWithPlaceholders, separators, chunkSize, chunkOverlap);
  
  // 3. 还原代码块
  const finalChunks = rawChunks.map(chunk => {
    return chunk.replace(new RegExp(`${placeholderPrefix}(\\d+)___`, 'g'), (match, index) => {
      const idx = parseInt(index);
      return codeBlocks[idx] || match;
    });
  });
  
  return finalChunks;
}

function splitText(text, separators, chunkSize, chunkOverlap) {
  const finalChunks = [];
  let separator = separators[0];
  let nextSeparators = separators.slice(1);
  
  // 1. 使用当前分隔符分割文本
  let splits = [];
  if (separator instanceof RegExp) {
    splits = text.split(separator).filter(s => s !== '');
  } else if (separator === "") {
    splits = Array.from(text); // 按字符分割
  } else {
    splits = text.split(separator);
  }
  
  // 2. 重新组合这些片段
  let currentDoc = [];
  let currentLength = 0;
  
  for (let split of splits) {
    // 恢复分隔符（如果是 regex split，分隔符可能丢失，这里简单处理：如果是字符串分隔符，且不是空字符，补回）
    // 为了简化，我们假设合并时会重新加上分隔符（除了 regex 情况）
    // 对于 regex split，split 结果通常已经包含了内容，或者是被 split 消耗掉了。
    // 这里我们采用简单的累积策略。
    
    const splitLen = split.length;
    
    if (currentLength + splitLen > chunkSize) {
      // 当前块已满，需要处理
      if (currentLength > 0) {
        // 如果当前累积的块本身就很大（且没法再分），或者我们已经到了字符级别
        const doc = joinDocs(currentDoc, separator);
        
        // 如果当前块还是太大，且还有更细的分隔符，递归处理它
        if (doc.length > chunkSize && nextSeparators.length > 0) {
           const subChunks = splitText(doc, nextSeparators, chunkSize, chunkOverlap);
           finalChunks.push(...subChunks);
        } else {
           finalChunks.push(doc);
        }
        
        // 处理重叠：保留末尾的一部分片段作为下一个块的开头
        // 这是一个简化的滑动窗口实现
        const overlapDocs = [];
        let overlapLength = 0;
        // 从后往前找，直到满足 overlap 要求
        for (let i = currentDoc.length - 1; i >= 0; i--) {
          const d = currentDoc[i];
          if (overlapLength + d.length > chunkOverlap) break;
          overlapDocs.unshift(d);
          overlapLength += d.length;
        }
        currentDoc = overlapDocs;
        currentLength = overlapLength;
      }
    }
    
    currentDoc.push(split);
    currentLength += splitLen + (typeof separator === 'string' ? separator.length : 0);
  }
  
  // 处理最后一个块
  if (currentDoc.length > 0) {
    const doc = joinDocs(currentDoc, separator);
    if (doc.length > chunkSize && nextSeparators.length > 0) {
       const subChunks = splitText(doc, nextSeparators, chunkSize, chunkOverlap);
       finalChunks.push(...subChunks);
    } else {
       finalChunks.push(doc);
    }
  }
  
  return finalChunks;
}

function joinDocs(docs, separator) {
  if (typeof separator === 'string') {
    return docs.join(separator);
  }
  // 对于 RegExp 分隔符，我们假设内容已经完整，直接连接
  return docs.join("");
}

// 辅助函数：检测代码块（防止切断代码块）
// 这是一个优化项，可以在 splitText 之前先提取代码块
function splitWithCodeBlocks(text) {
  // TODO: 如果需要更高级的逻辑，可以先提取 ```...``` 块，将其视为不可分割的原子
  // 目前递归切分已经能较好处理（因为代码块通常有换行）
  return [text];
}
