/**
 * Hub02 SDK — server (Node / edge).
 *
 * Verifies Hub02 identity JWTs against the public JWKS using Ed25519, and
 * provides framework helpers (generic + Express) that turn a request into a
 * trusted `Hub02User`.
 *
 * SECURITY: always read `user.id` from the verified token — never from a
 * client-supplied field.
 *
 * Usage:
 *   import { authenticateHub02 } from "@hub02/sdk/server";
 *   app.get("/my-plan", async (req, res) => {
 *     const user = await authenticateHub02(req);
 *     res.json(getPlan(user.id));
 *   });
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import {
  HUB02_ALG,
  HUB02_AUD,
  HUB02_ISS,
  HUB02_JWKS_URL,
  Hub02AuthError,
  claimsToUser,
  type Hub02Claims,
  type Hub02User,
} from "./shared";

export {
  Hub02AuthError,
  type Hub02Claims,
  type Hub02User,
} from "./shared";

export interface VerifyOptions {
  /** Override the JWKS endpoint (tests). */
  jwksUrl?: string;
  /** Provide a custom key resolver (tests / advanced). Overrides `jwksUrl`. */
  jwks?: JWTVerifyGetKey;
  /** If set, the token's `tool_id` claim must equal this value. */
  toolId?: string;
  /** Clock skew tolerance in seconds (default 5). */
  clockToleranceSec?: number;
}

// JWKS cache keyed by endpoint URL. createRemoteJWKSet caches keys by `kid`
// with its own TTL and refetches on an unknown `kid`.
const jwksCache = new Map<string, JWTVerifyGetKey>();

function getJwks(opts?: VerifyOptions): JWTVerifyGetKey {
  if (opts?.jwks) return opts.jwks;
  const url = opts?.jwksUrl ?? HUB02_JWKS_URL;
  let resolver = jwksCache.get(url);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 10 * 60 * 1000, // 10 minutes
    });
    jwksCache.set(url, resolver);
  }
  return resolver;
}

/**
 * Verify a Hub02 identity JWT.
 *
 * Checks: Ed25519 signature vs JWKS, `iss === "hub02"`, `aud ===
 * "tool-identity"`, `exp` not passed (with small leeway), and — if
 * `opts.toolId` is supplied — that the `tool_id` claim matches.
 *
 * @throws {Hub02AuthError} when verification fails.
 */
export async function verifyHub02Token(
  jwt: string,
  opts?: VerifyOptions,
): Promise<Hub02Claims> {
  if (!jwt || typeof jwt !== "string") {
    throw new Hub02AuthError("Missing token");
  }
  const jwks = getJwks(opts);
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(jwt, jwks, {
      issuer: HUB02_ISS,
      audience: HUB02_AUD,
      algorithms: [HUB02_ALG],
      clockTolerance: opts?.clockToleranceSec ?? 5,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Hub02AuthError(`Token verification failed: ${msg}`);
  }

  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Hub02AuthError("Token missing sub claim");
  }

  if (opts?.toolId && payload.tool_id !== opts.toolId) {
    throw new Hub02AuthError(
      `Token tool_id mismatch (expected ${opts.toolId})`,
    );
  }

  return payload as unknown as Hub02Claims;
}

/** Minimal request shape both Express and generic handlers satisfy. */
export interface RequestLike {
  headers:
    | Record<string, string | string[] | undefined>
    | { get(name: string): string | null };
}

function readHeader(req: RequestLike, name: string): string | undefined {
  const headers = req.headers as
    | Record<string, string | string[] | undefined>
    | { get(name: string): string | null };
  // Fetch API Headers (has .get)
  if (typeof (headers as { get?: unknown }).get === "function") {
    const v = (headers as { get(n: string): string | null }).get(name);
    return v ?? undefined;
  }
  const plain = headers as Record<string, string | string[] | undefined>;
  const v = plain[name] ?? plain[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}

/**
 * Extract the identity token from a request.
 *
 * Order: `X-Hub02-Auth` (set by the proxy) → `Authorization: Bearer <jwt>`.
 */
export function extractToken(req: RequestLike): string | undefined {
  const direct = readHeader(req, "x-hub02-auth");
  if (direct) return direct.replace(/^Bearer\s+/i, "").trim();
  const auth = readHeader(req, "authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  return undefined;
}

/**
 * Verify the request's identity token and return the trusted user.
 *
 * @throws {Hub02AuthError} (status 401) when no valid token is present.
 */
export async function authenticateHub02(
  req: RequestLike,
  opts?: VerifyOptions,
): Promise<Hub02User> {
  const token = extractToken(req);
  if (!token) {
    throw new Hub02AuthError("No Hub02 identity token on request");
  }
  const claims = await verifyHub02Token(token, opts);
  return claimsToUser(claims);
}

// ---- Express middleware -------------------------------------------------

/** Express-ish request/response/next types (kept local to avoid a dep). */
type ExpressReq = RequestLike & { hub02User?: Hub02User };
interface ExpressRes {
  status(code: number): ExpressRes;
  json(body: unknown): unknown;
}
type ExpressNext = (err?: unknown) => void;

/**
 * Express middleware that verifies the Hub02 identity token and attaches the
 * user to `req.hub02User`. Responds `401 { authenticated:false }` on failure.
 *
 * Usage:
 *   app.use(hub02Auth());
 *   app.get("/me", (req, res) => res.json(req.hub02User));
 */
export function hub02Auth(opts?: VerifyOptions) {
  return async (req: ExpressReq, res: ExpressRes, next: ExpressNext) => {
    try {
      req.hub02User = await authenticateHub02(req, opts);
      next();
    } catch (err) {
      if (err instanceof Hub02AuthError) {
        res.status(401).json({ authenticated: false, error: err.message });
        return;
      }
      next(err);
    }
  };
}
