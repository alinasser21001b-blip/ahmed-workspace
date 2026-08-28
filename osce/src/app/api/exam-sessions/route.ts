import { createExamSession } from '@/domain/exam/session';
import { getStore, knowledgeView } from '@/data/store';
import { errorResponse, json } from '@/lib/http';
import { presentSession } from '@/lib/present-session';
import { createExamRequestSchema } from '@/lib/schemas';

export async function POST(request: Request) {
  try {
    const body = createExamRequestSchema.parse(await request.json());
    const storeRepo = getStore();
    const store = await storeRepo.read();
    const session = createExamSession(body, knowledgeView(store));
    await storeRepo.write((current) => {
      current.sessions.unshift(session);
    });
    return json({ session: await presentSession(session) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
