/**
 * 模拟前端检索流程
 * 测试从searchSimilarChunks到最终结果的完整流程
 */

// 模拟服务器返回的chunks
const mockServerChunks = [
  {
    id: 'chunk-1',
    documentId: 'doc-1',
    content: 'BGP configuration example',
    score: 1,
    _score: 0.032787,
    _sources: ['keyword', 'vector']
  },
  {
    id: 'chunk-2',
    documentId: 'doc-1',
    content: 'How to configure BGP',
    score: 1,
    _score: 0.029670,
    _sources: ['keyword']
  },
  {
    id: 'chunk-3',
    documentId: 'doc-1',
    content: 'NVUE commands for BGP',
    score: 1,
    _score: 0.025849,
    _sources: ['vector']
  }
];

// 模拟 unifiedStorage.searchSimilarChunks
function searchSimilarChunks(chunks) {
  return chunks.map(chunk => ({ chunk, score: 1.0 }));
}

// 模拟 retrieval.semanticSearch 中的关键词结果处理
function processKeywordResults(keywordResults) {
  const keywordRecall = keywordResults.map(item => ({
    chunk: item.chunk,
    score: item.score,
    source: 'keyword'
  }));

  console.log('📊 关键词结果处理:');
  console.log(`   输入数量: ${keywordResults.length}`);
  console.log(`   输出数量: ${keywordRecall.length}`);

  if (keywordRecall.length > 0) {
    console.log(`   第一个结果:`);
    console.log(`   - chunk.id: ${keywordRecall[0].chunk?.id}`);
    console.log(`   - chunk.content: ${keywordRecall[0].chunk?.content?.substring(0, 50)}`);
    console.log(`   - score: ${keywordRecall[0].score}`);
  }

  return keywordRecall;
}

console.log('=== 模拟前端检索流程 ===\n');

// 1. 模拟服务器返回chunks
console.log('1️⃣ 服务器返回chunks:');
console.log(`   数量: ${mockServerChunks.length}\n`);

// 2. 模拟 unifiedStorage.searchSimilarChunks 的转换
console.log('2️⃣ unifiedStorage.searchSimilarChunks 转换:');
const wrappedChunks = searchSimilarChunks(mockServerChunks);
console.log(`   输入: Chunk[]`);
console.log(`   输出: { chunk: Chunk; score: number }[]`);
console.log(`   数量: ${wrappedChunks.length}\n`);

// 3. 模拟 retrieval.semanticSearch 中的处理
console.log('3️⃣ retrieval.semanticSearch 处理:');
const keywordRecall = processKeywordResults(wrappedChunks);
console.log();

// 4. 检查是否能正确访问chunk属性
console.log('4️⃣ 检查chunk属性访问:');
if (keywordRecall.length > 0) {
  const firstItem = keywordRecall[0];
  console.log(`   item.chunk: ${firstItem.chunk ? '✓ 存在' : '✗ 不存在'}`);
  console.log(`   item.chunk.content: ${firstItem.chunk?.content ? '✓ 存在' : '✗ 不存在'}`);
  console.log(`   item.chunk.id: ${firstItem.chunk?.id ? '✓ 存在' : '✗ 不存在'}`);
}
