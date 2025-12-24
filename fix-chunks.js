const fs = require('fs');
const path = require('path');

// HTML 表格转 Markdown
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

// 处理分片文件
function fixChunksFile(filePath) {
  console.log(`处理文件: ${filePath}`);

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  let modified = false;

  data.forEach(chunk => {
    if (chunk.content && chunk.content.includes('<table')) {
      const originalContent = chunk.content;
      chunk.content = convertHtmlTableToMarkdown(chunk.content);

      if (originalContent !== chunk.content) {
        modified = true;
        console.log(`  ✓ 修复了一个分片`);
      }
    }
  });

  if (modified) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`  ✓ 文件已保存\n`);
  } else {
    console.log(`  - 无需修改\n`);
  }
}

// 处理所有分片文件
const chunksDir = path.join(__dirname, 'data', 'chunks');
if (fs.existsSync(chunksDir)) {
  const files = fs.readdirSync(chunksDir).filter(f => f.endsWith('.json'));
  console.log(`找到 ${files.length} 个分片文件\n`);

  files.forEach(file => {
    fixChunksFile(path.join(chunksDir, file));
  });

  console.log('✓ 所有分片文件处理完成！');
} else {
  console.log('分片目录不存在');
}
