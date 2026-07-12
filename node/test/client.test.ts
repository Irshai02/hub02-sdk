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

describe("namespaced export", () => {
  it("exposes the full client surface", () => {
    expect(typeof hub02.user).toBe("function");
    expect(typeof hub02.isAuthenticated).toBe("function");
    expect(typeof hub02.onExpire).toBe("function");
    expect(typeof hub02.fetchAuthSession).toBe("function");
    expect(typeof hub02.token).toBe("function");
    expect(typeof hub02.authHeaders).toBe("function");
    expect(typeof hub02.authFetch).toBe("function");
    expect(typeof hub02.isHub02Domain).toBe("function");
    expect(typeof hub02.login).toBe("function");
  });
});
