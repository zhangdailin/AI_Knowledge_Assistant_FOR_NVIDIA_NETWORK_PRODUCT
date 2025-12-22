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
  const startTime = Date.now();
  
  try {
    // 输入验证
    if (!text || typeof text !== 'string') {
      console.warn('[Chunking] 输入文本为空或无效，返回空数组');
      return [];
    }
    
    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      console.warn('[Chunking] 文本内容为空，返回空数组');
      return [];
    }
    
    const textSizeKB = Math.round(trimmedText.length / 1024);
    console.log(`[Chunking] 开始处理文档，大小: ${textSizeKB} KB`);
    
    // 对于超大文件（>500KB），使用优化策略
    if (trimmedText.length > 500 * 1024) {
      console.log('[Chunking] 检测到大文件，使用优化处理策略');
    }
    
    // 1. 解析 Markdown 为语义块
    const parseStartTime = Date.now();
    let semanticBlocks;
    try {
      semanticBlocks = parseMarkdownToBlocks(trimmedText);
    } catch (parseError) {
      console.error('[Chunking] Markdown 解析出错:', parseError);
      console.error('[Chunking] 错误堆栈:', parseError.stack);
      console.warn('[Chunking] 降级到简单分块');
      return createSimpleChunks(trimmedText, maxChunkSize, parentSize, childSize);
    }
    
    const parseTime = Date.now() - parseStartTime;
    
    if (!semanticBlocks || semanticBlocks.length === 0) {
      console.warn('[Chunking] 未能解析出语义块，使用简单分块');
      // 降级处理：使用简单的段落分割
      return createSimpleChunks(trimmedText, maxChunkSize, parentSize, childSize);
    }
    
    console.log(`[Chunking] 解析完成，耗时: ${parseTime}ms，解析出 ${semanticBlocks.length} 个语义块`);
    
    // 统计语义块类型
    const blockStats = {};
    semanticBlocks.forEach(b => {
      blockStats[b.type] = (blockStats[b.type] || 0) + 1;
    });
    console.log(`[Chunking] 语义块统计:`, blockStats);
    
    // 检查是否有标题块
    const hasHeadings = semanticBlocks.some(b => b.type === BlockType.HEADING);
    
    // 检查是否有其他 Markdown 结构
    const hasMarkdownStructures = semanticBlocks.some(b => 
      b.type === BlockType.TABLE || 
      b.type === BlockType.CODE_BLOCK || 
      b.type === BlockType.LIST ||
      b.type === BlockType.BLOCKQUOTE
    );
    
    // 如果既没有标题也没有 Markdown 结构，才使用简单分块
    if (!hasHeadings && !hasMarkdownStructures) {
      console.log('[Chunking] 文档既没有标题也没有 Markdown 结构，使用简单分块');
      return createSimpleChunks(trimmedText, maxChunkSize, parentSize, childSize);
    }
    
    if (!hasHeadings) {
      console.log('[Chunking] 文档没有标题，但包含 Markdown 结构，使用 Markdown 处理');
    } else {
      console.log('[Chunking] 文档包含标题，使用 Markdown 层级处理');
    }
    
    // 2. 根据标题层级组织父子块（即使没有标题，也会创建一个无标题的 section）
    const organizeStartTime = Date.now();
    let chunks;
    try {
      chunks = organizeIntoParentChildChunks(semanticBlocks, maxChunkSize, parentSize, childSize);
      
      // 如果组织后没有生成 chunks，可能是章节树构建失败
      if (!chunks || chunks.length === 0) {
        console.warn('[Chunking] organizeIntoParentChildChunks 返回空数组，尝试降级处理');
        return createSimpleChunks(trimmedText, maxChunkSize, parentSize, childSize);
      }
    } catch (organizeError) {
      console.error('[Chunking] 组织父子块出错:', organizeError);
      console.error('[Chunking] 错误堆栈:', organizeError.stack);
      console.warn('[Chunking] 降级到简单分块');
      return createSimpleChunks(trimmedText, maxChunkSize, parentSize, childSize);
    }
    
    const organizeTime = Date.now() - organizeStartTime;
    
    // 验证 chunks
    const validChunks = chunks.filter(c => c && c.content && c.content.trim().length > 0);
    
    if (validChunks.length === 0) {
      console.warn('[Chunking] 生成的 chunks 为空，使用简单分块');
      console.warn(`[Chunking] 原始 chunks 数量: ${chunks.length}`);
      return createSimpleChunks(trimmedText, maxChunkSize, parentSize, childSize);
    }
    
    const totalTime = Date.now() - startTime;
    const parentCount = validChunks.filter(c => c.chunkType === 'parent').length;
    const childCount = validChunks.filter(c => c.chunkType === 'child').length;
    
    console.log(`[Chunking] 组织完成，耗时: ${organizeTime}ms`);
    console.log(`[Chunking] 总计耗时: ${totalTime}ms，生成 ${validChunks.length} 个 chunks (父: ${parentCount}, 子: ${childCount})`);
    
    return validChunks;
  } catch (error) {
    console.error('[Chunking] 分块过程出错:', error);
    console.error('[Chunking] 错误堆栈:', error.stack);
    // 降级处理：使用简单的段落分割
    try {
      return createSimpleChunks(text.trim(), maxChunkSize, parentSize, childSize);
    } catch (fallbackError) {
      console.error('[Chunking] 降级处理也失败:', fallbackError);
      return [];
    }
  }
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
 * 优化：对于大文件，使用流式处理避免内存问题
 */
