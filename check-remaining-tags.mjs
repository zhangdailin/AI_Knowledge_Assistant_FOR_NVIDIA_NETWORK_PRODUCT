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

// 查找剩余的 HTML 标签
const htmlTags = converted.match(/<[^>]+>/g) || [];
const uniqueTags = [...new Set(htmlTags)];

console.log('=== 剩余的 HTML 标签 ===');
console.log(`总数: ${htmlTags.length}`);
console.log(`唯一标签: ${uniqueTags.length}`);
console.log('\n标签列表:');
uniqueTags.slice(0, 20).forEach(tag => {
  const count = htmlTags.filter(t => t === tag).length;
  console.log(`  ${tag} (${count})`);
});

if (uniqueTags.length > 20) {
  console.log(`  ... 还有 ${uniqueTags.length - 20} 个其他标签`);
}
