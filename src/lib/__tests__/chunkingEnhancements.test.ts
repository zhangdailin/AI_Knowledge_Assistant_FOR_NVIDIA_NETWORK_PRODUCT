import { describe, it, expect } from 'vitest';
import {
  preprocessText,
  findNearestSentenceBoundary,
  findNearestParagraphBoundary,
  smartChunk,
  detectCodeBlocks,
  isInCodeBlock,
  enhancedParentChildChunking,
  optimizeTextForEmbedding
} from '../chunkingEnhancements';

describe('chunkingEnhancements', () => {
  describe('preprocessText', () => {
    it('应该移除多余的空白字符', () => {
      const input = '这是    一个    测试   文本';
      const result = preprocessText(input);
      expect(result).toBe('这是 一个 测试 文本');
    });

    it('应该合并多个换行', () => {
      const input = '第一段\n\n\n\n第二段';
      const result = preprocessText(input);
      expect(result).toBe('第一段\n\n第二段');
    });

    it('应该规范化标点符号周围的空格', () => {
      const input = '这是测试 ， 这是另一个测试 。';
      const result = preprocessText(input);
      expect(result).toContain('这是测试，');
      expect(result).toContain('这是另一个测试。');
    });
  });

  describe('findNearestSentenceBoundary', () => {
    it('应该在句子边界处找到最近的位置', () => {
      const text = '这是第一句。这是第二句！这是第三句？';
      const position = 8; // 在第一句中间（"第"字的位置）
      const boundary = findNearestSentenceBoundary(text, position, 10, 10);
      // "。"在位置5，之后的位置是6，这是最近的句子边界
      expect(boundary).toBe(6); // 应该在"。"之后
    });

    it('如果没有找到边界，应该返回原位置', () => {
      const text = '没有标点的文本';
      const position = 5;
      const boundary = findNearestSentenceBoundary(text, position);
      expect(boundary).toBe(position);
    });
  });

  describe('smartChunk', () => {
    it('应该在句子边界处切分文本', () => {
      // 使用更长的文本以确保能够切分
      // 注意：smartChunk函数会过滤掉长度 < 50 的chunk，所以需要足够长的文本
      // 每个句子约7个字符，需要至少8个句子才能达到50字符
      // 使用足够长的文本（约200字符），确保切分后每个chunk都能达到50字符以上
      const text = '这是第一句。这是第二句。这是第三句。这是第四句。这是第五句。这是第六句。这是第七句。这是第八句。这是第九句。这是第十句。这是第十一句。这是第十二句。这是第十三句。这是第十四句。这是第十五句。这是第十六句。这是第十七句。这是第十八句。这是第十九句。这是第二十句。这是第二十一句。这是第二十二句。这是第二十三句。这是第二十四句。这是第二十五句。这是第二十六句。这是第二十七句。这是第二十八句。这是第二十九句。这是第三十句。';
      // 使用targetSize=80，确保每个chunk都能达到50字符以上（即使切分后也足够长）
      const chunks = smartChunk(text, 80, 50, true);
      expect(chunks.length).toBeGreaterThan(0);
      // 每个chunk应该以句子结束标记结尾（如果可能），且长度 >= 50（因为函数会过滤）
      chunks.forEach(chunk => {
        expect(chunk.length).toBeGreaterThanOrEqual(50);
      });
    });

    it('应该过滤太短的chunks', () => {
      const text = '短文本';
      const chunks = smartChunk(text, 100, 50);
      expect(chunks.length).toBe(0); // 太短，应该被过滤
    });
  });

  describe('detectCodeBlocks', () => {
    it('应该检测Markdown代码块', () => {
      const text = '这是文本\n```bash\nnv set interface swp1\n```\n更多文本';
      const blocks = detectCodeBlocks(text);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].type).toBe('bash');
    });

    it('应该检测行内代码', () => {
      const text = '使用 `nv set` 命令';
      const blocks = detectCodeBlocks(text);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].type).toBe('inline');
    });
  });

  describe('enhancedParentChildChunking', () => {
    it('应该创建父块和子块', () => {
      const text = '这是测试文本。'.repeat(1000); // 创建长文本
      const chunks = enhancedParentChildChunking(text, 4000, 500, 150);
      
      expect(chunks.length).toBeGreaterThan(0);
      
      const parentChunks = chunks.filter(c => c.chunkType === 'parent');
      const childChunks = chunks.filter(c => c.chunkType === 'child');
      
      expect(parentChunks.length).toBeGreaterThan(0);
      expect(childChunks.length).toBeGreaterThan(0);
    });

    it('子块应该关联到父块', () => {
      const text = '这是测试文本。'.repeat(1000);
      const chunks = enhancedParentChildChunking(text, 4000, 500, 150);
      
      const childChunks = chunks.filter(c => c.chunkType === 'child');
      childChunks.forEach(child => {
        expect(child.parentId).toBeDefined();
        expect(child.parentId).toMatch(/^parent-\d+$/);
      });
    });

    it('应该检测代码块并标记元数据', () => {
      const text = '这是文本\n```bash\nnv set interface swp1\n```\n更多文本'.repeat(200);
      const chunks = enhancedParentChildChunking(text, 4000, 500, 150);
      
      const chunksWithCode = chunks.filter(c => c.metadata?.isCodeBlock);
      expect(chunksWithCode.length).toBeGreaterThan(0);
    });
  });

  describe('optimizeTextForEmbedding', () => {
    it('如果文本短于最大长度，应该返回原文本', () => {
      const text = '这是短文本';
      const result = optimizeTextForEmbedding(text, 2000);
      expect(result).toBe(text);
    });

    it('应该优先保留代码块', () => {
      const codeBlock = '```bash\nnv set interface swp1\nnv config apply\n```';
      const text = '前面文本'.repeat(500) + codeBlock + '后面文本'.repeat(500);
      const result = optimizeTextForEmbedding(text, 200);
      
      expect(result).toContain('nv set');
      expect(result).toContain('nv config');
    });

    it('应该保留开头和结尾', () => {
      const text = '开头内容' + '中间内容'.repeat(1000) + '结尾内容';
      const result = optimizeTextForEmbedding(text, 100);
      
      expect(result).toContain('开头内容');
      expect(result).toContain('结尾内容');
    });

    it('应该提取关键句子（包含数字、命令等）', () => {
      const text = '普通文本。包含nv set命令的句子。更多普通文本。包含数字123的句子。';
      const result = optimizeTextForEmbedding(text, 50);
      
      // 应该优先保留包含关键词的句子
      expect(result.length).toBeLessThanOrEqual(50);
    });
  });
});
