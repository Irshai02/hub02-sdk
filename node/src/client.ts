/**
 * Hub02 SDK — client (browser-safe, zero dependencies).
 *
 * Reads the user's identity that the Hub02 proxy has already established:
 *   1. `window.__HUB02__` (push-injected by the proxy — zero round-trip)
 *   2. fallback: `GET /__hub02/me` (same-origin pull)
 *
 * Usage:
 *   import { hub02 } from "@hub02/sdk";
 *   const user = await hub02.user(); // { id, email, name } | null
 */

import {
  HUB02_ME_PATH,
  HUB02_TOKEN_PATH,
  HUB02_TOKEN_REFRESH_SKEW_SEC,
  type Hub02User,
  type Hub02MeResponse,
  type Hub02WindowIdentity,
  type Hub02Session,
  type Hub02TokenResponse,
  type Hub02Claims,
} from "./shared";

export type {
  Hub02User,
  Hub02MeResponse,
  Hub02Session,
  Hub02Claims,
} from "./shared";

function fromWindow(): Hub02User | null {
  if (typeof window === "undefined") return null;
  const w: Hub02WindowIdentity | undefined = window.__HUB02__;
  if (!w || !w.user_id) return null;
  return {
    id: w.user_id,
    hub_id: w.hub_id,
    tool_id: w.tool_id,
    email: w.email,
    name: w.name,
  };
}

async function fromMe(): Promise<Hub02MeResponse | null> {
  if (typeof fetch === "undefined") return null;
  try {
    const res = await fetch(HUB02_ME_PATH, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      // 401 etc. — caller gets null from user(); onExpire handles redirect.
      try {
        return (await res.json()) as Hub02MeResponse;
      } catch {
        return { authenticated: false };
      }
    }
    return (await res.json()) as Hub02MeResponse;
  } catch {
    return null;
  }
}

/**
 * Resolve the current user, or `null` if not authenticated.
 *
 * Tries the push-injected `window.__HUB02__` first, then falls back to the
 * same-origin `/__hub02/me` endpoint.
 *
 * Some gates only carry `id`/`hub_id`/`tool_id` in the launch identity and omit
 * `email`/`name`. When that happens this lazily fills them from the signed
 * identity token (which is enriched server-side) — so `user().email` is
 * populated everywhere without the app doing anything. The extra token fetch
 * only fires when the email is actually missing, and is cached.
 */
export async function user(): Promise<Hub02User | null> {
  const base = fromWindow() ?? meToUser(await fromMe());
  if (!base) return null;
  if (base.email) return base;

  const claims = await claimsFromToken();
  if (!claims) return base;
  return {
    ...base,
    email: base.email ?? (claims.email as string | undefined),
    name: base.name ?? (claims.name as string | undefined),
  };
}

function meToUser(me: Hub02MeResponse | null): Hub02User | null {
  if (!me || !me.authenticated || !me.user_id) return null;
  return {
    id: me.user_id,
    hub_id: me.hub_id,
    tool_id: me.tool_id,
    email: me.email,
    name: me.name,
  };
}

/** Decoded claims of the current identity token (unverified — display only). */
async function claimsFromToken(): Promise<Hub02Claims | null> {
  try {
    return (await fetchAuthSession()).claims;
  } catch {
    return null;
  }
}

/** True if a user identity is available. */
export async function isAuthenticated(): Promise<boolean> {
  return (await user()) !== null;
}

type ExpireCallback = (info: { login_url?: string }) => void;

/**
 * Register a handler for session expiry.
 *
 * The handler fires when `/__hub02/me` reports `authenticated:false`. By
 * default (no callback supplied, or the callback returns nothing) the SDK
 * performs a top-level redirect to the `login_url` the proxy provides, which
 * re-launches the tool after the user signs in again.
 *
 * Returns an unsubscribe function.
 */
export function onExpire(cb?: ExpireCallback): () => void {
  let cancelled = false;

  const check = async () => {
    if (cancelled) return;
    const me = await fromMe();
    if (cancelled) return;
    if (me && me.authenticated === false) {
      if (cb) {
        cb({ login_url: me.login_url });
      } else if (me.login_url && typeof window !== "undefined") {
        window.location.href = me.login_url;
      }
    }
  };

  // Re-check when the tab regains focus / visibility (cheap, event-driven).
  const onFocus = () => void check();
  if (typeof window !== "undefined") {
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
  }

  // Kick an initial check.
  void check();

  return () => {
    cancelled = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    }
  };
}

