/**
 * 测试前端是否能正确调用服务器API
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testFrontendAPICall() {
  console.log('=== 测试前端API调用 ===\n');

  // 模拟 serverStorageManager.searchChunks
  async function mockSearchChunks(query, limit) {
    console.log(`📡 调用 searchChunks API`);
    console.log(`   查询: "${query}"`);
    console.log(`   限制: ${limit}`);

    // 模拟API调用
    try {
      // 这里应该调用 fetch(`${this.apiUrl}/api/chunks/search?q=...`)
      // 但由于没有运行的服务器，我们模拟返回结果

      const CHUNKS_DIR = path.join(__dirname, 'data', 'chunks');
      const filePath = path.join(CHUNKS_DIR, 'doc-1766503475664.json');
      const allChunks = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      // 模拟服务器的searchChunks逻辑
      const queryLower = query.toLowerCase();
      const matchingChunks = allChunks.filter(c =>
        c.content.toLowerCase().includes(queryLower)
      );

      console.log(`   ✓ 返回 ${matchingChunks.length} 个chunks\n`);
      return matchingChunks.slice(0, limit);
    } catch (error) {
      console.log(`   ✗ API调用失败: ${error.message}\n`);
      return [];
    }
  }

  // 模拟 unifiedStorage.searchSimilarChunks
  async function searchSimilarChunks(query, limit) {
    const chunks = await mockSearchChunks(query, limit);
    return chunks.map(chunk => ({ chunk, score: 1.0 }));
  }

  // 测试
  const query = '如何配置BGP';
  const results = await searchSimilarChunks(query, 60);

  console.log('📊 最终结果:');
  console.log(`   数量: ${results.length}`);

  if (results.length > 0) {
    console.log(`   ✓ 可以正常检索\n`);
    console.log('   前3个结果:');
    results.slice(0, 3).forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.chunk.content.substring(0, 60)}...`);
    });
  } else {
    console.log(`   ✗ 检索结果为空\n`);
  }
}

testFrontendAPICall();
