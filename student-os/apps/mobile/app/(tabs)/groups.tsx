import Ionicons from '@expo/vector-icons/Ionicons';
import type { Group } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '../../src/components/Text';
import { Badge, Card } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Groups (§59).
 *
 * Two lists behind one control: the groups you are in, and the ones you could
 * join. Discovery is a separate scope rather than a mixed list, because "my
 * groups" is a place you return to and "discover" is a place you browse — and a
 * list that quietly mixes them makes the first one unreliable.
 */

type Scope = 'mine' | 'discover';

export default function Groups(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [scope, setScope] = useState<Scope>('mine');
  const [items, setItems] = useState<Group[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'refreshing'>('loading');

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial'): Promise<void> => {
      setStatus(mode === 'refresh' ? 'refreshing' : 'loading');
      try {
        const page = await api.get<{ items: Group[] }>(`/v1/groups?scope=${scope}&limit=30`);
        setItems(page.items);
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    },
    [api, scope],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="display">{t('groups.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('groups.create')}
          onPress={() => router.push('/group/new')}
          hitSlop={8}
        >
          <Ionicons name="add-circle-outline" size={26} color={theme.colors.primary} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {(['mine', 'discover'] as Scope[]).map((option) => {
          const active = scope === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setScope(option)}
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
                {t(option === 'mine' ? 'groups.tab.mine' : 'groups.tab.discover')}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  if (status === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
        <View style={{ flex: 1, padding: theme.spacing.lg }}>
          <ErrorState onRetry={() => void load()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <FlatList
        data={items}
        keyExtractor={(group) => group.id}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.md,
          flexGrow: 1,
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          status === 'loading' ? (
            <View style={{ minHeight: 220 }}>
              <LoadingState />
            </View>
          ) : (
            <View style={{ flex: 1, minHeight: 240 }}>
              <EmptyState
                title={t(scope === 'mine' ? 'groups.empty.title' : 'groups.discover.empty.title')}
                body={t(scope === 'mine' ? 'groups.empty.body' : 'groups.discover.empty.body')}
                action={{ label: t('groups.create'), onPress: () => router.push('/group/new') }}
              />
            </View>
          )
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/group/${item.id}`)} accessibilityLabel={item.name}>
            <View style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {item.name}
                </Text>
                {/* An unlisted group is worth marking: its members should know
                    it is not discoverable. */}
                {item.visibility === 'group' ? (
                  <Ionicons name="lock-closed-outline" size={16} color={theme.colors.textMuted} />
                ) : null}
                {item.pendingRequestCount ? (
                  <Badge label={String(item.pendingRequestCount)} tone="warning" />
                ) : null}
              </View>

              {item.description ? (
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Text variant="micro" tone="muted">
                  {t('groups.members.count', { count: item.memberCount })}
                </Text>
                {item.courseName ? <Badge label={item.courseName} tone="learning" /> : null}
                {item.viewer.membershipStatus === 'pending' ? (
                  <Badge label={t('groups.join.pending')} tone="warning" />
                ) : null}
                {item.viewer.membershipStatus === 'invited' ? (
                  <Badge label={t('groups.join.invited')} tone="primary" />
                ) : null}
              </View>
            </View>
          </Card>
        )}
        refreshControl={
          <RefreshControl
            refreshing={status === 'refreshing'}
            onRefresh={() => void load('refresh')}
            tintColor={theme.colors.primary}
          />
        }
      />
    </SafeAreaView>
  );
}
