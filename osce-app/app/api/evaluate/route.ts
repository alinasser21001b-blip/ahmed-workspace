import { DeterministicAnswerEvaluationProvider } from '@/lib/evaluation';
import { DB, ensureKnowledgeSchema, id } from '@/lib/knowledge/db';
import { logOperationalError } from '@/lib/operations';

type EvaluationRequest = { examSessionId: string; sessionQuestionId: string; studentAnswer: string };

export async function POST(request: Request) {
  try {
    await ensureKnowledgeSchema(); const body: unknown = await request.json();
    if (!isEvaluationRequest(body)) return Response.json({ error: 'INVALID_EVALUATION_REQUEST' }, { status: 400 });
    const question = await DB.prepare(`SELECT q.canonical_text AS question, q.expected_answer AS referenceAnswer, q.key_points_json AS keyPoints, q.answer_approved AS answerApproved FROM exam_sessions s JOIN exam_session_questions sq ON sq.session_id = s.id JOIN published_questions q ON q.id = sq.question_id JOIN examiner_questions eq ON eq.question_id = q.id AND eq.examiner_id = s.examiner_id AND eq.case_id = s.case_id WHERE s.id = ? AND sq.id = ? AND s.status = 'ACTIVE'`).bind(body.examSessionId, body.sessionQuestionId).first<{ question: string; referenceAnswer: string | null; keyPoints: string; answerApproved: number }>();
    if (!question) return Response.json({ error: 'SESSION_QUESTION_INVALID' }, { status: 409 });
    if (!question.answerApproved || !question.referenceAnswer) return Response.json({ error: 'AI_EVALUATION_UNAVAILABLE' }, { status: 409 });
    const keyPoints: unknown = JSON.parse(question.keyPoints);
    if (!Array.isArray(keyPoints) || !keyPoints.every((point) => typeof point === 'string')) return Response.json({ error: 'AI_EVALUATION_UNAVAILABLE' }, { status: 409 });
    const result = await new DeterministicAnswerEvaluationProvider().evaluate({ question: question.question, referenceAnswer: question.referenceAnswer, keyPoints, studentAnswer: body.studentAnswer });
    // INSERT, never INSERT OR REPLACE. With UNIQUE(session_id, session_question_id)
    // an overwrite let a student submit, read the returned score and the covered
    // and missing points, then resubmit an improved answer to the same question -
    // unlimited attempts with full feedback between them, while the results table
    // kept only the last one. A conflict here means the question is already
    // answered, which is a normal client state, not a server fault.
    const inserted = await DB.prepare('INSERT INTO exam_session_answers (id, session_id, session_question_id, student_answer, scoring_mode, correctness, score, covered_points_json, missing_points_json, confidence, created_at) VALUES (?, ?, ?, ?, \'AUTOMATIC\', ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, session_question_id) DO NOTHING').bind(id(), body.examSessionId, body.sessionQuestionId, body.studentAnswer, result.correctness, result.score, JSON.stringify(result.coveredPoints), JSON.stringify(result.missingPoints), result.confidence, new Date().toISOString()).run();
    if (!inserted.meta.changes) return Response.json({ error: 'ALREADY_ANSWERED' }, { status: 409 });
    return Response.json(result);
  } catch (error) { logOperationalError('exam.evaluate', error); return Response.json({ error: 'AI_EVALUATION_UNAVAILABLE' }, { status: 503 }); }
}
function isEvaluationRequest(value: unknown): value is EvaluationRequest { return typeof value === 'object' && value !== null && 'examSessionId' in value && typeof value.examSessionId === 'string' && 'sessionQuestionId' in value && typeof value.sessionQuestionId === 'string' && 'studentAnswer' in value && typeof value.studentAnswer === 'string'; }
