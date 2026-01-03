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
 * 改进 Markdown 结构 - 修复 PDF 转换的常见问题
 * 注意：保守策略，避免过度修改导致内容破坏
 */
function improveMarkdownStructure(text) {
  let result = text;

  // 1. 只修复多个连续空行（最安全的操作）
  result = result.replace(/\n\n\n+/g, '\n\n');

  // 2. 修复列表缩进问题 - 标准化为 2 个空格（只处理过度缩进）
  result = result.replace(/^(\s{4,})(-|\*|\+)\s/gm, '  $2 ');

  // 3. 修复数学符号为普通文本（只处理特定的数学符号）
  result = result.replace(/\$\\equiv\$/g, '=');
  result = result.replace(/\$=\$/g, '=');

  // 注意：移除了以下可能破坏内容的操作：
  // - 不再修改标题层级（可能导致结构混乱）
  // - 不再转换短代码块为行内代码（可能丢失重要信息）
  // - 不再修改 NOTE/IMPORTANT 块格式（保持原始格式）

  return result;
}

/**
 * 将 HTML 表格转换为 Markdown 格式
 */
function convertHtmlTableToMarkdown(html) {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, tableContent) => {
    const rows = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    if (rows.length === 0) return match;

    const markdownRows = rows.map(row => {
      const cells = row.match(/<(td|th)[^>]*>([\s\S]*?)<\/(td|th)>/gi) || [];
      if (cells.length === 0) return null;

      const cellTexts = cells.map(cell => {
        // 提取 <td>/<th> 中的文本内容
        const text = cell.replace(/<\/?t[dh][^>]*>/gi, '').trim();
        // 移除嵌套的 HTML 标签
        return text.replace(/<[^>]+>/g, '').trim();
      });

      return { text: '| ' + cellTexts.join(' | ') + ' |', cellCount: cellTexts.length };
    }).filter(Boolean);

    if (markdownRows.length === 0) return match;

    // 构建 Markdown 表格
    const result = [];
    const firstRow = markdownRows[0];
    result.push(firstRow.text);
    result.push('| ' + Array(firstRow.cellCount).fill('---').join(' | ') + ' |');
    markdownRows.slice(1).forEach(row => result.push(row.text));

    return '\n' + result.join('\n') + '\n';
  });
}

/**
 * 将 Markdown 表格语义化（避免表格语法影响分块与检索）
 */
function convertMarkdownTablesToSemantic(text) {
  const lines = text.split('\n');
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    if (isMarkdownTableHeader(line, nextLine)) {
      const headerCells = parseMarkdownTableRow(line);
      i += 2;

      const bodyRows = [];
      while (i < lines.length && isMarkdownTableRow(lines[i])) {
        bodyRows.push(parseMarkdownTableRow(lines[i]));
        i += 1;
      }

      output.push('[表格开始]');
      if (headerCells.length > 0) {
        output.push(`[表头] ${headerCells.join(' | ')}`);
      }
      bodyRows.forEach(row => {
        output.push(`[表格内容] ${row.join(' | ')}`);
      });
      output.push('[表格结束]');
      continue;
    }

    output.push(line);
    i += 1;
  }

  return output.join('\n');
}

function isMarkdownTableHeader(line, nextLine) {
  if (!line || !nextLine) return false;
  return line.includes('|') && isMarkdownTableSeparator(nextLine);
}

function isMarkdownTableSeparator(line) {
  if (!line) return false;
  if (!line.includes('-')) return false;
  return /^\s*\|?[\s:-]+(\|[\s:-]+)+\|?\s*$/.test(line);
}

function isMarkdownTableRow(line) {
  if (!line) return false;
  if (!line.includes('|')) return false;
  return !isMarkdownTableSeparator(line);
}

function parseMarkdownTableRow(line) {
  const trimmed = line.trim();
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return withoutEdges.split('|').map(cell => {
    const cleaned = cell.replace(/<[^>]+>/g, '').trim();
    return cleaned;
  });
}

/**
 * 主入口：Markdown 智能分片
 * @param {string} text - Markdown 文本
 * @param {number} maxChunkSize - 最大块大小（字符数）
 * @param {number} parentSize - section 分块上限（可选）
 * @param {number} childSize - section 内部切分大小（可选）
 * @returns {Array} chunks 数组
 */
