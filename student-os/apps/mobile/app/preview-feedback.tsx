import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChipPicker,
  DominantAction,
  SecondaryAction,
  SectionHeader,
  TopBar,
} from '../src/components/editorial';
import { Text } from '../src/components/Text';
import { useI18n, type TranslationKey } from '../src/i18n/index';
import { IS_PREVIEW_MODE } from '../src/preview/preview-mode';
import { recordFeedback, type PreviewFeedback } from '../src/preview/feedback-store';
import { useTheme } from '../src/theme/ThemeProvider';

/**
 * The student preview's feedback form.
 *
 * Preview-only by construction: outside a preview build `IS_PREVIEW_MODE` is a
 * compile-time `false`, the banner that opens this screen never renders, and
 * the screen itself refuses to render a form. A deep link to `/preview-feedback`
 * in a production build reaches a sentence, not a questionnaire.
 *
 * What it does NOT collect is the design decision worth stating: no name, no
 * email, no handle, no college, no device identifier, and no free-text prompt
 * that invites one. A student judging a design should not have to identify
 * themselves to do it, and a preview that gathered contact details would be
 * collecting personal data for a purpose it does not have.
 *
 * There is no server. The preview has no backend at all — the transport is an
 * in-memory fixture world — so a submitted response is written to this device
 * and shown back to the student as copyable text. That is the honest shape:
 * rather than a confirmation implying the answers travelled somewhere, the
 * screen says where they actually are and hands them over.
 */

const SCREENS = [
  'overall',
  'home',
  'learn',
  'topic',
  'practice',
  'classroom',
  'messages',
  'search',
  'profile',
  'compose',
  'settings',
] as const;

/**
 * Four points, no midpoint.
 *
 * An odd scale collects a neutral answer from anyone in a hurry, which reads as
 * data and is not. Four forces a lean, and each point is a word rather than a
 * number so it means the same thing to every student — and survives greyscale.
 */
const SCALE = ['4', '3', '2', '1'] as const;
type Scale = (typeof SCALE)[number];

const DIMENSIONS: { key: keyof PreviewFeedback['ratings']; label: TranslationKey }[] = [
  { key: 'clarity', label: 'preview.feedback.clarity' },
  { key: 'navigation', label: 'preview.feedback.navigation' },
  { key: 'usefulness', label: 'preview.feedback.usefulness' },
  { key: 'comfort', label: 'preview.feedback.comfort' },
];

export default function PreviewFeedbackScreen(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();

  const [screen, setScreen] = useState<(typeof SCREENS)[number] | null>(null);
  const [ratings, setRatings] = useState<Partial<Record<string, Scale>>>({});
  const [confusion, setConfusion] = useState('');
  const [change, setChange] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!IS_PREVIEW_MODE) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}>
          <TopBar title={t('preview.feedback.title')} onBack={() => router.back()} />
          <Text variant="body" tone="secondary">
            {t('preview.feedback.notPreview')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const submit = (): void => {
    const feedback: PreviewFeedback = {
      screen: screen ?? 'overall',
      ratings: {
        clarity: ratings['clarity'] ?? null,
        navigation: ratings['navigation'] ?? null,
        usefulness: ratings['usefulness'] ?? null,
        comfort: ratings['comfort'] ?? null,
      },
      confusion: confusion.trim(),
      suggestedChange: change.trim(),
    };
    setSent(recordFeedback(feedback));
  };

  const copy = (): void => {
    if (!sent) return;
    // Best effort. The clipboard API is unavailable over plain HTTP and in some
    // in-app browsers, so a failure selects nothing and says nothing rather
    // than throwing — the text is on screen either way.
    void navigator.clipboard?.writeText(sent).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  const scaleOptions = SCALE.map((value) => ({
    value,
    label: t(`preview.feedback.scale.${value}` as TranslationKey),
  }));

  if (sent) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}
        >
          <View accessibilityLiveRegion="polite" style={{ gap: theme.spacing.sm }}>
            <Text accessibilityRole="header" variant="title">
              {t('preview.feedback.sent.title')}
            </Text>
            <Text variant="body" tone="secondary">
              {t('preview.feedback.sent.body')}
            </Text>
            <Text variant="body" tone="secondary">
              {t('preview.feedback.sent.handOver')}
            </Text>
          </View>

          {/* The answers themselves, so "recorded on this device" is a
              statement the student can check rather than take on trust. */}
          <View
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.sm,
              padding: theme.spacing.md,
            }}
          >
            <Text variant="metadata" tone="secondary" style={{ writingDirection: 'ltr' }}>
              {sent}
            </Text>
          </View>

          <SecondaryAction label={t('preview.feedback.sent.copy')} onPress={copy} />
          {copied ? (
            <Text variant="metadata" tone="secondary" accessibilityLiveRegion="polite">
              {t('preview.feedback.sent.copied')}
            </Text>
          ) : null}
          <DominantAction label={t('action.done')} onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.xl,
        }}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <TopBar title={t('preview.feedback.title')} onBack={() => router.back()} />
          <Text variant="body" tone="secondary">
            {t('preview.feedback.intro')}
          </Text>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t('preview.feedback.screen')} />
          <ChipPicker
            label={t('preview.feedback.screen')}
            options={SCREENS.map((value) => ({
              value,
              label: t(`preview.feedback.screen.${value}` as TranslationKey),
            }))}
            selected={screen}
            onSelect={setScreen}
          />
        </View>

        {DIMENSIONS.map((dimension) => (
          <View key={dimension.key} style={{ gap: theme.spacing.sm }}>
            <SectionHeader title={t(dimension.label)} />
            <ChipPicker
              label={t(dimension.label)}
              options={scaleOptions}
              selected={ratings[dimension.key] ?? null}
              onSelect={(value) =>
                setRatings((previous) => ({ ...previous, [dimension.key]: value }))
              }
            />
          </View>
        ))}

        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t('preview.feedback.confusion')} />
          <Text variant="metadata" tone="muted">
            {t('preview.feedback.confusion.hint')}
          </Text>
          <TextInput
            accessibilityLabel={t('preview.feedback.confusion')}
            value={confusion}
            onChangeText={setConfusion}
            multiline
            maxLength={600}
            style={fieldStyle(theme)}
          />
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t('preview.feedback.change')} />
          <Text variant="metadata" tone="muted">
            {t('preview.feedback.change.hint')}
          </Text>
          <TextInput
            accessibilityLabel={t('preview.feedback.change')}
            value={change}
            onChangeText={setChange}
            multiline
            maxLength={600}
            style={fieldStyle(theme)}
          />
        </View>

        <Text variant="metadata" tone="muted">
          {t('preview.feedback.noPersonalData')}
        </Text>

        <DominantAction label={t('preview.feedback.submit')} onPress={submit} />
      </ScrollView>
    </SafeAreaView>
  );
}

function fieldStyle(theme: ReturnType<typeof useTheme>): Record<string, unknown> {
  return {
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.md,
    minHeight: 88,
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 22,
    textAlign: theme.isRTL ? 'right' : 'left',
    textAlignVertical: 'top',
  };
}
