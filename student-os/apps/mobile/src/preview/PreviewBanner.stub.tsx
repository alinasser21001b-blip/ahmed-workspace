/**
 * `PreviewBanner`, as a real (non-preview) build sees it.
 *
 * The real component is mounted unconditionally in `app/_layout.tsx` and
 * already returns `null` at runtime outside a preview build — but returning
 * `null` at runtime is not the same as being absent from the bundle. Its
 * module still carried the banner markup and the literal
 * `"— sample data · بيانات تجريبية"` string, which shipped, readable, on
 * every student's device, exactly like the fixture world this file's sibling
 * (`fixture-transport.stub.ts`) already keeps out.
 *
 * `metro.config.js` resolves the real `PreviewBanner` module to this one
 * unless the build was exported with `EXPO_PUBLIC_PREVIEW_MODE=1`. No import,
 * no literal preview copy, nothing to read out of the artifact.
 */
export function PreviewBanner(): null {
  return null;
}
