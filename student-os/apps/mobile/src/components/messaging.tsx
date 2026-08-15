import { Ionicons } from '@expo/vector-icons';
import type { MessageState } from '@sos/core';
import { Pressable, View } from 'react-native';
import { useI18n, type TranslationKey } from '../i18n/index';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/**
 * Messaging primitives (09-COMPONENTS.md §Messaging, 15-MESSAGES.md).
 *
 * Own bubbles are **ink, not teal** — a sent message is own authorship, not
 * success, and teal means provenance and nothing else.
 */

/** Every state the contract defines. Turn 5 drew three; there are six. */
const STATE_KEY: Record<MessageState, TranslationKey> = {
  queued: 'chat.queued',
  sending: 'chat.sending',
  sent: 'chat.sent',
  delivered: 'chat.delivered',
  read: 'chat.read',
  failed: 'chat.failed',
};

export function MessageBubble({
  body,
  own,
  senderName,
  state,
  deleted = false,
  onRetry,
}: {
  body: string;
  own: boolean;
  /** Shown only in a group, and only for someone else's message. */
  senderName?: string | null;
  state: MessageState;
  deleted?: boolean;
  onRetry?: (() => void) | undefined;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useI18n();

  const inFlight = state === 'queued' || state === 'sending';
  const failed = state === 'failed';
  const text = deleted ? t('chat.deletedMessage') : body;

  return (
    <View
      accessibilityLabel={
        own
          ? `${t('chat.youPrefix')}: ${text}, ${t(STATE_KEY[state])}`
          : `${senderName ? `${senderName}: ` : ''}${text}`
      }
      style={{
        alignSelf: own ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        backgroundColor: own ? theme.colors.text : theme.colors.surface,
        borderRadius: 12,
        borderWidth: own ? 0 : 1,
        borderColor: theme.colors.border,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        gap: 2,
        opacity: inFlight ? 0.6 : 1,
      }}
    >
      {!own && senderName ? (
        <Text variant="metadata" tone="muted" bidi="auto">
          {senderName}
        </Text>
      ) : null}

      <Text
        variant="body"
        tone={own ? 'inverse' : deleted ? 'muted' : 'default'}
        bidi="auto"
        style={deleted ? { fontStyle: 'italic' } : undefined}
      >
        {text}
      </Text>

      {/* State is own-only, and it is always a word — never a tick glyph
          alone, which no screen reader and no greyscale rendering can read. */}
      {own && !deleted ? (
        <View
          accessible={false}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            alignSelf: 'flex-end',
          }}
        >
          <Text
            variant="metadata"
            style={{ color: failed ? theme.colors.challenged : theme.colors.borderStrong }}
          >
            {t(STATE_KEY[state])}
          </Text>
          {failed && onRetry ? (
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel={t('chat.retrySend')}
              onPress={onRetry}
              hitSlop={12}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}
            >
              <Ionicons name="refresh" size={16} color={theme.colors.challenged} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The unread divider.
 *
 * Pinned at the read position captured on entry and immutable for the session:
 * a divider that slides as messages arrive tells you nothing.
 */
export function UnreadDivider(): React.JSX.Element {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View
      accessibilityLabel={t('chat.unreadDividerA11y')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.structure }} />
      <Text variant="metadata" tone="structure" style={{ fontWeight: '600' }}>
        {t('chat.unreadDivider')}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.structure }} />
    </View>
  );
}
