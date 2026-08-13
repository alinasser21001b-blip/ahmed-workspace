import { Text } from '../../src/components/Text';
import { EmptyState, Screen } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';

/**
 * Groups shell (§59).
 *
 * The empty state is the screen in Phase 0, and it carries an action rather
 * than an apology — a brand-new product is mostly empty states, and an empty
 * state without a next step is where users stop.
 */
export default function Groups(): React.JSX.Element {
  const { t } = useI18n();

  return (
    <Screen>
      <Text variant="display">{t('groups.title')}</Text>
      <EmptyState
        title={t('groups.empty.title')}
        body={t('groups.empty.body')}
        action={{ label: t('groups.empty.action'), onPress: () => {} }}
      />
    </Screen>
  );
}
