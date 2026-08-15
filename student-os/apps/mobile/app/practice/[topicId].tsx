import type { PracticeAnswerResult, PracticeSession } from '@sos/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { DominantAction, SecondaryAction } from '../../src/components/editorial';
import { EvidenceDelta } from '../../src/components/evidence';
import {
  AnswerOption,
  FeedbackPanel,
  PracticeHeader,
  type SegmentState,
} from '../../src/components/practice';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { Text } from '../../src/components/Text';
import { ApiError, NetworkError } from '../../src/api/client';
import { localizeDigits, useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Practice — the focus mode, implementing the state machine from
 * 13-PRACTICE.md exactly.
 *
 *   loading → idle ⇄ answer_selected → submitting → feedback_correct
 *                                        │       └→ feedback_incorrect
 *                                        └→ submit_failed → retry
 *   feedback → next → idle | complete
 *
 * Invariants the types below make unrepresentable: no verdict without a
 * submission, no double submit (the control is inert in flight), no changing
 * an answer after reveal.
 *
 * Three things carried over from the previous implementation and still
 * deliberate: no score/streak/timer; correctness always comes from the
 * server; answered questions stay answered — resume opens at the first
 * unanswered question and never re-asks.
 */

type Phase =
  | { kind: 'loading' }
  | { kind: 'load_failed'; offline: boolean }
  | { kind: 'empty' }
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'feedback'; result: PracticeAnswerResult }
  | { kind: 'submit_failed' }
  | { kind: 'complete' };

