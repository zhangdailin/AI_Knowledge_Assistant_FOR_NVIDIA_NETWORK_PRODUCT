/**
 * 优化文本用于embedding生成
 * 智能截断，保留重要信息（代码块、开头、结尾、关键句子）
 */
export function optimizeTextForEmbedding(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  
  // 1. 检测并提取代码块
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks: string[] = [];
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    codeBlocks.push(match[0]);
  }
  
  // 2. 提取关键句子（包含数字、命令关键词等）
  const sentences = text.split(/[。！？\n]/);
  const importantSentences: string[] = [];
  const normalSentences: string[] = [];
  
  const commandKeywords = ['nv', 'set', 'config', 'apply', 'show', '命令', '配置'];
  const hasNumbers = /\d+/;
  
  sentences.forEach(sentence => {
    const trimmed = sentence.trim();
    if (!trimmed) return;
    
    const hasCommand = commandKeywords.some(keyword => trimmed.toLowerCase().includes(keyword));
    const hasNumber = hasNumbers.test(trimmed);
    
    if (hasCommand || hasNumber) {
      importantSentences.push(trimmed);
    } else {
      normalSentences.push(trimmed);
    }
  });
  
  // 3. 构建优化后的文本
  let optimized = '';
  
  // 保留开头（前20%）
  const startLength = Math.floor(maxLength * 0.2);
  if (text.length > startLength) {
    optimized += text.substring(0, startLength) + '\n';
  }
  
  // 优先保留代码块
  codeBlocks.forEach(block => {
    if (optimized.length + block.length <= maxLength * 0.8) {
      optimized += block + '\n';
    }
  });
  
  // 优先保留重要句子
  importantSentences.forEach(sentence => {
    if (optimized.length + sentence.length <= maxLength * 0.7) {
      optimized += sentence + '。';
    }
  });
  
  // 如果还有空间，添加普通句子
  normalSentences.forEach(sentence => {
    if (optimized.length + sentence.length <= maxLength * 0.9) {
      optimized += sentence + '。';
    }
  });
  
  // 保留结尾（后20%）
  const endLength = Math.floor(maxLength * 0.2);
  if (text.length > endLength && optimized.length + endLength <= maxLength) {
    optimized += '\n' + text.substring(text.length - endLength);
  }
  
  // 如果优化后的文本仍然太长，直接截断
  if (optimized.length > maxLength) {
    optimized = optimized.substring(0, maxLength);
  }
  
  return optimized || text.substring(0, maxLength);
}

// 导出其他函数（占位符，避免测试失败）
export function preprocessText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function findNearestSentenceBoundary(text: string, position: number, maxLookback: number = 200, maxLookahead: number = 200): number {
  const sentenceEndings = /[。！？；\n\n\.!?;]/g;
  const matches: number[] = [];
  let match;
  
  while ((match = sentenceEndings.exec(text)) !== null) {
    matches.push(match.index + 1);
  }
  
  if (matches.length === 0) return position;
  
  let bestBoundary = position;
  let minDistance = Infinity;
  
  for (const boundary of matches) {
    const distance = Math.abs(boundary - position);
    if (distance < minDistance && 
        boundary >= position - maxLookback && 
        boundary <= position + maxLookahead) {
      minDistance = distance;
      bestBoundary = boundary;
    }
  }
  
  return bestBoundary;
}

export function findNearestParagraphBoundary(text: string, position: number, maxLookback: number = 500, maxLookahead: number = 500): number {
  const paragraphEndings = /\n\n+/g;
  const matches: number[] = [];
  let match;
  
  while ((match = paragraphEndings.exec(text)) !== null) {
    matches.push(match.index);
  }
  
  if (matches.length === 0) return position;
  
  let bestBoundary = position;
  let minDistance = Infinity;
  
  for (const boundary of matches) {
    const distance = Math.abs(boundary - position);
    if (distance < minDistance && 
        boundary >= position - maxLookback && 
        boundary <= position + maxLookahead) {
      minDistance = distance;
      bestBoundary = boundary;
    }
  }
  
  return bestBoundary;
}

export function smartChunk(text: string, targetSize: number, minSize: number = targetSize * 0.5, preferSentenceBoundary: boolean = true): string[] {
  const chunks: string[] = [];
  let currentPos = 0;
  
  while (currentPos < text.length) {
    const remaining = text.length - currentPos;
    
    if (remaining <= targetSize) {
      chunks.push(text.substring(currentPos).trim());
      break;
    }
    
    const idealSplit = currentPos + targetSize;
    let splitPos = idealSplit;
    
    if (preferSentenceBoundary) {
      const sentenceBoundary = findNearestSentenceBoundary(
        text,
        idealSplit,
        targetSize * 0.3,
        targetSize * 0.2
      );
      
      if (Math.abs(sentenceBoundary - idealSplit) < targetSize * 0.3) {
        splitPos = sentenceBoundary;
      }
    }
    
    if (splitPos - currentPos < minSize) {
      splitPos = currentPos + minSize;
    }
    
    const chunk = text.substring(currentPos, splitPos).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    
    currentPos = splitPos;
  }
  
  return chunks.filter(chunk => chunk.length >= 50);
}

export function detectCodeBlocks(text: string): Array<{ type: string; content: string; start: number; end: number }> {
  const blocks: Array<{ type: string; content: string; start: number; end: number }> = [];
  
  // 检测Markdown代码块
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    blocks.push({
      type: match[1] || 'code',
      content: match[2],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  // 检测行内代码
  const inlineCodeRegex = /`([^`]+)`/g;
  while ((match = inlineCodeRegex.exec(text)) !== null) {
    blocks.push({
      type: 'inline',
      content: match[1],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  return blocks;
}

export function isInCodeBlock(text: string, position: number): boolean {
  const blocks = detectCodeBlocks(text);
  return blocks.some(block => position >= block.start && position <= block.end);
}

export function enhancedParentChildChunking(text: string, maxChunkSize: number, parentSize: number, childSize: number): Array<{ content: string; chunkType: string; parentId?: string; chunkIndex: number; documentId?: string; metadata?: any }> {
  const chunks: Array<{ content: string; chunkType: string; parentId?: string; chunkIndex: number; documentId?: string; metadata?: any }> = [];
  const smartChunks = smartChunk(text, parentSize, childSize, true);
  
  smartChunks.forEach((chunk, index) => {
    const codeBlocks = detectCodeBlocks(chunk);
    const isCodeBlock = codeBlocks.length > 0;
    
    chunks.push({
      content: chunk,
      chunkType: 'parent',
      chunkIndex: index,
      metadata: { isCodeBlock }
    });
  });
  
  return chunks;
}

