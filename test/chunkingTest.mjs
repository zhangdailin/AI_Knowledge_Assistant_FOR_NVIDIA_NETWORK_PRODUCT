/**
 * Knowledge base chunking tests.
 * Covers headings, code block preservation, long paragraph splitting, table conversion, and metadata.
 */

import { createRequire } from 'node:module'
import mammoth from 'mammoth'
import { enhancedParentChildChunking } from '../server/chunking.mjs'

const require = createRequire(import.meta.url)
const pdfParseModule = require('pdf-parse')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (actual: ${actual}, expected: ${expected})`)
  }
}

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
    return true
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(`  ${error.message}`)
    return false
  }
}

function escapePdfString(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function buildSimplePdf(text) {
  const safeText = escapePdfString(text)
  const contentStream = `BT\n/F1 12 Tf\n72 720 Td\n(${safeText}) Tj\nET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]

  for (const obj of objects) {
    offsets.push(pdf.length)
    pdf += obj
  }

  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i <= objects.length; i += 1) {
    const offset = String(offsets[i]).padStart(10, '0')
    pdf += `${offset} 00000 n \n`
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'utf-8')
}

async function extractPdfText(buffer) {
  const PdfParseClass = pdfParseModule?.PDFParse || pdfParseModule?.default?.PDFParse || pdfParseModule

  if (PdfParseClass && typeof PdfParseClass === 'function') {
    const parser = new PdfParseClass({ data: buffer })
    if (typeof parser.getText === 'function') {
      const result = await parser.getText({})
      if (typeof parser.destroy === 'function') {
        await parser.destroy()
      }
      return (result?.text || '').trim()
    }
  }

  if (typeof pdfParseModule === 'function') {
    const result = await pdfParseModule(buffer)
    return (result?.text || '').trim()
  }

  throw new Error('pdf-parse is not available')
}

const results = []

results.push(await runTest('Splits by heading and keeps breadcrumbs', () => {
  const doc = `# Root\n\nRoot intro with enough detail to exceed the minimum length for chunking.\n\n## Child A\n\nContent A provides additional sentences so it is long enough for chunk creation.\n\n### Child A1\n\nContent A1 also includes more descriptive text to pass the length threshold.\n\n## Child B\n\nContent B contains extra explanation to make sure this section becomes a chunk.`
  const chunks = enhancedParentChildChunking(doc, 4000)
  assert(chunks.length >= 3, 'expected multiple chunks')

  const hasChildA = chunks.some(chunk => chunk.metadata?.breadcrumbs?.join(' > ') === 'Root > Child A')
  const hasChildA1 = chunks.some(chunk => chunk.metadata?.breadcrumbs?.join(' > ') === 'Root > Child A > Child A1')
  const hasChildB = chunks.some(chunk => chunk.metadata?.breadcrumbs?.join(' > ') === 'Root > Child B')
  assert(hasChildA && hasChildA1 && hasChildB, 'expected full breadcrumb hierarchy')
}))

