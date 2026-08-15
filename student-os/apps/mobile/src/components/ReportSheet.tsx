import type { CreateReportRequest, ReportReason, ReportTargetType } from '@sos/contracts';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../api/client';
import { DominantAction, SectionHeader, SecondaryAction } from './editorial';
import { Text } from './Text';
import type { TranslationKey } from '../i18n/index';
import { useI18n } from '../i18n/index';
import { useSession } from '../state/session';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The report form (App Review Guideline 1.2 — "a mechanism to report offensive
 * content and timely responses to concerns").
 *
 * One component used from every reportable surface — a post, a comment, a
 * message, a profile — so there is exactly one place this contract is
 * exercised from the client, matching the one gate on the server.
 */

const REASONS: ReportReason[] = [
  'harassment',
  'hate',
  'sexual',
  'violence',
  'spam',
  'misinformation',
  'academic_dishonesty',
  'copyright',
  'other',
];

export function ReportSheet({
  visible,
  onClose,
  targetType,
  targetId,
  onBlock,
}: {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  /**
   * Offered on the confirmation. Reporting does not hide the content for the
   * reporter — blocking does — so the surface that just took a report is the
   * right place to offer it. Omitted where blocking makes no sense (a post's
   * own report sheet has no person to block from here).
   */
  onBlock?: (() => void) | undefined;
}): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<'idle' | 'filed' | 'duplicate' | 'error'>('idle');

  function reset(): void {
    setReason(null);
    setDetails('');
    setOutcome('idle');
  }

  async function submit(): Promise<void> {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      const body: CreateReportRequest = {
        targetType,
        targetId,
        reason,
        ...(details.trim() ? { details: details.trim() } : {}),
      };
      await api.post('/v1/reports', body);
      setOutcome('filed');
    } catch (error) {
      // A duplicate report is not a failure from the reporter's point of view —
      // their concern is already in the queue, and that is worth saying plainly
      // rather than showing a generic error for something that already worked.
      setOutcome(error instanceof ApiError && error.code === 'CONFLICT' ? 'duplicate' : 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const dismiss = (): void => {
    onClose();
    reset();
  };

  return (
    <Modal
      visible={visible}
      // Screen-filling, not a peek: the reason list, the detail field and the
      // action are all reachable without dragging the surface.
      presentationStyle="fullScreen"
      animationType="slide"
      // Deliberate dismissal only — an explicit Cancel and the system back
      // gesture. There is no tap-outside, which would discard a typed reason.
      onRequestClose={dismiss}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface }}>
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {outcome === 'filed' || outcome === 'duplicate' ? (
            <View style={{ gap: theme.spacing.md }} accessibilityLiveRegion="polite">
              <Text accessibilityRole="header" variant="title">
                {t('report.submitted.title')}
              </Text>
              <Text variant="body" tone="secondary">
                {outcome === 'duplicate' ? t('report.alreadyFiled') : t('report.submitted.body')}
              </Text>
              {/* Reporting does not hide the content; blocking does, so the
                  confirmation offers it rather than leaving the person to
                  find it. */}
              {onBlock ? (
                <>
                  <Text variant="body" tone="secondary">
                    {t('report.alsoBlock')}
                  </Text>
                  <SecondaryAction
                    label={t('report.blockAction')}
                    onPress={() => {
                      dismiss();
                      onBlock();
                    }}
                  />
                </>
              ) : null}
              <DominantAction label={t('action.done')} onPress={dismiss} />
            </View>
          ) : (
            <>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: theme.spacing.md,
                }}
              >
                {/* Focus moves here on open, so the modal owns the screen. */}
                {/* The modal owns focus: content behind it is inert, and a
                    screen reader lands on this title rather than wherever it
                    was reading before. */}
                <Text
                  accessibilityRole="header"
                  accessibilityViewIsModal
                  variant="title"
                  style={{ flex: 1 }}
                >
                  {t('report.title')}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('action.cancel')}
                  onPress={dismiss}
                  hitSlop={10}
                  style={{
                    minWidth: 44,
                    minHeight: 44,
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="close" size={24} color={theme.colors.text} />
                </Pressable>
              </View>

              <SectionHeader title={t('report.reason.title')} />
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t('report.reason.title')}
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}
              >
                {REASONS.map((r) => {
                  const active = reason === r;
                  return (
                    <Pressable
                      key={r}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t(`report.reason.${r}` as TranslationKey)}
                      onPress={() => setReason(r)}
                      style={{
                        borderRadius: theme.radius.pill,
                        borderWidth: active ? 0 : 1.5,
                        borderColor: theme.colors.borderStrong,
                        backgroundColor: active ? theme.colors.text : 'transparent',
                        paddingHorizontal: theme.spacing.lg,
                        minHeight: 44,
                        justifyContent: 'center',
                      }}
                    >
                      <Text
                        variant="metadata"
                        tone={active ? 'inverse' : 'secondary'}
                        style={{ fontWeight: active ? '600' : '500' }}
                      >
                        {t(`report.reason.${r}` as TranslationKey)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                accessibilityLabel={t('report.details.placeholder')}
                value={details}
                onChangeText={setDetails}
                placeholder={t('report.details.placeholder')}
                placeholderTextColor={theme.colors.textFaint}
                multiline
                maxLength={500}
                style={{
                  borderWidth: 1.5,
                  borderColor: theme.colors.borderStrong,
                  borderRadius: theme.radius.sm,
                  padding: theme.spacing.md,
                  minHeight: 96,
                  color: theme.colors.text,
                  textAlign: theme.isRTL ? 'right' : 'left',
                  textAlignVertical: 'top',
                }}
              />

              {outcome === 'error' ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={{
                    borderStartWidth: 2,
                    borderStartColor: theme.colors.challenged,
                    paddingStart: 11,
                  }}
                >
                  <Text variant="metadata" tone="challenged">
                    {t('error.generic')}
                  </Text>
                </View>
              ) : null}

              <Text variant="metadata" tone="muted">
                {t('report.moderatorNote')}
              </Text>

              <DominantAction
                label={t('report.submit')}
                disabled={!reason}
                loading={submitting}
                onPress={() => void submit()}
              />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
