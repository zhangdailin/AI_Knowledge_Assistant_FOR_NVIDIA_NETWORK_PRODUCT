import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import mammoth from 'mammoth';

export async function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return await file.arrayBuffer();
}

async function ensurePDFJS() {
  // 这里直接返回 pdfjsLib 实例，不再尝试修改其导出的属性（如 disableWorker），
  // 以避免打包器将其视为对 ES Module import 的赋值操作而报错。
  return pdfjsLib as any;
}

export async function parsePDFToText(file: File, maxPages = 20): Promise<string> {
  try {
    const pdfjsLib = await ensurePDFJS();
    try {
      const workerSources = [
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.js',
        'https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js'
      ];
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerSources[0];
    } catch {}

    const buffer = await readAsArrayBuffer(file);
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const total = Math.min(doc.numPages, maxPages);
    const texts: string[] = [];
    for (let p = 1; p <= total; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      const items = content.items as any[];
      const lines: Record<string, string[]> = {};
      items.forEach((it: any) => {
        const y = Math.round((it.transform?.[5] || 0) / 2) * 2;
        const key = String(y);
        if (!lines[key]) lines[key] = [];
        lines[key].push(it.str);
      });
      const joined = Object.keys(lines)
        .sort((a, b) => Number(a) - Number(b))
        .map(k => lines[k].join(' '))
        .join('\n');
      texts.push(joined);
    }
    return texts.join('\n\n');
  } catch {
    const buffer = await readAsArrayBuffer(file);
    const joined = extractOperatorsText(buffer);
    return joined || `PDF文件: ${file.name}`;
  }
}

