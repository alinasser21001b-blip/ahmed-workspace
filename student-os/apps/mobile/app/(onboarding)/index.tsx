import type { College, Program, Stage, Topic, University } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ApiError } from '../../src/api/client';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { Text } from '../../src/components/Text';
import { Card, Badge } from '../../src/components/surfaces';
import { ErrorState, LoadingState, Screen } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Onboarding — the second half of the first journey (§91).
 *
 * Every option on every step is fetched from the academic hierarchy API.
 * Nothing here knows that the first cohort is medicine at Baghdad; adding a
 * second university is a row insert (§8, §63).
 */

type Step = 'university' | 'college' | 'program' | 'stage' | 'profile';
const STEPS: Step[] = ['university', 'college', 'program', 'stage', 'profile'];

interface Selection {
  university?: University;
  college?: College;
  program?: Program;
  stage?: Stage;
}

export default function Onboarding(): React.JSX.Element {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { api, refreshUser } = useSession();

  const [step, setStep] = useState<Step>('university');
  const [selection, setSelection] = useState<Selection>({});
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [handleAvailable, setHandleAvailable] = useState<boolean | null>(null);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const name = useCallback(
    (node: { nameAr: string; nameEn: string }) => (locale === 'ar' ? node.nameAr : node.nameEn),
    [locale],
  );

  // Each step loads only the options reachable from the previous choice, which
  // is what makes an invalid placement unreachable through the UI. The server
  // still validates it independently.
  const loadOptions = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      switch (step) {
        case 'university': {
          const rows = await api.get<University[]>('/v1/academic/universities', { auth: false });
          setOptions(rows.map((r) => ({ id: r.id, label: name(r) })));
          break;
        }
        case 'college': {
          const rows = await api.get<College[]>(
            `/v1/academic/colleges?universityId=${selection.university!.id}`,
            { auth: false },
          );
          setOptions(rows.map((r) => ({ id: r.id, label: name(r) })));
          break;
        }
        case 'program': {
          const rows = await api.get<Program[]>(
            `/v1/academic/programs?collegeId=${selection.college!.id}`,
            { auth: false },
          );
          setOptions(rows.map((r) => ({ id: r.id, label: name(r) })));
          break;
        }
        case 'stage': {
          const rows = await api.get<Stage[]>(
            `/v1/academic/stages?programId=${selection.program!.id}`,
            { auth: false },
          );
          setOptions(rows.map((r) => ({ id: r.id, label: name(r) })));
          break;
        }
        case 'profile': {
          const courses = await api.get<{ id: string }[]>(
            `/v1/academic/courses?stageId=${selection.stage!.id}`,
            { auth: false },
          );
          const lists = await Promise.all(
            courses.map((course) =>
              api.get<Topic[]>(`/v1/academic/topics?courseId=${course.id}`, { auth: false }),
            ),
          );
          setTopics(lists.flat());
          break;
        }
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api, step, selection, name]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  // Debounced availability check, so a user is told about a clash while typing
  // rather than after submitting a form they cannot fix without retyping.
  useEffect(() => {
    if (!/^[a-z0-9_]{3,30}$/.test(handle)) {
      setHandleAvailable(null);
      return;
    }
    const timer = setTimeout(() => {
      void api
        .get<{ available: boolean }>(`/v1/handles/available?handle=${handle}`, { auth: false })
        .then((result) => setHandleAvailable(result.available))
        .catch(() => setHandleAvailable(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [api, handle]);

  const choose = (id: string): void => {
    const stepIndex = STEPS.indexOf(step);
    setSelection((current) => {
      switch (step) {
        case 'university':
          return { university: { id } as University };
        case 'college':
          return { ...current, college: { id } as College };
        case 'program':
          return { ...current, program: { id } as Program };
        case 'stage':
          return { ...current, stage: { id } as Stage };
        default:
          return current;
      }
    });
    setStep(STEPS[stepIndex + 1] ?? 'profile');
  };

  const goBack = (): void => {
    const stepIndex = STEPS.indexOf(step);
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1]!);
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post('/v1/me/onboarding', {
        handle,
        displayName: displayName.trim(),
        universityId: selection.university!.id,
        collegeId: selection.college!.id,
        programId: selection.program!.id,
        stageId: selection.stage!.id,
        interestTopicIds: selectedTopics,
      });
      await refreshUser();
      router.replace('/(tabs)');
    } catch (caught) {
      setSubmitError(
        caught instanceof ApiError && caught.code === 'CONFLICT'
          ? t('onboarding.handle.taken')
          : t('state.error.body'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const titles: Record<Step, string> = {
    university: t('onboarding.university.title'),
    college: t('onboarding.college.title'),
    program: t('onboarding.program.title'),
    stage: t('onboarding.stage.title'),
    profile: t('onboarding.profile.title'),
  };

  const canSubmit =
    handleAvailable === true && displayName.trim().length > 0 && !submitting;

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.lg }}>
        <Badge label={`${STEPS.indexOf(step) + 1} / ${STEPS.length}`} tone="primary" />
        <Text variant="title">{titles[step]}</Text>
        {step === 'profile' ? (
          <Text variant="body" tone="muted">
            {t('onboarding.profile.subtitle')}
          </Text>
        ) : null}
      </View>

      {loading ? (
        <View style={{ height: 220 }}>
          <LoadingState />
        </View>
      ) : loadError ? (
        <View style={{ height: 220 }}>
          <ErrorState onRetry={() => void loadOptions()} />
        </View>
      ) : step === 'profile' ? (
        <View style={{ gap: theme.spacing.lg }}>
          <Input
            label={t('onboarding.displayName')}
            value={displayName}
            onChangeText={setDisplayName}
            autoComplete="name"
          />
          <Input
            label={t('onboarding.handle')}
            hint={t('onboarding.handle.hint')}
            value={handle}
            onChangeText={(value) => setHandle(value.toLowerCase())}
            autoCapitalize="none"
            autoCorrect={false}
            {...(handleAvailable === false ? { error: t('onboarding.handle.taken') } : {})}
            {...(handleAvailable === true ? { success: t('onboarding.handle.available') } : {})}
          />

          {topics.length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="heading">{t('onboarding.interests.title')}</Text>
              <Text variant="caption" tone="muted">
                {t('onboarding.interests.subtitle')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  {topics.map((topic) => {
                    const active = selectedTopics.includes(topic.id);
                    return (
                      <Pressable
                        key={topic.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: active }}
                        onPress={() =>
                          setSelectedTopics((current) =>
                            active
                              ? current.filter((id) => id !== topic.id)
                              : [...current, topic.id],
                          )
                        }
                        style={{
                          borderRadius: theme.radius.pill,
                          borderWidth: 1,
                          borderColor: active ? theme.colors.primary : theme.colors.border,
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                          paddingHorizontal: theme.spacing.lg,
                          paddingVertical: theme.spacing.sm,
                        }}
                      >
                        <Text variant="caption" tone={active ? 'primary' : 'muted'}>
                          {name(topic)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          ) : null}

          {submitError ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {submitError}
            </Text>
          ) : null}

          <Button
            label={t('onboarding.finish')}
            onPress={() => void submit()}
            loading={submitting}
            disabled={!canSubmit}
            size="lg"
            fullWidth
          />
        </View>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {options.map((option) => (
            <Card key={option.id} onPress={() => choose(option.id)} accessibilityLabel={option.label}>
              <Text variant="bodyStrong">{option.label}</Text>
            </Card>
          ))}
        </View>
      )}

      {STEPS.indexOf(step) > 0 ? (
        <Button label={t('action.back')} variant="ghost" onPress={goBack} />
      ) : null}
    </Screen>
  );
}
