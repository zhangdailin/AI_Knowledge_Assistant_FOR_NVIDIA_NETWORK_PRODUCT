import fs from 'fs';

/**
 * 改进的 Markdown 预处理
 * 解决 PDF 转换的常见问题
 */

function improveMarkdown(text) {
  let result = text;

  // 1. 修复过多的 H1 标题 - 将孤立的 H1 转换为 H2
  result = result.replace(/^# ([^\n]+)\n\n# /gm, '## $1\n\n# ');

  // 2. 修复标题后直接跟另一个标题的情况
  result = result.replace(/^(#+\s[^\n]+)\n\n(#+\s)/gm, '$1\n\n$2');

  // 3. 修复过短的代码块（< 20 字符）- 转换为行内代码
  result = result.replace(/```\n(.{1,20})\n```/g, '`$1`');

  // 4. 修复命令行示例的格式
  // 将 "$ command" 转换为代码块
  result = result.replace(/^(\$\s.+)$/gm, (match) => {
    return '```bash\n' + match + '\n```';
  });

  // 5. 修复列表缩进问题
  // 将多个空格的列表项标准化为 2 个空格
  result = result.replace(/^(\s{4,})(-|\*|\+)\s/gm, '  $2 ');

  // 6. 修复孤立的列表项（前后都没有列表项）
  result = result.replace(/\n\n(-\s[^\n]+)\n\n/g, '\n\n$1\n');

  // 7. 修复表格前后的空行
  result = result.replace(/\n\n(\|.+\|)\n\n/g, '\n\n$1\n\n');

  // 8. 修复 NOTE 和 IMPORTANT 块的格式
  result = result.replace(/^# (NOTE|IMPORTANT)\n\n/gm, '\n> **$1**\n\n');

  // 9. 修复数学符号 $\equiv$ 和 $=$ 为普通文本
  result = result.replace(/\$\\equiv\$/g, '=');
  result = result.replace(/\$=\$/g, '=');

  // 10. 修复多个连续空行
  result = result.replace(/\n\n\n+/g, '\n\n');

  return result;
}

// 测试
const filePath = 'C:\\Users\\zhangdailin\\MinerU\\Cumulus-Linux-5.9-User-Guide.pdf-5371be8b-1665-4392-8877-4c8c17403889\\MinerU_markdown_202512210334255.md';
const content = fs.readFileSync(filePath, 'utf-8');
const improved = improveMarkdown(content);

console.log('=== 改进效果 ===\n');

// 统计改进前后的差异
const before = {
  h1: (content.match(/^# [^\n]+/gm) || []).length,
  h2: (content.match(/^## [^\n]+/gm) || []).length,
  codeBlocks: (content.match(/```[\s\S]*?```/g) || []).length,
  emptyLines: (content.match(/\n\n\n+/g) || []).length,
};

const after = {
  h1: (improved.match(/^# [^\n]+/gm) || []).length,
  h2: (improved.match(/^## [^\n]+/gm) || []).length,
  codeBlocks: (improved.match(/```[\s\S]*?```/g) || []).length,
  emptyLines: (improved.match(/\n\n\n+/g) || []).length,
};

console.log('H1 标题:');
console.log(`  改进前: ${before.h1}`);
console.log(`  改进后: ${after.h1}`);
console.log(`  改进: ${before.h1 - after.h1} 个\n`);

console.log('H2 标题:');
console.log(`  改进前: ${before.h2}`);
console.log(`  改进后: ${after.h2}`);
console.log(`  增加: ${after.h2 - before.h2} 个\n`);

console.log('代码块:');
console.log(`  改进前: ${before.codeBlocks}`);
console.log(`  改进后: ${after.codeBlocks}`);
console.log(`  减少: ${before.codeBlocks - after.codeBlocks} 个\n`);

console.log('多余空行:');
console.log(`  改进前: ${before.emptyLines}`);
console.log(`  改进后: ${after.emptyLines}`);
console.log(`  减少: ${before.emptyLines - after.emptyLines} 个\n`);

// 保存改进后的文件
const outputPath = filePath.replace('.md', '_improved.md');
fs.writeFileSync(outputPath, improved, 'utf-8');
console.log(`✓ 改进后的文件已保存: ${outputPath}`);
