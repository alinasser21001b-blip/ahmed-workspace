import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useI18n } from '../../src/i18n/index';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Primary navigation (§54).
 *
 * Exactly five destinations: Home, Groups, Create, Learn, Chat. Profile lives
 * behind the avatar, notifications and search are global. The temptation is to
 * keep adding tabs; the constraint is the point, because a ten-tab bar means
 * nothing is primary.
 *
 * `Learn` is deliberately its own destination rather than a section inside
 * Home. If studying is reachable only by scrolling past a social feed, the
 * product is a social app with coursework attached.
 */

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * React Navigation hands the icon a `ColorValue`, which widens to platform
 * colour objects and null. Normalising it once here keeps every call site
 * clean and guarantees an icon is never rendered colourless.
 */
function TabIcon({
  name,
  color,
  size,
  bump = 0,
}: {
  name: IconName;
  color: ColorValue | undefined;
  size: number;
  bump?: number;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Ionicons
      name={name}
      size={size + bump}
      color={typeof color === 'string' ? color : theme.colors.textMuted}
    />
  );
}

export default function TabsLayout(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        // Five destinations with Arabic labels overflow at the default size on a
        // narrow phone, and a clipped label is worse than a small one.
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarItemStyle: { paddingHorizontal: 0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.home'),
          tabBarIcon: (props) => <TabIcon name="home-outline" {...props} />,
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: t('nav.groups'),
          tabBarIcon: (props) => <TabIcon name="people-outline" {...props} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: t('nav.create'),
          tabBarIcon: (props) => <TabIcon name="add-circle-outline" bump={4} {...props} />,
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: t('nav.learn'),
          tabBarIcon: (props) => <TabIcon name="school-outline" {...props} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t('nav.chat'),
          tabBarIcon: (props) => <TabIcon name="chatbubbles-outline" {...props} />,
        }}
      />
    </Tabs>
  );
}
