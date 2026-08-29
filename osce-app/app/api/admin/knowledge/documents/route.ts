import { DeterministicExtractionProvider, extractText } from '@/lib/knowledge/extractor';
import { DB, documents, ensureKnowledgeSchema, id, requireAdmin } from '@/lib/knowledge/db';
import { logOperationalError } from '@/lib/operations';

const allowed = new Set(['txt', 'md', 'markdown', 'docx', 'pdf']);
const maxBytes = 25 * 1024 * 1024;

export async function GET(request: Request) {
  try { requireAdmin(request); await ensureKnowledgeSchema(); const { results } = await DB.prepare('SELECT id, original_filename AS originalFilename, specialty_id AS specialtyId, source_year AS sourceYear, uploaded_at AS uploadedAt, status, processing_error AS processingError FROM knowledge_documents ORDER BY uploaded_at DESC').all(); return Response.json(results); } catch (error) { if (error instanceof Response) return error; logOperationalError('knowledge.list', error); return Response.json({ error: 'KNOWLEDGE_LIST_FAILED' }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request); await ensureKnowledgeSchema(); const contentLength = Number(request.headers.get('content-length')); if (Number.isFinite(contentLength) && contentLength > maxBytes + 1024 * 1024) return Response.json({ error: 'FILE_SIZE_INVALID' }, { status: 413 }); const form = await request.formData(); const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'FILE_REQUIRED' }, { status: 400 });
    const extension = file.name.toLowerCase().split('.').pop() ?? '';
    if (!allowed.has(extension)) return Response.json({ error: 'UNSUPPORTED_FILE_TYPE' }, { status: 400 });
    if (!file.size || file.size > maxBytes) return Response.json({ error: 'FILE_SIZE_INVALID' }, { status: 400 });
    const documentId = id(); const runId = id(); const now = new Date().toISOString(); const storedFilename = `knowledge/${documentId}/${documentId}.${extension}`;
    const stored = await documents.put(storedFilename, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' }, customMetadata: { originalFilename: file.name, documentId } });
    if (!stored) throw new Error('UPLOAD_FAILED');
    await DB.prepare('INSERT INTO knowledge_documents (id, original_filename, stored_filename, mime_type, file_size, uploaded_at, status, extraction_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(documentId, file.name, storedFilename, file.type || 'application/octet-stream', file.size, now, 'EXTRACTING_TEXT', 'deterministic-v1').run();
    try {
      const rawText = await extractText(file); const extraction = await new DeterministicExtractionProvider().extract({ text: rawText, filename: file.name }); const status = extraction.candidates.some((candidate) => candidate.confidence < .9) ? 'REVIEW_REQUIRED' : 'READY_TO_PUBLISH';
      const statements = [DB.prepare('INSERT INTO extraction_runs (id, document_id, status, extractor_version, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)').bind(runId, documentId, 'COMPLETED', 'deterministic-v1', now, new Date().toISOString()), DB.prepare('UPDATE knowledge_documents SET raw_text = ?, specialty_id = ?, source_year = ?, status = ?, processed_at = ? WHERE id = ?').bind(rawText, extraction.specialtyId ?? null, extraction.candidates.find((candidate) => candidate.year)?.year ?? null, status, new Date().toISOString(), documentId)];
      extraction.candidates.forEach((candidate) => statements.push(DB.prepare('INSERT INTO extraction_candidates (id, document_id, run_id, kind, payload_json, source_excerpt, line_start, line_end, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id(), documentId, runId, candidate.kind, JSON.stringify(candidate), candidate.excerpt, candidate.lineStart, candidate.lineEnd, candidate.confidence, now)));
      await DB.batch(statements); return Response.json({ id: documentId, status, extracted: extraction.candidates.length, warnings: extraction.warnings });
    } catch (error) { const message = error instanceof Error ? error.message : 'TEXT_EXTRACTION_FAILED'; if (message !== 'OCR_REQUIRED') logOperationalError('knowledge.extract', error, { documentId }); await DB.prepare('UPDATE knowledge_documents SET status = ?, processing_error = ? WHERE id = ?').bind('FAILED', message, documentId).run(); return Response.json({ id: documentId, status: 'FAILED', error: message }, { status: 422 }); }
  } catch (error) { if (error instanceof Response) return error; logOperationalError('knowledge.upload', error); return Response.json({ error: 'KNOWLEDGE_UPLOAD_FAILED' }, { status: 500 }); }
}
