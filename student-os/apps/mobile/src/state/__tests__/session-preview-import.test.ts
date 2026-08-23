import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The production bundle must not compile the preview fixture world.
 *
 * `session.tsx` used to import `fixture-transport` eagerly, so Metro shipped
 * "Layla Hassan" into every export — including production. The import is now
 * a dynamic `import()` inside the preview-flag branch. This test reads the
 * source, not the bundle, so it fails at the same moment the eager import
 * is reintroduced rather than after a production export is grepped.
 */

const SESSION = join(dirname(fileURLToPath(import.meta.url)), '..', 'session.tsx');

describe('session transport setup', () => {
  const source = readFileSync(SESSION, 'utf8');

  it('does not statically import the fixture transport', () => {
    expect(source).not.toMatch(
      /import\s+\{[^}]*fixtureFetch[^}]*\}\s+from\s+['"]\.\.\/preview\/fixture-transport['"]/,
    );
  });

  it('loads the fixture transport only behind the preview flag', () => {
    expect(source).toMatch(/IS_PREVIEW_MODE/);
    expect(source).toMatch(/import\(['"]\.\.\/preview\/fixture-transport['"]\)/);
  });
});