// ---- Auth session (Amplify-style) ---------------------------------------

// In-memory only — the JWT is NEVER persisted to storage. The long-lived
// credential stays in the HttpOnly cookie; this is just an ephemeral ≤5-min
// token cached to avoid a network round-trip on every request.
let cachedSession: Hub02Session | null = null;

const emptySession = (): Hub02Session => ({
  token: "",
  claims: null,
  isValid: false,
});

function decodeJwtClaims(token: string): Hub02Claims | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const json =
      typeof atob === "function"
        ? atob(b64 + pad)
        : // Node without atob
          Buffer.from(b64 + pad, "base64").toString("utf8");
    return JSON.parse(json) as Hub02Claims;
  } catch {
    return null;
  }
}

function sessionFromToken(token: string, exp?: number): Hub02Session {
  const claims = decodeJwtClaims(token);
  const expiresAt = exp ?? claims?.exp;
  return {
    token,
    claims,
    userSub: claims?.sub,
    hubId: claims?.hub_id,
    toolId: claims?.tool_id,
    expiresAt,
    isValid:
      !!token && (expiresAt === undefined || expiresAt * 1000 > Date.now()),
  };
}

/** A cached session is reusable only if it won't expire within the skew window. */
function sessionStillFresh(s: Hub02Session | null): s is Hub02Session {
  if (!s || !s.isValid || !s.expiresAt) return false;
  return s.expiresAt * 1000 - Date.now() > HUB02_TOKEN_REFRESH_SKEW_SEC * 1000;
}

/**
 * Fetch (or reuse) the current auth session.
 *
 * Returns a short-lived signed JWT plus decoded claims. The token is cached in
 * memory and auto-refreshed before it expires; pass `{ forceRefresh: true }` to
 * mint a fresh one immediately. Calls the same-origin `/__hub02/token` endpoint,
 * which is authenticated by the HttpOnly session cookie.
 */
export async function fetchAuthSession(opts?: {
  forceRefresh?: boolean;
}): Promise<Hub02Session> {
  if (!opts?.forceRefresh && sessionStillFresh(cachedSession)) {
    return cachedSession;
  }
  if (typeof fetch === "undefined") return cachedSession ?? emptySession();
  try {
    const res = await fetch(HUB02_TOKEN_PATH, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      cachedSession = emptySession();
      return cachedSession;
    }
    const data = (await res.json()) as Hub02TokenResponse;
    if (!data.token) {
      cachedSession = emptySession();
      return cachedSession;
    }
    cachedSession = sessionFromToken(data.token, data.exp);
    return cachedSession;
  } catch {
    return cachedSession ?? emptySession();
  }
}

/** Sugar for `(await fetchAuthSession()).token`. Returns "" when unauthenticated. */
export async function token(): Promise<string> {
  return (await fetchAuthSession()).token;
}

/** Header name the Hub02 gate and backends expect the identity token under. */
export const HUB02_AUTH_HEADER = "X-Hub02-Auth";

/**
 * Ready-to-spread auth header for calls to your backend.
 *
 * Returns `{ "X-Hub02-Auth": <token> }` when running inside Hub02, or `{}`
 * otherwise — so a request outside Hub02 carries nothing extra and your app's
 * existing auth is left untouched.
 *
 *   // fetch:
 *   fetch(url, { headers: { ...myHeaders, ...(await hub02.authHeaders()) } });
 *
 *   // axios (once, in an interceptor):
 *   api.interceptors.request.use(async (c) => {
 *     Object.assign(c.headers, await hub02.authHeaders());
 *     return c;
 *   });
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const t = await token();
  return t ? { [HUB02_AUTH_HEADER]: t } : {};
}

/**
 * `fetch` that auto-attaches the Hub02 identity header when inside Hub02.
 *
 * Same signature as the global `fetch`; existing headers are preserved. Outside
 * Hub02 it's a plain `fetch` (no header added).
 *
 *   const res = await hub02.authFetch("/api/tenants");
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const extra = await authHeaders();
  return fetch(input, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), ...extra },
  });
}

// ---- Global fetch interceptor -------------------------------------------

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  try {
    return (input as Request).url ?? "";
  } catch {
    return "";
  }
}

/**
 * Default target check: attach the identity to this app's own backend only —
 * same-origin requests, plus Supabase Edge Functions (`*.supabase.co/functions/*`,
 * where the builder controls CORS). Never third-party origins, and never
 * Supabase REST/auth (adding a custom header there forces a preflight that can
 * break RLS queries).
 */
