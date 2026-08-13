import Ionicons from '@expo/vector-icons/Ionicons';
import type { Group } from '@sos/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { ApiError, NetworkError } from '../../src/api/client';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { Text } from '../../src/components/Text';
import { Screen } from '../../src/components/states';
import { useI18n, type TranslationKey } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Create a study group.
 *
 * Visibility and join policy are two separate questions, asked separately,
 * because they answer different things: who can *find* the group, and who can
 * *get in*. Collapsing them into one "privacy" control is how people end up
 * with an unlisted group that anyone can join, or a discoverable one nobody can.
 */

type Visibility = 'stage' | 'college' | 'group';
type JoinPolicy = 'open' | 'request' | 'invite';

const VISIBILITY: { value: Visibility; key: TranslationKey }[] = [
  { value: 'stage', key: 'groups.create.visibility.stage' },
  { value: 'college', key: 'groups.create.visibility.college' },
  { value: 'group', key: 'groups.create.visibility.group' },
];

const JOIN_POLICY: { value: JoinPolicy; key: TranslationKey }[] = [
  { value: 'open', key: 'groups.create.joinPolicy.open' },
  { value: 'request', key: 'groups.create.joinPolicy.request' },
  { value: 'invite', key: 'groups.create.joinPolicy.invite' },
];

function ChoiceRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; key: TranslationKey }[];
  value: T;
  onChange: (next: T) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: active ? theme.colors.primary : theme.colors.border,
              backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.md,
              minHeight: 44,
            }}
          >
            <Ionicons
              name={active ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={active ? theme.colors.primary : theme.colors.textMuted}
            />
            <Text variant="body" tone={active ? 'primary' : 'default'}>
              {t(option.key)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function NewGroup(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('stage');
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>('request');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.post<Group>('/v1/groups', {
        name: name.trim(),
        description: description.trim() || undefined,
        visibility,
        joinPolicy,
      });
      router.replace(`/group/${created.id}`);
    } catch (caught) {
      setError(
        t(
          caught instanceof NetworkError
            ? 'state.offline'
            : caught instanceof ApiError && caught.code === 'PRECONDITION_FAILED'
              ? 'state.error.body'
              : 'state.error.body',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="title">{t('groups.create')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('action.cancel')}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="close" size={24} color={theme.colors.textMuted} />
        </Pressable>
      </View>

      <Input label={t('groups.create.name')} value={name} onChangeText={setName} />

      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="label" tone="muted">
          {t('groups.create.description')}
        </Text>
        <TextInput
          accessibilityLabel={t('groups.create.description')}
          value={description}
          onChangeText={setDescription}
          multiline
          placeholderTextColor={theme.colors.textMuted}
          style={{
            minHeight: 90,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            color: theme.colors.text,
            padding: theme.spacing.lg,
            fontSize: 16,
            textAlign: theme.isRTL ? 'right' : 'left',
            textAlignVertical: 'top',
            writingDirection: theme.isRTL ? 'rtl' : 'ltr',
          }}
        />
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" tone="muted">
          {t('groups.create.visibility')}
        </Text>
        <ChoiceRow options={VISIBILITY} value={visibility} onChange={setVisibility} />
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" tone="muted">
          {t('groups.create.joinPolicy')}
        </Text>
        <ChoiceRow options={JOIN_POLICY} value={joinPolicy} onChange={setJoinPolicy} />
      </View>

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <Button
        label={t('groups.create.submit')}
        onPress={() => void submit()}
        loading={submitting}
        disabled={name.trim().length < 2 || submitting}
        size="lg"
        fullWidth
      />
    </Screen>
  );
}
