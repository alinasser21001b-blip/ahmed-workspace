import { SPECIALTIES } from '@/domain/models';
import { json } from '@/lib/http';
import { getStore, knowledgeView } from '@/data/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = await getStore().read();
  const knowledge = knowledgeView(store);
  const specialties = SPECIALTIES.map((specialty) => {
    const departmentExaminers = store.examiners.filter((e) => e.departmentId === specialty.id && e.active);
    const caseCount = store.cases.filter((row) => row.departmentId === specialty.id).length;
    const questionCount = knowledge.examinerQuestions.filter((eq) =>
      departmentExaminers.some((examiner) => examiner.id === eq.examinerId),
    ).length;
    return {
      ...specialty,
      examinerCount: departmentExaminers.length,
      caseCount,
      questionCount,
      sample: true,
    };
  });
  return json({ specialties, seedBanner: store.seedBanner });
}
