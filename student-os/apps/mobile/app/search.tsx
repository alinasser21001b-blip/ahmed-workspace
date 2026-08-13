import type { SearchResults } from '@sos/contracts';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { DirectionalIcon } from '../src/components/DirectionalIcon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '../src/components/Text';
import { Avatar, Badge, Card, SectionHeader } from '../src/components/surfaces';
import { EmptyState, LoadingState } from '../src/components/states';
import { useI18n } from '../src/i18n/index';
import { useSession } from '../src/state/session';
import { useTheme } from '../src/theme/ThemeProvider';

/**
 * Search (§32).
 *
 * Debounced, and cancelled on every keystroke — an in-flight request for a
 * stale query that lands after a newer one would flip the results back to what
 * the student was typing two letters ago.
 */

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

export default function Search(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY) {
      setResults(null);
      return;
    }

    const timer = setTimeout(() => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setSearching(true);
      void api
        .request<SearchResults>(`/v1/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        })
        .then((response) => {
          if (!controller.signal.aborted) setResults(response);
        })
        .catch(() => {
          if (!controller.signal.aborted) setResults(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [api, query]);

  const total =
    (results?.people.length ?? 0) +
    (results?.content.length ?? 0) +
    (results?.groups.length ?? 0) +
    (results?.communities.length ?? 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
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
        <TextInput
          accessibilityLabel={t('search.placeholder')}
          placeholder={t('search.placeholder')}
          placeholderTextColor={theme.colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: theme.radius.pill,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            color: theme.colors.text,
            paddingHorizontal: theme.spacing.lg,
            fontSize: 16,
            textAlign: theme.isRTL ? 'right' : 'left',
            writingDirection: theme.isRTL ? 'rtl' : 'ltr',
          }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.xl,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {query.trim().length < MIN_QUERY ? (
          <Text variant="caption" tone="muted">
            {t('search.hint')}
          </Text>
        ) : searching && !results ? (
          <View style={{ minHeight: 200 }}>
            <LoadingState />
          </View>
        ) : total === 0 ? (
          <View style={{ flex: 1, minHeight: 240 }}>
            <EmptyState title={t('search.empty.title')} body={t('search.empty.body')} />
          </View>
        ) : (
          <>
            {results!.people.length > 0 ? (
              <View>
                <SectionHeader title={t('search.section.people')} />
                <View style={{ gap: theme.spacing.sm }}>
                  {results!.people.map((person) => (
                    <Card
                      key={person.userId}
                      onPress={() => router.push(`/profile/${person.handle}`)}
                      accessibilityLabel={person.displayName}
                    >
                      <View
                        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                      >
                        <Avatar name={person.displayName} size={36} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="label" bidi="auto">{person.displayName}</Text>
                          <Text variant="micro" tone="muted">
                            @{person.handle}
                            {person.stageName ? ` · ${person.stageName}` : ''}
                          </Text>
                        </View>
                      </View>
                    </Card>
                  ))}
                </View>
              </View>
            ) : null}

            {results!.groups.length > 0 ? (
              <View>
                <SectionHeader title={t('search.section.groups')} />
                <View style={{ gap: theme.spacing.sm }}>
                  {results!.groups.map((group) => (
                    <Card
                      key={group.id}
                      onPress={() => router.push(`/group/${group.id}`)}
                      accessibilityLabel={group.name}
                    >
                      <View style={{ gap: theme.spacing.xs }}>
                        <Text variant="label" bidi="auto">{group.name}</Text>
                        <Text variant="micro" tone="muted">
                          {t('groups.members.count', { count: group.memberCount })}
                        </Text>
                      </View>
                    </Card>
                  ))}
                </View>
              </View>
            ) : null}

            {results!.content.length > 0 ? (
              <View>
                <SectionHeader title={t('search.section.content')} />
                <View style={{ gap: theme.spacing.sm }}>
                  {results!.content.map((hit) => (
                    <Card
                      key={hit.id}
                      onPress={() => router.push(`/post/${hit.id}`)}
                      accessibilityLabel={hit.body ?? ''}
                    >
                      <View style={{ gap: theme.spacing.xs }}>
                        <Text variant="body" numberOfLines={3} bidi="auto">
                          {hit.body}
                        </Text>
                        <Text variant="micro" tone="muted" bidi="auto">
                          {hit.author.displayName}
                        </Text>
                      </View>
                    </Card>
                  ))}
                </View>
              </View>
            ) : null}

            {results!.communities.length > 0 ? (
              <View>
                <SectionHeader title={t('search.section.communities')} />
                <View style={{ gap: theme.spacing.sm }}>
                  {results!.communities.map((community) => (
                    <Card key={community.id}>
                      <View
                        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
                      >
                        <Text variant="label" style={{ flex: 1 }}>
                          {community.name}
                        </Text>
                        {community.isOfficial ? (
                          <Badge label={t('communities.title')} tone="primary" />
                        ) : null}
                      </View>
                    </Card>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
