import type { CreateReportRequest, ReportReason, ReportTargetType } from '@sos/contracts';
import { useState } from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';
import { ApiError } from '../api/client';
import { Button } from './Button';
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
}: {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        onClose();
        reset();
      }}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
            padding: theme.spacing.lg,
            gap: theme.spacing.md,
            maxHeight: '80%',
          }}
        >
          {outcome === 'filed' || outcome === 'duplicate' ? (
            <View style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.lg }}>
              <Text variant="bodyStrong">{t('report.submitted.title')}</Text>
              <Text variant="body" tone="muted">
                {outcome === 'duplicate' ? t('report.alreadyFiled') : t('report.submitted.body')}
              </Text>
              <Button
                label={t('action.done')}
                onPress={() => {
                  onClose();
                  reset();
                }}
              />
            </View>
          ) : (
            <>
              <Text variant="bodyStrong">{t('report.title')}</Text>
              <Text variant="label">{t('report.reason.title')}</Text>
              <View style={{ gap: theme.spacing.xs }}>
                {REASONS.map((r) => (
                  <Pressable
                    key={r}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: reason === r }}
                    accessibilityLabel={t(`report.reason.${r}` as TranslationKey)}
                    onPress={() => setReason(r)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                      paddingVertical: theme.spacing.xs,
                    }}
                  >
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        borderWidth: 2,
                        borderColor: reason === r ? theme.colors.primary : theme.colors.border,
                        backgroundColor: reason === r ? theme.colors.primary : 'transparent',
                      }}
                    />
                    <Text variant="body">{t(`report.reason.${r}` as TranslationKey)}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder={t('report.details.placeholder')}
                placeholderTextColor={theme.colors.textMuted}
                multiline
                maxLength={2000}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  padding: theme.spacing.sm,
                  minHeight: 72,
                  color: theme.colors.text,
                }}
              />
              {outcome === 'error' ? (
                <Text variant="micro" tone="danger">
                  {t('error.generic')}
                </Text>
              ) : null}
              <Button
                label={t('report.submit')}
                disabled={!reason}
                loading={submitting}
                onPress={() => void submit()}
                fullWidth
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
