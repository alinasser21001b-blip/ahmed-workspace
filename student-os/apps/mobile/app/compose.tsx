import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContentItem, FileRef, Visibility } from '@sos/contracts';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, TextInput, View } from 'react-native';
import { ApiError, NetworkError } from '../src/api/client';
import { Button } from '../src/components/Button';
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
        <Text variant="title">{t('compose.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('action.cancel')}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="close" size={24} color={theme.colors.textMuted} />
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

      <View style={{ gap: theme.spacing.sm, display: groupId ? 'none' : 'flex' }}>
        <Text variant="label" tone="muted">
          {t('compose.visibility')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {VISIBILITY_OPTIONS.map((option) => {
            const active = visibility === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setVisibility(option.value)}
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
                  {t(option.key)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <Button
        label={t('compose.publish')}
        onPress={() => void publish()}
        loading={publishing}
        disabled={!canPublish}
        size="lg"
        fullWidth
      />
    </Screen>
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