function defaultShouldAttach(url: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const u = new URL(url, window.location.origin);
    if (u.hostname.endsWith(".supabase.co")) return u.pathname.startsWith("/functions/");
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

export interface FetchInterceptorOptions {
  /**
   * Decide which request URLs get the `X-Hub02-Auth` header. Defaults to this
   * app's own backend (same-origin + Supabase Edge Functions). Return `true` to
   * attach. Hub02's own `/__hub02/*` endpoints are ALWAYS skipped regardless.
   */
  shouldAttach?: (url: string) => boolean;
}

/**
 * Wrap `window.fetch` so the Hub02 identity (`X-Hub02-Auth`) is attached to your
 * backend requests automatically — the one line that replaces a hand-written
 * interceptor. Additive: outside Hub02 nothing is added.
 *
 *   // in your app entry (main.tsx / index.tsx), once:
 *   import { hub02 } from "@hub02/sdk";
 *   hub02.installFetchInterceptor();
 *
 * It safely handles the footguns: it NEVER intercepts Hub02's own `/__hub02/*`
 * calls (doing so recurses into token-minting → request storm → 429), and by
 * default only attaches to your own backend, never third parties.
 *
 * Returns an uninstaller. Calling it more than once is a no-op (idempotent).
 */
export function installFetchInterceptor(
  opts?: FetchInterceptorOptions,
): () => void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return () => {};
  }
  // Idempotent: don't double-wrap (React StrictMode / HMR / repeated calls).
  if ((window.fetch as { __hub02__?: boolean }).__hub02__) {
    return () => {};
  }

  const rawFetch = window.fetch;
  const originalFetch = rawFetch.bind(window);
  const shouldAttach = opts?.shouldAttach ?? defaultShouldAttach;

  const wrapped = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = requestUrl(input);
    // NEVER touch Hub02's own endpoints — the SDK fetches its token there, and
    // intercepting that call recurses into itself (request storm → CF 1015).
    if (!url || url.includes(HUB02_ME_PATH) || url.includes(HUB02_TOKEN_PATH) || !shouldAttach(url)) {
      return originalFetch(input as RequestInfo, init);
    }
    try {
      const extra = await authHeaders();
      if (Object.keys(extra).length > 0) {
        const headers = new Headers(
          init.headers || (input instanceof Request ? input.headers : undefined),
        );
        for (const [k, v] of Object.entries(extra)) headers.set(k, v);
        init = { ...init, headers };
      }
    } catch {
      /* proceed with the original request */
    }
    return originalFetch(input as RequestInfo, init);
  };
  (wrapped as { __hub02__?: boolean }).__hub02__ = true;

  window.fetch = wrapped as typeof window.fetch;
  return () => {
    if (window.fetch === (wrapped as typeof window.fetch)) {
      window.fetch = rawFetch;
    }
  };
}

/**
 * True when the app is running inside Hub02 (behind the Hub02 gate) — i.e. the
 * visitor arrived through Hub02 and is already signed in. Use it to decide
 * whether to bypass your app's own login screen. Detects the Hub02 tool domain
 * (`*.tools.hub02.com`) or the proxy-injected `window.__HUB02__`.
 *
 * For a definitive identity check, use `await hub02.user()` (non-null only in
 * Hub02 context). `isHub02Domain()` is the cheap synchronous signal.
 */
export function isHub02Domain(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__HUB02__) return true;
  return /\.tools\.hub02\.com$/i.test(window.location.hostname);
}

/**
 * Send the user to Hub02 sign-in (e.g. after logout, or if identity is missing).
 * Uses the `login_url` the gate provides, falling back to Hub02's auth page.
 */
export async function login(): Promise<void> {
  if (typeof window === "undefined") return;
  let url: string | undefined;
  try {
    const me = (await fetch(HUB02_ME_PATH, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    }).then((r) => r.json())) as Hub02MeResponse;
    url = me?.login_url;
  } catch {
    /* fall through to default */
  }
  window.location.href =
    url ??
    `https://hub02.com/auth?mode=signin&return_url=${encodeURIComponent(window.location.href)}`;
}

/** Namespaced client object — the primary entry point. */
export const hub02 = {
  user,
  isAuthenticated,
  onExpire,
  fetchAuthSession,
  token,
  authHeaders,
  authFetch,
  installFetchInterceptor,
  isHub02Domain,
  login,
};

export default hub02;
