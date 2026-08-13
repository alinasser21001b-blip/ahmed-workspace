import { Redirect } from 'expo-router';
import { LoadingState, Screen } from '../src/components/states';
import { useSession } from '../src/state/session';

/**
 * The routing gate.
 *
 * Three states, one decision, in one place:
 *   loading    → hold (a restored session is being verified)
 *   signedOut  → auth
 *   signedIn   → onboarding if incomplete, otherwise the app shell
 *
 * `onboardingCompleted` is decided by the server, not inferred from whether
 * some field looks filled in — a client-side guess here is how users end up
 * stuck outside their own cohort.
 */
export default function Index(): React.JSX.Element {
  const { status, user } = useSession();

  if (status === 'loading') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (status === 'signedOut' || !user) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!user.onboardingCompleted) {
    return <Redirect href="/(onboarding)" />;
  }

  return <Redirect href="/(tabs)" />;
}
