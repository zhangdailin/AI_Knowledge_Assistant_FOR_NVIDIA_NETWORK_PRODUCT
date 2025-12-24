import fs from 'fs';
import path from 'path';

/**
 * 改进 Markdown 结构
 */
function improveMarkdownStructure(text) {
  let result = text;
  result = result.replace(/^# ([^\n]+)\n\n# /gm, '## $1\n\n# ');
  result = result.replace(/^(#+\s[^\n]+)\n\n(#+\s)/gm, '$1\n\n$2');
  result = result.replace(/```\n(.{1,20})\n```/g, '`$1`');
  result = result.replace(/^(\s{4,})(-|\*|\+)\s/gm, '  $2 ');
  result = result.replace(/\n\n\n+/g, '\n\n');
  result = result.replace(/^# (NOTE|IMPORTANT)\n\n/gm, '\n> **$1**\n\n');
  result = result.replace(/\$\\equiv\$/g, '=');
  result = result.replace(/\$=\$/g, '=');
  return result;
}

/**
 * 转换 HTML 表格为 Markdown
 */
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

/**
 * 修复分片文件
 */
function fixChunkFile(filePath) {
  console.log(`\n处理: ${path.basename(filePath)}`);

  const chunks = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  let fixedCount = 0;
  let tableCount = 0;

  chunks.forEach(chunk => {
    if (!chunk.content) return;

    const originalContent = chunk.content;

    // 先改进结构
    let improved = improveMarkdownStructure(chunk.content);

    // 再转换表格
    let fixed = convertHtmlTableToMarkdown(improved);

    if (fixed !== originalContent) {
      chunk.content = fixed;
      fixedCount++;

      // 统计转换的表格数
      const tablesBefore = (originalContent.match(/<table>/gi) || []).length;
      const tablesAfter = (fixed.match(/<table>/gi) || []).length;
      tableCount += (tablesBefore - tablesAfter);
    }
  });

  if (fixedCount > 0) {
    fs.writeFileSync(filePath, JSON.stringify(chunks, null, 2), 'utf-8');
    console.log(`  ✓ 修复了 ${fixedCount} 个分片`);
    console.log(`  ✓ 转换了 ${tableCount} 个表格`);
  } else {
    console.log(`  - 无需修复`);
  }

  return { fixedCount, tableCount };
}

// 主程序
const chunksDir = path.join(process.cwd(), 'data', 'chunks');

if (!fs.existsSync(chunksDir)) {
  console.log('❌ 分片目录不存在:', chunksDir);
  process.exit(1);
}

const files = fs.readdirSync(chunksDir).filter(f => f.endsWith('.json'));

if (files.length === 0) {
  console.log('❌ 没有找到分片文件');
  process.exit(1);
}

console.log(`找到 ${files.length} 个分片文件\n`);
console.log('='.repeat(50));

let totalFixed = 0;
let totalTables = 0;

files.forEach(file => {
  const filePath = path.join(chunksDir, file);
  const { fixedCount, tableCount } = fixChunkFile(filePath);
  totalFixed += fixedCount;
  totalTables += tableCount;
});

console.log('\n' + '='.repeat(50));
console.log('\n✓ 完成！');
console.log(`  - 总共修复: ${totalFixed} 个分片`);
console.log(`  - 转换表格: ${totalTables} 个`);
