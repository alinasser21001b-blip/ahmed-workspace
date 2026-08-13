import { Text } from '../../src/components/Text';
import { EmptyState, Screen } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';

/**
 * Chat shell (§58).
 *
 * Chat must feel like chat. No learning controls are added to this surface;
 * academic context enters it naturally, as a shared lecture or quiz card inside
 * a thread — which is exactly what `messages.share_kind` / `share_id` model in
 * the schema.
 */
export default function Chat(): React.JSX.Element {
  const { t } = useI18n();

  return (
    <Screen>
      <Text variant="display">{t('chat.title')}</Text>
      <EmptyState
        title={t('chat.empty.title')}
        body={t('chat.empty.body')}
        action={{ label: t('chat.empty.action'), onPress: () => {} }}
      />
    </Screen>
  );
}
