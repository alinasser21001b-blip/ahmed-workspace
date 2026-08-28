import { DomainError } from '@/domain/invariants';
import { applyApprovedCandidates } from '@/domain/ingestion/apply';
import { getStore } from '@/data/store';
import { isSpecialtyId } from '@/domain/models';
import { errorResponse, json } from '@/lib/http';
import { reviewDecisionSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = await getStore().read();
  const pending = store.candidates.filter((row) => row.decision === 'PENDING');
  return json({ candidates: pending });
}

export async function POST(request: Request) {
  try {
    const body = reviewDecisionSchema.parse(await request.json());
    const storeRepo = getStore();
    await storeRepo.write((store) => {
      const candidate = store.candidates.find((row) => row.id === body.candidateId);
      if (!candidate) throw new DomainError('Candidate not found', 'CANDIDATE_NOT_FOUND', 404);
      candidate.decision = body.decision;
      if (body.questionText) candidate.questionText = body.questionText;
      if (body.expectedAnswer) candidate.expectedAnswer = body.expectedAnswer;
      if (body.examinerName) candidate.examinerName = body.examinerName;
      if (body.caseTitle) candidate.caseTitle = body.caseTitle;
      if (body.specialtyId && isSpecialtyId(body.specialtyId)) candidate.specialtyId = body.specialtyId;

      if (candidate.decision === 'APPROVED' || candidate.decision === 'EDITED') {
        const document = store.documents.find((row) => row.id === candidate.documentId);
        if (!document) return;
        const mutated = applyApprovedCandidates([candidate], store, document);
        store.examiners = mutated.examiners;
        store.cases = mutated.cases;
        store.questions = mutated.questions;
        store.examinerQuestions = mutated.examinerQuestions;
        store.occurrences = mutated.occurrences;
      }

      const remaining = store.candidates.some(
        (row) => row.documentId === candidate.documentId && row.decision === 'PENDING',
      );
      const doc = store.documents.find((row) => row.id === candidate.documentId);
      if (doc && !remaining && doc.processingStatus === 'REVIEW_REQUIRED') {
        doc.processingStatus = 'PROCESSED';
      }
    });
    const store = await storeRepo.read();
    return json({
      candidate: store.candidates.find((row) => row.id === body.candidateId),
      pending: store.candidates.filter((row) => row.decision === 'PENDING'),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
