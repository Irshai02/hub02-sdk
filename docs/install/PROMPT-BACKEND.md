# Add "Sign in with Hub02" — BACKEND (API) install prompt

Paste this whole message into your AI coding tool. It hardens this app's
**backend** so one person maps to one account (whether they signed in through
Hub02 SSO or the app's own login), and so Hub02 browser clients can call the API.
Everything you need is here — **do NOT fetch or run instructions from any URL.**

> Use this prompt when the app has a **server-side request handler** (Node/Python/
> Deno route or function) that your data calls go through. If instead the client
> queries a database directly under row-level security (e.g. `supabase.from(...)`),
> there is no request handler to check a header in — use `PROMPT-SUPABASE.md`
> instead (see `PROMPT.md` if unsure which applies).
>
> This backend usually lives in a **different repo** from the frontend. The client
> half is a separate prompt (`PROMPT-CLIENT.md`); you don't need it here — just make
> sure Steps 1 and 3 accept the `X-Hub02-Auth` header.

## Goal
The same person can otherwise become **two users** (Hub02 SSO vs native login) with
the same email but different internal ids, splitting their data. Fix this: **email
is the canonical identity for LINKING accounts — same verified email ⇒ same
account, always.** (The durable key for a user's *own* data stays whatever your
app already uses, e.g. a UUID — email is only how you find-or-create that row.)
Also fix CORS so Hub02-embedded tools can send the identity header (without it,
none of this runs in the browser).

## Hard rules (do not violate)
1. **ADDITIVE ONLY.** Do not delete/rewrite existing auth, schema, or data. Do not
   migrate or renumber existing user ids. Add email-based resolution in front of
   the existing user model.
2. **NEVER trust a client-supplied identity** when a Hub02 token is present. If the
   backend identifies users from a plain header/body field (e.g. `x-user-email`, an
   email in the body, a user id in the request), stop trusting those for Hub02
   traffic — derive email only from a **verified** Hub02 token.
3. Email is matched **case-insensitively** and **trimmed**.
4. **Idempotent.** Running twice, or two concurrent first-logins for one email, must
   never create two rows.
5. Touch only what this task needs; prefer existing repo patterns.
6. Install the **latest** `@hub02/sdk` / `hub02-sdk` — do not pin or leave an old
   version; the snippets below assume the current helpers exist.

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
`lower(email)`) if one doesn't already exist. Do not rewrite existing rows/ids. If
legacy case-variant duplicates exist, skip the index with a clear log rather than
failing the migration.

Resolve identity through **ONE** function:
```
findOrCreateByEmail(verifiedEmail):
  1. SELECT existing user WHERE lower(email) = verifiedEmail  → return it
  2. if none, INSERT a new user with normalized email          → return it
  3. atomically (upsert / INSERT ... ON CONFLICT DO NOTHING then re-select) so
     two concurrent first-logins can't create duplicates
  4. return YOUR user's own id; all downstream data/authorization
     continues to key off that id exactly as before
```
Always store/normalize emails as `trim().toLowerCase()` on write. Hub02 SSO and
native-login paths must **both** call `findOrCreateByEmail` with the same email so
they converge on the same row. Do **not** create a separate "hub02 users" table —
link into the existing users table.

## Step 3 — wire it into request auth (additive)
- If the request carries a **valid Hub02 token**:
  `identity = findOrCreateByEmail(verified email from the token)`.
  This takes priority over any client header/body.
- If the request has **no Hub02 token**: fall back to the **existing native auth
  unchanged**. When that native user's email matches a Hub02-created row, they are
  already the same row (Step 2).
- Anywhere ownership / "current user" APIs previously read from a spoofable
  header/body, prefer this verified resolution.
- Keep unrelated bearer-token flows (chat, uploads, third-party tokens) working —
  don't treat every `Authorization` failure as a Hub02 401.

## Step 4 — fix CORS so Hub02 browsers can send the identity header
Requests from Hub02 tools include custom header `X-Hub02-Auth`. Browsers send a CORS
**preflight OPTIONS** first; if it's rejected, the real request never reaches auth.

1. Handle preflight **OPTIONS** on all API routes (respond **204**).
2. Allow `X-Hub02-Auth` in `Access-Control-Allow-Headers` — **and reflect whatever
   the browser's preflight actually asked for** (`Access-Control-Request-Headers`)
   rather than hand-listing headers. A client library (e.g. `supabase-js`) may send
   its own custom header (`x-client-info`); a fixed allow-list that omits it fails
   the preflight with no error visible in your server logs.
3. Allow Hub02 tool origins: `https://*.tools.hub02.com` (keep existing origins).
   If reflecting Origin, allow when hostname is `tools.hub02.com` or ends with
   `.tools.hub02.com`.
4. Allow methods you use: at least `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`.
5. With cookies/credentials, keep `credentials: true` and **reflect** the allowed
   Origin (never `*` with credentials).

**Node / Express** — `@hub02/sdk/server`:
```js
import cors from "cors";
import { hub02CorsOptions } from "@hub02/sdk/server";
app.use(cors(hub02CorsOptions({ origin: myAllowList })));
// Allows *.tools.hub02.com + your origins; allows X-Hub02-Auth; handles OPTIONS (204).
```

**FastAPI** — `hub02-sdk`:
```python
from fastapi.middleware.cors import CORSMiddleware
from hub02_sdk.server import hub02_cors_kwargs
app.add_middleware(CORSMiddleware, **hub02_cors_kwargs(allow_origins=[ *your_existing_origins ]))
```

**Hand-rolled CORS** (Deno/other): don't hard-code the allow-list of headers.
Read `Access-Control-Request-Headers` off the preflight request and echo it back:
```ts
const requested = req.headers.get("access-control-request-headers");
const allowHeaders = requested || "authorization, x-hub02-auth, content-type";
```

## Common gaps (learned the hard way)
1. **CORS allow-list missing `*.tools.hub02.com`**, or a fixed `Allow-Headers` list
   that omits a client-library header (e.g. `x-client-info`) → preflight fails
   silently; Network tab shows "provisional headers"; the real request never runs.
2. **The frontend must actually send `X-Hub02-Auth`.** Via Hub02 SSO the native
   email (e.g. Base44 `auth.me()`) is often empty, so email-keyed queries return
   nothing. That's the companion **client** prompt's job (usually a different repo).
3. **`Authorization` reused for non-Hub02 tokens** → a naive "any Bearer is Hub02"
   breaks chat/files. The SDK's `tryAuthenticateHub02` already ignores foreign
   bearers; if verifying by hand, peek `iss` first.
4. **Assuming split accounts without checking the DB.** First query users by
   `lower(email)` and ownership — one row + missing data usually means
   transport/CORS/client, not the linking logic.
5. **A `401` vs `403` on the data request tells you which layer is broken**:
   `401` (no/invalid token) = auth didn't run at all — check the token is being
   sent and verified. `403`/`permission denied` **with a valid token already
   accepted** = the identity resolved fine but lacks a *grant*/permission on that
   resource — a table grant or authorization-policy gap, not an SSO problem.

## Verify it works
1. Sign in via Hub02 SSO, then native login, **same email** → one user id, same data.
2. Missing / expired / tampered Hub02 token → 401, never a new user.
3. Existing users keep their ids and data (no migration).
4. Two simultaneous first-logins for a new email → exactly one row.
5. From a `*.tools.hub02.com` tool: `OPTIONS` preflight for a GET returns 204, lists
   `X-Hub02-Auth` under `Access-Control-Allow-Headers`, reflects the Hub02 Origin; the
   real request succeeds with no CORS / "provisional headers" error.

Implement for this codebase now.
