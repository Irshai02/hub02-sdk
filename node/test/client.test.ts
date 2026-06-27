import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hub02, user, isAuthenticated, onExpire } from "../src/client";

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

describe("namespaced export", () => {
  it("exposes user/isAuthenticated/onExpire", () => {
    expect(typeof hub02.user).toBe("function");
    expect(typeof hub02.isAuthenticated).toBe("function");
    expect(typeof hub02.onExpire).toBe("function");
  });
});