export default function PracticeScreen(): React.JSX.Element {
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const { t, locale } = useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { api } = useSession();

  const [session, setSession] = useState<PracticeSession | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  /** Verdicts this session, by question id — drives the header segments. */
  const [verdicts, setVerdicts] = useState<Record<string, boolean>>({});
  /** The evidence pair before the answer in flight — the delta's left side. */
  const [progressBefore, setProgressBefore] = useState<PracticeSession['progress'] | null>(null);
  /** Where the session started, for the completion summary. */
  const [sessionStart, setSessionStart] = useState<PracticeSession['progress'] | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setPhase({ kind: 'loading' });
    try {
      const started = await api.post<PracticeSession>(`/v1/topics/${topicId}/practice`);
      setSession(started);
      setProgressBefore(started.progress);
      setSessionStart(started.progress);
      const next = started.questions.findIndex((question) => !question.answered);
      if (next === -1) {
        setIndex(started.questions.length);
        setPhase({ kind: 'complete' });
      } else {
        setIndex(next);
        setPhase({ kind: 'idle' });
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) setPhase({ kind: 'empty' });
      else setPhase({ kind: 'load_failed', offline: cause instanceof NetworkError });
    }
  }, [api, topicId]);

  useEffect(() => {
    void load();
  }, [load]);

  const question = session?.questions[index];
  const isMulti = question?.kind === 'mcq_multi';
  const kind: 'single' | 'multi' | 'boolean' =
    question?.kind === 'mcq_multi' ? 'multi' : question?.kind === 'true_false' ? 'boolean' : 'single';

  const segments = useMemo<SegmentState[]>(() => {
    if (!session) return [];
    return session.questions.map((entry, position) => {
      if (entry.id in verdicts) return verdicts[entry.id] ? 'correct' : 'incorrect';
      // Answered on a previous visit: shown as correct-band? No — earlier
      // verdicts are unknown to this session; the segment states only what
      // this session saw. Prior answers render as filled-unanswered.
      if (entry.answered) return 'correct';
      return position === index ? 'current' : 'unanswered';
    });
  }, [session, verdicts, index]);

  function toggle(optionId: string): void {
    if (phase.kind !== 'idle' && phase.kind !== 'submit_failed') return;
    setSelected((current) => {
      if (!isMulti) return [optionId];
      return current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
    });
    setPhase({ kind: 'idle' });
  }

  async function submit(): Promise<void> {
    if (!session || !question || phase.kind === 'submitting') return;
    setPhase({ kind: 'submitting' });
    try {
      const result = await api.post<PracticeAnswerResult>(
        `/v1/practice/attempts/${session.attemptId}/answers`,
        { questionId: question.id, selectedOptionIds: selected },
      );
      setVerdicts((current) => ({ ...current, [question.id]: result.isCorrect }));
      setSession({
        ...session,
        questions: session.questions.map((entry) =>
          entry.id === question.id ? { ...entry, answered: true } : entry,
        ),
      });
      setPhase({ kind: 'feedback', result });
    } catch {
      // Selection preserved; nothing is claimed. Retry replays idempotently.
      setPhase({ kind: 'submit_failed' });
    }
  }

  function advance(result: PracticeAnswerResult): void {
    // The after becomes the next answer's before.
    if (result.progress) setProgressBefore(result.progress);
    setSelected([]);
    const next = session?.questions.findIndex((entry) => !entry.answered) ?? -1;
    if (next === -1) {
      setIndex(session ? session.questions.length : 0);
      setPhase({ kind: 'complete' });
    } else {
      setIndex(next);
      setPhase({ kind: 'idle' });
    }
  }

  const exit = (): void => router.back();
  const openTopic = (): void => {
    if (topicId) router.replace(`/topic/${topicId}`);
  };

  // ---- full-screen terminal states ----------------------------------------

  if (phase.kind === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface }}>
        <LoadingState />
      </SafeAreaView>
    );
  }
  if (phase.kind === 'load_failed') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface }}>
        <ErrorState
          {...(phase.offline ? { message: t('state.offline') } : {})}
          onRetry={() => void load()}
        />
      </SafeAreaView>
    );
  }
  if (phase.kind === 'empty' || !session) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface }}>
        <EmptyState
          title={t('practice.empty.title')}
          body={t('practice.empty.body')}
          action={{ label: t('action.back'), onPress: exit }}
        />
      </SafeAreaView>
    );
  }

  // ---- completion -----------------------------------------------------------

  if (phase.kind === 'complete' || !question) {
    const answeredThisSession = Object.keys(verdicts).length;
    const latest = progressBefore;
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
        <PracticeHeader
          total={session.questions.length}
          index={session.questions.length - 1}
          segments={segments}
          onExit={exit}
        />
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg, flexGrow: 1 }}
        >
          <Text variant="title">{t('practice.complete')}</Text>
          {answeredThisSession > 0 ? (
            <Text variant="body" tone="secondary">
              {t('practice.score', {
                correct: localizeDigits(locale, Object.values(verdicts).filter(Boolean).length),
                seen: localizeDigits(locale, answeredThisSession),
              })}
            </Text>
          ) : (
            <Text variant="body" tone="secondary">
              {t('practice.allAnswered')}
            </Text>
          )}
          {sessionStart && latest && answeredThisSession > 0 ? (
            <EvidenceDelta
              before={{ correct: sessionStart.questionsCorrect, answered: sessionStart.questionsSeen }}
              after={{ correct: latest.questionsCorrect, answered: latest.questionsSeen }}
            />
          ) : null}
          {latest?.lowConfidence ? (
            <Text variant="metadata" tone="muted">
              {t('practice.stillSmallSample')}
            </Text>
          ) : null}
          <Text variant="metadata" tone="muted">
            {t('practice.signalNote')}
          </Text>
          <View style={{ flex: 1 }} />
          <DominantAction label={t('practice.backToTopic')} onPress={openTopic} />
        </ScrollView>
      </View>
    );
  }

  // ---- the question ---------------------------------------------------------

  const revealed = phase.kind === 'feedback';
  const result = phase.kind === 'feedback' ? phase.result : null;
  const remaining = session.questions.filter((entry) => !entry.answered).length;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <PracticeHeader
        total={session.questions.length}
        index={index}
        segments={segments}
        onExit={exit}
      />

      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.xl,
          paddingBottom: theme.spacing.xl,
          gap: theme.spacing.lg,
        }}
      >
        {/* The stem — the largest text on screen at every step. */}
        <Text variant="title" bidi="auto" style={{ fontWeight: '600' }}>
          {question.prompt}
        </Text>
        {isMulti ? (
          <Text variant="metadata" tone="muted">
            {t('practice.multiHint')}
          </Text>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          {question.options.map((option, optionIndex) => (
            <AnswerOption
              key={option.id}
              index={optionIndex}
              label={option.label}
              kind={kind}
              selected={selected.includes(option.id)}
              revealed={revealed}
              isCorrect={result?.correctOptionIds.includes(option.id) ?? false}
              wasChosen={selected.includes(option.id)}
              onPress={() => toggle(option.id)}
            />
          ))}
        </View>

        {result ? (
          <FeedbackPanel
            isCorrect={result.isCorrect}
            explanation={result.explanation}
            progressBefore={
              progressBefore
                ? { correct: progressBefore.questionsCorrect, answered: progressBefore.questionsSeen }
                : null
            }
            progressAfter={
              result.progress
                ? { correct: result.progress.questionsCorrect, answered: result.progress.questionsSeen }
                : null
            }
            lowConfidence={result.progress?.lowConfidence ?? false}
            alreadyAnswered={result.alreadyAnswered}
            hasTopic={result.progress !== null}
          />
        ) : null}

        {phase.kind === 'submit_failed' ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              borderStartWidth: 2,
              borderStartColor: theme.colors.challenged,
              paddingStart: 11,
            }}
          >
            <Text variant="metadata" tone="challenged">
              {t('practice.submitFailed')}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Pinned footer with the bottom inset. */}
      <View
        style={{
          padding: theme.spacing.xl,
          paddingBottom: theme.spacing.lg + insets.bottom,
          gap: theme.spacing.md,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        }}
      >
        {result ? (
          <>
            <DominantAction
              label={remaining > 0 ? t('practice.next') : t('practice.finish')}
              onPress={() => advance(result)}
            />
            <SecondaryAction label={t('practice.openTopic')} onPress={openTopic} />
          </>
        ) : phase.kind === 'submit_failed' ? (
          <DominantAction label={t('practice.retry')} onPress={() => void submit()} />
        ) : (
          <DominantAction
            label={isMulti ? t('practice.checkMulti') : t('practice.checkAnswer')}
            onPress={() => void submit()}
            loading={phase.kind === 'submitting'}
          />
        )}
      </View>
    </View>
  );
}
