import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  hub02,
  user,
  isAuthenticated,
  onExpire,
  fetchAuthSession,
  token,
  authHeaders,
  authFetch,
  installFetchInterceptor,
  connectSupabase,
} from "../src/client";

/** Build a fake (unsigned) JWT with the given payload — for decode tests only. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJFZERTQSJ9.${b64}.sig`;
}

declare global {
  var window: any;
  var document: any;
}

beforeEach(() => {
  // Fresh fake window/document per test.
  globalThis.window = {
    __HUB02__: undefined,
    location: { href: "https://tool.example/app" },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  globalThis.document = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).window;
  delete (globalThis as any).document;
});

describe("hub02.user()", () => {
  it("returns identity from window.__HUB02__ (push)", async () => {
    globalThis.window.__HUB02__ = {
      user_id: "u-1",
      hub_id: "h-1",
      tool_id: "t-1",
      email: "x@y.com",
      name: "Linus",
    };
    const u = await user();
    expect(u).toEqual({
      id: "u-1",
      hub_id: "h-1",
      tool_id: "t-1",
      email: "x@y.com",
      name: "Linus",
    });
    // fetch should not be needed.
  });

  it("falls back to GET /__hub02/me (pull)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        user_id: "u-2",
        hub_id: "h-2",
        tool_id: "t-2",
        email: "p@q.com",
      }),
    });
    globalThis.fetch = fetchMock as any;

    const u = await user();
    expect(fetchMock).toHaveBeenCalledWith(
      "/__hub02/me",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(u?.id).toBe("u-2");
    expect(u?.email).toBe("p@q.com");
  });

  it("returns null when /me says not authenticated", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ authenticated: false, login_url: "https://login" }),
    }) as any;
    expect(await user()).toBeNull();
    expect(await isAuthenticated()).toBe(false);
  });
});

describe("hub02.onExpire()", () => {
  it("redirects to login_url by default on expiry", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        authenticated: false,
        login_url: "https://hub02/login?return=app",
      }),
    }) as any;

    onExpire();
    // Allow the async initial check to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.window.location.href).toBe(
      "https://hub02/login?return=app",
    );
  });

  it("invokes a custom callback instead of redirecting", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        authenticated: false,
        login_url: "https://hub02/login",
      }),
    }) as any;
    const cb = vi.fn();
    onExpire(cb);
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).toHaveBeenCalledWith({ login_url: "https://hub02/login" });
    // No redirect happened.
    expect(globalThis.window.location.href).toBe("https://tool.example/app");
  });
});

describe("hub02.fetchAuthSession()", () => {
  it("mints, decodes, caches, and force-refreshes", async () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const jwt = fakeJwt({ sub: "u-9", hub_id: "h-9", tool_id: "t-9", exp });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: jwt, exp }),
    });
    globalThis.fetch = fetchMock as any;

    const s = await fetchAuthSession({ forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/__hub02/token",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(s.token).toBe(jwt);
    expect(s.isValid).toBe(true);
    expect(s.userSub).toBe("u-9");
    expect(s.hubId).toBe("h-9");
    expect(s.toolId).toBe("t-9");
    expect(s.claims?.sub).toBe("u-9");

    // Second call reuses the in-memory cache (no extra fetch).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await token()).toBe(jwt);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // forceRefresh re-mints.
    await fetchAuthSession({ forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an invalid session when /__hub02/token says no", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ authenticated: false, login_url: "https://login" }),
    }) as any;
    const s = await fetchAuthSession({ forceRefresh: true });
    expect(s.isValid).toBe(false);
    expect(s.token).toBe("");
    expect(await token()).toBe("");
  });
});

describe("hub02.authHeaders() / authFetch()", () => {
  const exp = () => Math.floor(Date.now() / 1000) + 300;

  it("returns { X-Hub02-Auth } when a token is available", async () => {
    const jwt = fakeJwt({ sub: "u-h", exp: exp() });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: jwt, exp: exp() }),
    }) as any;
    await fetchAuthSession({ forceRefresh: true }); // prime cache
    expect(await authHeaders()).toEqual({ "X-Hub02-Auth": jwt });
  });

  it("returns {} when there is no token (outside Hub02)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ authenticated: false }),
    }) as any;
    await fetchAuthSession({ forceRefresh: true });
    expect(await authHeaders()).toEqual({});
  });

  it("authFetch merges the auth header without dropping existing ones", async () => {
    const jwt = fakeJwt({ sub: "u-af", exp: exp() });
    const fetchMock = vi
      .fn()
      // first call: mint token
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: jwt, exp: exp() }) })
      // second call: the actual request
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    globalThis.fetch = fetchMock as any;
    await fetchAuthSession({ forceRefresh: true });

    await authFetch("/api/x", { headers: { "X-Existing": "1" } });
    const lastInit = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1];
    expect(lastInit.headers).toMatchObject({
      "X-Existing": "1",
      "X-Hub02-Auth": jwt,
    });
  });
});

describe("hub02.user() email enrichment", () => {
  const now = () => Math.floor(Date.now() / 1000);

  it("fills email/name from the token when /__hub02/me omits them", async () => {
    const exp = now() + 300;
    const jwt = fakeJwt({ sub: "u-e", email: "e@fill.com", name: "Fill", exp });
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes("/__hub02/token"))
        return { ok: true, json: async () => ({ token: jwt, exp }) };
      // /__hub02/me: authenticated, but NO email/name (launch-cookie gate).
      return { ok: true, json: async () => ({ authenticated: true, user_id: "u-e" }) };
    }) as any;

    await fetchAuthSession({ forceRefresh: true }); // prime the token cache
    const u = await user();
    expect(u?.id).toBe("u-e");
    expect(u?.email).toBe("e@fill.com"); // pulled from the token, not /me
    expect(u?.name).toBe("Fill");
  });

  it("does NOT fetch the token when /me already has the email", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ authenticated: true, user_id: "u-h", email: "has@me.com" }),
    }));
    globalThis.fetch = fetchMock as any;
    const u = await user();
    expect(u?.email).toBe("has@me.com");
    // only /me was called — no /__hub02/token round-trip.
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("/token"))).toBe(true);
  });
});

describe("hub02.installFetchInterceptor()", () => {
  const now = () => Math.floor(Date.now() / 1000);

  it("attaches to backend, skips /__hub02/ + third parties, idempotent, uninstalls", async () => {
    const exp = now() + 300;
    const jwt = fakeJwt({ sub: "u-i", exp });
    // Token mint goes through the global fetch:
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ token: jwt, exp }) }) as any;
    await fetchAuthSession({ forceRefresh: true }); // prime token cache

    // The app's real fetch that the interceptor wraps:
    const original = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.window.location = {
      origin: "https://tool.example",
      href: "https://tool.example/app",
      hostname: "tool.example",
    };
    globalThis.window.fetch = original;

    const uninstall = installFetchInterceptor();
    const secondNoop = installFetchInterceptor(); // idempotent — must not re-wrap
    expect((globalThis.window.fetch as any).__hub02__).toBe(true);

    const headerOf = () => {
      const init = original.mock.calls.at(-1)?.[1];
      return new Headers(init?.headers || {}).get("X-Hub02-Auth");
    };

    await (globalThis.window.fetch as any)("https://tool.example/api/trips"); // same-origin backend
    expect(headerOf()).toBe(jwt);

    await (globalThis.window.fetch as any)("https://tool.example/__hub02/token"); // SDK-internal
    expect(headerOf()).toBeNull();

    await (globalThis.window.fetch as any)("https://evil.com/collect"); // third party
    expect(headerOf()).toBeNull();

    uninstall();
    expect(globalThis.window.fetch).toBe(original);
    secondNoop(); // no-op, safe to call
  });
});

describe("hub02.connectSupabase()", () => {
  const now = () => Math.floor(Date.now() / 1000);

  function fakeSupabase(overrides: Partial<{
    session: unknown;
    invokeData: unknown;
    invokeError: unknown;
  }> = {}) {
    const calls: Record<string, unknown[]> = {};
    return {
      calls,
      auth: {
        getSession: vi.fn(async () => ({ data: { session: overrides.session ?? null } })),
        setSession: vi.fn(async (t: unknown) => {
          calls.setSession = [t];
          return { data: { session: { via: "setSession" } }, error: null };
        }),
        verifyOtp: vi.fn(async (p: unknown) => {
          calls.verifyOtp = [p];
          return { data: { session: { via: "verifyOtp" } }, error: null };
        }),
      },
      functions: {
        invoke: vi.fn(async (name: string, o: unknown) => {
          calls.invoke = [name, o];
          return { data: overrides.invokeData ?? null, error: overrides.invokeError ?? null };
        }),
      },
    };
  }

  function primeToken() {
    const jwt = fakeJwt({ sub: "u-sb", email: "s@b.com", exp: now() + 300 });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ token: jwt, exp: now() + 300 }) }) as any;
    return jwt;
  }

  it("returns null and does nothing when not inside Hub02 (no token)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as any;
    await fetchAuthSession({ forceRefresh: true });
    const sb = fakeSupabase();
    expect(await connectSupabase(sb as any)).toBeNull();
    expect(sb.functions.invoke).not.toHaveBeenCalled();
  });

  it("reuses an existing session when it belongs to the Hub02 user", async () => {
    primeToken(); // Hub02 identity email = s@b.com
    await fetchAuthSession({ forceRefresh: true });
    globalThis.window.__HUB02__ = { user_id: "u-sb", email: "s@b.com" };
    const sb = fakeSupabase({
      session: { existing: true, user: { email: "S@B.com" } }, // case-insensitive
    });
    const s = await connectSupabase(sb as any);
    expect(s).toMatchObject({ existing: true });
    expect(sb.functions.invoke).not.toHaveBeenCalled();
  });

  it("does NOT inherit a session belonging to a different user — re-exchanges", async () => {
    primeToken(); // Hub02 identity email = s@b.com
    await fetchAuthSession({ forceRefresh: true });
    globalThis.window.__HUB02__ = { user_id: "u-sb", email: "s@b.com" };
    const sb = fakeSupabase({
      session: { existing: true, user: { email: "someone-else@x.com" } },
      invokeData: { access_token: "at", refresh_token: "rt" },
    });
    const s = await connectSupabase(sb as any);
    expect(sb.functions.invoke).toHaveBeenCalled(); // stale session rejected
    expect(s).toEqual({ via: "setSession" });
  });

  it("exchanges via the edge function and verifies token_hash", async () => {
    const jwt = primeToken();
    await fetchAuthSession({ forceRefresh: true });
    const sb = fakeSupabase({ invokeData: { token_hash: "th-123" } });
    const s = await connectSupabase(sb as any);
    expect(sb.functions.invoke).toHaveBeenCalledWith(
      "hub02-supabase-session",
      { headers: { "X-Hub02-Auth": jwt } },
    );
    expect(sb.calls.verifyOtp?.[0]).toEqual({ token_hash: "th-123", type: "email" });
    expect(s).toEqual({ via: "verifyOtp" });
  });

  it("accepts an access/refresh token pair via setSession", async () => {
    primeToken();
    await fetchAuthSession({ forceRefresh: true });
    const sb = fakeSupabase({
      invokeData: { access_token: "at", refresh_token: "rt" },
    });
    const s = await connectSupabase(sb as any);
    expect(sb.calls.setSession?.[0]).toEqual({ access_token: "at", refresh_token: "rt" });
    expect(s).toEqual({ via: "setSession" });
  });
});

describe("namespaced export", () => {
  it("exposes the full client surface", () => {
    expect(typeof hub02.user).toBe("function");
    expect(typeof hub02.isAuthenticated).toBe("function");
    expect(typeof hub02.onExpire).toBe("function");
    expect(typeof hub02.fetchAuthSession).toBe("function");
    expect(typeof hub02.token).toBe("function");
    expect(typeof hub02.authHeaders).toBe("function");
    expect(typeof hub02.authFetch).toBe("function");
    expect(typeof hub02.installFetchInterceptor).toBe("function");
    expect(typeof hub02.connectSupabase).toBe("function");
    expect(typeof hub02.isHub02Domain).toBe("function");
    expect(typeof hub02.login).toBe("function");
  });
});
