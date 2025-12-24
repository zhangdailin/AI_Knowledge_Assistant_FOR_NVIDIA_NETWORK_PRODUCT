/**
 * 检查chunks中是否包含BGP关键词
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHUNKS_DIR = path.join(__dirname, 'data', 'chunks');

async function checkBGPKeywords() {
  console.log('=== 检查chunks中的BGP关键词 ===\n');

  try {
    const filePath = path.join(CHUNKS_DIR, 'doc-1766503475664.json');
    const allChunks = JSON.parse(await fs.readFile(filePath, 'utf-8'));

    console.log(`📊 总chunks: ${allChunks.length}\n`);

    // 检查不同的查询方式
    const queries = [
      '如何配置BGP',
      'BGP',
      'bgp',
      '配置',
      '如何',
      'configure',
      'bgp configuration'
    ];

    console.log('🔍 查询匹配结果:\n');

    queries.forEach(query => {
      const queryLower = query.toLowerCase();
      const matches = allChunks.filter(c =>
        c.content.toLowerCase().includes(queryLower)
      );
      console.log(`   "${query}": ${matches.length} 个chunks`);
    });

    console.log('\n📈 关键词分布:');

    // 检查包含BGP的chunks
    const bgpChunks = allChunks.filter(c =>
      c.content.toLowerCase().includes('bgp')
    );

    console.log(`   包含"bgp": ${bgpChunks.length} 个chunks`);

    if (bgpChunks.length > 0) {
      console.log('\n   前3个BGP chunks的内容预览:');
      bgpChunks.slice(0, 3).forEach((chunk, i) => {
        console.log(`   ${i + 1}. ${chunk.content.substring(0, 100)}...`);
      });
    }

    // 检查为什么"如何配置BGP"没有匹配
    console.log('\n🔧 诊断:');
    const fullQuery = '如何配置BGP';
    const fullQueryLower = fullQuery.toLowerCase();
    const fullMatches = allChunks.filter(c =>
      c.content.toLowerCase().includes(fullQueryLower)
    );

    console.log(`   完整查询"${fullQuery}"匹配: ${fullMatches.length}`);

    // 尝试分词匹配
    const words = fullQuery.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [];
    console.log(`   提取的关键词: ${words.join(', ')}`);

    const wordMatches = allChunks.filter(c => {
      const contentLower = c.content.toLowerCase();
      return words.some(word => contentLower.includes(word.toLowerCase()));
    });

    console.log(`   至少包含一个关键词的chunks: ${wordMatches.length}`);

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

checkBGPKeywords();
