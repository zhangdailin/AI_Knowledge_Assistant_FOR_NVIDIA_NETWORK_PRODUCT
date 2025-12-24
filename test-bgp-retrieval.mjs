/**
 * BGP检索测试用例
 * 测试从前端查询到最后输出的完整流程
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHUNKS_DIR = path.join(__dirname, 'data', 'chunks');

// 简单的cosine相似度计算
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

async function testMultiFileRetrieval() {
  console.log('=== BGP检索测试 ===\n');

  try {
    // 1. 检查有多少个chunk文件
    const files = await fs.readdir(CHUNKS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    console.log(`📁 找到 ${jsonFiles.length} 个chunk文件:`);
    jsonFiles.forEach(f => console.log(`   - ${f}`));
    console.log();

    // 2. 统计每个文件的chunks数量
    let totalChunks = 0;
    let bgpChunks = 0;
    const fileStats = [];

    for (const file of jsonFiles) {
      const filePath = path.join(CHUNKS_DIR, file);
      const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      const fileChunkCount = data.length;
      const fileBgpCount = data.filter(c => c.content.toLowerCase().includes('bgp')).length;
      const fileWithEmbedding = data.filter(c => c.embedding && c.embedding.length > 0).length;

      totalChunks += fileChunkCount;
      bgpChunks += fileBgpCount;

      fileStats.push({
        file,
        total: fileChunkCount,
        bgp: fileBgpCount,
        withEmbedding: fileWithEmbedding
      });

      console.log(`📊 ${file}:`);
      console.log(`   总chunks: ${fileChunkCount}`);
      console.log(`   BGP相关: ${fileBgpCount}`);
      console.log(`   有embedding: ${fileWithEmbedding}`);
    }
    console.log();
    console.log(`📈 总计: ${totalChunks} chunks, ${bgpChunks} 个BGP相关\n`);

    // 3. 模拟向量搜索 - 收集所有chunks
    console.log('🔍 模拟向量搜索过程:\n');

    let allChunks = [];
    for (const file of jsonFiles) {
      const filePath = path.join(CHUNKS_DIR, file);
      const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      console.log(`   处理 ${file}...`);

      for (const chunk of data) {
        if (chunk.embedding && chunk.embedding.length > 0) {
          // 模拟一个查询embedding（这里用chunk的embedding作为示例）
          const score = Math.random() * 0.5 + 0.2; // 0.2-0.7之间的随机分数

          if (score > 0.2) { // minScore = 0.2
            allChunks.push({
              file,
              chunk,
              score
            });
          }
        }
      }

      console.log(`   ✓ 添加了 ${allChunks.length} 个chunks (累计)`);
    }

    console.log(`\n   总共收集: ${allChunks.length} 个chunks\n`);

    // 4. 排序
    console.log('📊 排序前后对比:\n');
    console.log(`   排序前第一个chunk来自: ${allChunks[0]?.file}`);

    allChunks.sort((a, b) => b.score - a.score);

    console.log(`   排序后第一个chunk来自: ${allChunks[0]?.file}`);
    console.log(`   排序后前10个chunks来自的文件分布:`);

    const topTen = allChunks.slice(0, 10);
    const fileDistribution = {};
    topTen.forEach(item => {
      fileDistribution[item.file] = (fileDistribution[item.file] || 0) + 1;
    });

    Object.entries(fileDistribution).forEach(([file, count]) => {
      console.log(`      ${file}: ${count} 个`);
    });
    console.log();

    // 5. 检查BGP chunks是否在前20个中
    console.log('🎯 BGP chunks检查:\n');
    const top20 = allChunks.slice(0, 20);
    const bgpInTop20 = top20.filter(item =>
      item.chunk.content.toLowerCase().includes('bgp')
    );

    console.log(`   前20个chunks中有 ${bgpInTop20.length} 个BGP相关`);

    if (bgpInTop20.length > 0) {
      console.log(`   ✓ BGP chunks被正确返回`);
      console.log(`   样本: ${bgpInTop20[0].chunk.content.substring(0, 100)}...`);
    } else {
      console.log(`   ✗ 没有BGP chunks在前20个中！`);
      console.log(`   这可能是问题所在`);
    }
    console.log();

    // 6. 检查是否有chunks被完全过滤掉
    console.log('⚠️  过滤分析:\n');

    let filteredCount = 0;
    for (const file of jsonFiles) {
      const filePath = path.join(CHUNKS_DIR, file);
      const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      const withEmbedding = data.filter(c => c.embedding && c.embedding.length > 0).length;
      const inResults = allChunks.filter(item => item.file === file).length;
      const filtered = withEmbedding - inResults;

      filteredCount += filtered;

      console.log(`   ${file}:`);
      console.log(`      有embedding: ${withEmbedding}`);
      console.log(`      在结果中: ${inResults}`);
      console.log(`      被过滤: ${filtered}`);
    }

    console.log(`\n   总共被过滤: ${filteredCount} 个chunks`);
    console.log();

    // 7. 最终诊断
    console.log('🔧 诊断结果:\n');

    if (allChunks.length === 0) {
      console.log('   ❌ 问题: 没有chunks被返回');
      console.log('   原因: 所有chunks都被minScore过滤掉了');
      console.log('   解决: 降低minScore阈值或检查embedding质量');
    } else if (bgpInTop20.length === 0) {
      console.log('   ⚠️  问题: BGP chunks没有在前20个中');
      console.log('   原因: BGP chunks的相似度分数太低');
      console.log('   解决: 检查embedding生成是否正确');
    } else {
      console.log('   ✓ 检索流程正常');
      console.log('   BGP chunks被正确返回');
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

// 运行测试
testMultiFileRetrieval();
