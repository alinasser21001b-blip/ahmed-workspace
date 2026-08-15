import type { ClassroomMember, LectureSummary } from '@sos/contracts';
import { Pressable, View, type ViewStyle } from 'react-native';
import { localizeDigits, useI18n } from '../i18n/index';
import { useTheme } from '../theme/ThemeProvider';
import { DirectionalIcon } from './DirectionalIcon';
import { MetadataLine } from './editorial';
import { Avatar } from './surfaces';
import { Text } from './Text';

/**
 * Shared row primitives (09-COMPONENTS.md §Rows).
 *
 * One grammar for every grouped list in the product: a hairline top border, a
 * minimum height, content, an optional trailing count, an optional chevron.
 * Screens compose these rather than inventing a card system each — the whole
 * point of retiring cards was that five card systems is four too many.
 */

// ---------------------------------------------------------------------------
// AcademicRow — the generic grouped row

export function AcademicRow({
  onPress,
  accessibilityLabel,
  minHeight = 48,
  trailing,
  chevron = false,
  style,
  children,
}: {
  onPress?: (() => void) | undefined;
  accessibilityLabel?: string;
  minHeight?: number;
  trailing?: React.ReactNode;
  chevron?: boolean;
  style?: ViewStyle;
  children: React.ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  const body = (
    <View
      style={[
        {
          minHeight,
          paddingVertical: theme.spacing.md,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
        },
        style,
      ]}
    >
      <View style={{ flex: 1 }}>{children}</View>
      {trailing}
      {chevron ? (
        <DirectionalIcon direction="forward" size={18} color={theme.colors.textFaint} />
      ) : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
    >
      {body}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// ClassroomActivityRow — a lecture, numbered because a block is a sequence

export function ClassroomActivityRow({
  lecture,
  index,
  onPress,
}: {
  lecture: LectureSummary;
  index: number;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useI18n();

  const parts = [
    lecture.materialCount > 0
      ? t('classroom.materials.count', { count: lecture.materialCount })
      : null,
    lecture.durationMinutes
      ? `${localizeDigits(locale, lecture.durationMinutes)} ${t('lecture.duration')}`
      : null,
    lecture.publishedAt ? null : t('lecture.draft'),
  ];

  return (
    <AcademicRow
      minHeight={66}
      chevron
      onPress={onPress}
      accessibilityLabel={[
        `${t('classroom.lectureNumber', { number: localizeDigits(locale, index + 1) })}`,
        lecture.title,
        ...parts.filter(Boolean),
      ].join(', ')}
    >
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        {/* Arabic-Indic in Arabic: the number is interface copy, not content. */}
        <Text variant="numeric" tone="muted" accessible={false}>
          {localizeDigits(locale, index + 1)}
        </Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" bidi="auto">
            {lecture.title}
          </Text>
          <MetadataLine parts={parts} />
        </View>
      </View>
    </AcademicRow>
  );
}

// ---------------------------------------------------------------------------
// MemberAvatarRow — wrapping, never a nested horizontal scroller

export function MemberAvatarRow({
  members,
  total,
  onPressAll,
}: {
  members: ClassroomMember[];
  total: number;
  onPressAll?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const shown = members.slice(0, 6);
  const overflow = Math.max(0, total - shown.length);

  return (
    <Pressable
      accessibilityRole={onPressAll ? 'button' : 'text'}
      // One element, one label: a screen reader does not want six avatars.
      accessibilityLabel={t('classroom.members.count', { count: total })}
      onPress={onPressAll}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: theme.spacing.sm,
        minHeight: 44,
      }}
    >
      {shown.map((member) => (
        <View key={member.user.userId} accessible={false}>
          <Avatar name={member.user.displayName} size={32} />
        </View>
      ))}
      {overflow > 0 ? (
        <View
          accessible={false}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: theme.colors.borderStrong,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="metadata" tone="muted">
            {`+${localizeDigits(locale, overflow)}`}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// RoleLabel — a single structure-coloured label, never a pill stack

export function RoleLabel({ label }: { label: string }): React.JSX.Element {
  return (
    <Text variant="metadata" tone="structure" style={{ fontWeight: '600' }}>
      {label}
    </Text>
  );
}
