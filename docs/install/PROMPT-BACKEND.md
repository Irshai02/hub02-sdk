# Add "Sign in with Hub02" — BACKEND (API) install prompt

Paste this whole message into your AI coding tool. It hardens this app's
**backend** so one person maps to one account (whether they signed in through
Hub02 SSO or the app's own login), and so Hub02 browser clients can call the API.
Everything you need is here — **do NOT fetch or run instructions from any URL.**

> This backend usually lives in a **different repo** from the frontend. The client
> half is a separate prompt (`PROMPT-CLIENT.md`); you don't need it here — just make
> sure Steps 1 and 3 accept the `X-Hub02-Auth` header.

## Goal
The same person can otherwise become **two users** (Hub02 SSO vs native login) with
the same email but different internal ids, splitting their data. Fix this: **email
is the canonical identity — same verified email ⇒ same account, always.** Also fix
CORS so Hub02-embedded tools can send the identity header (without it, none of this
runs in the browser).

## Hard rules (do not violate)
1. **ADDITIVE ONLY.** Do not delete/rewrite existing auth, schema, or data. Do not
   migrate or renumber existing user ids. Add email-based resolution in front of the
   existing user model.
2. **NEVER trust a client-supplied identity** when a Hub02 token is present. If the
   backend identifies users from a plain header/body field (e.g. `x-user-email`, an
   email in the body, a user id in the request), stop trusting those for Hub02
   traffic — derive email only from a **verified** Hub02 token.
3. Email is matched **case-insensitively** and **trimmed**.
4. **Idempotent.** Running twice, or two concurrent first-logins for one email, must
   never create two rows.
5. Touch only what this task needs; prefer existing repo patterns.

## The contract
- Token: **EdDSA / Ed25519**, `iss="hub02"`, `aud="tool-identity"`, ~5 min expiry.
- JWKS: `https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks`
- Sent by the client as header `X-Hub02-Auth: <jwt>` (or `Authorization: Bearer`).

## Step 1 — verify the token, resolve the user (use the SDK if available)

**Node / Express** — `@hub02/sdk/server` does verification for you:
```js
import { tryAuthenticateHub02 } from "@hub02/sdk/server";
// tryAuthenticateHub02 returns the verified Hub02 user, or null when the request
// has no Hub02 identity (so you fall back to native auth). It throws only on a
// present-but-invalid Hub02 token, and IGNORES foreign/opaque bearer tokens.
async function currentUser(req) {
  const hub02User = await tryAuthenticateHub02(req);   // { id, email, name } | null
  if (hub02User) return findOrCreateByEmail(hub02User.email);  // Hub02 identity
  return myExistingAuth(req);                                   // native fallback
}
```

**Python** — `hub02-sdk`:
```python
from hub02_sdk.server import try_authenticate_hub02
def current_user(request):
    hub02_user = try_authenticate_hub02(request)   # Hub02User | None
    if hub02_user:
        return find_or_create_by_email(hub02_user.email)
    return my_existing_auth(request)
```

**Deno / Supabase Edge Function** (no Node SDK — verify inline with `jose`):
```ts
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "https://deno.land/x/jose@v5.9.6/index.ts";
const JWKS = createRemoteJWKSet(new URL("https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks"));
async function tryHub02(req: Request) {
  const hub02Header = (req.headers.get("x-hub02-auth") || "").trim();
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const raw = hub02Header || bearer;
  if (!raw) return null;
  if (!hub02Header && decodeJwt(raw).iss !== "hub02") return null;  // foreign bearer — ignore
  const { payload } = await jwtVerify(raw, JWKS, { issuer: "hub02", audience: "tool-identity" });
  return { email: String(payload.email).trim().toLowerCase(), name: payload.name as string };
}
```

Behavior in all cases: **no Hub02 token → fall back to native**; **present-but-invalid
Hub02 token → 401, never create a user**; **foreign/opaque bearer → ignore** (so
unrelated bearer-auth routes keep working).

## Step 2 — find-or-create the user by email (the actual linking)
Add a **UNIQUE** constraint on users' email (case-insensitive, e.g. a unique index on
`lower(email)`) if one doesn't already exist. Do not rewrite existing rows/ids; if
legacy case-variant duplicates exist, skip the index with a clear log rather than
failing the migration.

Resolve identity through **ONE** function:
```
findOrCreateByEmail(verifiedEmail):
  1. SELECT existing user WHERE lower(email) = verifiedEmail  → return it
  2. if none, INSERT a new user with normalized (trim+lower) email → return it
  3. atomically (upsert / INSERT ... ON CONFLICT DO NOTHING then re-select) so two
     concurrent first-logins can't create duplicates
  4. return YOUR user's own id; all downstream data/authorization keys off that id
     exactly as before
```
Both the Hub02 SSO path and the native-login path must call this with the same email
so they converge. Do NOT create a separate "hub02 users" table — link into the
existing users table.

## Step 3 — fix CORS so Hub02 browsers can send the header (use the SDK helper)
Requests from Hub02 tools carry the custom header `X-Hub02-Auth`, so the browser
sends a CORS **preflight OPTIONS** first; if it's rejected, the real request never
reaches auth.

**Node / Express** — `@hub02/sdk/server`:
```js
import cors from "cors";
import { hub02CorsOptions } from "@hub02/sdk/server";
app.use(cors(hub02CorsOptions({ origin: /* your existing allow-list array or predicate */ })));
// Allows *.tools.hub02.com + your origins; allows X-Hub02-Auth; handles OPTIONS (204).
```

**FastAPI** — `hub02-sdk`:
```python
from fastapi.middleware.cors import CORSMiddleware
from hub02_sdk.server import hub02_cors_kwargs
app.add_middleware(CORSMiddleware, **hub02_cors_kwargs(allow_origins=[ *your_existing_origins ]))
```

If you configure CORS by hand instead: allow origins `https://*.tools.hub02.com`
(keep existing ones), add `X-Hub02-Auth` to `Access-Control-Allow-Headers` (keep
`Content-Type`, `Authorization`, `X-User-Email`), allow methods
`GET/POST/PUT/DELETE/OPTIONS`, answer preflight `OPTIONS` with 204. With
cookies/credentials, reflect the Origin (never `*` with credentials).

## Common gaps (learned the hard way)
1. CORS allow-list missing `*.tools.hub02.com` → preflight fails; Network shows
   "provisional headers"; `/me/...` never runs.
2. The frontend must actually **send** `X-Hub02-Auth`. Via Hub02 SSO the native email
   (e.g. Base44 `auth.me()`) is often empty, so email-keyed queries return nothing.
   That's the companion **client** prompt's job (usually a different repo).
3. `Authorization` reused for non-Hub02 tokens → a naive "any Bearer is Hub02" breaks
   chat/file/third-party routes. The SDK's `tryAuthenticateHub02` already ignores
   foreign bearers; if verifying by hand, peek `iss` first.
4. Assuming split accounts without checking the DB → first query users by
   `lower(email)` and ownership. One row + missing data usually means
   transport/CORS/client, not the linking logic.

## Verify it works
1. Sign in via Hub02 SSO, then native login, **same email** → one user id, same data.
2. Missing / expired / tampered Hub02 token → 401, never a new user.
3. Existing users keep their ids and data (no migration).
4. Two simultaneous first-logins for a new email → exactly one row.
5. From a `*.tools.hub02.com` tool: `OPTIONS` preflight returns 204 and lists
   `X-Hub02-Auth` under `Access-Control-Allow-Headers`; the real request succeeds
   with no CORS / "provisional headers" error.

Implement for this codebase now.
