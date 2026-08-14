import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * Two documents, one cookie.
 *
 * The single-flight guard beside this is a module variable, and a module is per
 * document - so it stopped one tab racing itself and did nothing about two tabs
 * racing each other. That is the common case rather than the exotic one:
 * Chrome's "continue where you left off" restores every tab at once, and each
 * restored document holds no access token, so each reaches for the same
 * rotating cookie within a few milliseconds. Measured against the running API
 * before the fix: of eleven cold-load pairs, four produced a
 * `session.reuse_detected` row, revoked every live session, and put both tabs
 * on the sign-in form.
 *
 * A second document is modelled by loading `client.ts` twice with the module
 * registry reset between - two module instances, exactly as two documents have
 * - while the Web Lock manager and the BroadcastChannel bus below are shared,
 * exactly as the browser shares them. Nothing here fakes the coordination
 * itself; it fakes the two browser primitives the coordination stands on.
 */

interface LockOptions {
  ifAvailable?: boolean;
}
type LockCallback = (lock: { name: string } | null) => Promise<unknown>;

/** Enough of LockManager to be wrong in the same ways the real one is. */
class FakeLockManager {
  private readonly held = new Set<string>();
  private readonly waiting = new Map<string, (() => void)[]>();
  grants = 0;
  refusals = 0;

  async request(
    name: string,
    optionsOrCallback: LockOptions | LockCallback,
    maybeCallback?: LockCallback,
  ): Promise<unknown> {
    const options: LockOptions =
      typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : (maybeCallback as LockCallback);

    if (this.held.has(name)) {
      if (options.ifAvailable === true) {
        this.refusals += 1;
        return callback(null);
      }
      await new Promise<void>((resolve) => {
        const queue = this.waiting.get(name) ?? [];
        queue.push(resolve);
        this.waiting.set(name, queue);
      });
    }

    this.held.add(name);
    this.grants += 1;
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
      this.waiting.get(name)?.shift()?.();
    }
  }
}

type MessageListener = (event: { data: unknown }) => void;

const buses = new Map<string, Set<FakeBroadcastChannel>>();

/** Delivers to every *other* channel of the same name, asynchronously. */
class FakeBroadcastChannel {
  private readonly listeners = new Set<MessageListener>();

  constructor(readonly name: string) {
    const bus = buses.get(name) ?? new Set<FakeBroadcastChannel>();
    bus.add(this);
    buses.set(name, bus);
  }

  addEventListener(type: string, listener: MessageListener): void {
    if (type === 'message') this.listeners.add(listener);
  }

  postMessage(data: unknown): void {
    for (const peer of buses.get(this.name) ?? []) {
      if (peer === this) continue;
      queueMicrotask(() => {
        for (const listener of peer.listeners) listener({ data });
      });
    }
  }

  close(): void {
    buses.get(this.name)?.delete(this);
  }
}

type FetchLike = (input: unknown, init?: unknown) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: Mock<FetchLike>;
let locks: FakeLockManager;

/** A fresh module instance: one more document of the same origin. */
async function openDocument() {
  vi.resetModules();
  return import('./client');
}

function refreshCount(): number {
  return fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/auth/refresh')).length;
}

beforeEach(() => {
  buses.clear();
  locks = new FakeLockManager();
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  fetchMock = vi.fn<FetchLike>();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'locks');
  vi.resetModules();
});

describe('two documents refreshing at once', () => {
  it('exchanges the cookie once and hands the token to the document that did not', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: 'token-1' }));

    const first = await openDocument();
    const second = await openDocument();

    const outcomes = await Promise.all([first.refreshAccessToken(), second.refreshAccessToken()]);

    expect(outcomes).toEqual(['refreshed', 'refreshed']);
    // The whole point. Two rotations is two chances for the server to read the
    // second as a replayed token.
    expect(refreshCount()).toBe(1);
    expect(locks.refusals).toBe(1);
    expect(first.getAccessToken()).toBe('token-1');
    expect(second.getAccessToken()).toBe('token-1');
  });

  it('sends the waiting document\'s next request with the token it never asked for', async () => {
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(jsonResponse({ accessToken: 'shared' }));
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    const first = await openDocument();
    const second = await openDocument();

    await Promise.all([first.refreshAccessToken(), second.refreshAccessToken()]);
    await second.apiRequest('/me/today');

    const dataCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/me/today'));
    const headers = (dataCall?.[1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe('Bearer shared');
    expect(refreshCount()).toBe(1);
  });

  it('shares a refusal too, so both documents sign out on one 401', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'TOKEN_EXPIRED', message: 'no' } }, 401),
    );

    const first = await openDocument();
    const second = await openDocument();

    const outcomes = await Promise.all([first.refreshAccessToken(), second.refreshAccessToken()]);

    expect(outcomes).toEqual(['unauthenticated', 'unauthenticated']);
    expect(refreshCount()).toBe(1);
    expect(second.getAccessToken()).toBeNull();
  });

  it('shares "no answer" as no answer, rather than letting the second document ask again offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const first = await openDocument();
    const second = await openDocument();

    const outcomes = await Promise.all([first.refreshAccessToken(), second.refreshAccessToken()]);

    // A dropped connection is not a verdict on the session, and it must not be
    // turned into one; it also must not cost a second doomed request.
    expect(outcomes).toEqual(['network-error', 'network-error']);
    expect(refreshCount()).toBe(1);
  });

  it('still exchanges again once the first one has landed', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'token-1' }))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'token-2' }));

    const first = await openDocument();
    const second = await openDocument();

    await Promise.all([first.refreshAccessToken(), second.refreshAccessToken()]);
    expect(refreshCount()).toBe(1);

    // Fifteen minutes later the access token expires for real. A guard that
    // cached the first answer would strand the session instead.
    expect(await second.refreshAccessToken()).toBe('refreshed');
    expect(refreshCount()).toBe(2);
    expect(second.getAccessToken()).toBe('token-2');
  });

  it('falls back to the per-document guard where Web Locks does not exist', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    // A fresh Response per call: a body can only be read once, so reusing one
    // would fail this for the wrong reason - and would have hidden the fact
    // that this path really does send two.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ accessToken: 'token-1' })));

    const first = await openDocument();
    const second = await openDocument();

    const outcomes = await Promise.all([first.refreshAccessToken(), second.refreshAccessToken()]);

    // Two exchanges, which is the behaviour that existed before any of this -
    // no worse, and the browsers concerned are the ones with no Web Locks.
    expect(outcomes).toEqual(['refreshed', 'refreshed']);
    expect(refreshCount()).toBe(2);
  });
});
