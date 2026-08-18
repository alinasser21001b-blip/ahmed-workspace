import { Redirect } from 'expo-router';

/**
 * `/preview-feedback`, as a real (non-preview) build sees it.
 *
 * The real screen (`app/preview-feedback.tsx`) is preview-only by
 * construction — it refuses to render its form outside `IS_PREVIEW_MODE` —
 * but a runtime refusal still ships the whole module: the form, its 35
 * translation keys' worth of copy, and the "not available in this build"
 * sentence itself all sat in the real bundle, reachable by anyone who tried
 * the URL.
 *
 * This file lives outside `app/` on purpose: expo-router registers every file
 * under `app/` as its own route, so a stub placed there would create a second,
 * spurious `/preview-feedback-route.stub` route. `metro.config.js` resolves
 * the real route's module to this one instead, unless the build was exported
 * with `EXPO_PUBLIC_PREVIEW_MODE=1`.
 *
 * There is nothing left to read here: no preview copy, no feedback form, not
 * even a sentence explaining the redirect — a route a student was never given
 * a link to simply is not one, and sends them back to where the product
 * starts.
 */
export default function PreviewFeedbackRouteStub(): React.JSX.Element {
  return <Redirect href="/" />;
}
