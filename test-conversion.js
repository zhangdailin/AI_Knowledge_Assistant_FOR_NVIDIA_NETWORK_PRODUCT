const fs = require('fs');

// 转换函数
function convertHtmlTableToMarkdown(html) {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, tableContent) => {
    const rows = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    if (rows.length === 0) return match;

    const markdownRows = rows.map(row => {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      const cellTexts = cells.map(cell => {
        const text = cell.replace(/<td[^>]*>/gi, '').replace(/<\/td>/gi, '').trim();
        return text.replace(/<[^>]+>/g, '').trim();
      });
      return '| ' + cellTexts.join(' | ') + ' |';
    });

    if (markdownRows.length === 0) return match;

    const result = [markdownRows[0]];
    result.push('| ' + markdownRows[0].split('|').slice(1, -1).map(() => '---').join(' | ') + ' |');
    result.push(...markdownRows.slice(1));

    return '\n' + result.join('\n') + '\n';
  });
}

// 读取文件
const filePath = 'C:\\Users\\zhangdailin\\MinerU\\Cumulus-Linux-5.9-User-Guide.pdf-5371be8b-1665-4392-8877-4c8c17403889\\MinerU_markdown_202512210334255.md';
const content = fs.readFileSync(filePath, 'utf-8');

console.log('=== 文件分析 ===');
console.log(`文件大小: ${(content.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`HTML 表格数量: ${(content.match(/<table>/gi) || []).length}`);

// 转换
console.log('\n转换中...');
const converted = convertHtmlTableToMarkdown(content);

console.log('\n=== 转换结果 ===');
console.log(`转换后大小: ${(converted.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`剩余 HTML 表格: ${(converted.match(/<table>/gi) || []).length}`);
console.log(`Markdown 表格: ${(converted.match(/\| --- \|/g) || []).length}`);

// 检查是否有问题
if (converted.includes('<table') || converted.includes('<tr') || converted.includes('<td')) {
  console.log('\n❌ 仍然包含 HTML 表格标签');
} else {
  console.log('\n✓ 成功转换所有表格');
}

// 显示一个转换后的表格示例
const tableMatch = converted.match(/\| .+ \|\n\| --- \|[\s\S]*?\n\n/);
if (tableMatch) {
  console.log('\n=== 转换后的表格示例 ===');
  console.log(tableMatch[0].substring(0, 300));
}
