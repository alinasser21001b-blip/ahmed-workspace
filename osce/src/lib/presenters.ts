import { getStore, knowledgeView } from '@/data/store';
import type { Examiner } from '@/domain/models';
import { caseIdsForExaminer } from '@/domain/exam/session';

export async function examinerSummaries(specialtyId?: string) {
  const store = await getStore().read();
  const knowledge = knowledgeView(store);
  const list = specialtyId
    ? store.examiners.filter((examiner) => examiner.departmentId === specialtyId && examiner.active)
    : store.examiners.filter((examiner) => examiner.active);

  return list.map((examiner) => toExaminerSummary(examiner, knowledge));
}

export function toExaminerSummary(
  examiner: Examiner,
  knowledge: ReturnType<typeof knowledgeView>,
) {
  const associatedCases = caseIdsForExaminer(knowledge, examiner.id);
  const questionCount = knowledge.examinerQuestions.filter((eq) => eq.examinerId === examiner.id).length;
  return {
    id: examiner.id,
    name: examiner.name,
    nameAr: examiner.nameAr,
    departmentId: examiner.departmentId,
    availableCases: associatedCases.length,
    historicalQuestions: questionCount,
    sample: examiner.metadata.sample,
  };
}
