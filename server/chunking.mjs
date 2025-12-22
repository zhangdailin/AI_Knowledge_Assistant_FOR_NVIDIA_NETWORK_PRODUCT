/**
 * Markdown 语义感知的父子块分片算法
 * 
 * 专门针对 Markdown 文档特性优化：
 * 1. 标题层级（H1-H6）作为自然的父块边界
 * 2. 代码块、表格、列表等作为不可分割的语义单元
 * 3. 子块继承父块的上下文（标题路径）
 * 4. 智能合并小段落，避免过于碎片化
 */

/**
 * 主入口：Markdown 感知的父子块分片
 */
export function enhancedParentChildChunking(text, maxChunkSize = 4000, parentSize = 2000, childSize = 600) {
  // 1. 解析 Markdown 为语义块
  const semanticBlocks = parseMarkdownToBlocks(text);
  
  console.log(`[Chunking] 解析出 ${semanticBlocks.length} 个语义块`);
  
  // 2. 根据标题层级组织父子块
  const chunks = organizeIntoParentChildChunks(semanticBlocks, maxChunkSize, parentSize, childSize);
  
  console.log(`[Chunking] 生成 ${chunks.length} 个 chunks (父: ${chunks.filter(c => c.chunkType === 'parent').length}, 子: ${chunks.filter(c => c.chunkType === 'child').length})`);
  
  return chunks;
}

/**
 * 语义块类型
 */
const BlockType = {
  HEADING: 'heading',      // 标题
  PARAGRAPH: 'paragraph',  // 段落
  CODE_BLOCK: 'code_block', // 代码块
  TABLE: 'table',          // 表格
  LIST: 'list',            // 列表（有序/无序）
  BLOCKQUOTE: 'blockquote', // 引用块
  HORIZONTAL_RULE: 'hr',   // 分隔线
  EMPTY: 'empty'           // 空行
};

/**
 * 解析 Markdown 为语义块数组
 */
function parseMarkdownToBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // 1. 空行
    if (trimmedLine === '') {
      i++;
      continue;
    }
    
    // 2. 标题 (# ## ### etc.)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: BlockType.HEADING,
        level: headingMatch[1].length,
        content: line,
        title: headingMatch[2].trim()
      });
      i++;
      continue;
    }
    
    // 3. 代码块 (```)
    if (trimmedLine.startsWith('```')) {
      const codeLines = [line];
      i++;
      while (i < lines.length) {
        codeLines.push(lines[i]);
        if (lines[i].trim().startsWith('```') && codeLines.length > 1) {
          i++;
          break;
        }
        i++;
      }
      blocks.push({
        type: BlockType.CODE_BLOCK,
        content: codeLines.join('\n'),
        language: trimmedLine.slice(3).trim() || 'text'
      });
      continue;
    }
    
    // 4. 表格 (| col | col |)
    if (isTableLine(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && (isTableLine(lines[i]) || isTableSeparator(lines[i]))) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: BlockType.TABLE,
        content: tableLines.join('\n'),
        rows: parseTableToSemantic(tableLines)
      });
      continue;
    }
    
    // 5. 无序列表 (-, *, +)
    if (/^[\s]*[-*+]\s+/.test(line)) {
      const listLines = [];
      const baseIndent = line.search(/\S/);
      
      while (i < lines.length) {
        const currentLine = lines[i];
        const currentIndent = currentLine.search(/\S/);
        
        // 继续收集列表项：同级或缩进更多的行，或空行（用于分隔列表项内的段落）
        if (currentLine.trim() === '' || 
            /^[\s]*[-*+]\s+/.test(currentLine) || 
            (currentIndent > baseIndent && currentLine.trim() !== '')) {
          listLines.push(currentLine);
          i++;
        } else {
          break;
        }
      }
      
      blocks.push({
        type: BlockType.LIST,
        listType: 'unordered',
        content: listLines.join('\n').trim()
      });
      continue;
    }
    
    // 6. 有序列表 (1. 2. 3.)
    if (/^[\s]*\d+\.\s+/.test(line)) {
      const listLines = [];
      const baseIndent = line.search(/\S/);
      
      while (i < lines.length) {
        const currentLine = lines[i];
        const currentIndent = currentLine.search(/\S/);
        
        if (currentLine.trim() === '' || 
            /^[\s]*\d+\.\s+/.test(currentLine) || 
            (currentIndent > baseIndent && currentLine.trim() !== '')) {
          listLines.push(currentLine);
          i++;
        } else {
          break;
        }
      }
      
      blocks.push({
        type: BlockType.LIST,
        listType: 'ordered',
        content: listLines.join('\n').trim()
      });
      continue;
    }
    
    // 7. 引用块 (>)
    if (trimmedLine.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && (lines[i].trim().startsWith('>') || lines[i].trim() === '')) {
        if (lines[i].trim() === '' && i + 1 < lines.length && !lines[i + 1].trim().startsWith('>')) {
          break;
        }
        quoteLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: BlockType.BLOCKQUOTE,
        content: quoteLines.join('\n').trim()
      });
      continue;
    }
    
    // 8. 分隔线 (---, ***, ___)
    if (/^[-*_]{3,}$/.test(trimmedLine)) {
      blocks.push({
        type: BlockType.HORIZONTAL_RULE,
        content: line
      });
      i++;
      continue;
    }
    
    // 9. HTML 表格
    if (trimmedLine.startsWith('<table')) {
      const htmlLines = [line];
      i++;
      while (i < lines.length && !lines[i - 1].includes('</table>')) {
        htmlLines.push(lines[i]);
        i++;
      }
      const htmlContent = htmlLines.join('\n');
      blocks.push({
        type: BlockType.TABLE,
        content: convertHtmlTableToSemantic(htmlContent),
        isHtml: true
      });
      continue;
    }
    
    // 10. 普通段落
    const paragraphLines = [];
    while (i < lines.length) {
      const currentLine = lines[i];
      const currentTrimmed = currentLine.trim();
      
      // 段落结束条件
      if (currentTrimmed === '' ||                    // 空行
          currentTrimmed.startsWith('#') ||           // 标题
          currentTrimmed.startsWith('```') ||         // 代码块
          currentTrimmed.startsWith('>') ||           // 引用
          /^[-*+]\s+/.test(currentTrimmed) ||         // 无序列表
          /^\d+\.\s+/.test(currentTrimmed) ||         // 有序列表
          /^[-*_]{3,}$/.test(currentTrimmed) ||       // 分隔线
          (isTableLine(currentLine) && i + 1 < lines.length && isTableSeparator(lines[i + 1]))) {
        break;
      }
      
      paragraphLines.push(currentLine);
      i++;
    }
    
    if (paragraphLines.length > 0) {
      blocks.push({
        type: BlockType.PARAGRAPH,
        content: paragraphLines.join('\n').trim()
      });
    }
  }
  
  return blocks;
}

