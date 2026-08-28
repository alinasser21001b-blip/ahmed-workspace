import type { ExamSession } from '@/domain/models';
import { getStore } from '@/data/store';
import { specialtyById } from '@/domain/models';
import { remainingSeconds } from '@/lib/ids';

export async function presentSession(session: ExamSession, options: { revealAnswers?: boolean } = {}) {
  const store = await getStore().read();
  const examiner = store.examiners.find((row) => row.id === session.examinerId);
  const clinicalCase = store.cases.find((row) => row.id === session.caseId);
  const specialty = specialtyById(session.specialtyId);
  const reveal = options.revealAnswers || session.status === 'COMPLETED';

  const questions = session.questionSequence.map((questionId, index) => {
    const question = store.questions.find((row) => row.id === questionId);
    const answer = session.answers.find((row) => row.questionId === questionId);
    const unlocked = reveal || Boolean(answer?.revealedAt) || index < session.currentQuestionIndex;
    return {
      id: questionId,
      index,
      questionText: question?.questionText ?? '',
      category: question?.category,
      expectedAnswer: unlocked ? question?.expectedAnswer : undefined,
      explanation: unlocked ? question?.explanation : undefined,
      sample: question?.sample ?? false,
      answer,
    };
  });

  return {
    id: session.id,
    status: session.status,
    specialty,
    examiner: examiner
      ? { id: examiner.id, name: examiner.name, nameAr: examiner.nameAr, sample: examiner.metadata.sample }
      : null,
    case: clinicalCase
      ? {
          id: clinicalCase.id,
          title: clinicalCase.title,
          titleAr: clinicalCase.titleAr,
          clinicalScenario: clinicalCase.clinicalScenario,
          tags: clinicalCase.tags,
          sample: clinicalCase.sample,
        }
      : null,
    examinerMode: session.examinerMode,
    preparationDuration: session.preparationDuration,
    startedAt: session.startedAt,
    preparationEndsAt: session.preparationEndsAt,
    remainingPreparationSeconds: session.preparationEndsAt ? remainingSeconds(session.preparationEndsAt) : null,
    currentQuestionIndex: session.currentQuestionIndex,
    questionCount: session.questionSequence.length,
    questions,
    scores: session.scores,
    sampleBanner: store.seedBanner,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
  };
}
