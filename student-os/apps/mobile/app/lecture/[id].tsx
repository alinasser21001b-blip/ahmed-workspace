import type { ContentItem, FeedPage, FileRef, LectureDetail } from '@sos/contracts';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/Button';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { Input } from '../../src/components/Input';
import { PostCard } from '../../src/components/PostCard';
import { Badge, Card, SectionHeader } from '../../src/components/surfaces';
import { Text } from '../../src/components/Text';
import { ErrorState, LoadingState } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { API_BASE_URL, useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * A lecture.
 *
 * The hub the schema has described since Phase 0: the instructor's own text,
 * the objectives, the key concepts, the topics it belongs to, and the
 * materials. `aiSummary` has its own slot and is rendered separately from
 * anything a human wrote — it is null until Phase 6, and the separation exists
 * now so the two can never be confused later.
 *
 * Material URLs arrive already signed, minted for this reader after the server
 * checked their classroom membership. The client never constructs one.
 *
 * Two affordances below the lecture are permission-shaped rather than decorative.
 * The discussion is open to every member, because a classroom where only staff
 * may write is a broadcast channel and the questions are half the value. Adding
 * a material is not: it is drawn only when the server has said `viewer.canTeach`,
 * and the server refuses it regardless of what this screen chose to draw.
 */
export default function LectureScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [lecture, setLecture] = useState<LectureDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [marking, setMarking] = useState(false);

  const [discussion, setDiscussion] = useState<ContentItem[]>([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const [materialTitle, setMaterialTitle] = useState('');
  const [materialFile, setMaterialFile] = useState<FileRef | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attaching, setAttaching] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      setLecture(await api.get<LectureDetail>(`/v1/lectures/${id}`));
      /*
       * The thread is scoped by the server to this lecture inside this
       * classroom. A lecture id from another room returns an empty page rather
       * than its posts, because `lectureId` narrows the feed's permission
       * predicate and never widens it.
       */
      const page = await api.get<FeedPage>(`/v1/lectures/${id}/discussion?limit=30`);
      setDiscussion(page.items);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (): Promise<void> => {
    setMarking(true);
    try {
      await api.request(`/v1/lectures/${id}/progress`, {
        method: 'PUT',
        body: { percent: 100 },
      });
      await load();
    } catch {
      setStatus('error');
    } finally {
      setMarking(false);
    }
  };

  const askQuestion = async (): Promise<void> => {
    const text = draft.trim();
    if (text.length === 0) return;
    setPosting(true);
    try {
      /*
       * No visibility is sent. The server forces `classroom`, so a client
       * cannot use this route to publish a post made inside a room to the
       * whole stage.
       */
      const created = await api.post<ContentItem>(`/v1/lectures/${id}/discussion`, { body: text });
      setDiscussion((current) => [created, ...current]);
      setDraft('');
    } catch {
      setStatus('error');
    } finally {
      setPosting(false);
    }
  };

  /*
   * The same picker and the same `/v1/files` upload the composer has used since
   * Phase 2. A material is an ordinary uploaded file that `addMaterial` then
   * places into the classroom — there is no second storage path for teaching
   * content, and adding one is how a file ends up outside the permission model.
   */
  const pickMaterialFile = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      const form = new FormData();
      // React Native and web disagree on what a file looks like in FormData.
      if (asset.file) {
        form.append('file', asset.file);
      } else {
        form.append('file', {
          uri: asset.uri,
          name: asset.fileName ?? 'material.jpg',
          type: asset.mimeType ?? 'image/jpeg',
        } as unknown as Blob);
      }
      setMaterialFile(await api.upload<FileRef>('/v1/files', form));
    } catch {
      setStatus('error');
    } finally {
      setUploading(false);
    }
  };

  const attachMaterial = async (): Promise<void> => {
    if (!materialFile || materialTitle.trim().length === 0) return;
    setAttaching(true);
    try {
      await api.post(`/v1/lectures/${id}/materials`, {
        title: materialTitle.trim(),
        fileId: materialFile.id,
      });
      setMaterialTitle('');
      setMaterialFile(null);
      await load();
    } catch {
      setStatus('error');
    } finally {
      setAttaching(false);
    }
  };

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error' || !lecture) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
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
        }}
      >
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
            <Text variant="heading" bidi="auto">
              {lecture.title}
            </Text>
            {lecture.author ? (
              <Text variant="micro" tone="muted" bidi="auto">
                {lecture.author.displayName}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
          {!lecture.publishedAt ? <Badge label={t('lecture.draft')} tone="warning" /> : null}
          {lecture.durationMinutes ? (
            <Badge label={`${lecture.durationMinutes} ${t('lecture.duration')}`} tone="neutral" />
          ) : null}
          {lecture.topics.map((topic) => (
            <Badge
              key={topic.id}
              label={topic.name}
              tone="primary"
              onPress={() => router.push(`/topic/${topic.id}`)}
            />
          ))}
        </View>

        {lecture.description ? (
          <Text variant="body" bidi="auto">
            {lecture.description}
          </Text>
        ) : null}

        {lecture.learningObjectives.length > 0 ? (
          <View>
            <SectionHeader title={t('lecture.objectives')} />
            <View style={{ gap: theme.spacing.xs }}>
              {lecture.learningObjectives.map((objective) => (
                <Text key={objective} variant="body" bidi="auto">
                  •  {objective}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        {lecture.keyConcepts.length > 0 ? (
          <View>
            <SectionHeader title={t('lecture.concepts')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              {lecture.keyConcepts.map((concept) => (
                <Badge key={concept} label={concept} tone="learning" />
              ))}
            </View>
          </View>
        ) : null}

        <View>
          <SectionHeader title={t('lecture.materials')} />
          {lecture.materials.length === 0 ? (
            <Text variant="caption" tone="muted">
              {t('lecture.materials.empty')}
            </Text>
          ) : (
            <View style={{ gap: theme.spacing.md }}>
              {lecture.materials.map((material) => {
                /*
                 * `file.url` is relative and already signed by the server; the
                 * external link is whatever the instructor typed. Both are
                 * opened rather than fetched, because a material is a document
                 * the student reads, not something this screen renders.
                 */
                const href = material.file
                  ? `${API_BASE_URL}${material.file.url}`
                  : material.externalUrl;
                return (
                  <Card key={material.id}>
                    <View style={{ gap: theme.spacing.xs }}>
                      <Text variant="bodyStrong" bidi="auto">
                        {material.title}
                      </Text>
                      {material.description ? (
                        <Text variant="caption" tone="muted" bidi="auto">
                          {material.description}
                        </Text>
                      ) : null}
                      {href ? (
                        <Button
                          label={t('lecture.open')}
                          variant="secondary"
                          onPress={() => void Linking.openURL(href)}
                        />
                      ) : null}
                    </View>
                  </Card>
                );
              })}
            </View>
          )}

          {lecture.viewer.canTeach ? (
            <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
              <Text variant="label" tone="muted">
                {t('lecture.material.add')}
              </Text>
              <Input
                label={t('lecture.material.title')}
                placeholder={t('lecture.material.title.placeholder')}
                value={materialTitle}
                onChangeText={setMaterialTitle}
              />
              <Button
                label={
                  uploading
                    ? t('lecture.material.uploading')
                    : materialFile
                      ? t('lecture.material.picked')
                      : t('lecture.material.pick')
                }
                variant="secondary"
                loading={uploading}
                onPress={() => void pickMaterialFile()}
                fullWidth
              />
              <Button
                label={t('lecture.material.attach')}
                variant="learning"
                loading={attaching}
                disabled={!materialFile || materialTitle.trim().length === 0}
                onPress={() => void attachMaterial()}
                fullWidth
              />
            </View>
          ) : null}
        </View>

        <View>
          <SectionHeader title={t('lecture.discussion')} />
          <Text variant="micro" tone="muted">
            {t('lecture.discussion.scope')}
          </Text>

          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
            <TextInput
              accessibilityLabel={t('lecture.discussion.placeholder')}
              placeholder={t('lecture.discussion.placeholder')}
              placeholderTextColor={theme.colors.textMuted}
              value={draft}
              onChangeText={setDraft}
              multiline
              style={{
                minHeight: 80,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                color: theme.colors.text,
                padding: theme.spacing.md,
                fontSize: 16,
                lineHeight: 26,
                textAlign: theme.isRTL ? 'right' : 'left',
                textAlignVertical: 'top',
                writingDirection: theme.isRTL ? 'rtl' : 'ltr',
              }}
            />
            <Button
              label={t('lecture.discussion.send')}
              variant="secondary"
              loading={posting}
              disabled={draft.trim().length === 0}
              onPress={() => void askQuestion()}
              fullWidth
            />
          </View>

          {discussion.length === 0 ? (
            <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.md }}>
              {t('lecture.discussion.empty')}
            </Text>
          ) : (
            <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.md }}>
              {discussion.map((item) => (
                <PostCard
                  key={item.id}
                  item={item}
                  onPress={() => router.push(`/post/${item.id}`)}
                />
              ))}
            </View>
          )}
        </View>

        {lecture.viewer.completedAt ? (
          <Badge label={t('lecture.completed')} tone="learning" />
        ) : (
          <Button
            label={t('lecture.markRead')}
            variant="learning"
            fullWidth
            loading={marking}
            onPress={() => void markRead()}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
