export interface ParsedDocument {
  text: string;
  fileType: string;
  warnings: string[];
}

export function extensionOf(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? (parts[parts.length - 1] as string) : '';
}

export function fileTypeFromName(filename: string): string {
  const ext = extensionOf(filename);
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'txt') return 'txt';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'doc') return 'doc';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  return ext || 'unknown';
}

export async function parseDocument(
  buffer: Buffer,
  filename: string,
  mimeType?: string,
): Promise<ParsedDocument> {
  const fileType = fileTypeFromName(filename);
  const warnings: string[] = [];

  if (fileType === 'txt' || fileType === 'markdown' || fileType === 'unknown') {
    return { text: buffer.toString('utf8'), fileType: fileType === 'unknown' ? 'txt' : fileType, warnings };
  }

  if (fileType === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value, fileType, warnings: result.messages.map((m) => m.message) };
  }

  if (fileType === 'pdf') {
    warnings.push('PDF text extraction is best-effort in this version. Prefer TXT, Markdown, or DOCX for daily uploads.');
    const asText = buffer.toString('utf8');
    const extracted = asText.replace(/[^\t\n\r\x20-\x7E\u0600-\u06FF\u00A0-\u024F]/g, ' ');
    const compact = extracted.replace(/\s+/g, ' ').trim();
    if (compact.length > 80 && /[A-Za-z\u0600-\u06FF]/.test(compact)) {
      return { text: extracted, fileType, warnings };
    }
    return {
      text: '',
      fileType,
      warnings: [
        ...warnings,
        'Could not extract text from this PDF. Convert to .txt or .docx, or add OCR later.',
      ],
    };
  }

  if (fileType === 'image') {
    return {
      text: '',
      fileType,
      warnings: ['Image OCR is not enabled yet. Architecture allows an OCR adapter later.'],
    };
  }

  if (mimeType?.startsWith('text/')) {
    return { text: buffer.toString('utf8'), fileType: 'txt', warnings };
  }

  return { text: buffer.toString('utf8'), fileType, warnings: ['Unknown type; treated as UTF-8 text.'] };
}
