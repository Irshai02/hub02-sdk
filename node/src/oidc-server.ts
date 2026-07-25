/**
 * Hub02 OIDC — server helpers (code exchange + ID token verification + callback route).
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import {
  HUB02_OIDC_CALLBACK_PATH,
  HUB02_OIDC_COOKIE_NONCE,
  HUB02_OIDC_COOKIE_STATE,
  HUB02_OIDC_COOKIE_VERIFIER,
  HUB02_OIDC_ISSUER_DEFAULT,
  type Hub02OidcTokenResponse,
  type Hub02OidcUser,
  oidcJwksUrl,
} from "./oidc-shared";
import type { RequestLike } from "./server";

export type { Hub02OidcUser, Hub02OidcTokenResponse } from "./oidc-shared";
export { HUB02_OIDC_CALLBACK_PATH, HUB02_OIDC_ISSUER_DEFAULT } from "./oidc-shared";

export class Hub02OidcError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "Hub02OidcError";
    this.status = status;
  }
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

function getOidcJwks(issuer: string): JWTVerifyGetKey {
  const url = oidcJwksUrl(issuer);
  let resolver = jwksCache.get(url);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(url), { cacheMaxAge: 10 * 60 * 1000 });
    jwksCache.set(url, resolver);
  }
  return resolver;
}

function readHeader(req: RequestLike, name: string): string | undefined {
  const headers = req.headers as
    | Record<string, string | string[] | undefined>
    | { get(name: string): string | null };
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  }
  const plain = headers as Record<string, string | string[] | undefined>;
  const v = plain[name] ?? plain[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function readCookie(req: RequestLike, name: string): string | undefined {
  const raw = readHeader(req, "cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function readQueryParam(req: RequestLike & { query?: Record<string, unknown>; url?: string }, key: string): string | undefined {
  const q = req.query?.[key];
  if (typeof q === "string") return q;
  if (Array.isArray(q) && typeof q[0] === "string") return q[0];
  if (req.url) {
    try {
      const u = new URL(req.url, "http://localhost");
      return u.searchParams.get(key) ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface ExchangeHub02CodeOptions {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  issuer?: string;
}

/** Exchange an authorization code at `{issuer}/token`. */
export async function exchangeHub02Code(
  opts: ExchangeHub02CodeOptions,
): Promise<Hub02OidcTokenResponse> {
  const issuer = (opts.issuer ?? HUB02_OIDC_ISSUER_DEFAULT).replace(/\/+$/, "");
  const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });

  const res = await fetch(`${issuer}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Hub02OidcError(
      (json.error_description as string) || (json.error as string) || "token_exchange_failed",
      res.status,
    );
  }
  return json as unknown as Hub02OidcTokenResponse;
}

export interface VerifyHub02IdTokenOptions {
  idToken: string;
  clientId: string;
  issuer?: string;
  /** When set, must match the ID token `nonce` claim. */
  nonce?: string;
  /** Override JWKS resolver (testing or custom key distribution). */
  jwks?: JWTVerifyGetKey;
}

/** Verify an RS256 OIDC ID token from Hub02. */
export async function verifyHub02IdToken(
  opts: VerifyHub02IdTokenOptions,
): Promise<Hub02OidcUser> {
  const issuer = (opts.issuer ?? HUB02_OIDC_ISSUER_DEFAULT).replace(/\/+$/, "");
  const jwks = opts.jwks ?? getOidcJwks(issuer);
  const { payload } = await jwtVerify(opts.idToken, jwks, {
    issuer,
    audience: opts.clientId,
  });

  if (opts.nonce && payload.nonce !== opts.nonce) {
    throw new Hub02OidcError("nonce_mismatch", 401);
  }

  return {
    id: payload.sub as string,
    email: (payload.email as string | undefined) ?? undefined,
    name: (payload.name as string | undefined) ?? undefined,
    hub02ToolId: (payload.hub02_tool_id as string | undefined) ?? undefined,
    nonce: (payload.nonce as string | undefined) ?? undefined,
  };
}

export interface HandleHub02CallbackOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  issuer?: string;
  jwks?: JWTVerifyGetKey;
  onUser: (user: Hub02OidcUser, ctx: { req: RequestLike }) => Promise<void> | void;
}

type WritableResponse = {
  status(code: number): WritableResponse;
  redirect(url: string): unknown;
  json(body: unknown): unknown;
  send(body: string): unknown;
};

/**
 * Handle GET `{redirectUri}` — exchange code, verify ID token, call `onUser`.
 *
 * Works with Express (`req.query`) or Fetch-style handlers (parse `req.url`).
 */
export async function handleHub02Callback(
  req: RequestLike & { query?: Record<string, unknown>; url?: string },
  res: WritableResponse,
  opts: HandleHub02CallbackOptions,
): Promise<void> {
  const err = readQueryParam(req, "error");
  if (err) {
    res.status(400).json({ error: err, error_description: readQueryParam(req, "error_description") });
    return;
  }

  const code = readQueryParam(req, "code");
  const state = readQueryParam(req, "state");
  if (!code || !state) {
    res.status(400).json({ error: "missing_code_or_state" });
    return;
  }

  const expectedState = readCookie(req, HUB02_OIDC_COOKIE_STATE);
  if (!expectedState || expectedState !== state) {
    res.status(400).json({ error: "invalid_state" });
    return;
  }

  const verifier = readCookie(req, HUB02_OIDC_COOKIE_VERIFIER);
  if (!verifier) {
    res.status(400).json({ error: "missing_pkce_verifier" });
    return;
  }

  const nonce = readCookie(req, HUB02_OIDC_COOKIE_NONCE);

  try {
    const tokens = await exchangeHub02Code({
      code,
      redirectUri: opts.redirectUri,
      codeVerifier: verifier,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      issuer: opts.issuer,
    });

    const user = await verifyHub02IdToken({
      idToken: tokens.id_token,
      clientId: opts.clientId,
      issuer: opts.issuer,
      nonce,
      jwks: opts.jwks,
    });

    await opts.onUser(user, { req });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e instanceof Hub02OidcError ? e.status : 401;
    res.status(status).json({ error: "oidc_callback_failed", message: msg });
  }
}

export interface CreateHub02CallbackOptions extends HandleHub02CallbackOptions {
  /** Defaults to `HUB02_OIDC_CALLBACK_PATH`. */
  path?: string;
}

/**
 * Express middleware factory for the OIDC callback route.
 *
 *   app.get("/auth/hub02/callback", createHub02Callback({ ... }));
 */
export function createHub02Callback(opts: CreateHub02CallbackOptions) {
  return async (
    req: RequestLike & { query?: Record<string, unknown>; url?: string },
    res: WritableResponse,
  ) => handleHub02Callback(req, res, opts);
}
