
import fs from 'fs';
import path from 'path';

// Parse command line arguments
const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const jsonOutput = args.includes('--json');
const urlArg = args.find(arg => arg.startsWith('--url='));
const typeArg = args.find(arg => arg.startsWith('--type='));

if (help) {
  console.log(`
Usage: node test/benchmark_precision.mjs [options]

Options:
  --url=<url>   Set the API URL (default: http://172.17.200.222:8787/api/chunks/search)
  --type=<type> Filter test cases by type (command, concept, troubleshoot, exact_command)
  --json        Output results in JSON format
  --help, -h    Show this help message
`);
  process.exit(0);
}

const REMOTE_URL = urlArg ? urlArg.split('=')[1] : 'http://172.17.200.222:8787/api/chunks/search';
const FILTER_TYPE = typeArg ? typeArg.split('=')[1] : null;

// ANSI Colors
const COLORS = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  CYAN: '\x1b[36m',
  BOLD: '\x1b[1m'
};

const color = (str, colorCode) => jsonOutput ? str : `${colorCode}${str}${COLORS.RESET}`;

// 1. 定义基准测试集 (Golden Dataset)
// 格式: { query: "问题", expected: ["关键词1", "关键词2"], minRank: 5 }
const ALL_TEST_CASES = [
  // --- 命令类 (Command) ---
  { 
    query: "列出当前设备所有的配置", 
    expected: ["nv config show", "running configuration"], 
    minRank: 5,
    type: "command"
  },
  { 
    query: "如何查看 BGP 邻居状态", 
    expected: ["nv show router bgp neighbor", "Established"], 
    minRank: 5,
    type: "command"
  },
  {
    query: "nv config apply",
    expected: ["apply", "commit", "save"],
    minRank: 3,
    type: "exact_command"
  },

  // --- 概念类 (Concept) ---
  { 
    query: "什么是 MLAG", 
    expected: ["Multi-Chassis Link Aggregation", "redundancy"], 
    minRank: 10,
    type: "concept"
  },
  { 
    query: "解释一下 VXLAN 的 VNI", 
    expected: ["Virtual Network Identifier", "overlay"], 
    minRank: 10,
    type: "concept"
  },

  // --- 故障排查类 (Troubleshooting) ---
  {
    query: "BGP 邻居起不来怎么办",
    expected: ["troubleshoot", "debug", "log"],
    minRank: 10,
    type: "troubleshoot"
  },

  // --- 接口状态查询类 (Interface Status) ---
  {
    query: "如何查询接口状态",
    expected: ["nv show interface", "interface status", "接口状态"],
    minRank: 5,
    type: "command"
  },
  {
    query: "怎么查看端口状态",
    expected: ["nv show interface", "port status", "端口状态"],
    minRank: 5,
    type: "command"
  },
  {
    query: "nv show interface",
    expected: ["nv show interface"],
    minRank: 1,
    type: "exact_command"
  },
  {
    query: "查看swp1接口状态",
    expected: ["swp1", "nv show interface swp1"],
    minRank: 3,
    type: "command"
  }
];

const TEST_CASES = FILTER_TYPE 
  ? ALL_TEST_CASES.filter(tc => tc.type === FILTER_TYPE)
  : ALL_TEST_CASES;

