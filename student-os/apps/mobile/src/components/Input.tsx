import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH_TARGET } from '../theme/tokens';
import { Text } from './Text';

/**
 * Text field with label, hint, and error slot.
 *
 * The error slot is part of the primitive rather than something each screen
 * lays out, because a validation message that appears in a different place on
 * every screen is how forms end up inaccessible.
 */

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  error?: string | null;
  /** Positive feedback, e.g. "handle is available". */
  success?: string | null;
}

export function Input({
  label,
  hint,
  error,
  success,
  onFocus,
  onBlur,
  ...rest
}: InputProps): React.JSX.Element {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.primary
      : theme.colors.border;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>

      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.textMuted}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.surface,
            borderColor,
            borderRadius: theme.radius.md,
            color: theme.colors.text,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            textAlign: theme.isRTL ? 'right' : 'left',
            writingDirection: theme.isRTL ? 'rtl' : 'ltr',
          },
        ]}
        {...rest}
      />

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : success ? (
        // `provenance` is the one sanctioned exception to "teal is never
        // success": a fact verified against the server, which in practice is
        // handle availability. If `success` is ever used for a generic
        // confirmation, that use must not be teal — see
        // `docs/design-handoff/07-COLOUR.md`.
        <Text variant="caption" tone="provenance" accessibilityLiveRegion="polite">
          {success}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: StyleSheet.hairlineWidth * 2,
    fontSize: 16,
  },
});
