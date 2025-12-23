
const BASE_URL = 'http://localhost:8787';
const API_URL = `${BASE_URL}/api/ask`;

async function verify(question) {
  console.log(`\n🔍 Checking: "${question}"`);
  
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    
    const json = await res.json();
    
    if (json.ok) {
      console.log('✅ Answer Preview:');
      console.log('--------------------------------------------------');
      console.log(json.answer.substring(0, 1000));
      console.log('--------------------------------------------------');
      
      const hasStep1 = json.answer.includes('Peer Link') || json.answer.includes('Peer-Link') || json.answer.includes('peer-link');
      const hasStep2 = json.answer.includes('Domain Parameters') || json.answer.includes('MAC') || json.answer.includes('域参数');
      const hasStep3 = json.answer.includes('Member Ports') || json.answer.includes('成员端口');
      
      console.log(`\n[Reconstruction Check]`);
      console.log(`Step 1 (Peer Link): ${hasStep1 ? '✅ Found' : '❌ Missing'}`);
      console.log(`Step 2 (Domain/MAC): ${hasStep2 ? '✅ Found' : '❌ Missing'}`);
      console.log(`Step 3 (Member Ports): ${hasStep3 ? '✅ Found' : '❌ Missing'}`);
      
    } else {
      console.error(`❌ Error:`, json.error);
    }
  } catch (e) {
    console.error(`❌ Request Failed:`, e.message);
  }
}

async function run() {
  await verify('怎么配置MLAG');
}

run();