/**
 * 将语义块组织为父子块结构
 */
function organizeIntoParentChildChunks(blocks, maxChunkSize, parentSize, childSize) {
  const chunks = [];
  let globalIndex = 0;
  
  // 构建章节树
  const sections = buildSectionTree(blocks);
  
  // 遍历章节生成 chunks
  for (const section of sections) {
    const sectionChunks = processSectionV2(section, [], maxChunkSize, parentSize, childSize);
    for (const chunk of sectionChunks) {
      chunk.chunkIndex = globalIndex++;
      chunks.push(chunk);
    }
  }
  
  return chunks;
}

/**
 * 构建章节树
 * H1/H2 作为主要章节边界
 */
function buildSectionTree(blocks) {
  const sections = [];
  let currentSection = null;
  let currentSubSection = null;
  
  for (const block of blocks) {
    if (block.type === BlockType.HEADING) {
      if (block.level <= 2) {
        // H1/H2: 新的主章节
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          heading: block,
          blocks: [],
          subSections: []
        };
        currentSubSection = null;
      } else {
        // H3+: 子章节
        if (!currentSection) {
          currentSection = {
            heading: null,
            blocks: [],
            subSections: []
          };
        }
        
        if (currentSubSection) {
          currentSection.subSections.push(currentSubSection);
        }
        
        currentSubSection = {
          heading: block,
          blocks: []
        };
      }
    } else {
      // 非标题块
      if (currentSubSection) {
        currentSubSection.blocks.push(block);
      } else if (currentSection) {
        currentSection.blocks.push(block);
      } else {
        // 没有任何标题的内容
        currentSection = {
          heading: null,
          blocks: [block],
          subSections: []
        };
      }
    }
  }
  
  // 收尾
  if (currentSubSection && currentSection) {
    currentSection.subSections.push(currentSubSection);
  }
  if (currentSection) {
    sections.push(currentSection);
  }
  
  return sections;
}

/**
 * 处理一个章节，生成父子块
 */
