/**
 * Markdown 智能分片算法 v2
 *
 * 核心原则：
 * 1. 代码块永远不切分
 * 2. 按标题层级组织内容
 * 3. 每个 section 生成一个完整的 chunk（不再拆分父子块）
 * 4. 简洁可靠，避免过度工程
 */

/**
 * 主入口：Markdown 智能分片
 * @param {string} text - Markdown 文本
 * @param {number} maxChunkSize - 最大块大小（字符数）
 * @returns {Array} chunks 数组
 */
export function enhancedParentChildChunking(text, maxChunkSize = 3000) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    console.warn('[Chunking] 输入文本为空');
    return [];
  }

  const startTime = Date.now();
  console.log(`[Chunking] 开始处理文档，大小: ${Math.round(text.length / 1024)} KB`);

  try {
    // Step 1: 预处理 - 保护代码块
    const { processedText, codeBlocks } = protectCodeBlocks(text);

    // Step 2: 按标题分割成 sections
    const sections = splitBySections(processedText);
    console.log(`[Chunking] 解析出 ${sections.length} 个 sections`);

    // Step 3: 生成 chunks
    const chunks = [];
    let chunkIndex = 0;

    for (const section of sections) {
      // 还原代码块
      const content = restoreCodeBlocks(section.content, codeBlocks);

      if (content.trim().length < 50) continue; // 跳过太短的内容

      // 如果 section 内容不超过 maxChunkSize，直接作为一个 chunk
      if (content.length <= maxChunkSize) {
        chunks.push(createChunk(content, section.breadcrumbs, chunkIndex++));
      } else {
        // 内容太长，需要智能切分（但保护代码块）
        const subChunks = splitLargeSection(content, section.breadcrumbs, maxChunkSize, chunkIndex);
        chunks.push(...subChunks);
        chunkIndex += subChunks.length;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Chunking] 完成，生成 ${chunks.length} 个 chunks，耗时 ${elapsed}ms`);

    return chunks;

  } catch (error) {
    console.error('[Chunking] 处理出错:', error);
    // 降级：简单按段落切分
    return fallbackChunking(text, maxChunkSize);
  }
}

/**
 * 保护代码块 - 用占位符替换，避免被切断
 */
function protectCodeBlocks(text) {
  const codeBlocks = [];
  let index = 0;

  // 匹配 ``` 代码块
  const processedText = text.replace(/```[\s\S]*?```/g, (match) => {
    const placeholder = `__CODE_BLOCK_${index}__`;
    codeBlocks.push({ placeholder, content: match });
    index++;
    return placeholder;
  });

  return { processedText, codeBlocks };
}

/**
 * 还原代码块
 */
function restoreCodeBlocks(text, codeBlocks) {
  let result = text;
  for (const { placeholder, content } of codeBlocks) {
    result = result.replace(placeholder, content);
  }
  return result;
}

/**
 * 按标题分割成 sections
 */
function splitBySections(text) {
  const lines = text.split('\n');
  const sections = [];

  let currentSection = {
    breadcrumbs: [],
    content: [],
    level: 0
  };

  // 标题栈，用于跟踪层级
  const headingStack = []; // { level, title }

  for (const line of lines) {
    // 检测标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // 保存之前的 section（如果有内容）
      if (currentSection.content.length > 0) {
        sections.push({
          breadcrumbs: [...currentSection.breadcrumbs],
          content: currentSection.content.join('\n')
        });
      }

      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      // 更新标题栈
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });

      // 开始新的 section
      currentSection = {
        breadcrumbs: headingStack.map(h => h.title),
        content: [line], // 包含标题行
        level
      };
    } else {
      // 普通内容行
      currentSection.content.push(line);
    }
  }

  // 保存最后一个 section
  if (currentSection.content.length > 0) {
    sections.push({
      breadcrumbs: [...currentSection.breadcrumbs],
      content: currentSection.content.join('\n')
    });
  }

  // 如果没有找到任何标题，把整个文档作为一个 section
  if (sections.length === 0) {
    sections.push({
      breadcrumbs: [],
      content: text
    });
  }

  return sections;
}

/**
 * 切分过大的 section（保护代码块）
 */
