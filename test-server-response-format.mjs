/**
 * 直接测试服务器API返回的结果格式
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHUNKS_DIR = path.join(__dirname, 'data', 'chunks');

async function testServerAPIFormat() {
  console.log('=== 测试服务器API返回格式 ===\n');

  try {
    // 读取chunks文件
    const filePath = path.join(CHUNKS_DIR, 'doc-1766503475664.json');
    const allChunks = JSON.parse(await fs.readFile(filePath, 'utf-8'));

    console.log(`📊 总chunks: ${allChunks.length}\n`);

    // 模拟服务器返回的格式
    const mockServerResponse = {
      ok: true,
      chunks: allChunks.slice(0, 5).map(chunk => ({
        ...chunk,
        _score: Math.random() * 0.1 + 0.02,
        _sources: ['keyword', 'vector'],
        _debug: {
          keywordScore: Math.random(),
          vectorScore: Math.random()
        }
      }))
    };

    console.log('📡 模拟服务器返回:');
    console.log(`   chunks数量: ${mockServerResponse.chunks.length}`);
    console.log(`   第一个chunk结构:`);
    const firstChunk = mockServerResponse.chunks[0];
    console.log(`   - id: ${firstChunk.id}`);
    console.log(`   - content长度: ${firstChunk.content.length}`);
    console.log(`   - _score: ${firstChunk._score?.toFixed(6)}`);
    console.log(`   - _sources: ${firstChunk._sources?.join(', ')}\n`);

    // 模拟前端处理
    console.log('🔄 前端处理:');
    const data = mockServerResponse;
    const chunks = data.chunks || [];
    console.log(`   接收到chunks: ${chunks.length}`);

    if (chunks.length > 0) {
      console.log(`   ✓ 可以正常处理\n`);
    } else {
      console.log(`   ✗ chunks为空\n`);
    }

    // 检查是否能访问chunk属性
    console.log('🔍 检查chunk属性:');
    chunks.forEach((chunk, i) => {
      console.log(`   chunk ${i}:`);
      console.log(`   - 有id: ${!!chunk.id}`);
      console.log(`   - 有content: ${!!chunk.content}`);
      console.log(`   - 有_score: ${!!chunk._score}`);
    });

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testServerAPIFormat();
