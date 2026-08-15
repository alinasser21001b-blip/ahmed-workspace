import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The gate itself, rather than what is behind it.
 *
 * `fixture-transport.test.ts` proves the fixture world answers the contract.
 * This file proves the three properties the student preview is only safe
 * because of:
 *
 *   1. the flag turns the fixture transport on,
 *   2. nothing else can — no hostname, no URL, no runtime write,
 *   3. destructive actions never reach the network.
 *
 * Each is asserted by loading the module fresh under a controlled environment,
 * because `EXPO_PUBLIC_PREVIEW_MODE` is read once at module scope — which is
 * the property that makes it a build-time constant in the shipped bundle.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadGate(): Promise<typeof import('../preview-mode')> {
  vi.resetModules();
  return import('../preview-mode');
}

describe('the preview flag', () => {
  it('is off when the variable is absent', async () => {
    vi.stubEnv('EXPO_PUBLIC_PREVIEW_MODE', undefined);
    const { IS_PREVIEW_MODE, previewBannerLabel } = await loadGate();
    expect(IS_PREVIEW_MODE).toBe(false);
    expect(previewBannerLabel()).toBeNull();
  });

  it('is on for the documented values, and only those', async () => {
    for (const value of ['1', 'true']) {
      vi.stubEnv('EXPO_PUBLIC_PREVIEW_MODE', value);
      const { IS_PREVIEW_MODE } = await loadGate();
      expect(IS_PREVIEW_MODE).toBe(true);
    }

    // Anything else fails closed rather than being interpreted generously. A
    // build that meant to be a preview and typo'd the value gets production
    // behaviour, which is the safe direction to be wrong in.
    for (const value of ['0', 'false', 'yes', 'preview', '', ' 1']) {
      vi.stubEnv('EXPO_PUBLIC_PREVIEW_MODE', value);
      const { IS_PREVIEW_MODE } = await loadGate();
      expect(IS_PREVIEW_MODE, `value ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it('cannot be turned on by the hostname, the URL, or anything else at runtime', async () => {
    vi.stubEnv('EXPO_PUBLIC_PREVIEW_MODE', undefined);
    // Every inference a hostname-sniffing implementation would have used.
    vi.stubGlobal('location', {
      hostname: 'student-os-preview.netlify.app',
      host: 'student-os-preview.netlify.app',
      href: 'https://student-os-preview.netlify.app/?preview=1&EXPO_PUBLIC_PREVIEW_MODE=1',
      search: '?preview=1',
      origin: 'https://student-os-preview.netlify.app',
    });
    vi.stubGlobal('localStorage', {
      getItem: () => '1',
      setItem: () => undefined,
    });

    const gate = await loadGate();
    expect(gate.IS_PREVIEW_MODE).toBe(false);
    expect(gate.previewBannerLabel()).toBeNull();
  });

  it('exports the flag as a value a screen cannot reassign', async () => {
    vi.stubEnv('EXPO_PUBLIC_PREVIEW_MODE', undefined);
    const gate = await loadGate();
    // ES module bindings are read-only from the importing side; assigning
    // through the namespace object throws in strict mode, which every module
    // is. This is the mechanism, asserted rather than assumed.
    expect(() => {
      (gate as unknown as { IS_PREVIEW_MODE: boolean }).IS_PREVIEW_MODE = true;
    }).toThrow();
    expect(gate.IS_PREVIEW_MODE).toBe(false);
  });
});

describe('destructive actions in preview', () => {
  it('never reach the network — not even account deletion', async () => {
    // Any call to fetch is a failure, so this is not "we did not observe a
    // request" but "a request would have thrown".
    const forbidden = vi.fn(() => {
      throw new Error('the fixture transport opened a network connection');
    });
    vi.stubGlobal('fetch', forbidden);
    vi.stubGlobal('XMLHttpRequest', undefined);
    vi.stubGlobal('WebSocket', undefined);

    vi.resetModules();
    const { route } = await import('../fixture-transport');
    const { resetWorld } = await import('../fixtures');
    resetWorld();

    const auth = route('POST', '/v1/auth/login', new URLSearchParams(), {
      email: 'preview@student-os.example',
      password: 'preview-password',
    });
    expect(auth.status).toBe(200);

    // The four the brief names explicitly: a report, a block, a message and
    // an account deletion. Each is a write, and each resolves locally.
    const report = route('POST', '/v1/reports', new URLSearchParams(), {
      targetType: 'user',
      targetId: 'user-layla',
      reason: 'harassment',
    });
    expect(report.status).toBeLessThan(400);

    const block = route('PUT', '/v1/profiles/layla.hassan/block', new URLSearchParams(), {});
    expect(block.status).toBeLessThan(400);

    const message = route('POST', '/v1/conversations/conv-1/messages', new URLSearchParams(), {
      body: 'a preview message',
      clientId: 'preview-client-1',
    });
    expect(message.status).toBeLessThan(400);

    const deletion = route('DELETE', '/v1/me/account', new URLSearchParams(), {
      password: 'preview-password',
      confirmation: 'DELETE',
    });
    expect(deletion.status).toBeLessThan(400);

    expect(forbidden).not.toHaveBeenCalled();
  });

  it('mutates only the in-memory world, which a reset restores', async () => {
    vi.resetModules();
    const { route } = await import('../fixture-transport');
    const { resetWorld } = await import('../fixtures');
    resetWorld();

    const before = await route(
      'GET',
      '/v1/conversations/conv-1/messages',
      new URLSearchParams(),
      {},
    ).json();

    route('POST', '/v1/conversations/conv-1/messages', new URLSearchParams(), {
      body: 'a preview message',
      clientId: 'preview-client-2',
    });

    const during = await route(
      'GET',
      '/v1/conversations/conv-1/messages',
      new URLSearchParams(),
      {},
    ).json();
    expect(during.items.length).toBe(before.items.length + 1);

    // The only durable store the preview has is the module's own state, so
    // resetting it is genuinely the whole undo. There is nothing else holding
    // a copy — no database, no file, no request that already left.
    resetWorld();
    const after = await route(
      'GET',
      '/v1/conversations/conv-1/messages',
      new URLSearchParams(),
      {},
    ).json();
    expect(after.items.length).toBe(before.items.length);
  });
});