function parseMarkdownToBlocks(text) {
  // 对于超大文件，分批处理
  const isLargeFile = text.length > 500 * 1024; // >500KB
  const lines = text.split('\n');
  const totalLines = lines.length;
  
  if (isLargeFile) {
    console.log(`[Chunking] 大文件检测: ${totalLines} 行，使用优化解析`);
  }
  
  const blocks = [];
  let i = 0;
  let lastProgressLog = 0;
  const maxIterations = totalLines * 2; // 安全限制：最多迭代行数的2倍
  let iterations = 0;
  
  while (i < lines.length) {
    // 安全检查：防止无限循环
    iterations++;
    if (iterations > maxIterations) {
      console.error(`[Chunking] 解析超时：已迭代 ${iterations} 次，当前行 ${i}/${totalLines}`);
      break;
    }
    
    // 大文件进度日志（每处理 10% 输出一次）
    if (isLargeFile && totalLines > 1000) {
      const progress = Math.floor((i / totalLines) * 100);
      if (progress >= lastProgressLog + 10) {
        console.log(`[Chunking] 解析进度: ${progress}% (${i}/${totalLines} 行)`);
        lastProgressLog = progress;
      }
    }
    
    const line = lines[i];
    if (line === undefined) {
      console.warn(`[Chunking] 行 ${i} 未定义，跳过`);
      i++;
      continue;
    }
    
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
      let foundEndTag = false;
      while (i < lines.length && !foundEndTag) {
        htmlLines.push(lines[i]);
        if (lines[i].includes('</table>')) {
          foundEndTag = true;
        }
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
  
  // 解析完成日志
  if (isLargeFile) {
    console.log(`[Chunking] 解析完成: ${blocks.length} 个语义块 (处理了 ${i}/${totalLines} 行)`);
  }
  
  // 统计各类型块的数量
  const blockStats = {};
  blocks.forEach(b => {
    blockStats[b.type] = (blockStats[b.type] || 0) + 1;
  });
  
  if (isLargeFile && Object.keys(blockStats).length > 0) {
    console.log(`[Chunking] 块类型统计:`, blockStats);
  }
  
  return blocks;
}

/**
 * 将语义块组织为父子块结构
 */
function organizeIntoParentChildChunks(blocks, maxChunkSize, parentSize, childSize) {
  const chunks = [];
  let globalIndex = 0;
  
  // 输入验证
  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
    console.warn('[Chunking] organizeIntoParentChildChunks: blocks 为空');
    return [];
  }
  
  // 构建章节树
  const sections = buildSectionTree(blocks);
  
  if (!sections || sections.length === 0) {
    console.warn('[Chunking] organizeIntoParentChildChunks: 未能构建章节树');
    return [];
  }
  
  // 遍历章节生成 chunks
  for (const section of sections) {
    if (!section) continue;
    
    try {
      const sectionChunks = processSectionV2(section, [], maxChunkSize, parentSize, childSize);
      if (sectionChunks && Array.isArray(sectionChunks)) {
        for (const chunk of sectionChunks) {
          if (chunk && chunk.content && chunk.content.trim().length > 0) {
            chunk.chunkIndex = globalIndex++;
            chunks.push(chunk);
          }
        }
      }
    } catch (error) {
      console.error('[Chunking] 处理章节时出错:', error);
      // 继续处理下一个章节
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
  
  if (!blocks || blocks.length === 0) {
    console.warn('[Chunking] buildSectionTree: blocks 为空');
    return sections;
  }
  
  for (const block of blocks) {
    if (!block || !block.type) {
      console.warn('[Chunking] buildSectionTree: 遇到无效 block，跳过');
      continue;
    }
    
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
  
  console.log(`[Chunking] buildSectionTree: 构建了 ${sections.length} 个章节`);
  if (sections.length > 0) {
    const sectionStats = {
      withHeading: sections.filter(s => s.heading).length,
      withoutHeading: sections.filter(s => !s.heading).length,
      withSubSections: sections.filter(s => s.subSections && s.subSections.length > 0).length
    };
    console.log(`[Chunking] 章节统计:`, sectionStats);
  }
  
  return sections;
}

/**
 * 处理一个章节，生成父子块
 */
function processSectionV2(section, breadcrumbs, maxChunkSize, parentSize, childSize) {
  const chunks = [];
  
  if (!section) {
    return chunks;
  }
  
  // 更新面包屑
  const sectionTitle = section.heading?.title || '';
  const currentBreadcrumbs = sectionTitle ? [...breadcrumbs, sectionTitle] : breadcrumbs;
  
  // 收集本章节的所有内容（不包括子章节）
  const sectionContent = buildSectionContent(section, currentBreadcrumbs);
  
  if (sectionContent && sectionContent.length > 0) {
    try {
      // 创建父块
      const parentChunks = createParentChunks(sectionContent, currentBreadcrumbs, maxChunkSize, parentSize, childSize);
      if (parentChunks && Array.isArray(parentChunks)) {
        chunks.push(...parentChunks.filter(c => c && c.content && c.content.trim().length > 0));
      }
    } catch (error) {
      console.error('[Chunking] 创建父块时出错:', error);
    }
  }
  
  // 递归处理子章节
  if (section.subSections && Array.isArray(section.subSections)) {
    for (const subSection of section.subSections) {
      if (subSection) {
        try {
          const subChunks = processSectionV2(subSection, currentBreadcrumbs, maxChunkSize, parentSize, childSize);
          if (subChunks && Array.isArray(subChunks)) {
            chunks.push(...subChunks.filter(c => c && c.content && c.content.trim().length > 0));
          }
        } catch (error) {
          console.error('[Chunking] 处理子章节时出错:', error);
        }
      }
    }
  }
  
  return chunks;
}

/**
 * 构建章节内容
 */
function buildSectionContent(section, breadcrumbs) {
  const parts = [];
  
  // 添加标题
  if (section.heading && section.heading.content) {
    parts.push(section.heading.content);
  }
  
  // 添加块内容
  for (const block of section.blocks || []) {
    if (block && block.content) {
      const formatted = formatBlock(block);
      if (formatted && formatted.trim().length > 0) {
        parts.push(formatted);
      }
    }
  }
  
  return parts.join('\n\n').trim();
}

/**
 * 格式化语义块为文本
 */
function formatBlock(block) {
  if (!block || !block.content) {
    return '';
  }
  
  switch (block.type) {
    case BlockType.TABLE:
      // 如果已经转换为语义格式
      if (block.rows && Array.isArray(block.rows) && block.rows.length > 0) {
        return formatTableAsSemantic(block.rows);
      }
      return block.content || '';
    
    case BlockType.CODE_BLOCK:
      return block.content || '';
    
    case BlockType.LIST:
      return block.content || '';
    
    case BlockType.BLOCKQUOTE:
      return block.content || '';
    
    case BlockType.PARAGRAPH:
      return block.content || '';
    
    default:
      return block.content || '';
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
  
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return chunks;
  }
  
  // 确保参数有效
  parentSize = Math.max(100, parentSize || 2000);
  childSize = Math.max(50, childSize || 600);
  maxChunkSize = Math.max(parentSize, maxChunkSize || 4000);
  
  try {
    // 如果内容小于父块大小，直接作为一个父块
    if (content.length <= parentSize) {
      const parentId = generateId('parent');
      
      // 父块内容添加面包屑上下文
      const contextPrefix = (breadcrumbs && breadcrumbs.length > 0) ? `[${breadcrumbs.join(' > ')}]\n\n` : '';
      const parentContent = contextPrefix + content;
      
      if (parentContent.trim().length > 0) {
        chunks.push({
          id: parentId,
          content: parentContent,
          chunkType: 'parent',
          tokenCount: estimateTokens(parentContent),
          metadata: {
            breadcrumbs: breadcrumbs || [],
            header: (breadcrumbs && breadcrumbs.length > 0) ? breadcrumbs[breadcrumbs.length - 1] : null,
            summary: generateSummary(content, breadcrumbs || [])
          }
        });
        
        // 创建子块
        const childChunks = createChildChunksV2(content, parentId, breadcrumbs || [], childSize);
        if (childChunks && Array.isArray(childChunks)) {
          chunks.push(...childChunks.filter(c => c && c.content && c.content.trim().length > 0));
        }
      }
      
    } else {
      // 内容过大，需要分割
      const segments = splitContentIntoSegments(content, parentSize, maxChunkSize);
      
      if (!segments || segments.length === 0) {
        // 如果分割失败，至少创建一个块
        const parentId = generateId('parent');
        const contextPrefix = (breadcrumbs && breadcrumbs.length > 0) ? `[${breadcrumbs.join(' > ')}]\n\n` : '';
        chunks.push({
          id: parentId,
          content: contextPrefix + content.substring(0, maxChunkSize),
          chunkType: 'parent',
          tokenCount: estimateTokens(content),
          metadata: {
            breadcrumbs: breadcrumbs || [],
            header: (breadcrumbs && breadcrumbs.length > 0) ? breadcrumbs[breadcrumbs.length - 1] : null,
            summary: generateSummary(content.substring(0, 200), breadcrumbs || [])
          }
        });
      } else {
        segments.forEach((segment, segIdx) => {
          if (!segment || segment.trim().length === 0) return;
          
          const parentId = generateId('parent');
          
          const contextPrefix = (breadcrumbs && breadcrumbs.length > 0)
            ? `[${breadcrumbs.join(' > ')}]${segments.length > 1 ? ` (${segIdx + 1}/${segments.length})` : ''}\n\n`
            : '';
          const parentContent = contextPrefix + segment;
          
          chunks.push({
            id: parentId,
            content: parentContent,
            chunkType: 'parent',
            tokenCount: estimateTokens(parentContent),
            metadata: {
              breadcrumbs: breadcrumbs || [],
              header: (breadcrumbs && breadcrumbs.length > 0) ? breadcrumbs[breadcrumbs.length - 1] : null,
              segmentIndex: segIdx,
              totalSegments: segments.length,
              summary: generateSummary(segment, breadcrumbs || [])
            }
          });
          
          // 创建子块
          const childChunks = createChildChunksV2(segment, parentId, breadcrumbs || [], childSize);
          if (childChunks && Array.isArray(childChunks)) {
            chunks.push(...childChunks.filter(c => c && c.content && c.content.trim().length > 0));
          }
        });
      }
    }
  } catch (error) {
    console.error('[Chunking] createParentChunks 出错:', error);
  }
  
  return chunks.filter(c => c && c.content && c.content.trim().length > 0);
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
  if (!text) return 0;
  // 简单估算：中文约 2 字符/token，英文约 4 字符/token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 2 + otherChars / 4);
}

/**
 * 降级处理：简单的段落分割（当主算法失败时使用）
 */
function createSimpleChunks(text, maxChunkSize, parentSize, childSize) {
  console.log('[Chunking] 使用简单分块模式');
  
  const chunks = [];
  let globalIndex = 0;
  
  if (!text || text.trim().length === 0) {
    console.warn('[Chunking] createSimpleChunks: 文本为空');
    return chunks;
  }
  
  // 确保参数有效
  parentSize = Math.max(500, parentSize || 2000);
  childSize = Math.max(200, childSize || 600);
  maxChunkSize = Math.max(parentSize, maxChunkSize || 4000);
  
  // 按段落分割
  const paragraphs = text.split(/\n\n+/).filter(p => p && p.trim().length > 0);
  
  if (paragraphs.length === 0) {
    // 如果没有段落，按行分割
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length > 0) {
      paragraphs.push(lines.join('\n'));
    } else {
      // 如果连行都没有，直接使用整个文本
      paragraphs.push(text);
    }
  }
  
  console.log(`[Chunking] 简单分块: ${paragraphs.length} 个段落`);
  
  let currentParent = [];
  let currentParentLength = 0;
  
  for (const para of paragraphs) {
    const paraLength = para.length;
    
    // 如果当前段落加入后会超过父块大小
    if (currentParentLength + paraLength > parentSize && currentParent.length > 0) {
      // 创建父块
      const parentContent = currentParent.join('\n\n');
      const parentId = generateId('parent');
      
      chunks.push({
        id: parentId,
        content: parentContent,
        chunkType: 'parent',
        chunkIndex: globalIndex++,
        tokenCount: estimateTokens(parentContent),
        metadata: {}
      });
      
      // 创建子块
      const childTexts = splitTextSimple(parentContent, childSize);
      for (const childText of childTexts) {
        chunks.push({
          content: childText,
          chunkType: 'child',
          parentId: parentId,
          chunkIndex: globalIndex++,
          tokenCount: estimateTokens(childText),
          metadata: {}
        });
      }
      
      currentParent = [];
      currentParentLength = 0;
    }
    
    currentParent.push(para);
    currentParentLength += paraLength + 2; // +2 for \n\n
  }
  
  // 处理最后一个父块
  if (currentParent.length > 0) {
    const parentContent = currentParent.join('\n\n');
    const parentId = generateId('parent');
    
    chunks.push({
      id: parentId,
      content: parentContent,
      chunkType: 'parent',
      chunkIndex: globalIndex++,
      tokenCount: estimateTokens(parentContent),
      metadata: {}
    });
    
    const childTexts = splitTextSimple(parentContent, childSize);
    for (const childText of childTexts) {
      chunks.push({
        content: childText,
        chunkType: 'child',
        parentId: parentId,
        chunkIndex: globalIndex++,
        tokenCount: estimateTokens(childText),
        metadata: {}
      });
    }
  }
  
  return chunks.filter(c => c && c.content && c.content.trim().length > 0);
}

/**
 * 简单文本分割
 */
function splitTextSimple(text, chunkSize) {
  if (!text || text.length <= chunkSize) {
    return text ? [text] : [];
  }
  
  const chunks = [];
  const sentences = text.split(/(?<=[。！？；!?;.])\s*/).filter(s => s.trim().length > 0);
  
  let current = [];
  let currentLength = 0;
  
  for (const sentence of sentences) {
    if (currentLength + sentence.length > chunkSize && current.length > 0) {
      chunks.push(current.join(' '));
      current = [];
      currentLength = 0;
    }
    current.push(sentence);
    currentLength += sentence.length;
  }
  
  if (current.length > 0) {
    chunks.push(current.join(' '));
  }
  
  return chunks.filter(c => c && c.trim().length > 0);
}
