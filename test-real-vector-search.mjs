/**
 * 更真实的BGP检索测试
 * 使用实际的查询embedding来测试
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHUNKS_DIR = path.join(__dirname, 'data', 'chunks');

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

async function testRealVectorSearch() {
  console.log('=== 真实向量搜索测试 ===\n');

  try {
    // 1. 读取所有chunks
    const filePath = path.join(CHUNKS_DIR, 'doc-1766503475664.json');
    const allChunks = JSON.parse(await fs.readFile(filePath, 'utf-8'));

    console.log(`📊 总chunks: ${allChunks.length}\n`);

    // 2. 找到一个BGP chunk作为查询embedding
    const bgpChunk = allChunks.find(c => c.content.toLowerCase().includes('bgp'));

    if (!bgpChunk || !bgpChunk.embedding) {
      console.log('❌ 找不到BGP chunk或其embedding');
      return;
    }

    console.log(`🎯 使用BGP chunk作为查询embedding:`);
    console.log(`   内容: ${bgpChunk.content.substring(0, 100)}...`);
    console.log(`   embedding长度: ${bgpChunk.embedding.length}\n`);

    // 3. 计算所有chunks与查询embedding的相似度
    console.log('🔍 计算相似度...\n');

    const results = allChunks
      .map((chunk, idx) => {
        if (!chunk.embedding || chunk.embedding.length === 0) {
          return { idx, chunk, score: 0 };
        }
        const score = cosine(bgpChunk.embedding, chunk.embedding);
        return { idx, chunk, score };
      })
      .sort((a, b) => b.score - a.score);

    // 4. 分析结果
    console.log('📈 相似度分布:\n');

    const scoreRanges = {
      '0.9-1.0': 0,
      '0.8-0.9': 0,
      '0.7-0.8': 0,
      '0.6-0.7': 0,
      '0.5-0.6': 0,
      '0.4-0.5': 0,
      '0.3-0.4': 0,
      '0.2-0.3': 0,
      '0.1-0.2': 0,
      '0.0-0.1': 0
    };

    results.forEach(r => {
      if (r.score >= 0.9) scoreRanges['0.9-1.0']++;
      else if (r.score >= 0.8) scoreRanges['0.8-0.9']++;
      else if (r.score >= 0.7) scoreRanges['0.7-0.8']++;
      else if (r.score >= 0.6) scoreRanges['0.6-0.7']++;
      else if (r.score >= 0.5) scoreRanges['0.5-0.6']++;
      else if (r.score >= 0.4) scoreRanges['0.4-0.5']++;
      else if (r.score >= 0.3) scoreRanges['0.3-0.4']++;
      else if (r.score >= 0.2) scoreRanges['0.2-0.3']++;
      else if (r.score >= 0.1) scoreRanges['0.1-0.2']++;
      else scoreRanges['0.0-0.1']++;
    });

    Object.entries(scoreRanges).forEach(([range, count]) => {
      if (count > 0) {
        console.log(`   ${range}: ${count} chunks`);
      }
    });

    console.log();

    // 5. 检查前20个chunks中有多少个BGP相关
    console.log('🎯 前20个chunks分析:\n');

    const top20 = results.slice(0, 20);
    const bgpInTop20 = top20.filter(r =>
      r.chunk.content.toLowerCase().includes('bgp')
    );

    console.log(`   总数: 20`);
    console.log(`   BGP相关: ${bgpInTop20.length}`);
    console.log(`   最高分数: ${top20[0].score.toFixed(4)}`);
    console.log(`   最低分数: ${top20[19].score.toFixed(4)}\n`);

    // 6. 检查所有BGP chunks的排名
    console.log('📊 所有BGP chunks的排名:\n');

    const bgpChunks = results.filter(r =>
      r.chunk.content.toLowerCase().includes('bgp')
    );

    console.log(`   总BGP chunks: ${bgpChunks.length}`);
    console.log(`   排名最高的BGP chunk: 第 ${results.indexOf(bgpChunks[0]) + 1} 位`);
    console.log(`   排名最低的BGP chunk: 第 ${results.indexOf(bgpChunks[bgpChunks.length - 1]) + 1} 位\n`);

    // 7. 显示前5个BGP chunks的排名
    console.log('   前5个BGP chunks的排名:');
    bgpChunks.slice(0, 5).forEach((r, i) => {
      const rank = results.indexOf(r) + 1;
      console.log(`      ${i + 1}. 排名 #${rank}, 分数 ${r.score.toFixed(4)}`);
      console.log(`         ${r.chunk.content.substring(0, 80)}...`);
    });

    console.log();

    // 8. 诊断
    console.log('🔧 诊断:\n');

    if (bgpInTop20.length === 0) {
      console.log('   ❌ 问题: BGP chunks没有在前20个中');
      console.log(`   原因: 最高分数是 ${top20[0].score.toFixed(4)}`);
      console.log(`         但BGP chunks的最高分数是 ${bgpChunks[0].score.toFixed(4)}`);
      console.log('   这表明embedding相似度计算可能有问题');
    } else {
      console.log(`   ✓ BGP chunks在前20个中: ${bgpInTop20.length} 个`);
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

testRealVectorSearch();
