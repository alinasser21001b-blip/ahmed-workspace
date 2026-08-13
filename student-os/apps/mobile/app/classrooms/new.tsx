import type { ClassroomDetail, Course, Profile } from '@sos/contracts';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Text } from '../../src/components/Text';
import { EmptyState, Screen } from '../../src/components/states';
import { useI18n, type TranslationKey } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Opening a classroom.
 *
 * The course list comes from the student's own stage, because a classroom
 * belongs to a course and the server refuses one for a course they are not
 * enrolled in. Offering every course in the university and letting the API say
 * no would be a form the user can fill in wrongly by design.
 *
 * Visibility is the decision that matters most and is therefore not hidden
 * behind a default: a room open to the whole course and a room reachable only
 * by code are different products for the instructor.
 */

type Visibility = 'course' | 'classroom';

export default function NewClassroom(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('course');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const profile = await api.get<Profile>('/v1/me/profile');
        if (!profile.academic.stageId) return;
        const list = await api.get<Course[]>(
          `/v1/academic/courses?stageId=${profile.academic.stageId}`,
        );
        setCourses(list);
        setCourseId(list[0]?.id ?? null);
      } catch {
        setError(t('state.error.body'));
      }
    })();
  }, [api, t]);

  const submit = async (): Promise<void> => {
    if (!courseId) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.post<ClassroomDetail>('/v1/classrooms', {
        courseId,
        title: title.trim(),
        description: description.trim() || null,
        visibility,
      });
      router.replace(`/classrooms/${created.id}`);
    } catch {
      setError(t('state.error.body'));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = title.trim().length >= 3 && courseId !== null && !submitting;

  const field = (
    label: string,
    value: string,
    onChangeText: (next: string) => void,
    placeholder: string,
    multiline = false,
  ): React.JSX.Element => (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        style={{
          minHeight: multiline ? 96 : 44,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          color: theme.colors.text,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          fontSize: 16,
          textAlign: theme.isRTL ? 'right' : 'left',
          textAlignVertical: multiline ? 'top' : 'center',
          writingDirection: theme.isRTL ? 'rtl' : 'ltr',
        }}
      />
    </View>
  );

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="title">{t('classrooms.create.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('action.cancel')}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="close" size={24} color={theme.colors.textMuted} />
        </Pressable>
      </View>

      {courses.length === 0 ? (
        <View style={{ minHeight: 200 }}>
          <EmptyState
            title={t('classrooms.discover.empty.title')}
            body={t('classrooms.discover.empty.body')}
          />
        </View>
      ) : (
        <>
          {field(
            t('classrooms.create.name'),
            title,
            setTitle,
            t('classrooms.create.name.placeholder'),
          )}
          {field(
            t('classrooms.create.description'),
            description,
            setDescription,
            t('classrooms.create.description.placeholder'),
            true,
          )}

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label">{t('classrooms.create.course')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {courses.map((course) => {
                const active = courseId === course.id;
                return (
                  <Pressable
                    key={course.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={course.nameEn}
                    onPress={() => setCourseId(course.id)}
                    style={{
                      borderRadius: theme.radius.pill,
                      borderWidth: 1,
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                      paddingHorizontal: theme.spacing.lg,
                      paddingVertical: theme.spacing.sm,
                      minHeight: 40,
                      justifyContent: 'center',
                    }}
                  >
                    <Text variant="caption" tone={active ? 'primary' : 'muted'} bidi="auto">
                      {course.nameEn}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label">{t('classrooms.create.visibility')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {(['course', 'classroom'] as Visibility[]).map((option) => {
                const active = visibility === option;
                const label = t(`classrooms.create.visibility.${option}` as TranslationKey);
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={label}
                    onPress={() => setVisibility(option)}
                    style={{
                      borderRadius: theme.radius.pill,
                      borderWidth: 1,
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                      paddingHorizontal: theme.spacing.lg,
                      paddingVertical: theme.spacing.sm,
                      minHeight: 40,
                      justifyContent: 'center',
                    }}
                  >
                    <Text variant="caption" tone={active ? 'primary' : 'muted'}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {error ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Button
            label={t('classrooms.create')}
            variant="learning"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            onPress={() => void submit()}
          />
        </>
      )}
    </Screen>
  );
}
