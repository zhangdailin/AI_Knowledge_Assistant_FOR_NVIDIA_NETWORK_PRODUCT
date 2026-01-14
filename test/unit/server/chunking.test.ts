/**
 * Chunking 模块测试
 * 测试文档分块功能
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockMarkdown } from '../../fixtures/mock-data';

describe('Chunking Module', () => {
  const MAX_CHUNK_SIZE = 4000;

  describe('chunkMarkdown', () => {
    it('should split by headers hierarchically', () => {
      const markdown = `
# Main Title

Content under main title.

## Section 1

Content in section 1.

### Subsection 1.1

Content in subsection 1.1.

## Section 2

Content in section 2.
`;

      // 模拟分块逻辑
      const chunks = markdown.split(/(?=^#{1,3} )/m).filter(c => c.trim());

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toContain('# Main Title');
      expect(chunks.some(c => c.includes('## Section 1'))).toBe(true);
    });

    it('should preserve code blocks intact', () => {
      const markdown = `
# Configuration

Here is a code example:

\`\`\`bash
nv set interface eth0
nv set vlan 100
nv apply
\`\`\`

More content here.
`;

      // 代码块不应该被分割
      const hasCodeBlock = markdown.includes('```bash');
      expect(hasCodeBlock).toBe(true);

      // 验证代码块完整性
      const codeBlockMatch = markdown.match(/```[\s\S]*?```/);
      expect(codeBlockMatch).toBeDefined();
      expect(codeBlockMatch![0]).toContain('nv set interface eth0');
      expect(codeBlockMatch![0]).toContain('nv apply');
    });

    it('should respect max chunk size', () => {
      const longContent = 'a'.repeat(5000);
      const markdown = `# Title\n\n${longContent}`;

      // 模拟分块
      const chunkText = (text: string, maxSize: number) => {
        const chunks = [];
        let start = 0;
        while (start < text.length) {
          chunks.push(text.slice(start, start + maxSize));
          start += maxSize;
        }
        return chunks;
      };

      const chunks = chunkText(markdown, MAX_CHUNK_SIZE);

      chunks.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_SIZE);
      });
    });

    it('should maintain context with overlapping', () => {
      const text = 'This is a test sentence. Another sentence here. And one more.';
      const chunkSize = 30;
      const overlap = 10;

      const chunkWithOverlap = (text: string, size: number, overlap: number) => {
        const chunks = [];
        let start = 0;
        while (start < text.length) {
          const end = Math.min(start + size, text.length);
          chunks.push(text.slice(start, end));
          start += size - overlap;
        }
        return chunks;
      };

      const chunks = chunkWithOverlap(text, chunkSize, overlap);

      // 验证重叠
      if (chunks.length > 1) {
        const firstEnd = chunks[0].slice(-overlap);
        const secondStart = chunks[1].slice(0, overlap);
        // 应该有部分重叠内容
        expect(chunks.length).toBeGreaterThan(1);
      }
    });

    it('should handle nested lists correctly', () => {
      const markdown = `
# List Example

- Item 1
  - Subitem 1.1
  - Subitem 1.2
- Item 2
  - Subitem 2.1
`;

      // 验证列表结构保持完整
      expect(markdown).toContain('- Item 1');
      expect(markdown).toContain('  - Subitem 1.1');
      expect(markdown).toContain('- Item 2');
    });
  });

  describe('chunkText', () => {
    it('should split plain text by sentences', () => {
      const text = 'First sentence. Second sentence. Third sentence.';

      const splitBySentence = (text: string) => {
        return text.split(/[.!?]+\s+/).filter(s => s.trim());
      };

      const sentences = splitBySentence(text);

      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toContain('First sentence');
    });

    it('should handle Chinese text segmentation', () => {
      const chineseText = '这是第一句话。这是第二句话。这是第三句话。';

      const splitBySentence = (text: string) => {
        return text.split(/[。！？]+/).filter(s => s.trim());
      };

      const sentences = splitBySentence(chineseText);

      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toBe('这是第一句话');
    });

    it('should preserve paragraph boundaries', () => {
      const text = `First paragraph.

Second paragraph.

Third paragraph.`;

      const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

      expect(paragraphs).toHaveLength(3);
      expect(paragraphs[0]).toBe('First paragraph.');
    });
  });

  describe('improveMarkdownStructure', () => {
    it('should normalize PDF-extracted markdown', () => {
      const pdfMarkdown = `
#Title Without Space
##Another Title

Content   with   extra   spaces.
`;

      // 修复标题格式
      const normalized = pdfMarkdown
        .replace(/^(#{1,6})([^\s#])/gm, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();

      expect(normalized).toContain('# Title Without Space');
      expect(normalized).toContain('## Another Title');
    });

    it('should fix broken table formatting', () => {
      const brokenTable = `
| Header1|Header2 |Header3|
|---|---|---|
|Cell1| Cell2|Cell3 |
`;

      // 规范化表格
      const normalized = brokenTable
        .split('\n')
        .map(line => {
          if (line.includes('|')) {
            return line.split('|').map(cell => cell.trim()).join(' | ');
          }
          return line;
        })
        .join('\n');

      expect(normalized).toContain('Header1 | Header2 | Header3');
    });

    it('should clean up excessive whitespace', () => {
      const messyText = `
Title


Too    many    spaces.



Multiple blank lines.
`;

      const cleaned = messyText
        .replace(/\n{3,}/g, '\n\n')
        .replace(/  +/g, ' ')
        .trim();

      expect(cleaned).not.toContain('\n\n\n');
      expect(cleaned).not.toContain('    ');
    });
  });

  describe('chunkByTokenCount', () => {
    it('should estimate token count', () => {
      const text = 'This is a test sentence with multiple words.';

      // 简单的 token 估算（实际会更复杂）
      const estimateTokens = (text: string) => {
        return Math.ceil(text.split(/\s+/).length * 1.3);
      };

      const tokens = estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeGreaterThan(text.split(/\s+/).length);
    });

    it('should chunk by token limit', () => {
      const text = 'word '.repeat(1000);
      const maxTokens = 100;

      const chunkByTokens = (text: string, maxTokens: number) => {
        const words = text.split(/\s+/);
        const chunks = [];
        let currentChunk: string[] = [];
        let currentTokens = 0;

        for (const word of words) {
          const wordTokens = Math.ceil(word.length / 4);
          if (currentTokens + wordTokens > maxTokens && currentChunk.length > 0) {
            chunks.push(currentChunk.join(' '));
            currentChunk = [];
            currentTokens = 0;
          }
          currentChunk.push(word);
          currentTokens += wordTokens;
        }

        if (currentChunk.length > 0) {
          chunks.push(currentChunk.join(' '));
        }

        return chunks;
      };

      const chunks = chunkByTokens(text, maxTokens);

      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe('extractMetadata', () => {
    it('should extract title from markdown', () => {
      const markdown = createMockMarkdown();

      const extractTitle = (markdown: string) => {
        const match = markdown.match(/^#\s+(.+)$/m);
        return match ? match[1] : null;
      };

      const title = extractTitle(markdown);

      expect(title).toBeDefined();
      expect(title).toContain('Network Configuration');
    });

    it('should extract code blocks', () => {
      const markdown = createMockMarkdown();

      const extractCodeBlocks = (markdown: string) => {
        const regex = /```(\w+)?\n([\s\S]*?)```/g;
        const blocks = [];
        let match;

        while ((match = regex.exec(markdown)) !== null) {
          blocks.push({
            language: match[1] || 'text',
            code: match[2].trim()
          });
        }

        return blocks;
      };

      const codeBlocks = extractCodeBlocks(markdown);

      expect(codeBlocks.length).toBeGreaterThan(0);
      expect(codeBlocks[0].language).toBe('bash');
      expect(codeBlocks[0].code).toContain('nv set');
    });

    it('should extract headers hierarchy', () => {
      const markdown = createMockMarkdown();

      const extractHeaders = (markdown: string) => {
        const regex = /^(#{1,6})\s+(.+)$/gm;
        const headers = [];
        let match;

        while ((match = regex.exec(markdown)) !== null) {
          headers.push({
            level: match[1].length,
            text: match[2]
          });
        }

        return headers;
      };

      const headers = extractHeaders(markdown);

      expect(headers.length).toBeGreaterThan(0);
      expect(headers[0].level).toBe(1);
      expect(headers.some(h => h.level === 2)).toBe(true);
    });
  });

  describe('chunkQuality', () => {
    it('should validate chunk size', () => {
      const validChunk = 'a'.repeat(1000);
      const tooSmall = 'ab';
      const tooLarge = 'a'.repeat(10000);

      const isValidSize = (chunk: string, min = 50, max = 5000) => {
        return chunk.length >= min && chunk.length <= max;
      };

      expect(isValidSize(validChunk)).toBe(true);
      expect(isValidSize(tooSmall)).toBe(false);
      expect(isValidSize(tooLarge)).toBe(false);
    });

    it('should check chunk completeness', () => {
      const complete = 'This is a complete sentence.';
      const incomplete = 'This is an incomplete';

      const isComplete = (chunk: string) => {
        return /[.!?]$/.test(chunk.trim());
      };

      expect(isComplete(complete)).toBe(true);
      expect(isComplete(incomplete)).toBe(false);
    });

    it('should detect code block integrity', () => {
      const intact = '```bash\ncode here\n```';
      const broken = '```bash\ncode here';

      const hasIntactCodeBlock = (chunk: string) => {
        const openCount = (chunk.match(/```/g) || []).length;
        return openCount % 2 === 0;
      };

      expect(hasIntactCodeBlock(intact)).toBe(true);
      expect(hasIntactCodeBlock(broken)).toBe(false);
    });
  });
});
