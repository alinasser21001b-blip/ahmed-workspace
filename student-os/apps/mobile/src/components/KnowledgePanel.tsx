import type {
  ContentCorrection,
  ContentItem,
  ContentSource,
  SourceKind,
} from '@sos/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';
import { useI18n, type TranslationKey } from '../i18n/index';
import { useSession } from '../state/session';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Text } from './Text';
import { Badge, Card, Divider, SectionHeader } from './surfaces';

/**
 * Sources and corrections, on the post they belong to.
 *
 * This is where the Phase 5 claim becomes visible to a student: a piece of
 * knowledge is not just a body of text but a body of text plus what backs it
 * and what has been said against it. Both lists live on the post rather than
 * in the comment thread, because a reader arriving in six months must see them
 * whether or not they read the discussion.
 *
 * Everything is a row someone wrote, attributed to them. There is no computed
 * trust number anywhere on this screen (ADR-0013).
 */

const SOURCE_KINDS: SourceKind[] = [
  'textbook',
  'lecture',
  'guideline',
  'paper',
  'website',
  'other',
];

export function KnowledgePanel({
  item,
  onChanged,
}: {
  item: ContentItem;
  /** Signals live on the content, so the parent refetches when they move. */
  onChanged?: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api, user } = useSession();

  const [sources, setSources] = useState<ContentSource[]>([]);
  const [corrections, setCorrections] = useState<ContentCorrection[]>([]);
  const [composing, setComposing] = useState<'source' | 'correction' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [nextSources, nextCorrections] = await Promise.all([
        api.get<ContentSource[]>(`/v1/content/${item.id}/sources`),
        api.get<ContentCorrection[]>(`/v1/content/${item.id}/corrections`),
      ]);
      setSources(nextSources);
      setCorrections(nextCorrections);
    } catch {
      /*
       * Provenance is additional to the post, not a precondition for reading
       * it. A failure here leaves the panel empty rather than replacing the
       * content the student came for with an error.
       */
    }
  }, [api, item.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const after = async (work: Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await work;
      setComposing(null);
      await load();
      onChanged?.();
    } catch {
      /* The list is unchanged; the student can try again. */
    } finally {
      setBusy(false);
    }
  };

  const open = corrections.filter((correction) => correction.status === 'proposed');
  const resolved = corrections.filter((correction) => correction.status !== 'proposed');

  return (
    <View style={{ gap: theme.spacing.xl }}>
      {/* --- sources --------------------------------------------------- */}
      <View>
        <SectionHeader
          title={t('knowledge.sources')}
          action={
            composing === null
              ? { label: t('knowledge.sources.add'), onPress: () => setComposing('source') }
              : undefined
          }
        />

        {composing === 'source' ? (
          <SourceForm
            busy={busy}
            onCancel={() => setComposing(null)}
            onSubmit={(body) =>
              void after(api.post(`/v1/content/${item.id}/sources`, body))
            }
          />
        ) : sources.length === 0 ? (
          <Text variant="caption" tone="muted">
            {t('knowledge.sources.empty')}
          </Text>
        ) : (
          <View style={{ gap: theme.spacing.md }}>
            {sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                /*
                 * The server also lets whoever can delete the content remove a
                 * citation; the client only offers the case it can be certain
                 * of, so no visible control can fail on tap.
                 */
                canRemove={source.addedBy !== null && source.addedBy.userId === user?.id}
                onRemove={() =>
                  void after(
                    api.request(`/v1/content/${item.id}/sources/${source.id}`, {
                      method: 'DELETE',
                    }),
                  )
                }
              />
            ))}
          </View>
        )}
      </View>

      {/* --- corrections ------------------------------------------------ */}
      <View>
        <SectionHeader
          title={t('knowledge.corrections')}
          action={
            /*
             * An author corrects their own content by editing it, so the
             * control is absent for them rather than present and rejected by
             * the server.
             */
            composing === null && !item.viewer.isAuthor
              ? {
                  label: t('knowledge.corrections.propose'),
                  onPress: () => setComposing('correction'),
                }
              : undefined
          }
        />

        {composing === 'correction' ? (
          <CorrectionForm
            busy={busy}
            onCancel={() => setComposing(null)}
            onSubmit={(body) =>
              void after(
                api.post(`/v1/content/${item.id}/corrections`, { body, source: null }),
              )
            }
          />
        ) : corrections.length === 0 ? (
          <Text variant="caption" tone="muted">
            {t('knowledge.corrections.empty')}
          </Text>
        ) : (
          <View style={{ gap: theme.spacing.md }}>
            {[...open, ...resolved].map((correction) => (
              <CorrectionRow
                key={correction.id}
                correction={correction}
                canResolve={item.viewer.isAuthor && correction.status === 'proposed'}
                onResolve={(status) =>
                  void after(
                    api.request(`/v1/content/${item.id}/corrections/${correction.id}`, {
                      method: 'PATCH',
                      body: { status },
                    }),
                  )
                }
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function SourceRow({
  source,
  canRemove,
  onRemove,
}: {
  source: ContentSource;
  canRemove: boolean;
  onRemove: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();

  return (
    <Card>
      <View style={{ gap: theme.spacing.xs }}>
        <Badge label={t(`knowledge.source.kind.${source.kind}` as TranslationKey)} tone="learning" />
        <Text variant="body" bidi="auto">
          {source.citation}
          {source.pageRef ? ` · ${source.pageRef}` : ''}
        </Text>
        {source.url ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={source.url}
            onPress={() => void Linking.openURL(source.url!)}
          >
            <Text variant="micro" tone="primary" numberOfLines={1}>
              {source.url}
            </Text>
          </Pressable>
        ) : null}
        {/* Who made the claim. Not always the author — a classmate finding the
            textbook page is exactly the behaviour this is meant to reward. */}
        {source.addedBy ? (
          <Text variant="micro" tone="muted" bidi="auto">
            {source.addedBy.displayName}
          </Text>
        ) : null}
        {canRemove ? (
          <Button label={t('knowledge.sources.remove')} variant="ghost" onPress={onRemove} />
        ) : null}
      </View>
    </Card>
  );
}

function CorrectionRow({
  correction,
  canResolve,
  onResolve,
}: {
  correction: ContentCorrection;
  canResolve: boolean;
  onResolve: (status: 'accepted' | 'rejected') => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();

  const tone =
    correction.status === 'accepted'
      ? 'danger'
      : correction.status === 'proposed'
        ? 'warning'
        : 'neutral';

  return (
    <Card>
      <View style={{ gap: theme.spacing.sm }}>
        <Badge
          label={t(`knowledge.corrections.status.${correction.status}` as TranslationKey)}
          tone={tone}
        />
        <Text variant="body" bidi="auto">
          {correction.body}
        </Text>
        {correction.proposedBy ? (
          <Text variant="micro" tone="muted" bidi="auto">
            {correction.proposedBy.displayName}
          </Text>
        ) : null}

        {canResolve ? (
          <>
            <Divider />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={t('knowledge.corrections.accept')}
                  variant="learning"
                  fullWidth
                  onPress={() => onResolve('accepted')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={t('knowledge.corrections.reject')}
                  variant="secondary"
                  fullWidth
                  onPress={() => onResolve('rejected')}
                />
              </View>
            </View>
          </>
        ) : null}
      </View>
    </Card>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  multiline?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        style={{
          minHeight: multiline ? 96 : 44,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.background,
          color: theme.colors.text,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          fontSize: 16,
          textAlign: theme.isRTL ? 'right' : 'left',
          writingDirection: theme.isRTL ? 'rtl' : 'ltr',
        }}
      />
    </View>
  );
}

function SourceForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: {
    kind: SourceKind;
    citation: string;
    url: string | null;
    fileId: null;
    pageRef: string | null;
  }) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const [kind, setKind] = useState<SourceKind>('textbook');
  const [citation, setCitation] = useState('');
  const [pageRef, setPageRef] = useState('');

  // Mirrors the server's `min(3)` so the control is disabled rather than
  // producing a 400 the student has to interpret.
  const valid = citation.trim().length >= 3;

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
        {SOURCE_KINDS.map((option) => (
          <Badge
            key={option}
            label={t(`knowledge.source.kind.${option}` as TranslationKey)}
            tone={kind === option ? 'primary' : 'neutral'}
            onPress={() => setKind(option)}
          />
        ))}
      </View>
      <Field
        label={t('knowledge.sources')}
        value={citation}
        onChangeText={setCitation}
        placeholder={t('knowledge.source.citation.placeholder')}
      />
      <Field
        label={t('knowledge.source.pageRef')}
        value={pageRef}
        onChangeText={setPageRef}
        placeholder={t('knowledge.source.pageRef.placeholder')}
      />
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label={t('action.save')}
            variant="learning"
            fullWidth
            loading={busy}
            disabled={!valid}
            onPress={() =>
              onSubmit({
                kind,
                citation: citation.trim(),
                url: null,
                fileId: null,
                pageRef: pageRef.trim() === '' ? null : pageRef.trim(),
              })
            }
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={t('action.cancel')} variant="secondary" fullWidth onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}

function CorrectionForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const [body, setBody] = useState('');
  const valid = body.trim().length >= 10;

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Field
        label={t('knowledge.corrections.propose')}
        value={body}
        onChangeText={setBody}
        placeholder={t('knowledge.corrections.placeholder')}
        multiline
      />
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label={t('action.save')}
            variant="learning"
            fullWidth
            loading={busy}
            disabled={!valid}
            onPress={() => onSubmit(body.trim())}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={t('action.cancel')} variant="secondary" fullWidth onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}
