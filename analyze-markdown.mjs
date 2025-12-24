import fs from 'fs';

const filePath = 'C:\\Users\\zhangdailin\\MinerU\\Cumulus-Linux-5.9-User-Guide.pdf-5371be8b-1665-4392-8877-4c8c17403889\\MinerU_markdown_202512210334255.md';
const content = fs.readFileSync(filePath, 'utf-8');

console.log('=== Markdown 文件分析 ===\n');

// 1. 检查代码块
const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
console.log(`1. 代码块数量: ${codeBlocks.length}`);
if (codeBlocks.length > 0) {
  console.log(`   - 最小: ${Math.min(...codeBlocks.map(b => b.length))} 字符`);
  console.log(`   - 最大: ${Math.max(...codeBlocks.map(b => b.length))} 字符`);
}

// 2. 检查标题层级
const h1 = (content.match(/^# [^\n]+/gm) || []).length;
const h2 = (content.match(/^## [^\n]+/gm) || []).length;
const h3 = (content.match(/^### [^\n]+/gm) || []).length;
const h4 = (content.match(/^#### [^\n]+/gm) || []).length;
console.log(`\n2. 标题分布:`);
console.log(`   - H1: ${h1}`);
console.log(`   - H2: ${h2}`);
console.log(`   - H3: ${h3}`);
console.log(`   - H4: ${h4}`);

// 3. 检查列表
const ulLists = (content.match(/^- [^\n]+/gm) || []).length;
const olLists = (content.match(/^\d+\. [^\n]+/gm) || []).length;
console.log(`\n3. 列表:`);
console.log(`   - 无序列表项: ${ulLists}`);
console.log(`   - 有序列表项: ${olLists}`);

// 4. 检查特殊块
const blockquotes = (content.match(/^> /gm) || []).length;
const notes = (content.match(/^# NOTE/gm) || []).length;
const important = (content.match(/^# IMPORTANT/gm) || []).length;
console.log(`\n4. 特殊块:`);
console.log(`   - 引用块: ${blockquotes}`);
console.log(`   - NOTE: ${notes}`);
console.log(`   - IMPORTANT: ${important}`);

// 5. 检查图片
const images = (content.match(/!\[.*?\]\(.*?\)/g) || []).length;
console.log(`\n5. 媒体:`);
console.log(`   - 图片: ${images}`);

// 6. 检查链接
const links = (content.match(/\[.*?\]\(.*?\)/g) || []).length;
console.log(`   - 链接: ${links}`);

// 7. 检查表格
const tables = (content.match(/<table>/gi) || []).length;
const mdTables = (content.match(/\|.*\|/g) || []).length;
console.log(`\n6. 表格:`);
console.log(`   - HTML 表格: ${tables}`);
console.log(`   - Markdown 表格: ${mdTables}`);

// 8. 检查段落长度
const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);
const avgLength = Math.round(paragraphs.reduce((a, b) => a + b.length, 0) / paragraphs.length);
console.log(`\n7. 段落分析:`);
console.log(`   - 总段落数: ${paragraphs.length}`);
console.log(`   - 平均长度: ${avgLength} 字符`);
console.log(`   - 最长段落: ${Math.max(...paragraphs.map(p => p.length))} 字符`);

// 9. 检查特殊格式
const bold = (content.match(/\*\*.*?\*\*/g) || []).length;
const italic = (content.match(/\*.*?\*/g) || []).length;
const code = (content.match(/`[^`]+`/g) || []).length;
console.log(`\n8. 文本格式:`);
console.log(`   - 粗体: ${bold}`);
console.log(`   - 斜体: ${italic}`);
console.log(`   - 行内代码: ${code}`);

// 10. 检查问题
console.log(`\n=== 潜在问题 ===`);
const issues = [];

// 检查是否有孤立的标题
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].match(/^#+\s/)) {
    if (i + 1 < lines.length && lines[i + 1].trim() === '') {
      if (i + 2 < lines.length && lines[i + 2].match(/^#+\s/)) {
        issues.push(`行 ${i + 1}: 标题后直接跟另一个标题，中间没有内容`);
      }
    }
  }
}

// 检查是否有不规范的列表
const listLines = lines.filter(l => l.match(/^[\s]*[-*+]\s/));
if (listLines.length > 0) {
  console.log(`   - 发现 ${listLines.length} 行列表项`);
}

// 检查是否有不规范的缩进
const indentedLines = lines.filter(l => l.match(/^[\s]{2,}[^\s]/));
if (indentedLines.length > 50) {
  console.log(`   - 发现 ${indentedLines.length} 行缩进内容（可能是嵌套列表或代码）`);
}

if (issues.length > 0) {
  console.log(`\n发现的问题:`);
  issues.slice(0, 5).forEach(issue => console.log(`   - ${issue}`));
  if (issues.length > 5) {
    console.log(`   ... 还有 ${issues.length - 5} 个问题`);
  }
} else {
  console.log(`   - 未发现明显的结构问题`);
}
