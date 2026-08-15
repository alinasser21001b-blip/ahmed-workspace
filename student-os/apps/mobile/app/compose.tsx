import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContentItem, Difficulty, FileRef, KnowledgeType, Visibility } from '@sos/contracts';
import { allowedKnowledgeTypes } from '@sos/core';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, TextInput, View } from 'react-native';
import { ApiError, NetworkError } from '../src/api/client';
import { Button } from '../src/components/Button';
import { DominantAction, SectionHeader } from '../src/components/editorial';
import { Text } from '../src/components/Text';
import { Screen } from '../src/components/states';
import { useI18n, type TranslationKey } from '../src/i18n/index';
import { bumpContentVersion } from '../src/state/content-events';
import { API_BASE_URL, useSession } from '../src/state/session';
import { useTheme } from '../src/theme/ThemeProvider';

/**
 * Post composer (§56).
 *
 * The visibility control is deliberately prominent rather than tucked behind a
 * menu. In a closed academic network the audience is the decision that matters
 * most, and a default the student never noticed choosing is how private notes
 * end up in a cohort feed.
 */

const VISIBILITY_OPTIONS: { value: Visibility; key: TranslationKey }[] = [
  { value: 'stage', key: 'compose.visibility.stage' },
  { value: 'college', key: 'compose.visibility.college' },
  { value: 'university', key: 'compose.visibility.university' },
  { value: 'private', key: 'compose.visibility.private' },
];

/*
 * Read from the same table the server validates against (ADR-0012), so the
 * composer can never offer a combination that would be rejected on publish.
 */
const KNOWLEDGE_TYPES: readonly KnowledgeType[] = allowedKnowledgeTypes('post');
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