function processSectionV2(section, breadcrumbs, maxChunkSize, parentSize, childSize) {
  const chunks = [];
  
  // 更新面包屑
  const sectionTitle = section.heading?.title || '';
  const currentBreadcrumbs = sectionTitle ? [...breadcrumbs, sectionTitle] : breadcrumbs;
  
  // 收集本章节的所有内容（不包括子章节）
  const sectionContent = buildSectionContent(section, currentBreadcrumbs);
  
  if (sectionContent.length > 0) {
    // 创建父块
    const parentChunks = createParentChunks(sectionContent, currentBreadcrumbs, maxChunkSize, parentSize, childSize);
    chunks.push(...parentChunks);
  }
  
  // 递归处理子章节
  for (const subSection of section.subSections || []) {
    const subChunks = processSectionV2(subSection, currentBreadcrumbs, maxChunkSize, parentSize, childSize);
    chunks.push(...subChunks);
  }
  
  return chunks;
}

/**
 * 构建章节内容
 */
function buildSectionContent(section, breadcrumbs) {
  const parts = [];
  
  // 添加标题
  if (section.heading) {
    parts.push(section.heading.content);
  }
  
  // 添加块内容
  for (const block of section.blocks || []) {
    parts.push(formatBlock(block));
  }
  
  return parts.join('\n\n').trim();
}

/**
 * 格式化语义块为文本
 */
function formatBlock(block) {
  switch (block.type) {
    case BlockType.TABLE:
      // 如果已经转换为语义格式
      if (block.rows) {
        return formatTableAsSemantic(block.rows);
      }
      return block.content;
    
    case BlockType.CODE_BLOCK:
      return block.content;
    
    case BlockType.LIST:
      return block.content;
    
    case BlockType.BLOCKQUOTE:
      return block.content;
    
    default:
      return block.content;
  }
}

/**
 * 将表格格式化为语义文本
 */
function formatTableAsSemantic(rows) {
  if (!rows || rows.length === 0) return '';
  
  const lines = ['[表格开始]'];
  rows.forEach((row, idx) => {
    lines.push(`行${idx + 1}: ${row}`);
  });
  lines.push('[表格结束]');
  
  return lines.join('\n');
}

/**
 * 创建父块和子块
 */
function createParentChunks(content, breadcrumbs, maxChunkSize, parentSize, childSize) {
  const chunks = [];
  
  if (!content || content.trim().length === 0) {
    return chunks;
  }
  
  // 如果内容小于父块大小，直接作为一个父块
  if (content.length <= parentSize) {
    const parentId = generateId('parent');
    
    // 父块内容添加面包屑上下文
    const contextPrefix = breadcrumbs.length > 0 ? `[${breadcrumbs.join(' > ')}]\n\n` : '';
    const parentContent = contextPrefix + content;
    
    chunks.push({
      id: parentId,
      content: parentContent,
      chunkType: 'parent',
      tokenCount: estimateTokens(parentContent),
      metadata: {
        breadcrumbs: breadcrumbs,
        header: breadcrumbs[breadcrumbs.length - 1] || null,
        summary: generateSummary(content, breadcrumbs)
      }
    });
    
    // 创建子块
    const childChunks = createChildChunksV2(content, parentId, breadcrumbs, childSize);
    chunks.push(...childChunks);
    
  } else {
    // 内容过大，需要分割
    const segments = splitContentIntoSegments(content, parentSize, maxChunkSize);
    
    segments.forEach((segment, segIdx) => {
      const parentId = generateId('parent');
      
      const contextPrefix = breadcrumbs.length > 0 
        ? `[${breadcrumbs.join(' > ')}]${segments.length > 1 ? ` (${segIdx + 1}/${segments.length})` : ''}\n\n`
        : '';
      const parentContent = contextPrefix + segment;
      
      chunks.push({
        id: parentId,
        content: parentContent,
        chunkType: 'parent',
        tokenCount: estimateTokens(parentContent),
        metadata: {
          breadcrumbs: breadcrumbs,
          header: breadcrumbs[breadcrumbs.length - 1] || null,
          segmentIndex: segIdx,
          totalSegments: segments.length,
          summary: generateSummary(segment, breadcrumbs)
        }
      });
      
      // 创建子块
      const childChunks = createChildChunksV2(segment, parentId, breadcrumbs, childSize);
      chunks.push(...childChunks);
    });
  }
  
  return chunks;
}

/**
 * 将内容分割为多个段落
 * 优先在语义边界分割
 */
