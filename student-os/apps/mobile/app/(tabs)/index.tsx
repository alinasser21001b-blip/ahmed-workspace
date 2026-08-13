import type { Profile } from '@sos/contracts';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Avatar, Badge, Card, SectionHeader } from '../../src/components/surfaces';
import { Text } from '../../src/components/Text';
import { EmptyState, ErrorState, Screen, Skeleton } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Home shell (§55).
 *
 * Phase 0 renders the real profile header and the section scaffolding with
 * honest empty states. The feed itself is Phase 2 — and this screen shows an
 * empty state that says so and offers the next useful action, rather than a
 * blank page or fake placeholder content.
 */
export default function Home(): React.JSX.Element {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async (): Promise<void> => {
    setState('loading');
    try {
      setProfile(await api.get<Profile>('/v1/me/profile'));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'error') {
    return (
      <Screen>
        <ErrorState onRetry={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        {state === 'loading' || !profile ? (
          <>
            <Skeleton height={44} width={44} radiusKey="lg" />
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <Skeleton height={18} width="60%" />
              <Skeleton height={14} width="40%" />
            </View>
          </>
        ) : (
          <>
            <Avatar name={profile.displayName} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading">{t('home.greeting', { name: profile.displayName })}</Text>
              <Text variant="caption" tone="muted">
                {[profile.academic.collegeName, profile.academic.stageName]
                  .filter(Boolean)
                  .join(locale === 'ar' ? ' — ' : ' · ')}
              </Text>
            </View>
          </>
        )}
      </View>

      {profile ? (
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <Badge label={t('profile.contributionScore')} tone="learning" />
            <Text variant="title">{profile.contributionScore}</Text>
            <Text variant="caption" tone="muted">
              {t('learn.signalsDisclaimer')}
            </Text>
          </View>
        </Card>
      ) : null}

      <View>
        <SectionHeader title={t('home.section.feed')} />
        <Card>
          <View style={{ height: 200 }}>
            <EmptyState title={t('home.empty.title')} body={t('home.empty.body')} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}
