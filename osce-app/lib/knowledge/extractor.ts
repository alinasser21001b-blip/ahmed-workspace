import { unzipSync } from 'fflate';
import { extractionSchema, type ExtractionResult, type KnowledgeExtractionProvider } from './domain';
import { resolveSpecialty, normalizeText } from './normalization';

export async function extractText(file: File): Promise<string> {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'txt' || extension === 'md' || extension === 'markdown') return (await file.text()).normalize('NFKC').replace(/\r\n?/g, '\n').split('\n').map(normalizeText).filter(Boolean).join('\n');
  if (extension === 'docx') { const xml = new TextDecoder().decode(unzipSync(new Uint8Array(await file.arrayBuffer()))['word/document.xml']); const text = xml.replace(/<w:tab[^>]*\/>/g, ' ').replace(/<w:p[^>]*>/g, '\n').replace(/<[^>]+>/g, ' '); return text.split('\n').map(normalizeText).filter(Boolean).join('\n'); }
  if (extension === 'pdf') {
    try {
      installDomMatrixPolyfill();
      const { WorkerMessageHandler } = await import('pdfjs-dist/build/pdf.worker.mjs');
      (globalThis as unknown as { pdfjsWorker: { WorkerMessageHandler: typeof WorkerMessageHandler } }).pdfjsWorker = { WorkerMessageHandler };
      const { getDocument } = await import('pdfjs-dist/build/pdf.mjs');
      const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWorkerFetch: false }).promise;
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) { const page = await pdf.getPage(pageNumber); const content = await page.getTextContent(); const pageText = content.items.map((item) => 'str' in item ? item.str : '').join(' ').trim(); if (pageText) pages.push(`[Page ${pageNumber}]\n${pageText}`); }
      if (!pages.length) throw new Error('OCR_REQUIRED'); return pages.join('\n');
    } catch (error) { if (error instanceof Error && error.message === 'OCR_REQUIRED') throw error; throw new Error('TEXT_EXTRACTION_FAILED'); }
  }
  throw new Error('UNSUPPORTED_FILE_TYPE');
}

// pdfjs reads DOMMatrix while its module is evaluated. Workers do not provide
// the browser canvas implementation, but text extraction only needs affine transforms.
function installDomMatrixPolyfill() {
  if ('DOMMatrix' in globalThis) return;
  class WorkerDOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(values?: number[] | Float32Array | Float64Array) { if (values) [this.a, this.b, this.c, this.d, this.e, this.f] = values; }
    multiplySelf(other: WorkerDOMMatrix) { const { a, b, c, d, e, f } = this; this.a = a * other.a + c * other.b; this.b = b * other.a + d * other.b; this.c = a * other.c + c * other.d; this.d = b * other.c + d * other.d; this.e = a * other.e + c * other.f + e; this.f = b * other.e + d * other.f + f; return this; }
    preMultiplySelf(other: WorkerDOMMatrix) { return new WorkerDOMMatrix([other.a, other.b, other.c, other.d, other.e, other.f]).multiplySelf(this).copyTo(this); }
    translate(x = 0, y = 0) { return new WorkerDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(new WorkerDOMMatrix([1, 0, 0, 1, x, y])); }
    scale(x = 1, y = x) { return new WorkerDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(new WorkerDOMMatrix([x, 0, 0, y, 0, 0])); }
    invertSelf() { const determinant = this.a * this.d - this.b * this.c; if (!determinant) throw new Error('MATRIX_NOT_INVERTIBLE'); const { a, b, c, d, e, f } = this; this.a = d / determinant; this.b = -b / determinant; this.c = -c / determinant; this.d = a / determinant; this.e = (c * f - d * e) / determinant; this.f = (b * e - a * f) / determinant; return this; }
    private copyTo(target: WorkerDOMMatrix) { target.a = this.a; target.b = this.b; target.c = this.c; target.d = this.d; target.e = this.e; target.f = this.f; return target; }
  }
  (globalThis as unknown as { DOMMatrix: typeof WorkerDOMMatrix }).DOMMatrix = WorkerDOMMatrix;
}

export class DeterministicExtractionProvider implements KnowledgeExtractionProvider {
  async extract({ text }: { text: string; filename: string }): Promise<ExtractionResult> {
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean); const candidates: ExtractionResult['candidates'] = []; let specialty = resolveSpecialty(text); let examiner: string | undefined; let caseTitle: string | undefined; let year: number | undefined; let page: number | undefined;
    lines.forEach((line, index) => {
      const lineNo = index + 1; const pageMarker = line.match(/^\[Page (\d+)\]$/); if (pageMarker) { page = Number(pageMarker[1]); return; } const foundYear = line.match(/\b(20\d{2})\b/); if (foundYear) year = Number(foundYear[1]); specialty ??= resolveSpecialty(line);
      const examinerMatch = line.match(/^(?:dr\.?|د\.?|دكتور)\s*([\p{L}][\p{L}\s.'-]{1,80})/iu);
      if (examinerMatch) { examiner = `Dr. ${normalizeText(examinerMatch[1])}`; candidates.push({ kind: 'EXAMINER', name: examiner, category: 'OTHER', confidence: .94, lineStart: lineNo, lineEnd: lineNo, page, excerpt: line }); return; }
      const caseMatch = line.match(/^(?:case|حالة)\s*[:\-]?\s*(.+)$/iu);
      if (caseMatch) { caseTitle = normalizeText(caseMatch[1]); candidates.push({ kind: 'CASE', name: caseTitle, examiner, caseTitle, year, category: 'OTHER', confidence: examiner ? .92 : .76, lineStart: lineNo, lineEnd: lineNo, page, excerpt: line }); return; }
      if (/^(?:[-•*]|\d+[.)])\s+/.test(line) || /\?$/.test(line)) { const question = line.replace(/^(?:[-•*]|\d+[.)])\s+/, ''); candidates.push({ kind: 'QUESTION', name: question, examiner, caseTitle, year, page, category: /complication/i.test(question) ? 'COMPLICATIONS' : /investigation|order/i.test(question) ? 'INVESTIGATION' : /admit|severity/i.test(question) ? 'EMERGENCY' : 'OTHER', confidence: examiner && caseTitle ? .91 : .68, lineStart: lineNo, lineEnd: lineNo, excerpt: line }); }
    });
    return extractionSchema.parse({ specialtyId: specialty, candidates, warnings: candidates.length ? [] : ['NO_MEANINGFUL_CONTENT'] });
  }
}
