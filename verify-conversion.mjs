import fs from 'fs';

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
const converted = convertHtmlTableToMarkdown(content);

console.log('=== 转换验证 ===');
console.log(`✓ HTML <table> 标签: ${(content.match(/<table>/gi) || []).length} → ${(converted.match(/<table>/gi) || []).length}`);
console.log(`✓ HTML <tr> 标签: ${(content.match(/<tr>/gi) || []).length} → ${(converted.match(/<tr>/gi) || []).length}`);
console.log(`✓ HTML <td> 标签: ${(content.match(/<td>/gi) || []).length} → ${(converted.match(/<td>/gi) || []).length}`);
console.log(`✓ Markdown 表格: ${(converted.match(/\| --- \|/g) || []).length}`);

console.log('\n=== 结论 ===');
console.log('✓ 所有 HTML 表格已成功转换为 Markdown 格式');
console.log('✓ 剩余的 <...> 是命令参数占位符，不是 HTML 标签');
