import type { PracticeAnswerResult, PracticeQuestion, PracticeSession } from '@sos/contracts';
import { ApiError } from '../../src/api/client';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/Button';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { Text } from '../../src/components/Text';
import { Card } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Practice — the one screen where the product asks instead of tells.
 *
 * Everything else in the app shows a student what other people know. This is
 * the only place it finds out what THEY know, and it is the reason the Learn
 * tab and the topic page have numbers on them at all.
 *
 * Three things are deliberate and worth not undoing:
 *
 *  1. **No score, no streak, no timer.** The screen reports one thing — how
 *     many questions on this topic the student has answered correctly — and it
 *     labels that a study signal rather than a result. A points total would
 *     turn the honest number underneath into a game, and the whole loop exists
 *     to make that number trustworthy.
 *  2. **Correctness comes from the server, always.** The screen has no key to
 *     check against; it sends the selection and renders what comes back. That
 *     is not a limitation to work around.
 *  3. **Answered questions stay answered.** Resuming shows the ones already
 *     done as done — the API refuses a second answer, and a UI that let a
 *     student retry would be promising something it cannot deliver.
 */

type Status = 'loading' | 'ready' | 'empty' | 'error';

export default function PracticeScreen(): React.JSX.Element {
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [session, setSession] = useState<PracticeSession | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<PracticeAnswerResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      const started = await api.post<PracticeSession>(`/v1/topics/${topicId}/practice`);
      setSession(started);
      // Resume where the student stopped rather than at the top.
      const next = started.questions.findIndex((question) => !question.answered);
      setIndex(next === -1 ? started.questions.length : next);
      setStatus('ready');
    } catch (error) {
      // 404 is the honest "nothing published for you here" — not a failure.
      setStatus(error instanceof ApiError && error.status === 404 ? 'empty' : 'error');
    }
  }, [api, topicId]);

  useEffect(() => {
    void load();
  }, [load]);

  const question: PracticeQuestion | undefined = session?.questions[index];
  const isMulti = question?.kind === 'mcq_multi';

  const progress = result?.progress ?? session?.progress ?? null;
  const remaining = useMemo(
    () => (session ? session.questions.filter((q) => !q.answered).length : 0),
    [session],
  );

  function toggle(optionId: string): void {
    if (result) return;
    setSelected((current) => {
      if (!isMulti) return [optionId];
      return current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
    });
  }

  async function check(): Promise<void> {
    if (!session || !question || submitting) return;
    setSubmitting(true);
    try {
      const answered = await api.post<PracticeAnswerResult>(
        `/v1/practice/attempts/${session.attemptId}/answers`,
        { questionId: question.id, selectedOptionIds: selected },
      );
      setResult(answered);
      setSession({
        ...session,
        questions: session.questions.map((q) =>
          q.id === question.id ? { ...q, answered: true } : q,
        ),
      });
    } catch {
      setStatus('error');
    } finally {
      setSubmitting(false);
    }
  }

  function advance(): void {
    setResult(null);
    setSelected([]);
    setIndex((current) => current + 1);
  }

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  if (status === 'empty' || !session) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <EmptyState
          title={t('practice.empty.title')}
          body={t('practice.empty.body')}
          action={{ label: t('action.back'), onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('action.back')}
        onPress={() => router.back()}
        hitSlop={8}
      >
        <DirectionalIcon direction="back" size={24} color={theme.colors.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text variant="heading" numberOfLines={1} bidi="auto">
          {session.topicName}
        </Text>
        <Text variant="micro" tone="muted">
          {t('practice.title')}
        </Text>
      </View>
    </View>
  );

  /*
   * The signal, stated as a signal.
   *
   * `lowConfidence` comes from the API rather than being inferred from the
   * count here: the threshold lives in `@sos/core` with the formula, and a
   * client that carried its own copy would eventually disagree with the Learn
   * tab about the same student.
   */
  const signalCard = progress ? (
    <Card>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="bodyStrong">
          {t('practice.score', {
            correct: progress.questionsCorrect,
            seen: progress.questionsSeen,
          })}
        </Text>
        {progress.lowConfidence ? (
          <Text variant="micro" tone="muted">
            {t('practice.lowConfidence')}
          </Text>
        ) : null}
        <Text variant="micro" tone="muted">
          {t('practice.signalNote')}
        </Text>
      </View>
    </Card>
  ) : null;

  // Every question answered — either just now, or on a previous visit.
  if (!question) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ScrollView
          contentContainerStyle={{
            padding: theme.spacing.lg,
            gap: theme.spacing.lg,
            flexGrow: 1,
          }}
        >
          {header}
          <Text variant="bodyStrong">{t('practice.done.title')}</Text>
          <Text variant="body" tone="muted">
            {t('practice.done.body')}
          </Text>
          {signalCard}
          <Button
            label={t('practice.finish')}
            variant="learning"
            fullWidth
            onPress={() => router.back()}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.lg,
          flexGrow: 1,
        }}
      >
        {header}

        <Text variant="micro" tone="muted">
          {t('practice.progress', {
            current: session.questions.length - remaining + 1,
            total: session.questions.length,
          })}
        </Text>

        <Text variant="bodyStrong" bidi="auto">
          {question.prompt}
        </Text>
        {isMulti ? (
          <Text variant="micro" tone="muted">
            {t('practice.multiHint')}
          </Text>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          {question.options.map((option) => {
            const isSelected = selected.includes(option.id);
            const isKey = result?.correctOptionIds.includes(option.id) ?? false;

            /*
             * After the verdict the key is marked on the option itself, not
             * only in a banner. A student who picked wrong needs to see WHICH
             * one was right next to what they chose, or the feedback is a
             * scoreline rather than a correction.
             */
            const border = result
              ? isKey
                ? theme.colors.learning
                : isSelected
                  ? theme.colors.danger
                  : theme.colors.border
              : isSelected
                ? theme.colors.learning
                : theme.colors.border;

            return (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected, disabled: result !== null }}
                accessibilityLabel={option.label}
                disabled={result !== null}
                onPress={() => toggle(option.id)}
              >
                <Card style={{ borderColor: border, borderWidth: 2 }}>
                  <Text variant="body" bidi="auto">
                    {option.label}
                  </Text>
                </Card>
              </Pressable>
            );
          })}
        </View>

        {result ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="bodyStrong" tone={result.isCorrect ? 'learning' : 'danger'}>
              {result.isCorrect ? t('practice.correct') : t('practice.incorrect')}
            </Text>
            {result.explanation ? (
              <Text variant="body" tone="muted" bidi="auto">
                {result.explanation}
              </Text>
            ) : null}
            {signalCard}
            <Button
              label={
                index + 1 >= session.questions.length ? t('practice.finish') : t('practice.next')
              }
              variant="learning"
              fullWidth
              onPress={advance}
            />
          </View>
        ) : (
          <Button
            label={t('practice.check')}
            variant="learning"
            fullWidth
            loading={submitting}
            disabled={selected.length === 0}
            onPress={() => void check()}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
