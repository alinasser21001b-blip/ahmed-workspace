import { describe, expect, it } from 'vitest';
import {
  ApiBaseUrlError,
  DEV_API_BASE_URL,
  isLoopbackApiUrl,
  isSameOriginConfig,
  resolveApiBaseUrl,
  SAME_ORIGIN,
  shouldWarnAboutLoopback,
} from '../api-base-url';

/**
 * The rule that stops a production bundle addressing the machine that built it.
 *
 * These are the regression tests for a defect that shipped silently: the client
 * ended its resolution chain in `?? 'http://localhost:4000'`, and `app.json`
 * hardcoded the same value ahead of the environment variable, so a production
 * export both ignored its configuration and had somewhere harmless-looking to
 * fall back to. The app loaded; nothing worked; it looked like an outage.
 */

describe('a build that was never told where its API lives', () => {
  it('is refused outright when it is not a development build', () => {
    expect(() => resolveApiBaseUrl({ configured: undefined, isDevelopmentBuild: false })).toThrow(
      ApiBaseUrlError,
    );
    expect(() => resolveApiBaseUrl({ configured: null, isDevelopmentBuild: false })).toThrow();
    expect(() => resolveApiBaseUrl({ configured: '', isDevelopmentBuild: false })).toThrow();
    expect(() => resolveApiBaseUrl({ configured: '   ', isDevelopmentBuild: false })).toThrow();
  });

  it('names the variable to set, so the message is actionable', () => {
    expect(() => resolveApiBaseUrl({ configured: undefined, isDevelopmentBuild: false })).toThrow(
      /EXPO_PUBLIC_API_URL/,
    );
  });

  it('falls back to localhost only for a development build', () => {
    expect(resolveApiBaseUrl({ configured: undefined, isDevelopmentBuild: true })).toBe(
      DEV_API_BASE_URL,
    );
  });

  it('treats the empty object Expo makes from a null as unconfigured', () => {
    /*
     * Not hypothetical. Writing `apiBaseUrl: null` into `extra` came back out of
     * Expo's config serialisation as `{}` — truthy, so it read as a configured
     * value and blew up with `configured?.trim is not a function` instead of the
     * sentence naming the variable. The config now omits the key entirely; this
     * is the belt to that pair of braces.
     */
    expect(() => resolveApiBaseUrl({ configured: {}, isDevelopmentBuild: false })).toThrow(
      /EXPO_PUBLIC_API_URL/,
    );
    expect(resolveApiBaseUrl({ configured: {}, isDevelopmentBuild: true })).toBe(DEV_API_BASE_URL);
    for (const junk of [0, false, [], { apiBaseUrl: 'x' }]) {
      expect(() => resolveApiBaseUrl({ configured: junk, isDevelopmentBuild: false })).toThrow(
        ApiBaseUrlError,
      );
    }
  });
});

describe('a configured address', () => {
  it('is used as given', () => {
    expect(
      resolveApiBaseUrl({ configured: 'https://api.studentos.iq', isDevelopmentBuild: false }),
    ).toBe('https://api.studentos.iq');
  });

  it('loses trailing slashes, which would otherwise produce //v1/...', () => {
    expect(
      resolveApiBaseUrl({ configured: 'https://api.studentos.iq///', isDevelopmentBuild: false }),
    ).toBe('https://api.studentos.iq');
  });

  it('is trimmed, because a stray newline in a CI variable is easy to miss', () => {
    expect(
      resolveApiBaseUrl({ configured: '  https://api.studentos.iq  ', isDevelopmentBuild: false }),
    ).toBe('https://api.studentos.iq');
  });

  it('must be absolute — a path cannot address a host', () => {
    for (const bad of ['/v1', 'api.studentos.iq', 'ftp://api.studentos.iq', 'localhost:4000']) {
      expect(() => resolveApiBaseUrl({ configured: bad, isDevelopmentBuild: false })).toThrow(
        ApiBaseUrlError,
      );
    }
  });
});

