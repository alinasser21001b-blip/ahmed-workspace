import { getStore, knowledgeView } from '@/data/store';
import { recordAnswer } from '@/domain/exam/session';
import { HeuristicEvaluationService, mergeEvaluation, questionToEvaluationInput } from '@/domain/evaluation/service';
import { errorResponse, json } from '@/lib/http';
import { presentSession } from '@/lib/present-session';
import { submitAnswerSchema } from '@/lib/schemas';
import { nowIso } from '@/lib/ids';
import type { StudentAnswer } from '@/domain/models';

const evaluator = new HeuristicEvaluationService();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = submitAnswerSchema.parse(await request.json());
    const storeRepo = getStore();
    const store = await storeRepo.read();
    const current = store.sessions.find((row) => row.id === id);
    if (!current) return json({ error: 'Exam not found', code: 'EXAM_NOT_FOUND' }, 404);

    const question = store.questions.find((row) => row.id === body.questionId);
    if (!question) return json({ error: 'Question not found', code: 'QUESTION_NOT_FOUND' }, 404);

    const automatic = evaluator.evaluate(questionToEvaluationInput(question, body.studentAnswer));
    const merged = mergeEvaluation(automatic, body.correctness);

    const answer: StudentAnswer = {
      questionId: body.questionId,
      studentAnswer: body.studentAnswer,
      revealedAt: nowIso(),
      answeredAt: nowIso(),
      correctness: merged.correctness,
      score: merged.score,
      evaluation: merged,
      selfEvaluated: Boolean(body.correctness),
    };

    const next = recordAnswer(current, answer, knowledgeView(store));
    await storeRepo.write((s) => {
      const idx = s.sessions.findIndex((row) => row.id === id);
      if (idx >= 0) s.sessions[idx] = next;
    });
    return json({ session: await presentSession(next, { revealAnswers: false }), evaluation: merged });
  } catch (error) {
    return errorResponse(error);
  }
}
