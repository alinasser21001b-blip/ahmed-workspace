/**
 * The fixture transport, as a real (non-preview) build sees it.
 *
 * Metro resolves `import` statements statically: a module reached by an
 * unconditional import is bundled whether or not the branch that uses it can
 * ever run. `session.tsx` imports `fixtureFetch` and then passes it only when
 * `IS_PREVIEW_MODE`, which compiles to `false` in a real export — so the code
 * was unreachable, and the entire invented world behind it (demo students,
 * their posts, their messages: about 1,600 lines) still shipped inside every
 * bundle a student downloads. Unreachable is not the same as absent. A
 * student's device downloaded a cast of people who do not exist, and the
 * strings were extractable from the artifact by anyone who looked.
 *
 * `metro.config.js` redirects the fixture modules here unless the build was
 * exported with `EXPO_PUBLIC_PREVIEW_MODE=1`, so in a real build this file is
 * what the import resolves to and the fixture world is not part of the graph
 * at all. The check is the build's own environment — the same single flag that
 * gates everything else — never a hostname or a runtime guess.
 *
 * Calling this is a programming error: it means a real build tried to serve a
 * request from fixtures, which is exactly the silent fallback the environment
 * contract forbids. It therefore throws rather than returning anything.
 */
export const fixtureFetch: typeof fetch = async () => {
  throw new Error(
    'fixtureFetch is not available in this build. Fixtures exist only in preview exports (EXPO_PUBLIC_PREVIEW_MODE=1).',
  );
};
