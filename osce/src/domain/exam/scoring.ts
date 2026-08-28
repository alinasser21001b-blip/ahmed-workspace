import type { CategoryScore, ExamScores, Question, QuestionCategory, StudentAnswer } from '../models';

export function computeExamScores(
  sequence: readonly string[],
  answers: readonly StudentAnswer[],
  questions: readonly Question[],
): ExamScores {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answerByQ = new Map(answers.map((a) => [a.questionId, a]));

  let correct = 0;
  let partial = 0;
  let incorrect = 0;
  let earned = 0;
  const missedQuestionIds: string[] = [];
  const categoryTotals = new Map<QuestionCategory, { total: number; earned: number }>();

  for (const questionId of sequence) {
    const question = byId.get(questionId);
    const answer = answerByQ.get(questionId);
    const category = question?.category;
    if (category) {
      const row = categoryTotals.get(category) ?? { total: 0, earned: 0 };
      row.total += 1;
      row.earned += answer?.score ?? 0;
      categoryTotals.set(category, row);
    }

    if (!answer) {
      incorrect += 1;
      missedQuestionIds.push(questionId);
      continue;
    }
    earned += answer.score;
    if (answer.correctness === 'CORRECT') correct += 1;
    else if (answer.correctness === 'PARTIAL') {
      partial += 1;
      missedQuestionIds.push(questionId);
    } else {
      incorrect += 1;
      missedQuestionIds.push(questionId);
    }
  }

  const totalQuestions = sequence.length;
  const percent = totalQuestions === 0 ? 0 : Math.round((earned / totalQuestions) * 100);

  const byCategory: CategoryScore[] = [...categoryTotals.entries()].map(([category, row]) => ({
    category,
    total: row.total,
    earned: row.earned,
  }));

  const strong: QuestionCategory[] = [];
  const needsReview: QuestionCategory[] = [];
  for (const row of byCategory) {
    const ratio = row.total === 0 ? 0 : row.earned / row.total;
    if (ratio >= 0.75) strong.push(row.category);
    else if (ratio < 0.6) needsReview.push(row.category);
  }

  return {
    percent,
    totalQuestions,
    correct,
    partial,
    incorrect,
    byCategory,
    strong,
    needsReview,
    missedQuestionIds,
  };
}
