import type { ar } from './ar';

/**
 * English catalogue.
 *
 * Typed as `Record<keyof typeof ar, string>`: adding a key to the Arabic
 * catalogue without adding it here is a compile error, which is the only
 * reliable way to keep two languages in sync.
 */
export const en: Record<keyof typeof ar, string> = {
  'app.name': 'Student OS',
  'app.tagline': 'Your academic community and your studying, in one place',

  'action.continue': 'Continue',
  'action.back': 'Back',
  'action.next': 'Next',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.retry': 'Try again',
  'action.done': 'Done',
  'action.skip': 'Skip',

  'state.loading': 'Loading…',
  'state.error.title': 'Something went wrong',
  'state.error.body': 'We could not complete that. Check your connection and try again.',
  'state.offline': 'No internet connection',

  'auth.signIn.title': 'Sign in',
  'auth.signIn.subtitle': 'Welcome back',
  'auth.signUp.title': 'Create account',
  'auth.signUp.subtitle': 'Start your academic journey',
  'auth.email': 'Email',
  'auth.email.placeholder': 'name@uob.edu.iq',
  'auth.password': 'Password',
  'auth.password.hint': 'At least 10 characters',
  'auth.haveAccount': 'Already have an account? Sign in',
  'auth.noAccount': 'No account yet? Create one',
  'auth.error.invalidCredentials': 'Email or password is incorrect',
  'auth.error.emailTaken': 'That email is already registered',
  'auth.error.suspended': 'This account is suspended',

  'onboarding.university.title': 'Choose your university',
  'onboarding.college.title': 'Choose your college',
  'onboarding.program.title': 'Choose your program',
  'onboarding.stage.title': 'Choose your stage',
  'onboarding.profile.title': 'Complete your profile',
  'onboarding.profile.subtitle': 'This is how your classmates will see you',
  'onboarding.handle': 'Handle',
  'onboarding.handle.hint': 'Lowercase letters, numbers and _ only',
  'onboarding.handle.taken': 'That handle is taken',
  'onboarding.handle.available': 'Handle is available',
  'onboarding.displayName': 'Name',
  'onboarding.bio': 'Bio',
  'onboarding.interests.title': 'What are you interested in?',
  'onboarding.interests.subtitle': 'Pick topics to personalise what you see',
  'onboarding.finish': 'Get started',

  'nav.home': 'Home',
  'nav.groups': 'Groups',
  'nav.create': 'Create',
  'nav.learn': 'Learn',
  'nav.chat': 'Chat',
  'nav.profile': 'Profile',
  'nav.notifications': 'Notifications',
  'nav.search': 'Search',
  'nav.settings': 'Settings',

  'home.title': 'Home',
  'home.greeting': 'Hi {name}',
  'home.section.liveNow': 'Live now',
  'home.section.upcoming': 'Upcoming classes',
  'home.section.continue': 'Continue learning',
  'home.section.feed': 'Latest',
  'home.empty.title': 'Nothing here yet',
  'home.empty.body': 'Join your cohort’s community to start seeing what your classmates share.',
  'home.empty.action': 'Explore communities',

  'groups.title': 'Groups',
  'groups.empty.title': 'No study groups yet',
  'groups.empty.body': 'Create a group with your classmates to study and share notes.',
  'groups.empty.action': 'Create a study group',

  'learn.title': 'Learn',
  'learn.myCourses': 'My courses',
  'learn.continue': 'Continue where you left off',
  'learn.weakTopics': 'Topics to review',
  'learn.saved': 'Saved',
  'learn.quizzes': 'Quizzes',
  'learn.flashcards': 'Flashcards',
  'learn.aiTutor': 'AI tutor',
  'learn.empty.title': 'You have not joined a course yet',
  'learn.empty.body': 'Join your courses and your lectures and quizzes will appear here.',
  'learn.empty.action': 'Browse courses',
  'learn.signalsDisclaimer': 'These are study activity signals, not an assessment of your ability.',

  'chat.title': 'Chat',
  'chat.empty.title': 'No conversations',
  'chat.empty.body': 'Start a conversation with a classmate or a study group.',
  'chat.empty.action': 'New conversation',
  'chat.status.sending': 'Sending',
  'chat.status.failed': 'Failed to send',
  'chat.status.retry': 'Retry',

  'create.title': 'Create',
  'create.post': 'Post',
  'create.reel': 'Educational reel',
  'create.question': 'Question',
  'create.poll': 'Poll',
  'create.resource': 'Resource',
  'create.studySession': 'Study session',

  'profile.contributionScore': 'Contribution score',
  'profile.courses': 'Courses',
  'profile.groups': 'Groups',
  'profile.interests': 'Interests',

  'phase.comingSoon.title': 'Coming soon',
  'phase.comingSoon.body': 'This part of the product ships in an upcoming phase.',
};
