/**
 * 测试服务器API返回的结果
 */

async function testServerAPI() {
  console.log('=== 测试服务器API ===\n');

  try {
    // 测试搜索API
    const query = '如何配置BGP';
    const url = `http://localhost:3000/api/chunks/search?q=${encodeURIComponent(query)}&limit=20`;

    console.log(`🔍 查询: "${query}"`);
    console.log(`📡 请求URL: ${url}\n`);

    const response = await fetch(url);
    const data = await response.json();

    console.log(`📊 API响应状态: ${response.status}`);
    console.log(`✓ 返回chunks数量: ${data.chunks?.length || 0}\n`);

    if (data.chunks && data.chunks.length > 0) {
      console.log('📈 前5个chunks:');
      data.chunks.slice(0, 5).forEach((chunk, i) => {
        console.log(`   ${i + 1}. 分数: ${chunk._score?.toFixed(6) || 'N/A'}`);
        console.log(`      来源: ${chunk._sources?.join(', ') || 'N/A'}`);
        console.log(`      内容: ${chunk.content.substring(0, 80)}...`);
      });

      console.log(`\n🎯 BGP相关chunks: ${data.chunks.filter(c => c.content.toLowerCase().includes('bgp')).length}`);
    } else {
      console.log('❌ API返回空结果');
      console.log(`完整响应: ${JSON.stringify(data, null, 2)}`);
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testServerAPI();
