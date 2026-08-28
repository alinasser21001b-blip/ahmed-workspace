import { getStore } from '@/data/store';
import { maybeAdvanceTimer } from '@/domain/exam/session';
import { errorResponse, json } from '@/lib/http';
import { presentSession } from '@/lib/present-session';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const storeRepo = getStore();
    let session = (await storeRepo.read()).sessions.find((row) => row.id === id);
    if (!session) return json({ error: 'Exam not found', code: 'EXAM_NOT_FOUND' }, 404);
    const advanced = maybeAdvanceTimer(session);
    if (advanced !== session) {
      await storeRepo.write((store) => {
        const idx = store.sessions.findIndex((row) => row.id === id);
        if (idx >= 0) store.sessions[idx] = advanced;
      });
      session = advanced;
    }
    return json({ session: await presentSession(session) });
  } catch (error) {
    return errorResponse(error);
  }
}
