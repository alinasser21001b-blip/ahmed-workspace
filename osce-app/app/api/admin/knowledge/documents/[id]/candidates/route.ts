import { DB, ensureKnowledgeSchema, requireAdmin } from '@/lib/knowledge/db';
import { logOperationalError } from '@/lib/operations';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { requireAdmin(request); await ensureKnowledgeSchema(); const { id } = await context.params; const { results } = await DB.prepare('SELECT id, kind, payload_json AS payloadJson, source_excerpt AS sourceExcerpt, line_start AS lineStart, line_end AS lineEnd, confidence, review_status AS reviewStatus FROM extraction_candidates WHERE document_id = ? ORDER BY line_start').bind(id).all(); return Response.json(results); } catch (error) { if (error instanceof Response) return error; logOperationalError('knowledge.candidates.list', error); return Response.json({ error: 'CANDIDATES_UNAVAILABLE' }, { status: 500 }); } }
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request); await ensureKnowledgeSchema(); const { id: documentId } = await context.params; const body: unknown = await request.json();
    if (typeof body !== 'object' || !body || !('candidateId' in body) || typeof body.candidateId !== 'string' || !('action' in body) || !['APPROVED','EDITED','REJECTED','MERGED'].includes(String(body.action))) return Response.json({ error: 'INVALID_REVIEW_ACTION' }, { status: 400 });
    const status = String(body.action); const payloadValue = 'payload' in body && typeof body.payload === 'object' && body.payload ? body.payload as Record<string, unknown> : undefined;
    if (payloadValue && (typeof payloadValue.name !== 'string' || !payloadValue.name.trim())) return Response.json({ error: 'CANONICAL_WORDING_REQUIRED' }, { status: 400 });
    if (payloadValue?.keyPoints !== undefined && (!Array.isArray(payloadValue.keyPoints) || !payloadValue.keyPoints.every((point) => typeof point === 'string'))) return Response.json({ error: 'INVALID_KEY_POINTS' }, { status: 400 });
    if (status === 'MERGED') { const target = payloadValue?.mergeTargetId; if (typeof target !== 'string') return Response.json({ error: 'MERGE_TARGET_REQUIRED' }, { status: 400 }); const published = await DB.prepare('SELECT id FROM published_questions WHERE id = ?').bind(target).first(); if (!published) return Response.json({ error: 'MERGE_TARGET_INVALID' }, { status: 409 }); }
    const payload = payloadValue ? JSON.stringify(payloadValue) : undefined;
    await DB.prepare(payload ? 'UPDATE extraction_candidates SET review_status = ?, payload_json = ? WHERE id = ? AND document_id = ?' : 'UPDATE extraction_candidates SET review_status = ? WHERE id = ? AND document_id = ?').bind(...(payload ? [status, payload, body.candidateId, documentId] : [status, body.candidateId, documentId])).run();
    await DB.prepare("UPDATE knowledge_documents SET status = 'PENDING_REVIEW' WHERE id = ? AND status != 'PUBLISHED'").bind(documentId).run(); return Response.json({ status });
  } catch (error) { if (error instanceof Response) return error; logOperationalError('knowledge.candidates.update', error); return Response.json({ error: 'REVIEW_UPDATE_FAILED' }, { status: 500 }); }
}
