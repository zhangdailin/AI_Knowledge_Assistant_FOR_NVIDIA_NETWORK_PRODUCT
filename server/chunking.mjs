/**
 * 语义增强的分片算法
 * 采用递归字符切分策略 (Recursive Character Text Splitting)
 * 优先保留段落、句子、代码块的完整性
 */

export function enhancedParentChildChunking(text, maxChunkSize = 4000, parentSize = 1000, childSize = 200) {
  const chunks = [];
  
  // 使用递归切分策略，带重叠窗口
  // overlap 设置为 chunk size 的 15-20% 左右
  const overlap = Math.floor(parentSize * 0.15);
  
  const smartChunks = recursiveSplit(text, parentSize, overlap);
  
  smartChunks.forEach((chunk, index) => {
    chunks.push({
      content: chunk,
      chunkType: 'parent',
      chunkIndex: index,
      tokenCount: Math.ceil(chunk.length / 4) // 估算token
    });
  });
  
  return chunks;
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
  
  return splitText(text, separators, chunkSize, chunkOverlap);
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