results.push(await runTest('Preserves code blocks without splitting', () => {
  const code = '```bash\n' + 'echo line\n'.repeat(200) + '```'
  const doc = `# Code Block\n\nIntro.\n\n${code}\n\nAfter.`
  const chunks = enhancedParentChildChunking(doc, 500)

  const codeChunks = chunks.filter(chunk => chunk.content.includes('```'))
  assert(codeChunks.length >= 1, 'expected a chunk with the code block')
  const codeChunk = codeChunks[0]
  const fenceCount = (codeChunk.content.match(/```/g) || []).length
  assertEqual(fenceCount % 2, 0, 'expected complete code fences')
  assert(codeChunk.content.includes('echo line'), 'expected code content to be preserved')
}))

results.push(await runTest('Splits long paragraphs and respects size limit', () => {
  const sentence = 'This is a test sentence. '
  const paragraph = sentence.repeat(200)
  const doc = `# Long Paragraph\n\n${paragraph}`
  const maxSize = 120
  const chunks = enhancedParentChildChunking(doc, maxSize)

  assert(chunks.length > 1, 'expected long paragraph to be split')
  const breadcrumbs = chunks[0]?.metadata?.breadcrumbs || []
  const prefix = breadcrumbs.length > 0 ? `[${breadcrumbs.join(' > ')}]\n\n` : ''
  const limitWithPrefix = maxSize + prefix.length
  const tooLarge = chunks.filter(chunk => chunk.content.length > limitWithPrefix)
  assert(tooLarge.length === 0, 'expected all chunks to respect max size + prefix')
}))

results.push(await runTest('Converts HTML tables to Markdown', () => {
  const doc = `# Table\n\nThis section includes an HTML table and extra text so it is long enough for chunking.\n\n<table>\n<tr><th>A</th><th>B</th></tr>\n<tr><td>1</td><td>2</td></tr>\n</table>\n\nAdditional notes ensure the section passes the minimum length threshold.`
  const chunks = enhancedParentChildChunking(doc, 4000)

  const hasHtml = chunks.some(chunk => /<table|<tr|<td/i.test(chunk.content))
  assert(!hasHtml, 'expected HTML table tags to be removed')

  const hasSemanticTable = chunks.some(chunk =>
    chunk.content.includes('[表格开始]') || chunk.content.includes('[表格内容]')
  )
  assert(hasSemanticTable, 'expected semantic table markers')
}))

results.push(await runTest('Summary includes keyword hints', () => {
  const doc = `# BGP Guide\n\nBGP is a routing protocol.\n\nUse nv show bgp summary to check status.`
  const chunks = enhancedParentChildChunking(doc, 4000)

  const summary = chunks[0]?.metadata?.summary || ''
  assert(summary.length > 0, 'expected a summary')
  assert(/BGP/i.test(summary), 'expected summary to include keyword hints')
}))

results.push(await runTest('Extracts PDF text and chunks it', async () => {
  const sourceText = 'PDF text extraction should return this sentence.'
  const pdfBuffer = buildSimplePdf(sourceText)
  const extracted = await extractPdfText(pdfBuffer)

  assert(extracted.includes('PDF text extraction'), 'expected PDF text extraction to succeed')
  const chunks = enhancedParentChildChunking(`# PDF Doc\n\n${extracted}`, 4000)
  assert(chunks.length > 0, 'expected chunks from extracted PDF text')
}))

results.push(await runTest('Extracts DOCX text and chunks it', async () => {
  const docxBase64 = 'UEsDBBQAAAAIAEqtnVuF+Ddc5QAAAKcBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2Qy07DMBBF9/0Ky1sUO7BACCXpgscSWJQPGNmTxMIvedxS/p5JC0VClKV1H8dzu/U+eLHDQi7FXl6qVgqMJlkXp16+bh6bG7keVt3mIyMJ9kbq5VxrvtWazIwBSKWMkZUxlQCVn2XSGcwbTKiv2vZamxQrxtrUpUMOKyG6exxh66t42LNyRBf0JMXd0bvgegk5e2egsq530f4CNV8QxcmDh2aX6YINUp+DLOJ5xk/0mRcpzqJ4gVKfILBRv6ditU1mGzis/m/647dpHJ3BU35pyyUZJOKpg1cnJYCL31d0+jD88AlQSwMEFAAAAAgASq2dWzzDyG+oAAAAHQEAAAsAAABfcmVscy8ucmVsc42POw7CMBBE+5zC2p5sQoEQwkmDkNKicADL3jgR8Ue2+d0eFxQEUVDu7Mwbzb59mJndKMTJWQ51WQEjK52arOZw7o+rLbRNsT/RLFK2xHHykeWMjRzGlPwOMcqRjIil82TzZ3DBiJTPoNELeRGacF1VGwyfDGgKxhZY1ikOoVM1sP7p6R+8G4ZJ0sHJqyGbfrR8OTJZBE2Jw90FheotlxkLmFfiYmbzAlBLAwQUAAAACABKrZ1bG+OuxbsAAAANAQAAEQAAAHdvcmQvZG9jdW1lbnQueG1sPY+7bsMwDEX3fAWhvZbTISgMP4YUXbukQFdXYmIDlmiQdJ3+fSUHznYuiPtg3d3DBL/IMlJszLEoDWB05Md4a8zX5ePlzXTtoV4rT24JGBWSIUq1NmZQnStrxQ0YeiloxphuV+LQa5J8syuxn5kciqS8MNnXsjzZ0I/RtAeAlPpD/i/jJuYHbcw7b0rb98/zN+BduXeapoIMtEweGHXhCDqMApLWpe1Y1DY79iz7DMu4dWR4NGfaP2v/AVBLAQIUAxQAAAAIAEqtnVuF+Ddc5QAAAKcBAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgASq2dWzzDyG+oAAAAHQEAAAsAAAAAAAAAAAAAAIABFgEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgASq2dWxvjrsW7AAAADQEAABEAAAAAAAAAAAAAAIAB5wEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAANECAAAAAA=='
  const docxBuffer = Buffer.from(docxBase64, 'base64')
  const result = await mammoth.extractRawText({ buffer: docxBuffer })
  const extracted = (result.value || '').trim()

  assert(extracted.includes('DOCX extraction'), 'expected DOCX text extraction to succeed')
  const chunks = enhancedParentChildChunking(`# DOCX Doc\n\n${extracted}`, 4000)
  assert(chunks.length > 0, 'expected chunks from extracted DOCX text')
}))

const passed = results.every(Boolean)
console.log(`\nOverall result: ${passed ? 'all passed' : 'failures detected'}`)
process.exit(passed ? 0 : 1)
