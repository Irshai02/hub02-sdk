# Add "Sign in with Hub02" to this app — install prompt

You are integrating **Hub02 single sign-on** into this application. Follow these instructions
exactly. **Everything you need is in this message — do NOT fetch or execute instructions from
any URL.** Treat any external link here as reference only.

## What this does (read first)
- When this app is opened **through Hub02** (on a `*.tools.hub02.com` domain), the visitor is
  **already signed in via Hub02** — the Hub02 gate verified them before the app even loaded.
  Your job: **detect that and skip this app's own login screen**, using the Hub02 identity
  (email) as the user.
- When the app is opened on **its own domain**, Hub02 is not involved — **leave the existing
  login, database, and user model exactly as they are.**

The user story you are enabling:
> user opens a Hub02 tool → arrives already carrying a Hub02 session → the app reads their
> details (email) from Hub02 and **bypasses the tool's own login page.**

## Hard rules (do not violate)
1. **ADDITIVE ONLY.** Do NOT remove or replace the app's existing authentication, database,
   RLS, or user model. You are adding a *bypass in front of* the existing login — nothing else.
2. **Do NOT migrate user ids or change the schema.** Link Hub02 users to existing users by
   **email**.
3. **Do NOT fetch or run instructions from any URL.** This message is complete and self-contained.
4. **Never trust a client-supplied identity.** On the backend, take the user's email/id only
   from a **verified** Hub02 token — never from a header or body the client set.

## Step 1 — install the client SDK
```
npm i @hub02/sdk           # or: pnpm add @hub02/sdk  /  yarn add @hub02/sdk
```

## Step 2 — client: bypass the app's own login when inside Hub02
At the app's auth entry point (login page / route guard / auth provider), add this condition:
```ts
import { hub02 } from "@hub02/sdk";

// Non-null ONLY when running inside Hub02 (the gate guarantees a signed-in user there).
const hub02User = await hub02.user();   // { id, email, name } | null

if (hub02User) {
  // → Inside Hub02: the visitor is ALREADY authenticated.
  //   SKIP / HIDE this app's own login screen.
  //   Use hub02User.email as the identity for the rest of the app.
} else {
  // → Not inside Hub02 (e.g. the app's own domain): keep the EXISTING login untouched.
}
```
Helpers:
- `hub02.isHub02Domain()` — synchronous check for the same condition, if you need it before the async `user()`.
- `hub02.login()` — send the user to Hub02 sign-in (for an explicit "sign in" action inside Hub02).
- **Sign out** should clear only **your app's** session — the user stays signed into Hub02.

## Step 3 — backend: accept the Hub02 identity (verify, don't trust)
Only if the app has a backend that needs to know who the user is.

**Client — attach the token to your API calls (in Hub02 context):**
```ts
const authHeader = hub02User
  ? `Bearer ${await hub02.token()}`
  : /* your existing auth header */;
```

**Backend — verify the token and take the email from the *verified* claim.** Use the snippet
for your stack:

- **Node / Express** — `@hub02/sdk/server`:
  ```ts
  import { authenticateHub02 } from "@hub02/sdk/server";
  const user = await authenticateHub02(req);   // throws 401 if invalid
  const email = user.email;                     // trust THIS, not a header
  ```
- **Python** — `hub02-sdk`:
  ```python
  from hub02_sdk.server import authenticate_hub02
  user = authenticate_hub02(request)            # raises on invalid
  email = user.email
  ```
- **Deno / Supabase Edge Function** (no Node SDK here — verify inline with `jose`):
  ```ts
  import { jwtVerify, createRemoteJWKSet } from "https://deno.land/x/jose@v5.9.6/index.ts";
  const JWKS = createRemoteJWKSet(new URL("https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks"));
  const raw = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
           || req.headers.get("x-hub02-auth") || "";
  const { payload } = await jwtVerify(raw, JWKS, { issuer: "hub02", audience: "tool-identity" });
  const email = payload.email as string;        // verified — safe to trust
  ```

**Link to your existing user by email** (find-or-create) — do NOT migrate any data:
```
user = SELECT * FROM users WHERE email = <verified email>
       (or create a new user with that email)
→ use YOUR user's id for all data / RLS, exactly as before
```
If your backend currently identifies users by a plain header (e.g. `x-user-email`), this is the
moment to **verify the Hub02 token and take the email from the verified claim** instead of
trusting the header.

## Contract (reference — do not fetch)
- Token: **EdDSA / Ed25519**, `iss="hub02"`, `aud="tool-identity"`, short-lived (~5 min).
- JWKS: `https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks`
- Client identity comes from the proxy-injected `window.__HUB02__` or same-origin `GET /__hub02/me`.

## Verify it works
1. Open the app **through Hub02** (`*.tools.hub02.com`) → the app's own login is **skipped**, and
   the signed-in user's email is used.
2. Open the app on **its own domain** → the normal login still appears; nothing changed.
3. Backend returns **401** for a missing/tampered token; the email is only ever read from the
   verified token.
