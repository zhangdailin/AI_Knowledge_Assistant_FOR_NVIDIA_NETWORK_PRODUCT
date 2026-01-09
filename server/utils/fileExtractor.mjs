/**
 * 文件内容提取工具
 */
import mammoth from 'mammoth';
import XLSX from 'xlsx';

/**
 * 根据文件名和MIME类型判断文件类别
 */
export function getFileCategory(filename, mime) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (lower.endsWith('.doc') || lower.endsWith('.docx') || mime.includes('word')) return 'word';
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx') || mime.includes('excel') || mime.includes('spreadsheet')) return 'excel';
  if (lower.endsWith('.txt') || lower.endsWith('.md') || mime.startsWith('text/')) return 'text';
  return 'unknown';
}

/**
 * 验证文件类型
 */
export function validateFileType(filename, mime) {
  const category = getFileCategory(filename, mime);
  const allowedTypes = ['pdf', 'word', 'excel', 'text'];

  if (!allowedTypes.includes(category)) {
    return {
      valid: false,
      error: `不支持的文件类型: ${filename}。仅支持 PDF, Word, Excel, TXT 文件。`
    };
  }

  return { valid: true };
}

/**
 * 从PDF文件提取文本
 */
export async function extractPdfText(buffer, pdfParseModule) {
  const PdfParseClass = pdfParseModule?.PDFParse || pdfParseModule?.default?.PDFParse || pdfParseModule;

  if (typeof PdfParseClass !== 'function') {
    throw new Error('PDF解析器不可用');
  }

  const parser = new PdfParseClass({ data: buffer });

  if (typeof parser.getText !== 'function') {
    throw new Error('PDF解析器缺少 getText 方法');
  }

  const result = await parser.getText({});
  const text = result?.text || '';
  const pages = result?.total || result?.pages?.length || 0;

  if (typeof parser.destroy === 'function') {
    await parser.destroy();
  }

  return { text, pages };
}

/**
 * 从Word文件提取文本
 */
export async function extractWordText(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

/**
 * 从Excel文件提取文本
 */
export function extractExcelText(buffer) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellFormula: false,
    cellStyles: false
  });

  const sheets = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    return `【${name}】\n${csv}`;
  });

  return sheets.join('\n\n');
}

/**
 * 从普通文本文件提取内容
 */
export function extractTextContent(buffer) {
  return buffer.toString('utf-8');
}

/**
 * 通用文件内容提取器
 * @param {Buffer} buffer - 文件buffer
 * @param {string} fileCategory - 文件类别 (pdf/word/excel/text)
 * @param {Object} options - 可选配置（如pdfParseModule）
 * @returns {Promise<string>} - 提取的文本内容
 */
export async function extractFileContent(buffer, fileCategory, options = {}) {
  try {
    let text = '';

    switch (fileCategory) {
      case 'pdf':
        if (!options.pdfParseModule) {
          throw new Error('PDF解析需要提供 pdfParseModule');
        }
        const pdfResult = await extractPdfText(buffer, options.pdfParseModule);
        text = pdfResult.text;
        break;

      case 'word':
        text = await extractWordText(buffer);
        break;

      case 'excel':
        text = extractExcelText(buffer);
        break;

      case 'text':
        text = extractTextContent(buffer);
        break;

      default:
        // 未知类型，尝试作为文本处理
        console.warn(`[FileExtractor] 未知文件类型: ${fileCategory}，尝试作为文本处理`);
        text = extractTextContent(buffer);
    }

    return (text || '').trim();
  } catch (error) {
    console.error(`[FileExtractor] 提取失败 (${fileCategory}):`, error.message);
    throw new Error(`文件内容提取失败: ${error.message}`);
  }
}

/**
 * 固定中文文件名编码问题
 */
export function fixFilename(filename) {
  if (!filename) return filename;
  try {
    const buffer = Buffer.from(filename, 'latin1');
    const decoded = buffer.toString('utf8');
    // 检查是否真的是中文
    if (/[\u4e00-\u9fa5]/.test(decoded)) {
      return decoded;
    }
  } catch (e) {
    // 忽略错误，使用原文件名
  }
  return filename;
}