export function enhancedParentChildChunking(
  text,
  maxChunkSize = 3000,
  parentSize = null,
  childSize = null,
  options = {}
) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    console.warn('[Chunking] 输入文本为空');
    return [];
  }

  const startTime = Date.now();
  console.log(`[Chunking] 开始处理文档，大小: ${Math.round(text.length / 1024)} KB`);

  const effectiveParentSize = normalizeChunkSize(parentSize, maxChunkSize);
  const effectiveChildSize = normalizeChunkSize(childSize, effectiveParentSize);
  const chunkOptions = {
    documentType: options.documentType || 'general',
    includeSiblingMetadata: options.includeSiblingMetadata !== false,
    includeSectionContext: options.includeSectionContext !== false
  };

  try {
    // Step 0: 改进 Markdown 结构
    let improvedText = improveMarkdownStructure(text);

    // Step 1: 预处理 - 将 HTML 表格转换为 Markdown
    let processedInput = convertHtmlTableToMarkdown(improvedText);

    // Step 2: 预处理 - 保护代码块
    const { processedText, codeBlocks } = protectCodeBlocks(processedInput);

    // Step 3: Markdown 表格语义化
    const semanticText = convertMarkdownTablesToSemantic(processedText);

    // Step 4: 按标题分割成 sections
    let sections = splitBySections(semanticText);
    sections = sections.map((section, index) => ({
      ...section,
      sectionId: section.sectionId || `section-${index}`
    }));
    console.log(`[Chunking] 解析出 ${sections.length} 个 sections`);
    const siblingMap = chunkOptions.includeSiblingMetadata ? buildSiblingMap(sections) : new Map();

    // Step 5: 生成 chunks
    const chunks = [];
    let chunkIndex = 0;

    for (const section of sections) {
      // 还原代码块
      const content = restoreCodeBlocks(section.content, codeBlocks);

      if (shouldSkipSection(content, section.breadcrumbs, 50)) continue;

      const parentPath = section.breadcrumbs.slice(0, -1);
      const currentHeader = section.breadcrumbs.length > 0
        ? section.breadcrumbs[section.breadcrumbs.length - 1]
        : null;
      const siblingHeaders = chunkOptions.includeSiblingMetadata
        ? Array.from(siblingMap.get(makeParentKey(parentPath)) || []).filter(h => h !== currentHeader)
        : [];
      const sectionMetadata = {
        parentHeader: parentPath.length > 0 ? parentPath[parentPath.length - 1] : null,
        siblingHeaders,
        documentType: chunkOptions.documentType,
        sectionId: section.sectionId,
        sectionBreadcrumbs: section.breadcrumbs,
        sectionDepth: section.breadcrumbs.length
      };

      // 如果 section 内容不超过 parentSize，直接作为一个 chunk
      if (content.length <= effectiveParentSize) {
        chunks.push(createChunk(content, section.breadcrumbs, chunkIndex++, {
          ...sectionMetadata,
          includeContext: chunkOptions.includeSectionContext
        }));
      } else {
        // 内容太长，需要智能切分（但保护代码块）
        const subChunks = splitLargeSection(
          content,
          section.breadcrumbs,
          effectiveChildSize,
          chunkIndex,
          {
            ...sectionMetadata,
            includeContext: chunkOptions.includeSectionContext
          }
        );
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
    return fallbackChunking(text, effectiveParentSize);
  }
}

function normalizeChunkSize(size, fallback) {
  if (typeof size !== 'number' || Number.isNaN(size) || size <= 0) return fallback;
  return Math.round(size);
}

function shouldSkipSection(content, breadcrumbs, minLength) {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (trimmed.length >= minLength) return false;

  const hasHeader = breadcrumbs && breadcrumbs.length > 0;
  if (hasHeader) return false;

  const lines = trimmed.split('\n').map(line => line.trim()).filter(Boolean);
  const hasNonHeading = lines.some(line => !/^#{1,6}\s+/.test(line));
  return !hasNonHeading;
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
 * 还原代码块 - 优化为单次正则替换以提升性能
 */
function restoreCodeBlocks(text, codeBlocks) {
  if (codeBlocks.length === 0) return text;
  const placeholderMap = new Map(codeBlocks.map(b => [b.placeholder, b.content]));
  return text.replace(/__CODE_BLOCK_\d+__/g, (match) => placeholderMap.get(match) || match);
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

function buildSiblingMap(sections) {
  const map = new Map();
  sections.forEach(section => {
    const parentKey = makeParentKey(section.breadcrumbs.slice(0, -1));
    if (!map.has(parentKey)) map.set(parentKey, new Set());
    const header = section.breadcrumbs[section.breadcrumbs.length - 1];
    if (header) {
      map.get(parentKey).add(header);
    }
  });
  return map;
}

function makeParentKey(breadcrumbs = []) {
  return breadcrumbs.join('>');
}

/**
 * 切分过大的 section（保护代码块）
 * @param {number} overlapSize - 重叠大小（字符数），默认 300
 */
function splitLargeSection(content, breadcrumbs, maxSize, startIndex, baseMetadata = {}, overlapSize = 300) {
  const chunks = [];
  const effectiveOverlap = Math.min(overlapSize, Math.floor(maxSize * 0.2)); // 重叠不超过chunk的20%

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

  // 合并 parts 成 chunks（支持重叠）
  let currentChunk = '';
  let previousChunkTail = ''; // 保存前一个chunk的尾部用于重叠
  let chunkIndex = startIndex;
  const contextPrefix = breadcrumbs.length > 0 ? `[${breadcrumbs.join(' > ')}]\n\n` : '';

  for (const part of parts) {
    // 代码块特殊处理
    if (part.type === 'code') {
      // 如果代码块本身就超过 maxSize，单独作为一个 chunk
      if (part.content.length > maxSize) {
        // 先保存当前累积的内容（带重叠）
        if (currentChunk.trim()) {
          const fullContent = previousChunkTail + currentChunk;
          chunks.push(createChunk(contextPrefix + fullContent, breadcrumbs, chunkIndex++, baseMetadata));
          // 保存当前chunk的尾部
          previousChunkTail = extractTail(currentChunk, effectiveOverlap);
          currentChunk = '';
        }
        // 代码块单独成 chunk（即使超长也不切，但带重叠）
        const codeChunkContent = previousChunkTail + part.content;
        chunks.push(createChunk(contextPrefix + codeChunkContent, breadcrumbs, chunkIndex++, baseMetadata));
        previousChunkTail = ''; // 代码块后不保留重叠（避免重复代码块）
      } else if (currentChunk.length + part.content.length > maxSize) {
        // 加入代码块会超限，先保存当前内容（带重叠）
        if (currentChunk.trim()) {
          const fullContent = previousChunkTail + currentChunk;
          chunks.push(createChunk(contextPrefix + fullContent, breadcrumbs, chunkIndex++, baseMetadata));
          previousChunkTail = extractTail(currentChunk, effectiveOverlap);
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
          // 保存当前 chunk（带重叠）
          if (currentChunk.trim()) {
            const fullContent = previousChunkTail + currentChunk;
            chunks.push(createChunk(contextPrefix + fullContent, breadcrumbs, chunkIndex++, baseMetadata));
            previousChunkTail = extractTail(currentChunk, effectiveOverlap);
          }

          // 如果单个段落超长，强制切分（带重叠）
          if (para.length > maxSize) {
            const subParts = splitBysentences(para, maxSize);
            for (let i = 0; i < subParts.length; i++) {
              const subContent = (i === 0 ? previousChunkTail : '') + subParts[i];
              chunks.push(createChunk(contextPrefix + subContent, breadcrumbs, chunkIndex++, baseMetadata));
              if (i < subParts.length - 1) {
                previousChunkTail = extractTail(subParts[i], effectiveOverlap);
              }
            }
            previousChunkTail = extractTail(subParts[subParts.length - 1], effectiveOverlap);
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

  // 保存最后的内容（带重叠）
  if (currentChunk.trim()) {
    const fullContent = previousChunkTail + currentChunk;
    chunks.push(createChunk(contextPrefix + fullContent, breadcrumbs, chunkIndex++, baseMetadata));
  }

  return chunks;
}

/**
 * 提取文本尾部用于重叠
 * 优先在句子/段落边界截取，避免切断语义
 */
function extractTail(text, overlapSize) {
  if (!text || overlapSize <= 0) return '';
  if (text.length <= overlapSize) return text;

  // 从目标位置往前找句子边界
  const startPos = Math.max(0, text.length - overlapSize);
  const tail = text.slice(startPos);

  // 尝试在句子边界处切分（中英文）
  const sentenceBoundaries = ['\n\n', '。\n', '.\n', '！\n', '?\n', ';\n'];
  for (const boundary of sentenceBoundaries) {
    const idx = tail.indexOf(boundary);
    if (idx !== -1 && idx < overlapSize * 0.8) {
      // 找到边界且不会丢失太多内容
      return tail.slice(idx + boundary.length);
    }
  }

  // 没找到合适边界，直接截取
  return tail;
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
function createChunk(content, breadcrumbs, index, extraMetadata = {}) {
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
      summary: generateSummary(content, breadcrumbs),
      context: extraMetadata.includeContext ? buildContextSnippet(content) : undefined,
      parentHeader: extraMetadata.parentHeader,
      siblingHeaders: extraMetadata.siblingHeaders,
      documentType: extraMetadata.documentType,
      sectionId: extraMetadata.sectionId,
      sectionBreadcrumbs: extraMetadata.sectionBreadcrumbs,
      sectionDepth: extraMetadata.sectionDepth
    }
  };
}

function buildContextSnippet(content) {
  if (!content) return '';
  const trimmed = content.replace(/\s+/g, ' ').trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

/**
 * 估算 token 数 - 采用更接近 OpenAI/Qwen 的权重算法
 */
function estimateTokens(text) {
  if (!text) return 0;
  // 预估：中文字符约为 0.6 token，英文字符/数字约为 0.3 token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  return Math.ceil(chineseChars * 0.6 + (text.length - chineseChars) * 0.3);
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
