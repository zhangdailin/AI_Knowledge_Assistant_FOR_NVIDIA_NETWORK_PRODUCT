/**
 * 完整检索管道测试
 * 模拟从前端查询到最后输出的完整流程
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

async function testFullPipeline() {
  console.log('=== 完整检索管道测试 ===\n');

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

    console.log(`🎯 使用BGP chunk作为查询embedding\n`);

    // 3. 向量搜索 (模拟server/storage.mjs的vectorSearchChunks)
    console.log('📈 第1步: 向量搜索\n');
    const minScore = 0.2;
    let vectorResults = [];

    for (const chunk of allChunks) {
      if (Array.isArray(chunk.embedding) && chunk.embedding.length > 0) {
        const score = cosine(bgpChunk.embedding, chunk.embedding);
        if (score > minScore) {
          vectorResults.push({ chunk, score });
        }
      }
    }

    vectorResults.sort((a, b) => b.score - a.score);
    console.log(`   向量搜索返回: ${vectorResults.length} 个chunks`);
    console.log(`   前5个chunks的分数: ${vectorResults.slice(0, 5).map(r => r.score.toFixed(4)).join(', ')}`);
    console.log(`   其中BGP chunks: ${vectorResults.filter(r => r.chunk.content.toLowerCase().includes('bgp')).length}\n`);

    // 4. 关键词搜索 (模拟server/storage.mjs的searchChunks)
    console.log('📈 第2步: 关键词搜索\n');
    const query = '如何配置BGP';
    const queryLower = query.toLowerCase();
    const keywords = query.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [];

    let keywordResults = [];
    for (const chunk of allChunks) {
      const contentLower = chunk.content.toLowerCase();
      let score = 0;

      if (contentLower.includes(queryLower)) score += 10;
      keywords.forEach(keyword => {
        if (contentLower.includes(keyword.toLowerCase())) score += 1;
      });

      if (score > 0) {
        keywordResults.push({ chunk, score });
      }
    }

    keywordResults.sort((a, b) => b.score - a.score);
    console.log(`   关键词搜索返回: ${keywordResults.length} 个chunks`);
    console.log(`   前5个chunks的分数: ${keywordResults.slice(0, 5).map(r => r.score).join(', ')}`);
    console.log(`   其中BGP chunks: ${keywordResults.filter(r => r.chunk.content.toLowerCase().includes('bgp')).length}\n`);

    // 5. RRF融合 (模拟src/lib/retrieval.ts的RRF逻辑)
    console.log('📈 第3步: RRF融合\n');
    const RRF_K = 60;
    const rrfMap = new Map();

    vectorResults.slice(0, 60).forEach((item, rank) => {
      const scoreToAdd = 1 / (RRF_K + rank + 1);
      if (!rrfMap.has(item.chunk.id)) {
        rrfMap.set(item.chunk.id, { chunk: item.chunk, rrfScore: 0, sources: [] });
      }
      rrfMap.get(item.chunk.id).rrfScore += scoreToAdd;
      rrfMap.get(item.chunk.id).sources.push('vector');
    });

    keywordResults.slice(0, 60).forEach((item, rank) => {
      const scoreToAdd = 1 / (RRF_K + rank + 1);
      if (!rrfMap.has(item.chunk.id)) {
        rrfMap.set(item.chunk.id, { chunk: item.chunk, rrfScore: 0, sources: [] });
      }
      rrfMap.get(item.chunk.id).rrfScore += scoreToAdd;
      rrfMap.get(item.chunk.id).sources.push('keyword');
    });

    const mergedResults = Array.from(rrfMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore);

    console.log(`   RRF融合后: ${mergedResults.length} 个chunks`);
    console.log(`   前5个chunks的RRF分数: ${mergedResults.slice(0, 5).map(r => r.rrfScore.toFixed(6)).join(', ')}`);
    console.log(`   其中BGP chunks: ${mergedResults.filter(r => r.chunk.content.toLowerCase().includes('bgp')).length}\n`);

    // 6. 文档过滤 (模拟src/lib/retrieval.ts的文档过滤逻辑)
    console.log('📈 第4步: 文档过滤\n');

    // 计算每个文档的平均分数
    const chunksByDoc = new Map();
    mergedResults.forEach(item => {
      if (!chunksByDoc.has(item.chunk.documentId)) {
        chunksByDoc.set(item.chunk.documentId, []);
      }
      chunksByDoc.get(item.chunk.documentId).push(item);
    });

    const docAvgScores = new Map();
    chunksByDoc.forEach((docChunks, docId) => {
      const avgScore = docChunks.reduce((sum, item) => sum + item.rrfScore, 0) / docChunks.length;
      docAvgScores.set(docId, avgScore);
    });

    console.log(`   文档数: ${docAvgScores.size}`);
    docAvgScores.forEach((score, docId) => {
      console.log(`   ${docId}: 平均分数 ${score.toFixed(6)}`);
    });

    // 应用相关性阈值
    const maxAvgScore = Math.max(...Array.from(docAvgScores.values()));
    const baseRelevanceThreshold = maxAvgScore * 0.2;
    console.log(`\n   最高平均分数: ${maxAvgScore.toFixed(6)}`);
    console.log(`   相关性阈值: ${baseRelevanceThreshold.toFixed(6)}`);

    const relevantDocs = new Set();
    docAvgScores.forEach((avgScore, docId) => {
      if (avgScore >= baseRelevanceThreshold) {
        relevantDocs.add(docId);
      }
    });

    console.log(`   通过过滤的文档: ${relevantDocs.size}\n`);

    // 7. 最终结果
    console.log('📈 第5步: 最终结果\n');
    const finalResults = mergedResults
      .filter(item => relevantDocs.has(item.chunk.documentId))
      .slice(0, 20);

    console.log(`   最终返回: ${finalResults.length} 个chunks`);
    if (finalResults.length > 0) {
      console.log(`   前3个chunks:`);
      finalResults.slice(0, 3).forEach((item, i) => {
        console.log(`      ${i + 1}. RRF分数: ${item.rrfScore.toFixed(6)}`);
        console.log(`         ${item.chunk.content.substring(0, 80)}...`);
      });
    }
    console.log(`   其中BGP chunks: ${finalResults.filter(r => r.chunk.content.toLowerCase().includes('bgp')).length}\n`);

    // 8. 诊断
    console.log('🔧 诊断:\n');
    if (finalResults.length === 0) {
      console.log('   ❌ 问题: 最终结果为空');
      console.log(`   原因分析:`);
      console.log(`   - 向量搜索返回: ${vectorResults.length} 个chunks`);
      console.log(`   - 关键词搜索返回: ${keywordResults.length} 个chunks`);
      console.log(`   - RRF融合后: ${mergedResults.length} 个chunks`);
      console.log(`   - 文档过滤后: ${finalResults.length} 个chunks`);
      console.log(`   - 相关性阈值可能过高: ${baseRelevanceThreshold.toFixed(6)}`);
    } else {
      console.log(`   ✓ 检索流程正常`);
      console.log(`   ✓ 返回了 ${finalResults.length} 个chunks`);
      const bgpCount = finalResults.filter(r => r.chunk.content.toLowerCase().includes('bgp')).length;
      console.log(`   ✓ 其中 ${bgpCount} 个是BGP相关的`);
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

testFullPipeline();