function splitLargeSection(content, breadcrumbs, maxSize, startIndex) {
  const chunks = [];

  // 先按代码块分割
  const parts = [];
  let remaining = content;
  const codeBlockRegex = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match;

  // 重置 regex
  codeBlockRegex.lastIndex = 0;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // 代码块之前的文本
    if (match.index > lastIndex) {
      const beforeCode = content.slice(lastIndex, match.index);
      if (beforeCode.trim()) {
        parts.push({ type: 'text', content: beforeCode });
      }
    }
    // 代码块本身
    parts.push({ type: 'code', content: match[0] });
    lastIndex = match.index + match[0].length;
  }

  // 最后一段文本
  if (lastIndex < content.length) {
    const afterCode = content.slice(lastIndex);
    if (afterCode.trim()) {
      parts.push({ type: 'text', content: afterCode });
    }
  }

  // 如果没有代码块，直接按段落切分
  if (parts.length === 0) {
    parts.push({ type: 'text', content });
  }

  // 合并 parts 成 chunks
  let currentChunk = '';
  let chunkIndex = startIndex;
  const contextPrefix = breadcrumbs.length > 0 ? `[${breadcrumbs.join(' > ')}]\n\n` : '';

  for (const part of parts) {
    // 代码块特殊处理
    if (part.type === 'code') {
      // 如果代码块本身就超过 maxSize，单独作为一个 chunk
      if (part.content.length > maxSize) {
        // 先保存当前累积的内容
        if (currentChunk.trim()) {
          chunks.push(createChunk(contextPrefix + currentChunk, breadcrumbs, chunkIndex++));
          currentChunk = '';
        }
        // 代码块单独成 chunk（即使超长也不切）
        chunks.push(createChunk(contextPrefix + part.content, breadcrumbs, chunkIndex++));
      } else if (currentChunk.length + part.content.length > maxSize) {
        // 加入代码块会超限，先保存当前内容
        if (currentChunk.trim()) {
          chunks.push(createChunk(contextPrefix + currentChunk, breadcrumbs, chunkIndex++));
        }
        currentChunk = part.content;
      } else {
        currentChunk += part.content;
      }
    } else {
      // 文本内容，可以按段落切分
      const paragraphs = part.content.split(/\n\n+/);

      for (const para of paragraphs) {
        if (!para.trim()) continue;

        if (currentChunk.length + para.length + 2 > maxSize) {
          // 保存当前 chunk
          if (currentChunk.trim()) {
            chunks.push(createChunk(contextPrefix + currentChunk, breadcrumbs, chunkIndex++));
          }

          // 如果单个段落超长，强制切分
          if (para.length > maxSize) {
            const subParts = splitBysentences(para, maxSize);
            for (const subPart of subParts) {
              chunks.push(createChunk(contextPrefix + subPart, breadcrumbs, chunkIndex++));
            }
            currentChunk = '';
          } else {
            currentChunk = para;
          }
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + para;
        }
      }
    }
  }

  // 保存最后的内容
  if (currentChunk.trim()) {
    chunks.push(createChunk(contextPrefix + currentChunk, breadcrumbs, chunkIndex++));
  }

  return chunks;
}

/**
 * 按句子切分长文本
 */
function splitBysentences(text, maxSize) {
  const chunks = [];
  // 中英文句子边界
  const sentences = text.split(/(?<=[。！？；.!?;])\s*/);

  let current = '';
  for (const sentence of sentences) {
    if (current.length + sentence.length > maxSize) {
      if (current.trim()) {
        chunks.push(current.trim());
      }
      // 如果单个句子超长，强制切
      if (sentence.length > maxSize) {
        for (let i = 0; i < sentence.length; i += maxSize) {
          chunks.push(sentence.slice(i, i + maxSize));
        }
        current = '';
      } else {
        current = sentence;
      }
    } else {
      current += sentence;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * 创建 chunk 对象
 */
function createChunk(content, breadcrumbs, index) {
  const id = `chunk-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;

  return {
    id,
    content: content.trim(),
    chunkType: 'semantic', // 新类型：语义块
    chunkIndex: index,
    tokenCount: estimateTokens(content),
    metadata: {
      breadcrumbs: breadcrumbs || [],
      header: breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : null,
      summary: generateSummary(content, breadcrumbs)
    }
  };
}

/**
 * 估算 token 数
 */
function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 2 + otherChars / 4);
}

/**
 * 生成摘要
 */
function generateSummary(content, breadcrumbs) {
  const parts = [];

  if (breadcrumbs.length > 0) {
    parts.push(breadcrumbs[breadcrumbs.length - 1]);
  }

  // 提取 NVUE 命令
  const nvueCommands = content.match(/nv\s+(set|show|config|unset|action)\s+[^\n]+/gi);
  if (nvueCommands && nvueCommands.length > 0) {
    parts.push(`NVUE: ${nvueCommands.slice(0, 2).map(c => c.trim()).join('; ')}`);
  }

  // 提取技术术语
  const terms = extractTechTerms(content);
  if (terms.length > 0) {
    parts.push(`关键词: ${terms.slice(0, 5).join(', ')}`);
  }

  return parts.join(' | ') || 'No summary';
}

/**
 * 提取技术术语
 */
function extractTechTerms(text) {
  const terms = new Set();
  const patterns = [
    /\b(BGP|OSPF|EVPN|VXLAN|MLAG|CLAG|STP|LACP|LLDP|VLAN|VRF|ACL|BFD|PTP|SNMP|NTP|DHCP|DNS)\b/gi,
    /\b(PFC|ECN|RDMA|RoCE|DCQCN|QoS|CoS|DSCP)\b/gi,
    /\b(swp\d+|eth\d+|bond\d+|bridge|vni\d+|peerlink)\b/gi
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    matches.forEach(m => terms.add(m.toUpperCase()));
  }

  return Array.from(terms);
}

/**
 * 降级分片：简单按大小切分
 */
function fallbackChunking(text, maxSize) {
  console.log('[Chunking] 使用降级分片策略');
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);

  let current = '';
  let index = 0;

  for (const para of paragraphs) {
    if (current.length + para.length > maxSize) {
      if (current.trim()) {
        chunks.push(createChunk(current, [], index++));
      }
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }

  if (current.trim()) {
    chunks.push(createChunk(current, [], index++));
  }

  return chunks;
}