function splitContentIntoSegments(content, targetSize, maxSize) {
  const segments = [];
  
  // 1. 先按双换行分割为段落
  const paragraphs = content.split(/\n\n+/);
  
  let currentSegment = [];
  let currentLength = 0;
  
  for (const para of paragraphs) {
    const paraLength = para.length;
    
    // 如果当前段落加入后超过目标大小
    if (currentLength + paraLength > targetSize && currentSegment.length > 0) {
      segments.push(currentSegment.join('\n\n'));
      currentSegment = [];
      currentLength = 0;
    }
    
    // 如果单个段落就超过目标大小
    if (paraLength > targetSize) {
      // 检查是否是受保护的块（代码块、表格）
      if (isProtectedBlock(para)) {
        // 受保护块不切分，直接作为一个段
        if (currentSegment.length > 0) {
          segments.push(currentSegment.join('\n\n'));
          currentSegment = [];
          currentLength = 0;
        }
        segments.push(para);
      } else {
        // 普通大段落，按句子切分
        const sentences = splitBySentences(para);
        for (const sentence of sentences) {
          if (currentLength + sentence.length > targetSize && currentSegment.length > 0) {
            segments.push(currentSegment.join('\n\n'));
            currentSegment = [];
            currentLength = 0;
          }
          currentSegment.push(sentence);
          currentLength += sentence.length;
        }
      }
    } else {
      currentSegment.push(para);
      currentLength += paraLength + 2;
    }
  }
  
  // 收尾
  if (currentSegment.length > 0) {
    segments.push(currentSegment.join('\n\n'));
  }
  
  return segments.filter(s => s && s.trim().length > 0);
}

/**
 * 检查是否是受保护的块（不应该被切分）
 */
function isProtectedBlock(text) {
  const trimmed = text.trim();
  
  // 代码块
  if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
    return true;
  }
  
  // 表格
  if (trimmed.startsWith('[表格开始]') || trimmed.includes('[表格结束]')) {
    return true;
  }
  
  // Markdown 表格
  if (trimmed.includes('|') && trimmed.includes('---')) {
    return true;
  }
  
  return false;
}

/**
 * 创建子块 V2
 */
function createChildChunksV2(content, parentId, breadcrumbs, childSize) {
  const chunks = [];
  
  if (!content || content.length <= childSize) {
    // 内容太短，不需要子块，或者直接作为一个子块
    if (content && content.length > 50) {
      chunks.push({
        content: content,
        chunkType: 'child',
        parentId: parentId,
        tokenCount: estimateTokens(content),
        metadata: {
          childIndex: 0,
          totalChildren: 1
        }
      });
    }
    return chunks;
  }
  
  // 分割内容
  const childTexts = splitForChildren(content, childSize);
  
  // 重叠量
  const overlap = Math.floor(childSize * 0.1);
  
  for (let i = 0; i < childTexts.length; i++) {
    let childContent = childTexts[i];
    
    // 为子块添加简短上下文（只在非首个子块时添加）
    if (i > 0 && breadcrumbs.length > 0) {
      const shortContext = `[...${breadcrumbs[breadcrumbs.length - 1] || '续'}]`;
      childContent = shortContext + '\n' + childContent;
    }
    
    chunks.push({
      content: childContent,
      chunkType: 'child',
      parentId: parentId,
      tokenCount: estimateTokens(childContent),
      metadata: {
        childIndex: i,
        totalChildren: childTexts.length
      }
    });
  }
  
  return chunks;
}

/**
 * 为子块分割内容
 */
function splitForChildren(content, childSize) {
  const children = [];
  
  // 按段落分割
  const paragraphs = content.split(/\n\n+/);
  
  let current = [];
  let currentLen = 0;
  
  for (const para of paragraphs) {
    // 如果是受保护块，不切分
    if (isProtectedBlock(para)) {
      if (current.length > 0) {
        children.push(current.join('\n\n'));
        current = [];
        currentLen = 0;
      }
      children.push(para);
      continue;
    }
    
    if (currentLen + para.length > childSize && current.length > 0) {
      children.push(current.join('\n\n'));
      current = [];
      currentLen = 0;
    }
    
    if (para.length > childSize) {
      // 大段落按句子分
      const sentences = splitBySentences(para);
      for (const s of sentences) {
        if (currentLen + s.length > childSize && current.length > 0) {
          children.push(current.join('\n\n'));
          current = [];
          currentLen = 0;
        }
        current.push(s);
        currentLen += s.length;
      }
    } else {
      current.push(para);
      currentLen += para.length + 2;
    }
  }
  
  if (current.length > 0) {
    children.push(current.join('\n\n'));
  }
  
  return children.filter(c => c && c.trim().length > 0);
}

