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

import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
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

/**
 * Like {@link authenticateHub02}, but returns `null` instead of throwing when
 * the request carries NO Hub02 identity — so you can fall back to your app's
 * own auth on the same route.
 *
 * Rules:
 *  - `X-Hub02-Auth` present → verify it (throws {@link Hub02AuthError} on an
 *    invalid/expired/tampered token — that channel is unambiguously Hub02).
 *  - Only an `Authorization: Bearer` present → used ONLY if it is a Hub02 token
 *    (`iss === "hub02"`); a foreign or opaque bearer is ignored (returns
 *    `null`), so your unrelated bearer-auth routes keep working.
 *  - Neither present → `null`.
 *
 * Typical use:
 *   const hub02User = await tryAuthenticateHub02(req);
 *   const user = hub02User
 *     ? findOrCreateByEmail(hub02User.email)   // Hub02 identity
 *     : myExistingAuth(req);                    // native fallback
 */
export async function tryAuthenticateHub02(
  req: RequestLike,
  opts?: VerifyOptions,
): Promise<Hub02User | null> {
  const direct = readHeader(req, "x-hub02-auth");
  if (direct) {
    const claims = await verifyHub02Token(
      direct.replace(/^Bearer\s+/i, "").trim(),
      opts,
    );
    return claimsToUser(claims);
  }
  const auth = readHeader(req, "authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    const raw = auth.replace(/^Bearer\s+/i, "").trim();
    let iss: unknown;
    try {
      iss = decodeJwt(raw).iss;
    } catch {
      return null; // not a JWT (opaque token) — not ours
    }
    if (iss !== HUB02_ISS) return null; // someone else's bearer — leave it alone
    const claims = await verifyHub02Token(raw, opts);
    return claimsToUser(claims);
  }
  return null;
}

// ---- CORS -----------------------------------------------------------------

/** True when `origin` is a Hub02 tool origin (`https://*.tools.hub02.com`). */
export function isHub02Origin(origin?: string | null): boolean {
  if (!origin) return false;
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== "https:") return false;
    return hostname === "tools.hub02.com" || hostname.endsWith(".tools.hub02.com");
  } catch {
    return false;
  }
}

export interface Hub02CorsOptions {
  /**
   * Your existing allowed origins, combined (OR) with the Hub02 tool origins.
   * A list of exact origins, or a predicate `(origin) => boolean`.
   */
  origin?: string[] | ((origin: string | undefined) => boolean);
  /** Override the allowed request headers. Defaults include `X-Hub02-Auth`. */
  allowedHeaders?: string[];
  /** Override the allowed methods. */
  methods?: string[];
  /** Reflect credentials (cookies). Default `true`. */
  credentials?: boolean;
}

/**
 * Build an options object for the `cors` npm package that allows Hub02 tool
 * origins and the `X-Hub02-Auth` header, merged with your existing config.
 *
 *   import cors from "cors";
 *   app.use(cors(hub02CorsOptions({ origin: myExistingAllowList })));
 *
 * The returned object is a plain literal — no runtime dependency on `cors`.
 */
export function hub02CorsOptions(opts: Hub02CorsOptions = {}) {
  const extra = opts.origin;
  const allowExtra = (o?: string): boolean =>
    Array.isArray(extra)
      ? !!o && extra.includes(o)
      : typeof extra === "function"
        ? extra(o)
        : false;
  return {
    origin(
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ): void {
      // No Origin header = same-origin / server-to-server → allow.
      cb(null, !origin || isHub02Origin(origin) || allowExtra(origin));
    },
    allowedHeaders: opts.allowedHeaders ?? [
      "Content-Type",
      "Authorization",
      "X-Hub02-Auth",
      "X-User-Email",
    ],
    methods: opts.methods ?? ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    optionsSuccessStatus: 204,
    credentials: opts.credentials ?? true,
  };
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
