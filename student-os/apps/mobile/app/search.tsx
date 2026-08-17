import type { SearchResults } from '@sos/contracts';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MetadataLine, SectionHeader } from '../src/components/editorial';
import { DirectionalIcon } from '../src/components/DirectionalIcon';
import { AcademicRow } from '../src/components/rows';
import { Avatar } from '../src/components/surfaces';
import { Text } from '../src/components/Text';
import { localizeDigits, useI18n } from '../src/i18n/index';
import { useSession } from '../src/state/session';
import { useTheme } from '../src/theme/ThemeProvider';
import { Enter } from '../src/motion/index';

/**
 * Search — per 16-SEARCH.md.
 *
 * One language, four objects: a section heading naming the type, then rows of
 * a title plus one metadata line. The heading carries the type, so a row never
 * repeats it, and there is no second card system.
 *
 * Only the four result classes the contract actually returns are rendered.
 * Topics and classrooms are specified in the handoff and BLOCKED — no endpoint
 * exists — so they are stated as unavailable rather than faked. That line is
 * the honest version of the product's largest gap.
 *
 * The empty-result advice says "try a shorter word" rather than "try different
 * keywords", because the index is trigram-based: prefix matching works and
 * root matching does not, so shorter is the advice that actually helps.
 */

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

export default function Search(): React.JSX.Element {
  const { t, locale } = useI18n();
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

  const term = query.trim();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* The field is pinned: results scroll under it, it never scrolls away.
          No screen title — frame 5c gives the whole top row to the back
          control and the pill field, because on this screen the query IS the
          title. */}
      <View
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('action.back')}
          onPress={() => router.back()}
          hitSlop={10}
          style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
        >
          <DirectionalIcon direction="back" size={22} color={theme.colors.text} />
        </Pressable>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            borderWidth: 1,
            borderColor: theme.colors.borderStrong,
            borderRadius: theme.radius.pill,
            paddingHorizontal: theme.spacing.lg,
            minHeight: 50,
          }}
        >
          <Ionicons name="search-outline" size={18} color={theme.colors.textMuted} />
          <TextInput
            accessibilityRole="search"
            accessibilityLabel={t('search.placeholder')}
            placeholder={t('search.placeholder')}
            placeholderTextColor={theme.colors.textFaint}
            value={query}
            onChangeText={setQuery}
            autoFocus
            returnKeyType="search"
            style={{
              flex: 1,
              // Web: a flex item will not shrink below its placeholder's
              // intrinsic width without this, and the placeholder is a full
              // sentence — that was a 22 px page overflow at 360.
              minWidth: 0,
              color: theme.colors.text,
              fontSize: 16,
              lineHeight: 22,
              // The typed script decides the field's direction.
              textAlign: theme.isRTL ? 'right' : 'left',
            }}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('action.clear')}
              onPress={() => setQuery('')}
              hitSlop={10}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.xl,
        }}
      >
        {/* Results announce politely — never assertively, which would
            interrupt a student mid-read on every keystroke. */}
        <View accessibilityLiveRegion="polite">
          {term.length > 0 && term.length < MIN_QUERY ? (
            <Text variant="metadata" tone="muted">
              {t('search.minQuery')}
            </Text>
          ) : null}

          {results && total === 0 && !searching ? (
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="bodyStrong" bidi="auto">
                {t('search.noResultsFor', { query: term })}
              </Text>
              <Text variant="body" tone="secondary">
                {t('search.tryShorter')}
              </Text>
            </View>
          ) : null}
        </View>

        {/*
         * The results settle once per result set, not per row. Search has to
         * feel instant, so this is `settle` on the group rather than a
         * staggered cascade down the list — a stagger here would make a fast
         * answer look slow.
         */}
        <Enter trigger={results} rise={4}>
        {results && results.people.length > 0 ? (
          <View>
            <SectionHeader
              title={t('search.people')}
              trailing={localizeDigits(locale, results.people.length)}
            />
            {results.people.map((person) => (
              <AcademicRow
                key={person.userId}
                minHeight={56}
                chevron
                onPress={() => router.push(`/profile/${person.handle}`)}
                accessibilityLabel={`${person.displayName}, @${person.handle}`}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <Avatar name={person.displayName} size={36} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="body" numberOfLines={1} bidi="auto">
                      {person.displayName}
                    </Text>
                    {/* The handle is a Latin run and stays isolated in Arabic. */}
                    <MetadataLine parts={[`@${person.handle}`, person.stageName]} bidi="auto" />
                  </View>
                </View>
              </AcademicRow>
            ))}
          </View>
        ) : null}

        {results && results.groups.length > 0 ? (
          <View>
            <SectionHeader
              title={t('search.studyGroups')}
              trailing={localizeDigits(locale, results.groups.length)}
            />
            {results.groups.map((group) => (
              <AcademicRow
                key={group.id}
                chevron
                onPress={() => router.push(`/group/${group.id}`)}
                accessibilityLabel={`${group.name}, ${t('classroom.members.count', { count: group.memberCount })}`}
              >
                <View style={{ gap: 2 }}>
                  <Text variant="body" numberOfLines={1} bidi="auto">
                    {group.name}
                  </Text>
                  <MetadataLine
                    parts={[t('classroom.members.count', { count: group.memberCount })]}
                  />
                </View>
              </AcademicRow>
            ))}
          </View>
        ) : null}

        {results && results.communities.length > 0 ? (
          <View>
            <SectionHeader
              title={t('search.communities')}
              trailing={localizeDigits(locale, results.communities.length)}
            />
            {results.communities.map((community) => (
              <AcademicRow key={community.id} chevron accessibilityLabel={community.name}>
                <View style={{ gap: 2 }}>
                  <Text variant="body" numberOfLines={1} bidi="auto">
                    {community.name}
                  </Text>
                  <MetadataLine
                    parts={[community.isOfficial ? t('search.official') : null]}
                    tone="structure"
                  />
                </View>
              </AcademicRow>
            ))}
          </View>
        ) : null}

        {results && results.content.length > 0 ? (
          <View>
            <SectionHeader
              title={t('search.knowledge')}
              trailing={localizeDigits(locale, results.content.length)}
            />
            {results.content.map((entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                onPress={() => router.push(`/post/${entry.id}`)}
                style={{ borderTopWidth: 1, borderTopColor: theme.colors.border }}
              >
                {/*
                 * Knowledge is the only result type in the editorial voice,
                 * because it is the only one whose content IS what you are
                 * reading. The search endpoint returns a reduced shape, so
                 * this renders body + author directly rather than pretending
                 * to a full ContentGrammar it does not have the fields for.
                 */}
                <View style={{ paddingVertical: theme.spacing.md, gap: theme.spacing.xs }}>
                  <Text variant="bodyStrong" numberOfLines={3} bidi="auto" style={{ fontWeight: '500' }}>
                    {entry.body ?? ''}
                  </Text>
                  <MetadataLine parts={[entry.author.displayName, entry.author.stageName]} bidi="auto" />
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
        </Enter>

        {/*
         * Stated, not hidden. Topics are the most navigable object in the
         * product and are unreachable from the screen whose only job is
         * navigation — the handoff calls this the largest gap, so the screen
         * says so rather than quietly omitting a section.
         */}
        {results && total > 0 ? (
          <Text variant="metadata" tone="muted">
            {t('search.deferredTopics')}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
