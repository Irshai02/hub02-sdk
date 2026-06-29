/**
 * Shared constants and types for the Hub02 SDK.
 *
 * These pin the contract so the client and server halves cannot drift:
 *   - JWKS endpoint (public Ed25519 keys)
 *   - token issuer (`iss`)
 *   - token audience (`aud`)
 *
 * Token algorithm is EdDSA / Ed25519 (NOT ES256).
 */

/** Public JWKS endpoint exposing Hub02's Ed25519 verification keys. */
export const HUB02_JWKS_URL =
  "https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks";

/** Expected `iss` claim on a Hub02 identity token. */
export const HUB02_ISS = "hub02";

/** Expected `aud` claim on a Hub02 identity token. */
export const HUB02_AUD = "tool-identity";

/** Signing / verification algorithm. EdDSA over the Ed25519 curve. */
export const HUB02_ALG = "EdDSA";

/** Same-origin pull endpoint the proxy exposes for client identity. */
export const HUB02_ME_PATH = "/__hub02/me";

/** Same-origin endpoint the proxy exposes to mint a short-lived identity JWT. */
export const HUB02_TOKEN_PATH = "/__hub02/token";

/**
 * Re-mint the token this many seconds before it actually expires, so an
 * in-flight request never carries an about-to-expire token.
 */
export const HUB02_TOKEN_REFRESH_SKEW_SEC = 30;

/**
 * Identity returned to application code.
 *
 * `id` is the durable Hub02 user UUID (the `sub` claim) — builders MUST key
 * their data on this. `email` / `name` are display-only and may change.
 */
export interface Hub02User {
  /** Durable Hub02 user UUID (token `sub`). Key your data on this. */
  id: string;
  /** Hub the user launched from. */
  hub_id?: string;
  /** Tool this identity is scoped to. */
  tool_id?: string;
  /** Display-only; may change. Do not key data on this. */
  email?: string;
  /** Display-only; may change. */
  name?: string;
}

/**
 * Raw verified claims from a Hub02 identity JWT.
 */
export interface Hub02Claims {
  /** Subject — the durable Hub02 user UUID. */
  sub: string;
  iss: string;
  aud: string | string[];
  hub_id?: string;
  tool_id?: string;
  email?: string;
  name?: string;
  iat?: number;
  exp?: number;
  [claim: string]: unknown;
}

/** Shape pushed onto `window.__HUB02__` by the proxy. */
export interface Hub02WindowIdentity {
  user_id: string;
  hub_id?: string;
  tool_id?: string;
  email?: string;
  name?: string;
  exp?: number;
}

/** Shape returned by `GET /__hub02/token`. */
export interface Hub02TokenResponse {
  token?: string;
  exp?: number;
  authenticated?: boolean;
  login_url?: string;
}

/**
 * Amplify-style auth session returned by `hub02.fetchAuthSession()`.
 *
 * `token` is the short-lived signed JWT to attach as a Bearer credential.
 * `claims` are decoded (NOT verified — verification is the backend's job).
 */
export interface Hub02Session {
  /** Signed identity JWT (Bearer). Empty string when not authenticated. */
  token: string;
  /** Decoded token claims (unverified), or null when not authenticated. */
  claims: Hub02Claims | null;
  /** Durable Hub02 user UUID (token `sub`). */
  userSub?: string;
  hubId?: string;
  toolId?: string;
  /** Token expiry (epoch seconds). */
  expiresAt?: number;
  /** True when a non-expired token is present. */
  isValid: boolean;
}

/** Shape returned by `GET /__hub02/me`. */
export interface Hub02MeResponse {
  authenticated: boolean;
  user_id?: string;
  hub_id?: string;
  tool_id?: string;
  email?: string;
  name?: string;
  exp?: number;
  login_url?: string;
}

/** Error thrown when token verification or authorization fails. */
export class Hub02AuthError extends Error {
  /** HTTP status a framework handler should return (always 401). */
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "Hub02AuthError";
  }
}

/** Map verified claims to the public `Hub02User` shape. */
export function claimsToUser(claims: Hub02Claims): Hub02User {
  return {
    id: claims.sub,
    hub_id: claims.hub_id,
    tool_id: claims.tool_id,
    email: claims.email,
    name: claims.name,
  };
}

declare global {
  interface Window {
    __HUB02__?: Hub02WindowIdentity;
  }
}