function extractOperatorsText(buffer: ArrayBuffer): string {
  try {
    const textDecoder = new TextDecoder('latin1');
    const raw = textDecoder.decode(new Uint8Array(buffer));
    const btEtBlocks = raw.match(/BT[\s\S]*?ET/g) || [];
    const pieces: string[] = [];
    btEtBlocks.forEach(block => {
      const matches = block.match(/\((?:\\\(|\\\)|\\n|\\r|\\t|[^\)])*\)\s*T[Jj]/g) || [];
      matches.forEach(m => {
        const inner = m.replace(/^[^\(]*\(/, '').replace(/\)[^\)]*$/, '');
        const cleaned = inner
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\n')
          .replace(/\\t/g, ' ')
          .replace(/\\\)/g, ')')
          .replace(/\\\(/g, '(');
        pieces.push(cleaned);
      });
    });
    return pieces.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

export async function parsePDFToTextAdvanced(
  file: File,
  opts: { maxPages?: number; normalizeWhitespace?: boolean; disableCombineTextItems?: boolean; groupByPosition?: boolean } = {}
): Promise<string> {
  const maxPages = opts.maxPages ?? 20;
  try {
    const pdfjsLib = await ensurePDFJS();
    const buffer = await readAsArrayBuffer(file);
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const total = (opts.maxPages && opts.maxPages > 0) ? Math.min(doc.numPages, maxPages) : doc.numPages;
    const texts: string[] = [];
    for (let p = 1; p <= total; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent({
        normalizeWhitespace: opts.normalizeWhitespace ?? true,
        disableCombineTextItems: opts.disableCombineTextItems ?? false
      });
      const items = content.items as any[];
      if (opts.groupByPosition) {
        const lines: Record<string, string[]> = {};
        items.forEach((it: any) => {
          const y = Math.round((it.transform?.[5] || 0) / 2) * 2;
          const key = String(y);
          if (!lines[key]) lines[key] = [];
          lines[key].push(it.str);
        });
        const joined = Object.keys(lines)
          .sort((a, b) => Number(a) - Number(b))
          .map(k => lines[k].join(' '))
          .join('\n');
        texts.push(joined);
      } else {
        const str = items.map(it => it.str).join(' ');
        texts.push(str);
      }
    }
    return texts.join('\n\n');
  } catch {
    return parsePDFToText(file, maxPages);
  }
}

export async function parsePDFToTextSelective(
  file: File,
  opts: { maxPages?: number; charLimit?: number; groupByPosition?: boolean } = {}
): Promise<string> {
  const maxPages = opts.maxPages ?? 200;
  const charLimit = opts.charLimit ?? 20000;
  try {
    const pdfjsLib = await ensurePDFJS();
    const buffer = await readAsArrayBuffer(file);
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const total = (opts.maxPages && opts.maxPages > 0) ? Math.min(doc.numPages, maxPages) : doc.numPages;
    const parts: string[] = [];
    let acc = 0;
    for (let p = 1; p <= total; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      const items = content.items as any[];
      if (!items || items.length === 0) continue;
      let text = '';
      if (opts.groupByPosition) {
        const lines: Record<string, string[]> = {};
        items.forEach((it: any) => {
          const y = Math.round((it.transform?.[5] || 0) / 2) * 2;
          const key = String(y);
          if (!lines[key]) lines[key] = [];
          lines[key].push(it.str);
        });
        text = Object.keys(lines)
          .sort((a, b) => Number(a) - Number(b))
          .map(k => lines[k].join(' '))
          .join('\n');
      } else {
        text = items.map(it => it.str).join(' ');
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (text.length === 0) continue;
      parts.push(text);
      acc += text.length;
      if (acc >= charLimit) break;
    }
    const joined = parts.join('\n\n');
    return joined || `PDF文件: ${file.name}`;
  } catch {
    const buffer = await readAsArrayBuffer(file);
    const joined = extractOperatorsText(buffer);
    return joined || `PDF文件: ${file.name}`;
  }
}

export async function diagnosePDFTextExtraction(
  file: File,
  opts: { inspectPages?: number; groupByPosition?: boolean } = {}
): Promise<string> {
  try {
    const pdfjsLib = await ensurePDFJS();
    const buffer = await readAsArrayBuffer(file);
    const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
    const inspectTotal = Math.min(doc.numPages, opts.inspectPages ?? 30);
    let checked = 0;
    let noItems = 0;
    let totalItems = 0;
    let totalChars = 0;
    for (let p = 1; p <= inspectTotal; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      const items = content.items as any[];
      checked++;
      if (!items || items.length === 0) {
        noItems++;
        continue;
      }
      totalItems += items.length;
      items.forEach(it => {
        const s = String(it.str || '');
        totalChars += s.length;
      });
    }
    if (checked === 0) return 'PDF加载失败或被浏览器策略阻止';
    const ratioNoItems = noItems / checked;
    if (ratioNoItems >= 0.8) {
      return `文档页面主要为图像/扫描，未包含可提取文本（检测页数 ${checked}，无文本页 ${noItems}）`;
    }
    if (totalItems > 0 && totalChars < 100) {
      return `文档文本编码或字体映射不可识别，无法还原为可读文本（检测页数 ${checked}，文本项 ${totalItems}）`;
    }
    return `解析异常或文本稀疏，建议转换为TXT/MD（检测页数 ${checked}，无文本页 ${noItems}）`;
  } catch {
    try {
      const via = await extractViaServer(file);
      if (via && via.length > 100) {
        return '浏览器解析失败，但服务端已成功提取文本';
      }
      return '文档可能为扫描件或受保护编码，无法直接提取文本（未启用OCR）';
    } catch {
      return 'PDF加载失败或跨域/Worker限制导致无法解析';
    }
  }
}

export async function parseDocxToText(file: File): Promise<string> {
  const buffer = await readAsArrayBuffer(file);
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  const html = result.value as string;
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li\s*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ') // 去除HTML标签
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

export async function extractViaServer(file: File): Promise<string | null> {
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('http://localhost:8787/api/extract', { method: 'POST', body: form });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.ok && typeof data.text === 'string') {
      return data.text as string;
    }
    return null;
  } catch {
    return null;
  }
}

export async function extractViaCloudOCR(file: File): Promise<string | null> {
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('http://localhost:8787/api/ocr', { method: 'POST', body: form });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.ok && typeof data.text === 'string') {
      return data.text as string;
    }
    return null;
  } catch {
    return null;
  }
}

