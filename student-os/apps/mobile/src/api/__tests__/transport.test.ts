import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../client';

/**
 * Transport regression tests.
 *
 * These exist because of a real failure: making the transport injectable
 * introduced `return this.options.fetchImpl ?? fetch`, and calling that as
 * `this.transport(...)` handed the browser's `fetch` the ApiClient as its
 * receiver. Browsers reject that with "Illegal invocation", so every request
 * failed — but only in a browser. Node's fetch accepts any receiver, so the
 * unit suite and the API smoke suite both passed and the defect reached CI's
 * browser journey, where signup never made it to onboarding.
 *
 * The first test reproduces the receiver problem directly with a fetch
 * implementation that refuses a non-global `this`, which is what a browser
 * does.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ApiClient transport', () => {
  it('does not call the global fetch with the client as its receiver', async () => {
    const strictFetch = function (this: unknown): Promise<Response> {
      // A browser throws exactly here when `fetch` is invoked on the wrong
      // object. `undefined` (strict-mode plain call) and the global are fine.
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    };

    const original = globalThis.fetch;
    globalThis.fetch = strictFetch as unknown as typeof fetch;
    try {
      const client = new ApiClient({ baseUrl: 'https://api.test' });
      await expect(client.request('/v1/ping', { auth: false })).resolves.toEqual({ ok: true });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('uses an injected transport instead of the global fetch', async () => {
    const injected = vi.fn().mockResolvedValue(jsonResponse({ source: 'fixture' }));
    const globalSpy = vi.spyOn(globalThis, 'fetch');

    const client = new ApiClient({
      baseUrl: 'https://api.test',
      fetchImpl: injected as unknown as typeof fetch,
    });

    await expect(client.request('/v1/learn', { auth: false })).resolves.toEqual({
      source: 'fixture',
    });
    expect(injected).toHaveBeenCalledTimes(1);
    // The point of preview mode: the network is never reached.
    expect(globalSpy).not.toHaveBeenCalled();
    globalSpy.mockRestore();
  });

  it('loads a lazy transport once and never reaches the network', async () => {
    const injected = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ source: 'lazy' })));
    const loader = vi.fn().mockResolvedValue(injected);
    const globalSpy = vi.spyOn(globalThis, 'fetch');

    const client = new ApiClient({
      baseUrl: 'https://api.test',
      loadFetchImpl: loader,
    });

    await expect(client.request('/v1/learn', { auth: false })).resolves.toEqual({
      source: 'lazy',
    });
    await expect(client.request('/v1/me/profile', { auth: false })).resolves.toEqual({
      source: 'lazy',
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(injected).toHaveBeenCalledTimes(2);
    expect(globalSpy).not.toHaveBeenCalled();
    globalSpy.mockRestore();
  });

  it('sends the request to the configured base url', async () => {
    const injected = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      fetchImpl: injected as unknown as typeof fetch,
    });

    await client.request('/v1/learn', { auth: false });

    expect(injected).toHaveBeenCalledWith('https://api.test/v1/learn', expect.anything());
  });
});
