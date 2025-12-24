/**
 * 健康检查脚本
 * 检查AI知识助手的各个组件是否正常运行
 */

const BACKEND_URL = 'http://localhost:8787';
const FRONTEND_URL = 'http://localhost:5173';

const COLORS = {
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  CYAN: '\x1b[36m',
  BOLD: '\x1b[1m'
};

const color = (str, colorCode) => `${colorCode}${str}${COLORS.RESET}`;

console.log(color('\n━━━ AI知识助手健康检查 ━━━\n', COLORS.BOLD));

async function checkBackend() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/documents`);
    if (response.ok) {
      const data = await response.json();
      console.log(color('✅ 后端服务', COLORS.GREEN) + ` - 运行正常 (${BACKEND_URL})`);
      console.log(`   文档数量: ${data.documents?.length || 0}`);
      return true;
    } else {
      console.log(color('⚠️  后端服务', COLORS.YELLOW) + ` - 响应异常 (HTTP ${response.status})`);
      return false;
    }
  } catch (error) {
    console.log(color('❌ 后端服务', COLORS.RED) + ` - 未运行`);
    console.log(color('   启动命令: npm run server', COLORS.YELLOW));
    return false;
  }
}

async function checkFrontend() {
  try {
    const response = await fetch(FRONTEND_URL);
    if (response.ok || response.status === 304) {
      console.log(color('✅ 前端服务', COLORS.GREEN) + ` - 运行正常 (${FRONTEND_URL})`);
      return true;
    } else {
      console.log(color('⚠️  前端服务', COLORS.YELLOW) + ` - 响应异常`);
      return false;
    }
  } catch (error) {
    console.log(color('❌ 前端服务', COLORS.RED) + ` - 未运行`);
    console.log(color('   启动命令: npm run dev', COLORS.YELLOW));
    return false;
  }
}

async function checkRetrieval() {
  try {
    const testQuery = '测试查询';
    const response = await fetch(`${BACKEND_URL}/api/chunks/search?q=${encodeURIComponent(testQuery)}&limit=1`);
    if (response.ok) {
      const data = await response.json();
      console.log(color('✅ 检索功能', COLORS.GREEN) + ` - 工作正常`);
      console.log(`   测试查询返回: ${data.chunks?.length || 0} 条结果`);
      return true;
    } else {
      console.log(color('⚠️  检索功能', COLORS.YELLOW) + ` - 异常`);
      return false;
    }
  } catch (error) {
    console.log(color('❌ 检索功能', COLORS.RED) + ` - 无法连接`);
    return false;
  }
}

async function checkApiKey() {
  try {
    const fs = await import('fs');
    const path = await import('path');

    const settingsPath = path.join(process.cwd(), 'data', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      console.log(color('⚠️  API配置', COLORS.YELLOW) + ` - 配置文件不存在`);
      return false;
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hasSiliconFlow = settings.apiKeys?.siliconflow ? true : false;

    if (hasSiliconFlow) {
      console.log(color('✅ API配置', COLORS.GREEN) + ` - SiliconFlow API Key已配置`);
      return true;
    } else {
      console.log(color('⚠️  API配置', COLORS.YELLOW) + ` - API Key未配置`);
      console.log(color('   请在设置页面配置SiliconFlow API Key', COLORS.YELLOW));
      return false;
    }
  } catch (error) {
    console.log(color('⚠️  API配置', COLORS.YELLOW) + ` - 无法读取配置`);
    return false;
  }
}

async function runHealthCheck() {
  const results = {
    backend: await checkBackend(),
    frontend: await checkFrontend(),
    retrieval: await checkRetrieval(),
    apiKey: await checkApiKey()
  };

  console.log(color('\n━━━ 检查结果 ━━━\n', COLORS.BOLD));

  const allGood = Object.values(results).every(r => r);

  if (allGood) {
    console.log(color('🎉 所有服务运行正常！', COLORS.GREEN));
    console.log(`\n访问应用: ${color(FRONTEND_URL, COLORS.CYAN)}\n`);
  } else {
    console.log(color('⚠️  部分服务需要启动', COLORS.YELLOW));
    console.log('\n需要的操作：');

    if (!results.backend || !results.retrieval) {
      console.log(color('  1. 启动后端: npm run server', COLORS.CYAN));
    }
    if (!results.frontend) {
      console.log(color('  2. 启动前端: npm run dev', COLORS.CYAN));
    }
    if (!results.apiKey) {
      console.log(color('  3. 配置API Key（在设置页面）', COLORS.CYAN));
    }
    console.log();
  }

  process.exit(allGood ? 0 : 1);
}

runHealthCheck().catch(error => {
  console.error(color('\n健康检查失败:', COLORS.RED), error.message);
  process.exit(1);
});
