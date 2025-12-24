/**
 * 关键词搜索测试
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHUNKS_DIR = path.join(__dirname, 'data', 'chunks');

async function testKeywordSearch() {
  console.log('=== 关键词搜索测试 ===\n');

  try {
    const filePath = path.join(CHUNKS_DIR, 'doc-1766503475664.json');
    const allChunks = JSON.parse(await fs.readFile(filePath, 'utf-8'));

    const query = '如何配置BGP';
    const queryLower = query.toLowerCase();

    console.log(`🔍 查询: "${query}"\n`);

    // 1. 提取关键词
    const keywords = query.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [];
    console.log(`📝 提取的关键词: ${keywords.join(', ')}\n`);

    // 2. 搜索包含关键词的chunks
    console.log('🔎 搜索结果:\n');

    let matchingChunks = [];

    for (const chunk of allChunks) {
      const contentLower = chunk.content.toLowerCase();
      let score = 0;

      // 检查是否包含查询词
      if (contentLower.includes(queryLower)) {
        score += 10;
      }

      // 检查是否包含关键词
      keywords.forEach(keyword => {
        if (contentLower.includes(keyword.toLowerCase())) {
          score += 1;
        }
      });

      if (score > 0) {
        matchingChunks.push({ chunk, score });
      }
    }

    console.log(`   找到 ${matchingChunks.length} 个匹配chunks\n`);

    // 3. 排序并显示前10个
    matchingChunks.sort((a, b) => b.score - a.score);

    console.log('📊 前10个匹配chunks:\n');

    matchingChunks.slice(0, 10).forEach((item, i) => {
      console.log(`   ${i + 1}. 分数: ${item.score}`);
      console.log(`      ${item.chunk.content.substring(0, 80)}...`);
    });

    console.log();

    // 4. 检查BGP chunks
    const bgpMatches = matchingChunks.filter(item =>
      item.chunk.content.toLowerCase().includes('bgp')
    );

    console.log(`🎯 BGP相关的匹配chunks: ${bgpMatches.length}\n`);

    if (bgpMatches.length > 0) {
      console.log('   前3个BGP匹配:');
      bgpMatches.slice(0, 3).forEach((item, i) => {
        console.log(`      ${i + 1}. 分数: ${item.score}`);
        console.log(`         ${item.chunk.content.substring(0, 80)}...`);
      });
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

testKeywordSearch();
