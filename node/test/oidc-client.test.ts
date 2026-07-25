import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildAuthorizeUrl,
  defaultOidcRedirectUri,
  hasHub02LaunchContext,
  startSSO,
  autoSSO,
  HUB02_OIDC_CALLBACK_PATH,
} from "../src/oidc-client";

declare global {
  var window: any;
  var document: any;
}

beforeEach(() => {
  const storage = new Map<string, string>();
  const cookies = new Map<string, string>();
  globalThis.sessionStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  } as Storage;

  globalThis.document = {
    get cookie() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(v: string) {
      const pair = v.split(";")[0]?.trim() ?? "";
      const eq = pair.indexOf("=");
      if (eq === -1) return;
      cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    },
  };

  globalThis.window = {
    __HUB02__: undefined,
    location: {
      href: "https://demo.tools.hub02.com/app",
      origin: "https://demo.tools.hub02.com",
      hostname: "demo.tools.hub02.com",
      protocol: "https:",
      search: "",
      assign: vi.fn(),
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).sessionStorage;
});

describe("hasHub02LaunchContext", () => {
  it("detects window.__HUB02__", () => {
    globalThis.window.__HUB02__ = { user_id: "u1" };
    expect(hasHub02LaunchContext()).toBe(true);
  });

  it("detects *.tools.hub02.com", () => {
    expect(hasHub02LaunchContext()).toBe(true);
  });

  it("detects ?hub02= launch param", () => {
    globalThis.window.location.hostname = "example.com";
    globalThis.window.location.search = "?hub02=1";
    expect(hasHub02LaunchContext()).toBe(true);
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds authorize URL with PKCE and persists session", async () => {
    const url = await buildAuthorizeUrl({
      clientId: "hub02_test",
      issuer: "https://id.hub02.com",
      redirectUri: "https://demo.tools.hub02.com/auth/hub02/callback",
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://id.hub02.com");
    expect(parsed.pathname).toBe("/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("hub02_test");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://demo.tools.hub02.com/auth/hub02/callback",
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("code_challenge")).toBeTruthy();
    expect(parsed.searchParams.get("state")).toBeTruthy();
    expect(parsed.searchParams.get("nonce")).toBeTruthy();

    expect(sessionStorage.getItem("hub02_oidc_pkce_verifier")).toBeTruthy();
    expect(document.cookie).toContain("hub02_oidc_pkce_verifier=");
  });

  it("defaults redirect URI from window origin", () => {
    expect(defaultOidcRedirectUri()).toBe(
      `https://demo.tools.hub02.com${HUB02_OIDC_CALLBACK_PATH}`,
    );
  });
});

describe("startSSO / autoSSO", () => {
  it("redirects when Hub02 context is present", async () => {
    const ok = await startSSO({ clientId: "hub02_test", requireHub02Context: true });
    expect(ok).toBe(true);
    expect(window.location.assign).toHaveBeenCalledOnce();
    const assigned = (window.location.assign as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(String(assigned)).toContain("https://id.hub02.com/authorize");
  });

  it("skips outside Hub02 context by default", async () => {
    globalThis.window.location.hostname = "example.com";
    globalThis.window.location.search = "";
    const ok = await startSSO({ clientId: "hub02_test" });
    expect(ok).toBe(false);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("autoSSO skips when isLoggedIn returns true", async () => {
    const ok = await autoSSO({
      clientId: "hub02_test",
      isLoggedIn: async () => true,
    });
    expect(ok).toBe(false);
  });
});
