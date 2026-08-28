import { isSpecialtyId } from '@/domain/models';
import { errorResponse, json } from '@/lib/http';
import { examinerSummaries } from '@/lib/presenters';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ specialtyId: string }> },
) {
  try {
    const { specialtyId } = await context.params;
    if (!isSpecialtyId(specialtyId)) {
      return json({ error: 'Unknown specialty', code: 'UNKNOWN_SPECIALTY' }, 404);
    }
    const examiners = await examinerSummaries(specialtyId);
    return json({ specialtyId, examiners });
  } catch (error) {
    return errorResponse(error);
  }
}
