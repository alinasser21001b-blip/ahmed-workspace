import type { BlockedAccount } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { Text } from '../../src/components/Text';
import { Avatar, Card } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * The block list (App Review Guideline 1.2).
 *
 * Blocking without a way to see who is blocked is a capability that cannot be
 * verified or reversed by the person who used it — this is what closes that
 * gap. Unblocking is available inline; the blocked person is not notified
 * either way.
 */
export default function BlockedAccountsScreen(): React.JSX.Element {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [items, setItems] = useState<BlockedAccount[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      setItems(await api.get<BlockedAccount[]>('/v1/me/blocks'));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function unblock(handle: string): Promise<void> {
    setUnblocking(handle);
    try {
      await api.request(`/v1/profiles/${handle}/block`, { method: 'DELETE' });
      setItems((current) => current.filter((item) => item.profile.handle !== handle));
    } finally {
      setUnblocking(null);
    }
  }

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.profile.userId}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.sm, flexGrow: 1 }}
        ListHeaderComponent={
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              marginBottom: theme.spacing.lg,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('action.back')}
              onPress={() => router.back()}
              hitSlop={8}
            >
              <DirectionalIcon direction="back" size={24} color={theme.colors.text} />
            </Pressable>
            <Text variant="heading">{t('settings.blocked')}</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={{ minHeight: 200 }}>
            <EmptyState title={t('blocked.empty.title')} body={t('blocked.empty.body')} />
          </View>
        }
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Avatar name={item.profile.displayName} size={40} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" bidi="auto">
                  {item.profile.displayName}
                </Text>
                <Text variant="metadata" tone="muted">
                  {t('blocked.blockedSince', {
                    date: new Date(item.blockedAt).toLocaleDateString(locale),
                  })}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('blocked.unblock')}
                disabled={unblocking === item.profile.handle}
                onPress={() => void unblock(item.profile.handle)}
              >
                <Text variant="body" tone="primary">
                  {t('blocked.unblock')}
                </Text>
              </Pressable>
            </View>
          </Card>
        )}
      />
    </SafeAreaView>
  );
}