/**
 * 按句子分割
 */
function splitBySentences(text) {
  // 中英文句子结束符
  const sentences = text.split(/(?<=[。！？；!?;.])\s*/);
  return sentences.filter(s => s && s.trim().length > 0);
}

// ========== 辅助函数 ==========

function isTableLine(line) {
  if (!line) return false;
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
}

function isTableSeparator(line) {
  if (!line) return false;
  const trimmed = line.trim();
  return /^\|[\s\-:]+\|/.test(trimmed);
}

/**
 * 解析 Markdown 表格为语义格式
 */
function parseTableToSemantic(tableLines) {
  if (!tableLines || tableLines.length < 2) return null;
  
  // 解析表头
  const headers = parseTableRow(tableLines[0]);
  
  // 跳过分隔符行（第二行）
  const rows = [];
  for (let i = 2; i < tableLines.length; i++) {
    if (!isTableSeparator(tableLines[i])) {
      const cells = parseTableRow(tableLines[i]);
      if (cells.length > 0) {
        if (headers.length === cells.length) {
          const rowDesc = cells.map((cell, idx) => `${headers[idx]}=${cell}`).join(', ');
          rows.push(rowDesc);
        } else {
          rows.push(cells.join(' | '));
        }
      }
    }
  }
  
  return rows;
}

function parseTableRow(line) {
  if (!line) return [];
  return line.split('|')
    .map(cell => cell.trim())
    .filter((cell, idx, arr) => idx > 0 && idx < arr.length - 1 && cell.length >= 0);
}

/**
 * 转换 HTML 表格为语义文本
 */
function convertHtmlTableToSemantic(html) {
  const rows = [];
  const headers = [];
  
  // 提取表头
  const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
  let thMatch;
  while ((thMatch = thRegex.exec(html)) !== null) {
    headers.push(cleanHtml(thMatch[1]));
  }
  
  // 提取行
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  let rowIndex = 0;
  
  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowContent = trMatch[1];
    const cells = [];
    
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowContent)) !== null) {
      cells.push(cleanHtml(tdMatch[1]));
    }
    
    if (cells.length > 0) {
      if (headers.length > 0 && headers.length === cells.length) {
        const rowDesc = cells.map((cell, i) => `${headers[i]}=${cell}`).join(', ');
        rows.push(`行${rowIndex + 1}: ${rowDesc}`);
      } else {
        rows.push(`行${rowIndex + 1}: ${cells.join(' | ')}`);
      }
      rowIndex++;
    }
  }
  
  if (rows.length > 0) {
    return `[表格开始]\n${rows.join('\n')}\n[表格结束]`;
  }
  
  return `[表格内容]\n${cleanHtml(html)}`;
}

function cleanHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 生成摘要
 */
function generateSummary(content, breadcrumbs) {
  const parts = [];
  
  // 添加标题路径
  if (breadcrumbs.length > 0) {
    parts.push(breadcrumbs[breadcrumbs.length - 1]);
  }
  
  // 提取命令
  const commands = content.match(/(?:nv|show|netq|vtysh|ip)\s+\S+(?:\s+\S+)*/gi);
  if (commands && commands.length > 0) {
    parts.push(`命令: ${commands.slice(0, 2).join(', ')}`);
  }
  
  // 提取技术术语
  const terms = extractTechTerms(content);
  if (terms.length > 0) {
    parts.push(`关键词: ${terms.slice(0, 4).join(', ')}`);
  }
  
  return parts.join(' | ');
}

function extractTechTerms(text) {
  const terms = new Set();
  const patterns = [
    /\b(BGP|OSPF|EVPN|VXLAN|MLAG|STP|LACP|LLDP|VLAN|VRF|ACL|BFD|PTP|SNMP|NTP|DHCP|DNS)\b/gi,
    /\b(PFC|ECN|RDMA|RoCE|DCQCN|QoS|CoS|DSCP)\b/gi,
    /\b(swp\d+|eth\d+|bond\d+|bridge|vni\d+)\b/gi
  ];
  
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    matches.forEach(m => terms.add(m.toUpperCase()));
  }
  
  return Array.from(terms);
}

function generateId(type) {
  return `chunk-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
}

function estimateTokens(text) {
  // 简单估算：中文约 2 字符/token，英文约 4 字符/token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 2 + otherChars / 4);
}
