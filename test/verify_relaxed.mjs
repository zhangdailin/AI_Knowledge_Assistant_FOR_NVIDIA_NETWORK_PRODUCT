
// import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:8787';

async function verifyLocal() {
  const query = '列出当前设备所有的配置';
  const url = `${BASE_URL}/api/chunks/search?q=${encodeURIComponent(query)}&limit=10`;
  
  console.log(`Checking Local (Relaxed Logic): ${BASE_URL}`);
  console.log(`Query: "${query}"`);
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.chunks && data.chunks.length > 0) {
      const targetIndex = data.chunks.findIndex(c => c.content.includes('nv config show'));
      
      if (targetIndex !== -1) {
          console.log(`✅ FOUND "nv config show" at Rank ${targetIndex + 1}`);
          if (targetIndex < 5) console.log('   Result: 🏆 TOP 5');
          else console.log('   Result: ⚠️ NOT TOP 5');
      } else {
          console.log('❌ NOT FOUND in top 10');
      }
    }
  } catch (e) { console.log(e.message); }
}

verifyLocal();
