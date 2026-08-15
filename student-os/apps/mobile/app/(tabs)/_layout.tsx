import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { StyleSheet, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../../src/i18n/index';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Tab bar height before the safe-area inset is added. */
const TAB_BAR_HEIGHT = 74;

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
  focused,
  bump = 0,
}: {
  name: IconName;
  color: ColorValue | undefined;
  size: number;
  focused: boolean;
  bump?: number;
}): React.JSX.Element {
  const theme = useTheme();
  /*
   * The focused tab uses the filled glyph, not merely a different tint. Colour
   * is never the only carrier of a state in this system, and "which tab am I
   * on" has to survive greyscale and colour-vision deficiency like every other
   * state does.
   */
  const glyph = (focused ? name.replace(/-outline$/, '') : name) as IconName;
  return (
    <Ionicons
      name={glyph}
      size={size + bump}
      color={typeof color === 'string' ? color : theme.colors.textMuted}
    />
  );
}

export default function TabsLayout(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Position is ink, not the indigo primary: an active tab states where
        // you are, and the filled glyph plus weight 600 carry it as well as the
        // colour does, so it survives greyscale.
        tabBarActiveTintColor: theme.colors.text,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          // No elevation. This system does not use shadows for chrome.
          elevation: 0,
          shadowOpacity: 0,
        },
        /*
         * 12 px is the floor here and it is a deliberate, isolated exception to
         * the 13 px metadata rule: five destinations with Arabic labels clip at
         * 13 on a 360 px screen, and a clipped label is worse than a small one.
         * The label is never the only carrier — the glyph and position state it
         * too. Do not copy this exception to any other surface.
         */
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
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