async function runPrecisionTest() {
  if (!jsonOutput) {
    console.log(color('Starting Precision Benchmark...', COLORS.BOLD));
    console.log(`Target URL: ${REMOTE_URL}`);
    console.log(`Filter Type: ${FILTER_TYPE || 'ALL'}`);
    console.log(`Total Cases: ${TEST_CASES.length}`);
  }
  
  let totalScore = 0;
  let passedCases = 0;
  
  const results = [];

  for (const testCase of TEST_CASES) {
    if (!jsonOutput) {
      console.log(`\n${'-'.repeat(50)}`);
      console.log(`Query: "${color(testCase.query, COLORS.CYAN)}" [${testCase.type}]`);
    }
    
    try {
      const url = `${REMOTE_URL}?q=${encodeURIComponent(testCase.query)}&limit=20`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const json = await response.json();
      const chunks = json.chunks || [];
      
      let bestRank = -1;
      let matchedKeyword = null;
      let matchedChunk = null;

      // 检查结果是否包含预期关键词
      for (let i = 0; i < chunks.length; i++) {
        const content = chunks[i].content.toLowerCase();
        for (const keyword of testCase.expected) {
          if (content.includes(keyword.toLowerCase())) {
            bestRank = i + 1;
            matchedKeyword = keyword;
            matchedChunk = chunks[i];
            break;
          }
        }
        if (bestRank !== -1) break;
      }

      const isPass = bestRank !== -1 && bestRank <= testCase.minRank;
      
      // 评分系统: 
      // 1. 没找到 = 0分
      // 2. 找到了但排名低 = 0.5分
      // 3. 找到了且排名符合要求 = 1分 + (1 - rank/minRank) * 0.5 (排名越靠前分越高)
      let caseScore = 0;
      if (bestRank !== -1) {
          if (bestRank <= testCase.minRank) {
              caseScore = 1 + (1 - bestRank/testCase.minRank) * 0.5;
              passedCases++;
          } else {
              caseScore = 0.5; // Found but low rank
          }
      }
      
      totalScore += caseScore;

      if (!jsonOutput) {
        const resultStr = isPass ? color('PASS', COLORS.GREEN) : color('FAIL', COLORS.RED);
        console.log(`Result: ${resultStr}`);
        console.log(`Best Rank: ${bestRank === -1 ? color('Not Found', COLORS.RED) : bestRank} (Required: <= ${testCase.minRank})`);
        if (matchedChunk) {
            console.log(`Matched: "${color(matchedKeyword, COLORS.YELLOW)}"`);
            // console.log(`Sources: ${JSON.stringify(matchedChunk._sources)}`);
            if (matchedChunk._score || matchedChunk._debug) {
               console.log(`Scores: RRF=${matchedChunk._score?.toFixed(4) || 'N/A'}, Keyword=${matchedChunk._debug?.keywordScore || 'N/A'}, Vector=${matchedChunk._debug?.vectorScore?.toFixed(4) || 'N/A'}`);
            }
        }
      }

      results.push({
          query: testCase.query,
          type: testCase.type,
          expected: testCase.expected,
          minRank: testCase.minRank,
          rank: bestRank,
          score: caseScore,
          passed: isPass,
          matchedKeyword,
          matchedSources: matchedChunk ? matchedChunk._sources : null
      });

    } catch (error) {
      console.error(color(`Error testing case: ${error.message}`, COLORS.RED));
      results.push({
        query: testCase.query,
        error: error.message,
        passed: false
      });
    }
  }

  const accuracy = TEST_CASES.length > 0 ? (passedCases / TEST_CASES.length) * 100 : 0;
  const maxScore = TEST_CASES.length * 1.5;

  if (jsonOutput) {
    console.log(JSON.stringify({
      config: {
        url: REMOTE_URL,
        filter: FILTER_TYPE
      },
      summary: {
        total: TEST_CASES.length,
        passed: passedCases,
        accuracy: accuracy,
        score: totalScore,
        maxScore: maxScore
      },
      results: results
    }, null, 2));
  } else {
    // 生成报告
    console.log(`\n${'='.repeat(50)}`);
    console.log(color('BENCHMARK REPORT', COLORS.BOLD));
    console.log(`${'='.repeat(50)}`);
    console.log(`Passed: ${passedCases}/${TEST_CASES.length}`);
    console.log(`Precision Score: ${totalScore.toFixed(2)} / ${maxScore.toFixed(2)}`);
    
    let accuracyColor = COLORS.RED;
    if (accuracy >= 80) accuracyColor = COLORS.GREEN;
    else if (accuracy >= 60) accuracyColor = COLORS.YELLOW;
    
    console.log(`Accuracy: ${color(accuracy.toFixed(1) + '%', accuracyColor)}`);
    
    if (accuracy < 60) {
        console.log(`\nCONCLUSION: ${color('Model needs SIGNIFICANT improvement.', COLORS.RED)}`);
    } else if (accuracy < 80) {
        console.log(`\nCONCLUSION: ${color('Model is decent but needs tuning.', COLORS.YELLOW)}`);
    } else {
        console.log(`\nCONCLUSION: ${color('Model is performing well!', COLORS.GREEN)}`);
    }
  }
}

runPrecisionTest();
