import { Modal, Pressable, View } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A bottom sheet of actions, and the confirmation dialog built on top of it.
 *
 * New for App Store readiness: the report/block menu and the account-deletion
 * confirmation both needed a small modal surface, and the product had none.
 * Kept deliberately plain — a translucent scrim, a rounded card, one row per
 * action — because this is infrastructure the visual design pass can restyle
 * without touching behaviour.
 */

export interface ActionSheetItem {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

export function ActionSheet({
  visible,
  onClose,
  items,
}: {
  visible: boolean;
  onClose: () => void;
  items: ActionSheetItem[];
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="dismiss"
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
            paddingBottom: theme.spacing.xl,
          }}
        >
          {items.map((item, index) => (
            <Pressable
              key={index}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              disabled={item.disabled}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              style={{
                paddingVertical: theme.spacing.lg,
                paddingHorizontal: theme.spacing.lg,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.colors.border,
                opacity: item.disabled ? 0.5 : 1,
              }}
            >
              <Text
                variant="body"
                tone={item.tone === 'danger' ? 'danger' : 'default'}
                style={{ textAlign: 'center' }}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * A confirmation dialog for an irreversible action.
 *
 * Used by account deletion, where the App Store requires the capability to
 * exist and good practice requires it not be one accidental tap.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  disabled = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.4)',
          justifyContent: 'center',
          padding: theme.spacing.xl,
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            padding: theme.spacing.lg,
            gap: theme.spacing.md,
          }}
        >
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="body" tone="muted">
            {body}
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'flex-end' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              onPress={onCancel}
              style={{ paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md }}
            >
              <Text variant="body">{cancelLabel}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              disabled={disabled}
              onPress={onConfirm}
              style={{
                paddingVertical: theme.spacing.sm,
                paddingHorizontal: theme.spacing.md,
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <Text variant="bodyStrong" tone={danger ? 'danger' : 'primary'}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