describe('same-origin', () => {
  /*
   * The regression tests for the second silent deployment failure. The client
   * loaded, every request failed before leaving the browser, and the app said
   * "no internet connection" — while the API was answering on the exact host the
   * page had been served from. Two independent causes, one shape:
   *
   *   * the baked host was the deploy's branch subdomain, not the address the
   *     site is opened at;
   *   * and it was `http://`, blocked as mixed content by an `https://` page.
   *
   * Neither is reachable once the origin is read at runtime.
   */
  it('resolves to the origin the page was served from', () => {
    expect(
      resolveApiBaseUrl({
        configured: SAME_ORIGIN,
        isDevelopmentBuild: false,
        origin: 'https://studentos.netlify.app',
      }),
    ).toBe('https://studentos.netlify.app');
  });

  it('is recognised however it is cased or padded, since it comes from a shell', () => {
    for (const spelling of ['same-origin', 'SAME-ORIGIN', '  Same-Origin  ']) {
      expect(isSameOriginConfig(spelling), spelling).toBe(true);
      expect(
        resolveApiBaseUrl({
          configured: spelling,
          isDevelopmentBuild: false,
          origin: 'https://studentos.netlify.app',
        }),
      ).toBe('https://studentos.netlify.app');
    }
  });

  it('is not confused with a host that merely resembles it', () => {
    for (const other of ['https://same-origin.example', 'same-origin.example', 'sameorigin']) {
      expect(isSameOriginConfig(other), other).toBe(false);
    }
  });

  it('refuses when there is no page to take an origin from', () => {
    // A native build. Falling back to anything here is how a phone ends up
    // addressing whichever machine produced the bundle.
    expect(() =>
      resolveApiBaseUrl({ configured: SAME_ORIGIN, isDevelopmentBuild: false, origin: null }),
    ).toThrow(ApiBaseUrlError);
    expect(() =>
      resolveApiBaseUrl({ configured: SAME_ORIGIN, isDevelopmentBuild: false }),
    ).toThrow(/no page to take an origin from/i);
  });

  it('refuses in a development build too, rather than quietly using localhost', () => {
    expect(() =>
      resolveApiBaseUrl({ configured: SAME_ORIGIN, isDevelopmentBuild: true, origin: null }),
    ).toThrow(ApiBaseUrlError);
  });

  it('loses a trailing slash, which would otherwise produce //v1/...', () => {
    expect(
      resolveApiBaseUrl({
        configured: SAME_ORIGIN,
        isDevelopmentBuild: false,
        origin: 'https://studentos.netlify.app/',
      }),
    ).toBe('https://studentos.netlify.app');
  });
});

describe('loopback detection', () => {
  it('recognises every way of naming the local machine', () => {
    for (const url of [
      'http://localhost:4000',
      'http://localhost',
      'https://127.0.0.1:8081',
      'http://127.1.2.3:4000',
      'http://[::1]:4000',
      // A bind address, not a destination: asking for it is asking yourself.
      'http://0.0.0.0:4000',
      'HTTP://LOCALHOST:4000',
    ]) {
      expect(isLoopbackApiUrl(url), url).toBe(true);
    }
  });

  it('does not mistake a real host that merely contains the word', () => {
    for (const url of [
      'https://api.studentos.iq',
      'https://localhost.studentos.iq',
      'https://not-localhost.example',
      'https://127.0.0.1.studentos.iq',
    ]) {
      expect(isLoopbackApiUrl(url), url).toBe(false);
    }
  });
});

describe('loopback in a production bundle', () => {
  /*
   * A warning rather than a refusal, and the distinction is the whole design:
   * the *accidental* case — an address nobody chose — is already impossible,
   * because a missing variable throws. What remains can only have been typed on
   * purpose, and the browser journeys do exactly that on purpose.
   */
  it('warns, because only a deliberate act can reach it', () => {
    expect(shouldWarnAboutLoopback('http://localhost:4000', false)).toBe(true);
  });

  it('says nothing in development, where it is simply correct', () => {
    expect(shouldWarnAboutLoopback('http://localhost:4000', true)).toBe(false);
  });

  it('says nothing about a real host', () => {
    expect(shouldWarnAboutLoopback('https://api.studentos.iq', false)).toBe(false);
  });

  it('still resolves, so the end-to-end journeys can bundle against a local API', () => {
    expect(
      resolveApiBaseUrl({ configured: 'http://localhost:4000', isDevelopmentBuild: false }),
    ).toBe('http://localhost:4000');
  });
});
