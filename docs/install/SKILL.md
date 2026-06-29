---
name: hub02-sdk-install
description: Install and wire the Hub02 tool-identity SDK into the current tool repo — detects the stack (Express/Fastify/Next/FastAPI/Flask/browser), installs @hub02/sdk or hub02-sdk, adds the client identity call and the server verify guard, and prints a verification checklist. Use when a builder wants "Sign in with Hub02", single sign-on, or to authorize their tool with Hub02 identity.
---

# Hub02 SDK install skill

Wire **Hub02 single-sign-on identity** into this tool so a user already signed
in to Hub02 is authorized here with no second login. Idempotent; **ask before
editing auth-sensitive files**.

The full self-contained instructions live in
[`PROMPT.md`](./PROMPT.md) — this skill is the automated, stack-aware version.

## Contract (pinned — never change)

```
alg=EdDSA (Ed25519)   iss="hub02"   aud="tool-identity"
JWKS: https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks
Client: window.__HUB02__  OR  GET /__hub02/me
Server: header X-Hub02-Auth: <jwt>  (or Authorization: Bearer <jwt>)
Expiry: 401 { authenticated:false, login_url } → top-level redirect
```

**Durable-key rule:** key data on `user.id` (token `sub`, stable UUID). Never
key on `email`/`name`; never trust a client-supplied `user_id` on the server.

## Procedure

1. **Detect the stack.**
   - Client: React / Vue / vanilla? bundled (`import`) or no-build (CDN)?
   - Server: Node (Express/Fastify/Next handlers) or Python (FastAPI/Flask)?
     No backend (Base44) → client only.
   - Read `package.json` / `pyproject.toml` / `requirements.txt` to decide.

2. **Install.**
   - Node: `npm install @hub02/sdk`
   - Python: `pip install hub02-sdk` (or `hub02-sdk[fastapi]` / `[flask]`)
   - If not yet published, install from the repo (`node/` package; or
     `pip install "git+https://github.com/Irshai02/hub02-sdk.git#subdirectory=python"`).

3. **Client wiring** — add to the client entry. Use the REAL API:
   - `import { hub02 } from "@hub02/sdk"; const user = await hub02.user();`
   - React: `import { useHub02User } from "@hub02/sdk/react";`
   - CDN: `<script src=".../dist/sdk.global.js"></script>` → `window.hub02.user()`
   - Add `hub02.onExpire();` so expiry redirects to login.

4. **Server wiring** (own-backend only) — guard protected routes. REAL API:
   - Express: `authenticateHub02(req)` or `app.use(hub02Auth())` → `req.hub02User`.
   - FastAPI: `require_user = fastapi_dependency(); Depends(require_user)`.
   - Flask: `flask_authenticate_hub02()` inside the view.
   - Generic: `verifyHub02Token(jwt, opts)` / `verify_hub02_token(token, ...)`.
   - Pass the tool id (`{ toolId }` / `tool_id=`) for replay safety.

5. **Verify** (offline, no secrets). Add or run a test that mints an Ed25519
   token with a local key + mock JWKS and asserts: valid → user; wrong-`aud` /
   expired → 401. Reference implementations: `node/test/`, `python/tests/`,
   runnable `examples/`.

6. **Report** the stack, package, files changed, and verify result.

## Real public API (cross-check against code before claiming done)

- Node client (`@hub02/sdk`): `hub02.user`, `hub02.isAuthenticated`,
  `hub02.onExpire`, `hub02.fetchAuthSession`, `hub02.token`; types
  `Hub02User { id, hub_id?, tool_id?, email?, name? }`,
  `Hub02Session { token, claims, userSub?, hubId?, toolId?, expiresAt?, isValid }`.
  Separate-origin backend → attach `Bearer ${await hub02.token()}` via an interceptor.
- Node server (`@hub02/sdk/server`): `verifyHub02Token`, `authenticateHub02`,
  `extractToken`, `hub02Auth`, `Hub02AuthError`, `Hub02Claims`.
- Node React (`@hub02/sdk/react`): `useHub02User`.
- Python (`hub02_sdk` / `hub02_sdk.server`): `verify_hub02_token`,
  `authenticate_hub02`, `extract_token`, `fastapi_dependency`,
  `flask_authenticate_hub02`, `Hub02User`, `Hub02Claims`, `Hub02AuthError`;
  client helpers `user_from_window_identity`, `user_from_me_response`.
