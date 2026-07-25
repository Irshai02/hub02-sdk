/**
 * Hub02 OIDC — browser client (start Sign in with Hub02 via authorization-code + PKCE).
 */

import {
  HUB02_OIDC_CALLBACK_PATH,
  HUB02_OIDC_COOKIE_NONCE,
  HUB02_OIDC_COOKIE_STATE,
  HUB02_OIDC_COOKIE_VERIFIER,
  HUB02_OIDC_DEFAULT_SCOPE,
  HUB02_OIDC_ISSUER_DEFAULT,
  HUB02_OIDC_STORAGE_NONCE,
  HUB02_OIDC_STORAGE_STATE,
  HUB02_OIDC_STORAGE_VERIFIER,
  generatePkce,
} from "./oidc-shared";

export type {
  Hub02OidcUser,
  Hub02OidcTokenResponse,
} from "./oidc-shared";

export {
  HUB02_OIDC_CALLBACK_PATH,
  HUB02_OIDC_ISSUER_DEFAULT,
} from "./oidc-shared";

export interface StartSSOOptions {
  /** From builder dashboard → OIDC / SSO. */
  clientId: string;
  /** Defaults to `{origin}/auth/hub02/callback`. */
  redirectUri?: string;
  /** Defaults to `https://id.hub02.com`. */
  issuer?: string;
  /** Defaults to `openid profile email`. */
  scope?: string;
  /**
   * When true (default), no-op outside Hub02 launch context / tool domain.
   * Set false only for testing.
   */
  requireHub02Context?: boolean;
}

function setCookie(name: string, value: string, maxAgeSec = 600): void {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
}

function persistOidcSession(verifier: string, state: string, nonce: string): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(HUB02_OIDC_STORAGE_VERIFIER, verifier);
    sessionStorage.setItem(HUB02_OIDC_STORAGE_STATE, state);
    sessionStorage.setItem(HUB02_OIDC_STORAGE_NONCE, nonce);
  }
  setCookie(HUB02_OIDC_COOKIE_VERIFIER, verifier);
  setCookie(HUB02_OIDC_COOKIE_STATE, state);
  setCookie(HUB02_OIDC_COOKIE_NONCE, nonce);
}

/** True on `*.tools.hub02.com` or when launch context is present. */
export function hasHub02LaunchContext(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__HUB02__) return true;
  if (/\.tools\.hub02\.com$/i.test(window.location.hostname)) return true;
  return new URLSearchParams(window.location.search).has("hub02");
}

/** Default callback URL for the current origin. */
export function defaultOidcRedirectUri(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${HUB02_OIDC_CALLBACK_PATH}`;
}

/** Build the authorize URL (does not redirect). */
export async function buildAuthorizeUrl(opts: StartSSOOptions): Promise<string> {
  const issuer = (opts.issuer ?? HUB02_OIDC_ISSUER_DEFAULT).replace(/\/+$/, "");
  const redirectUri = opts.redirectUri ?? defaultOidcRedirectUri();
  const { verifier, challenge, state, nonce } = await generatePkce();
  persistOidcSession(verifier, state, nonce);

  const url = new URL(`${issuer}/authorize`);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", opts.scope ?? HUB02_OIDC_DEFAULT_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Start the Hub02 OIDC login redirect.
 * @returns `true` if a redirect was initiated, `false` if skipped (wrong context).
 */
export async function startSSO(opts: StartSSOOptions): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const requireCtx = opts.requireHub02Context !== false;
  if (requireCtx && !hasHub02LaunchContext()) return false;

  const url = await buildAuthorizeUrl(opts);
  window.location.assign(url);
  return true;
}

export interface AutoSSOOptions extends StartSSOOptions {
  /** Return true when the user already has a native app session. */
  isLoggedIn?: () => boolean | Promise<boolean>;
}

/**
 * On Hub02 launch, redirect to OIDC unless the user already has a native session.
 * Call once at app startup (e.g. in `main.tsx`).
 */
export async function autoSSO(opts: AutoSSOOptions): Promise<boolean> {
  if (opts.isLoggedIn && (await opts.isLoggedIn())) return false;
  return startSSO(opts);
}
