import { getStore } from '@/data/store';
import { advanceQuestion, completeExam, isLastQuestion } from '@/domain/exam/session';
import { knowledgeView } from '@/data/store';
import { errorResponse, json } from '@/lib/http';
import { presentSession } from '@/lib/present-session';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const storeRepo = getStore();
    const store = await storeRepo.read();
    const current = store.sessions.find((row) => row.id === id);
    if (!current) return json({ error: 'Exam not found', code: 'EXAM_NOT_FOUND' }, 404);

    if (isLastQuestion(current)) {
      const completed = completeExam(current, knowledgeView(store));
      await storeRepo.write((s) => {
        const idx = s.sessions.findIndex((row) => row.id === id);
        if (idx >= 0) s.sessions[idx] = completed;
      });
      return json({ session: await presentSession(completed, { revealAnswers: true }) });
    }

    const next = advanceQuestion(current);
    await storeRepo.write((s) => {
      const idx = s.sessions.findIndex((row) => row.id === id);
      if (idx >= 0) s.sessions[idx] = next;
    });
    return json({ session: await presentSession(next) });
  } catch (error) {
    return errorResponse(error);
  }
}
