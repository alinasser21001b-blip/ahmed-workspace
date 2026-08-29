import { DB, ensureKnowledgeSchema, id } from '@/lib/knowledge/db';
import { logOperationalError } from '@/lib/operations';

type SessionRequest = { specialtyId: string; examinerId: string; caseId: string };

export async function POST(request: Request) {
  try {
    await ensureKnowledgeSchema();
    const body: unknown = await request.json();
    if (!isSessionRequest(body)) return Response.json({ error: 'INVALID_SESSION_REQUEST' }, { status: 400 });
    const validStation = await DB.prepare('SELECT e.id FROM published_examiners e JOIN examiner_cases ec ON ec.examiner_id = e.id JOIN published_cases c ON c.id = ec.case_id WHERE e.id = ? AND e.specialty_id = ? AND c.id = ?').bind(body.examinerId, body.specialtyId, body.caseId).first<{ id: string }>();
    if (!validStation) return Response.json({ error: 'STATION_NOT_PUBLISHED' }, { status: 409 });
    const { results: questions } = await DB.prepare('SELECT q.id AS questionId FROM examiner_questions eq JOIN published_questions q ON q.id = eq.question_id WHERE eq.examiner_id = ? AND eq.case_id = ? ORDER BY q.id').bind(body.examinerId, body.caseId).all<{ questionId: string }>();
    if (!questions.length) return Response.json({ error: 'STATION_NOT_PUBLISHED' }, { status: 409 });
    const sessionId = id(); const createdAt = new Date().toISOString();
    const sessionQuestions = questions.map((question, index) => ({ sessionQuestionId: id(), questionId: question.questionId, order: index + 1 }));
    await DB.batch([DB.prepare('INSERT INTO exam_sessions (id, specialty_id, examiner_id, case_id, status, created_at) VALUES (?, ?, ?, ?, \'ACTIVE\', ?)').bind(sessionId, body.specialtyId, body.examinerId, body.caseId, createdAt), ...sessionQuestions.map((question) => DB.prepare('INSERT INTO exam_session_questions (id, session_id, question_id, question_order) VALUES (?, ?, ?, ?)').bind(question.sessionQuestionId, sessionId, question.questionId, question.order))]);
    return Response.json({ examSessionId: sessionId, questions: sessionQuestions }, { status: 201 });
  } catch (error) { logOperationalError('exam.session.create', error); return Response.json({ error: 'SESSION_CREATION_UNAVAILABLE' }, { status: 503 }); }
}
function isSessionRequest(value: unknown): value is SessionRequest { return typeof value === 'object' && value !== null && 'specialtyId' in value && typeof value.specialtyId === 'string' && 'examinerId' in value && typeof value.examinerId === 'string' && 'caseId' in value && typeof value.caseId === 'string'; }
