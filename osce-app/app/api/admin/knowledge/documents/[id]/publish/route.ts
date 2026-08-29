import { DB, ensureKnowledgeSchema, id, requireAdmin } from '@/lib/knowledge/db';
import { normalizeQuestion } from '@/lib/knowledge/normalization';
import { fingerprint } from '@/lib/engine/domain/hash';
import { logOperationalError } from '@/lib/operations';

type CandidatePayload = {
  name: string; examiner?: string; caseTitle?: string; category?: string; year?: number; confidence: number;
  answer?: string; keyPoints?: string[]; explanation?: string;
  answerSourceType?: 'HISTORICAL_EXTRACTED'|'CURATED'|'AI_NORMALIZED'|'ANSWER_MISSING';
  answerApproved?: boolean; answerMissing?: boolean;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request); await ensureKnowledgeSchema(); const { id: documentId } = await context.params;
    const document = await DB.prepare('SELECT specialty_id AS specialtyId, status FROM knowledge_documents WHERE id = ?').bind(documentId).first<{ specialtyId: string | null; status: string }>();
    if (!document || document.status === 'FAILED') return Response.json({ error: 'DOCUMENT_NOT_PUBLISHABLE' }, { status: 409 });
    if (!document.specialtyId) return Response.json({ error: 'SPECIALTY_REQUIRED' }, { status: 409 });
    const { results } = await DB.prepare("SELECT id, kind, payload_json AS payloadJson FROM extraction_candidates WHERE document_id = ? AND review_status IN ('APPROVED', 'EDITED') ORDER BY line_start").bind(documentId).all<{ id: string; kind: string; payloadJson: string }>();
    if (!results.length) return Response.json({ error: 'NO_REVIEWED_CANDIDATES' }, { status: 409 });
    const now = new Date().toISOString(); const examinerByName = new Map<string, string>(); const caseByName = new Map<string, string>();
    // Links touched by this publish, recomputed once at the end.
    const touchedCases = new Set<string>(); const touchedQuestions = new Set<string>();
    for (const row of results) {
      const candidate = JSON.parse(row.payloadJson) as CandidatePayload;
      if (row.kind === 'EXAMINER') {
        const existing = await DB.prepare('SELECT id FROM published_examiners WHERE lower(canonical_name) = lower(?) AND specialty_id = ?').bind(candidate.name, document.specialtyId).first<{ id: string }>(); const examinerId = existing?.id ?? id();
        if (!existing) await DB.prepare('INSERT INTO published_examiners (id, canonical_name, specialty_id, aliases_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(examinerId, candidate.name, document.specialtyId, JSON.stringify([candidate.name]), now, now).run(); examinerByName.set(candidate.name, examinerId);
      }
      if (row.kind === 'CASE') {
        const existing = await DB.prepare('SELECT id FROM published_cases WHERE lower(canonical_title) = lower(?) AND specialty_id = ?').bind(candidate.name, document.specialtyId).first<{ id: string }>(); const caseId = existing?.id ?? id();
        if (!existing) await DB.prepare('INSERT INTO published_cases (id, specialty_id, canonical_title, aliases_json, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(caseId, document.specialtyId, candidate.name, JSON.stringify([candidate.name]), '[]', now, now).run(); caseByName.set(candidate.name, caseId);
        const examinerId = candidate.examiner ? examinerByName.get(candidate.examiner) : undefined; if (examinerId) { await DB.prepare('INSERT OR IGNORE INTO examiner_cases (examiner_id, case_id, confidence) VALUES (?, ?, ?)').bind(examinerId, caseId, candidate.confidence).run(); touchedCases.add(`${examinerId}\u0000${caseId}`); }
      }
      if (row.kind === 'QUESTION') {
        const normalized = normalizeQuestion(candidate.name); const existing = await DB.prepare('SELECT id FROM published_questions WHERE normalized_text = ?').bind(normalized).first<{ id: string }>(); const questionId = existing?.id ?? id();
        const keyPoints = candidate.answerMissing ? [] : (candidate.keyPoints ?? []).map((point) => point.trim()).filter(Boolean); const answer = candidate.answerMissing ? null : candidate.answer?.trim() || null; const approved = Boolean(candidate.answerApproved && answer && keyPoints.length);
        if (!existing) await DB.prepare('INSERT INTO published_questions (id, canonical_text, normalized_text, category, expected_answer, key_points_json, answer_source_type, answer_approved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(questionId, candidate.name, normalized, candidate.category ?? 'OTHER', answer, JSON.stringify(keyPoints), candidate.answerMissing ? 'ANSWER_MISSING' : candidate.answerSourceType ?? 'CURATED', approved ? 1 : 0, now, now).run();
        else await DB.prepare('UPDATE published_questions SET canonical_text = ?, category = ?, expected_answer = ?, key_points_json = ?, answer_source_type = ?, answer_approved = ?, updated_at = ? WHERE id = ?').bind(candidate.name, candidate.category ?? 'OTHER', answer, JSON.stringify(keyPoints), candidate.answerMissing ? 'ANSWER_MISSING' : candidate.answerSourceType ?? 'CURATED', approved ? 1 : 0, now, questionId).run();
        await DB.prepare('INSERT OR REPLACE INTO question_answer_curations (question_id, explanation, curator_source_type, updated_at) VALUES (?, ?, ?, ?)').bind(questionId, candidate.explanation?.trim() || null, candidate.answerMissing ? 'ANSWER_MISSING' : candidate.answerSourceType ?? 'CURATED', now).run();
        const examinerId = candidate.examiner ? examinerByName.get(candidate.examiner) : undefined; const caseId = candidate.caseTitle ? caseByName.get(candidate.caseTitle) : undefined; const referenceId = id();
        // The occurrence's natural key: the same evidence, in the same document,
        // for the same examiner/case/question/year is one occurrence however many
        // times it is re-processed. ON CONFLICT DO NOTHING makes a replay a no-op
        // rather than a second row, which is what keeps "asked N times" honest.
        const occurrenceFingerprint = fingerprint('occ:v1', documentId, examinerId ?? null, caseId ?? null, questionId, candidate.year ?? null, row.id);
        await DB.batch([DB.prepare('INSERT INTO source_references (id, document_id, candidate_id, text_excerpt, extraction_confidence) SELECT ?, ?, id, source_excerpt, confidence FROM extraction_candidates WHERE id = ?').bind(referenceId, documentId, row.id), DB.prepare('INSERT INTO question_occurrences (id, document_id, examiner_id, case_id, question_id, observed_text, source_reference_id, year, extraction_confidence, review_status, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(fingerprint) DO NOTHING').bind(id(), documentId, examinerId ?? null, caseId ?? null, questionId, candidate.name, referenceId, candidate.year ?? null, candidate.confidence, 'APPROVED', occurrenceFingerprint)]);
        if (examinerId) { await DB.prepare('INSERT OR IGNORE INTO examiner_questions (examiner_id, question_id, case_id, confidence) VALUES (?, ?, ?, ?)').bind(examinerId, questionId, caseId ?? null, candidate.confidence).run(); touchedQuestions.add(`${examinerId}\u0000${questionId}\u0000${caseId ?? ''}`); }
      }
    }
    // Recompute observation counts from approved occurrences. These columns were
    // previously declared but never written by any code path, so every row held
    // DEFAULT 0 - the historical-frequency signal the station selection score
    // weights at 0.45 was always zero. Recomputed, never incremented: an
    // increment drifts the first time anything is deleted or replayed.
    const recounts = [];
    for (const key of touchedCases) {
      const [examinerId, caseId] = key.split('\u0000');
      recounts.push(DB.prepare("UPDATE examiner_cases SET observation_count = (SELECT COUNT(*) FROM question_occurrences o WHERE o.examiner_id = ? AND o.case_id = ? AND o.review_status = 'APPROVED'), first_observed_year = (SELECT MIN(o.year) FROM question_occurrences o WHERE o.examiner_id = ? AND o.case_id = ? AND o.review_status = 'APPROVED'), last_observed_year = (SELECT MAX(o.year) FROM question_occurrences o WHERE o.examiner_id = ? AND o.case_id = ? AND o.review_status = 'APPROVED') WHERE examiner_id = ? AND case_id = ?").bind(examinerId, caseId, examinerId, caseId, examinerId, caseId, examinerId, caseId));
    }
    for (const key of touchedQuestions) {
      const [examinerId, questionId, rawCaseId] = key.split('\u0000'); const caseId = rawCaseId || null;
      recounts.push(DB.prepare("UPDATE examiner_questions SET observation_count = (SELECT COUNT(*) FROM question_occurrences o WHERE o.examiner_id = ? AND o.question_id = ? AND o.case_id IS ? AND o.review_status = 'APPROVED'), first_observed_year = (SELECT MIN(o.year) FROM question_occurrences o WHERE o.examiner_id = ? AND o.question_id = ? AND o.case_id IS ? AND o.review_status = 'APPROVED'), last_observed_year = (SELECT MAX(o.year) FROM question_occurrences o WHERE o.examiner_id = ? AND o.question_id = ? AND o.case_id IS ? AND o.review_status = 'APPROVED') WHERE examiner_id = ? AND question_id = ? AND case_id IS ?").bind(examinerId, questionId, caseId, examinerId, questionId, caseId, examinerId, questionId, caseId, examinerId, questionId, caseId));
    }
    if (recounts.length) await DB.batch(recounts);

    await DB.prepare("UPDATE extraction_candidates SET review_status = 'PUBLISHED' WHERE document_id = ? AND review_status IN ('APPROVED', 'EDITED')").bind(documentId).run();
    await DB.prepare("UPDATE knowledge_documents SET status = CASE WHEN EXISTS (SELECT 1 FROM extraction_candidates WHERE document_id = ? AND review_status = 'PENDING') THEN 'PARTIALLY_PUBLISHED' ELSE 'PUBLISHED' END, published_at = ? WHERE id = ?").bind(documentId, now, documentId).run();
    return Response.json({ status: 'PUBLISHED', published: results.length });
  } catch (error) { if (error instanceof Response) return error; logOperationalError('knowledge.publish', error); return Response.json({ error: 'PUBLISH_FAILED' }, { status: 500 }); }
}
