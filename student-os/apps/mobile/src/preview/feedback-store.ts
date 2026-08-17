import { IS_PREVIEW_MODE } from './preview-mode';

/**
 * Where a preview feedback response goes.
 *
 * Nowhere off the device. The preview has no backend — its transport is an
 * in-memory fixture world — so there is no endpoint to post to, and inventing
 * one would mean either standing up a server for a design review or sending
 * student words to a third party neither the student nor the owner agreed to.
 *
 * So a response is appended to `localStorage` and handed straight back to the
 * student as text they can copy. The screen says exactly that. This is a
 * deliberately small mechanism: it cannot lose a response silently, it cannot
 * leak one, and it needs no infrastructure to keep working.
 *
 * Retrieval, for whoever is running the session: open the preview on the
 * student's device and read `localStorage['student-os.preview.feedback']`, or
 * ask the student to use the copy control on the confirmation.
 */

const KEY = 'student-os.preview.feedback';

export type PreviewFeedback = {
  /** Which surface the response is about. */
  screen: string;
  /**
   * The four judged dimensions, on a four-point scale with no midpoint.
   * `null` where the student did not answer — an unanswered question is not a
   * neutral score, and storing it as one would be inventing data.
   */
  ratings: {
    clarity: string | null;
    navigation: string | null;
    usefulness: string | null;
    comfort: string | null;
  };
  confusion: string;
  suggestedChange: string;
};

/**
 * Records one response and returns it rendered for the student to read.
 *
 * The return value is what the confirmation shows, so the text the student can
 * copy is the same text that was stored — there is no second formatting of the
 * same answers that could drift from it.
 */
export function recordFeedback(feedback: PreviewFeedback): string {
  const rendered = render(feedback);

  // Storage is best effort: Safari in private mode throws on write, and a
  // student losing the ability to submit because of that would be a worse
  // outcome than a response that only exists on their screen.
  try {
    if (IS_PREVIEW_MODE && typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(KEY);
      localStorage.setItem(KEY, existing ? `${existing}\n\n${rendered}` : rendered);
    }
  } catch {
    // Intentionally silent — see above. The text is still returned.
  }

  return rendered;
}

function render(feedback: PreviewFeedback): string {
  const lines = [
    `screen: ${feedback.screen}`,
    `clarity: ${feedback.ratings.clarity ?? '-'}`,
    `navigation: ${feedback.ratings.navigation ?? '-'}`,
    `usefulness: ${feedback.ratings.usefulness ?? '-'}`,
    `comfort: ${feedback.ratings.comfort ?? '-'}`,
    `confused by: ${feedback.confusion || '-'}`,
    `would change: ${feedback.suggestedChange || '-'}`,
  ];
  return lines.join('\n');
}
