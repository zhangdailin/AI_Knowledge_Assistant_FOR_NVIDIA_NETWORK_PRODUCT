/**
 * 文件验证工具
 * 集中处理文件类型检查和验证
 */

export function isExcelFile(filename, mime) {
  const name = filename.toLowerCase();
  return name.endsWith('.xlsx') || name.endsWith('.xls') || mime?.includes('spreadsheet') || mime?.includes('excel');
}

export function isPdfFile(filename, mime) {
  const name = filename.toLowerCase();
  return name.endsWith('.pdf') || mime?.includes('pdf');
}

export function isWordFile(filename, mime) {
  const name = filename.toLowerCase();
  return name.endsWith('.doc') || name.endsWith('.docx') || mime?.includes('word');
}

export function isTextFile(filename, mime) {
  const name = filename.toLowerCase();
  return name.endsWith('.txt') || name.endsWith('.md') || mime?.includes('text');
}

export function validateFileType(filename, mime) {
  // Excel files are now supported
  return { valid: true };
}

export function getFileCategory(filename, mime) {
  if (isPdfFile(filename, mime)) return 'pdf';
  if (isWordFile(filename, mime)) return 'word';
  if (isExcelFile(filename, mime)) return 'excel';
  if (isTextFile(filename, mime)) return 'text';
  return 'unknown';
}
