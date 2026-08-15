import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH_TARGET } from '../theme/tokens';
import { Text } from './Text';

/**
 * Button.
 *
 * `dominant` is the one filled ink control a context is allowed — Practise,
 * Start, Continue, Submit. It replaces the former `learning` variant, which
 * was teal.
 *
 * That change is deliberate and is the point of the colour system: teal now
 * means provenance and citation exclusively, so a study action can no longer
 * borrow it. Separating study actions from social actions is still the goal;
 * it is now carried by hierarchy — one dominant action per context — rather
 * than by giving coursework its own hue.
 *
 * Only one `dominant` button should be visible in a context at a time. A
 * second filled control is a design bug, not a variant choice.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dominant' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  style,
  ...rest
}: ButtonProps): React.JSX.Element {
  const theme = useTheme();
  const isDisabled = disabled === true || loading;

  const surfaces: Record<ButtonVariant, { background: string; border: string; label: 'default' | 'inverse' | 'primary' | 'danger' }> = {
    primary: { background: theme.colors.primary, border: theme.colors.primary, label: 'inverse' },
    secondary: { background: theme.colors.surface, border: theme.colors.border, label: 'default' },
    ghost: { background: 'transparent', border: 'transparent', label: 'primary' },
    dominant: { background: theme.colors.text, border: theme.colors.text, label: 'inverse' },
    danger: { background: theme.colors.danger, border: theme.colors.danger, label: 'inverse' },
  };
  const surface = surfaces[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: surface.background,
          borderColor: surface.border,
          borderRadius: theme.radius.md,
          paddingVertical: size === 'lg' ? theme.spacing.lg : theme.spacing.md,
          paddingHorizontal: theme.spacing.xl,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
      {...rest}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={surface.label === 'inverse' ? theme.colors.onPrimary : theme.colors.primary}
          />
        ) : null}
        <Text
          variant={size === 'lg' ? 'bodyStrong' : 'label'}
          tone={surface.label}
          align="center"
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: StyleSheet.hairlineWidth * 2,
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