export default function Compose(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();
  /*
   * When opened from a group, the post belongs to that group and the audience
   * control is hidden: a group's membership already IS the audience, and
   * offering a second, contradictory choice would be a way to publish into a
   * group with a visibility that says otherwise.
   */
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();

  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('stage');
  /*
   * Both stay null until the student chooses. There is no default knowledge
   * type: guessing one would put a label the author never agreed to onto their
   * post, and an honest gap is more useful than a confident wrong answer
   * (ADR-0012). Language is not asked at all — it is derived from the text.
   */
  const [knowledgeType, setKnowledgeType] = useState<KnowledgeType | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [attachment, setAttachment] = useState<FileRef | null>(null);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickImage = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      // Resizing before upload keeps a 12 MP phone photo under the server's
      // limit and off a student's mobile data plan.
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      // React Native and web disagree on what a file looks like in FormData.
      if (asset.file) {
        form.append('file', asset.file);
      } else {
        form.append('file', {
          uri: asset.uri,
          name: asset.fileName ?? 'image.jpg',
          type: asset.mimeType ?? 'image/jpeg',
        } as unknown as Blob);
      }

      const uploaded = await api.upload<FileRef>('/v1/files', form);
      setAttachment(uploaded);
    } catch (caught) {
      setError(t(uploadErrorKey(caught)));
    } finally {
      setUploading(false);
    }
  };

  const publish = async (): Promise<void> => {
    setPublishing(true);
    setError(null);
    try {
      const created = await api.post<ContentItem>('/v1/content', {
        body: body.trim() || undefined,
        mediaFileIds: attachment ? [attachment.id] : [],
        ...(knowledgeType ? { knowledgeType } : {}),
        ...(difficulty ? { difficulty } : {}),
        ...(groupId ? { groupId, visibility: 'group' } : { visibility }),
      });
      // Tell every mounted feed to reload before navigating, so the post is
      // already there when the student comes back.
      bumpContentVersion();
      router.replace(`/post/${created.id}`);
    } catch (caught) {
      setError(t(uploadErrorKey(caught)));
    } finally {
      setPublishing(false);
    }
  };

  const canPublish = (body.trim().length > 0 || attachment !== null) && !publishing && !uploading;

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text accessibilityRole="header" variant="title">
          {t('compose.title')}
        </Text>
        {/* 44 px and far from Publish: dismissal genuinely loses the text,
            because there is no draft persistence to fall back on. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('action.cancel')}
          onPress={() => router.back()}
          hitSlop={10}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <Ionicons name="close" size={24} color={theme.colors.text} />
        </Pressable>
      </View>

      <TextInput
        accessibilityLabel={t('compose.placeholder')}
        placeholder={t('compose.placeholder')}
        placeholderTextColor={theme.colors.textMuted}
        value={body}
        onChangeText={setBody}
        multiline
        style={{
          minHeight: 140,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          color: theme.colors.text,
          padding: theme.spacing.lg,
          fontSize: 16,
          lineHeight: 26,
          textAlign: theme.isRTL ? 'right' : 'left',
          textAlignVertical: 'top',
          writingDirection: theme.isRTL ? 'rtl' : 'ltr',
        }}
      />

      {/* Language is detected, never asked — classification.ts derives it. */}
      <Text variant="metadata" tone="muted">
        {t('compose.languageDetected')}
      </Text>

      {attachment ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Image
            source={{ uri: `${API_BASE_URL}${attachment.url}` }}
            accessibilityIgnoresInvertColors
            style={{
              width: '100%',
              aspectRatio:
                attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.background,
            }}
            resizeMode="cover"
          />
          <Button
            label={t('action.cancel')}
            variant="ghost"
            onPress={() => setAttachment(null)}
          />
        </View>
      ) : (
        <Button
          label={uploading ? t('compose.uploading') : t('compose.addImage')}
          variant="secondary"
          loading={uploading}
          onPress={() => void pickImage()}
          fullWidth
        />
      )}

      {/* The audience is the loudest decision and the only pre-selected
          control: a default nobody noticed is how a private note reaches a
          cohort. */}
      <View style={{ gap: theme.spacing.sm, display: groupId ? 'none' : 'flex' }}>
        <SectionHeader title={t('compose.whoCanSee')} />
        <ChoiceRow
          label={t('compose.whoCanSee')}
          options={VISIBILITY_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.key),
          }))}
          selected={visibility}
          onSelect={(next) => setVisibility(next)}
        />
      </View>

      {/*
       * Classification is optional and sits after the audience, because a post
       * nobody can see is worse than a post nobody classified. Tapping the
       * active chip clears it — the student can decline to label, and that is a
       * different state from having chosen "note".
       */}
      <View style={{ gap: theme.spacing.sm }}>
        <SectionHeader title={t('compose.whatKind')} trailing={t('compose.optional')} />
        <ChoiceRow
          label={`${t('compose.whatKind')}, ${t('compose.optional')}`}
          options={KNOWLEDGE_TYPES.map((value) => ({
            value,
            label: t(`knowledge.type.${value}` as TranslationKey),
          }))}
          selected={knowledgeType}
          onSelect={(next) => setKnowledgeType(next === knowledgeType ? null : next)}
        />
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <SectionHeader title={t('compose.difficulty')} trailing={t('compose.optional')} />
        <ChoiceRow
          label={`${t('compose.difficulty')}, ${t('compose.optional')}`}
          options={DIFFICULTIES.map((value) => ({
            value,
            label: t(`knowledge.difficulty.${value}` as TranslationKey),
          }))}
          selected={difficulty}
          onSelect={(next) => setDifficulty(next === difficulty ? null : next)}
        />
      </View>

      {error ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            borderStartWidth: 2,
            borderStartColor: theme.colors.challenged,
            paddingStart: 11,
          }}
        >
          <Text variant="metadata" tone="challenged">
            {error}
          </Text>
        </View>
      ) : null}
      <Text variant="metadata" tone="faint">
        {t('compose.clearHint')}
      </Text>

      <DominantAction
        label={t('compose.publish')}
        onPress={() => void publish()}
        loading={publishing}
        disabled={!canPublish}
      />
    </Screen>
  );
}

/**
 * A row of mutually exclusive chips.
 *
 * Announced as radios, which is what they are — the visibility control has
 * behaved this way since Phase 2 and the classification pickers reuse it rather
 * than inventing a second look for the same decision.
 */
function ChoiceRow<T extends string>({
  options,
  selected,
  onSelect,
  label,
}: {
  options: { value: T; label: string }[];
  selected: T | null;
  onSelect: (value: T) => void;
  /** Labels the radiogroup, so the section title is announced with the chips. */
  label: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}
    >
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => onSelect(option.value)}
            style={{
              borderRadius: theme.radius.pill,
              borderWidth: active ? 0 : 1.5,
              borderColor: theme.colors.borderStrong,
              // A choice made is an ink fill — the same weight the dominant
              // action carries, and never teal.
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
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function uploadErrorKey(caught: unknown): TranslationKey {
  if (caught instanceof NetworkError) return 'state.offline';
  if (caught instanceof ApiError) {
    if (caught.code === 'PAYLOAD_TOO_LARGE') return 'compose.error.tooLarge';
    if (caught.code === 'UNSUPPORTED_MEDIA_TYPE') return 'compose.error.unsupported';
  }
  return 'state.error.body';
}
