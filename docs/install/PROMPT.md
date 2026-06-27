# Install & wire the Hub02 SDK — copy-paste prompt for any coding agent

> Paste everything below the line into your coding agent (Claude Code, Cursor,
> etc.), running inside the builder's tool repo. It is **self-contained**: it
> carries the full contract, the exact SDK API, per-framework snippets, and a
> verify step. The agent should detect the stack, install the right package,
> wire client + server, and confirm it works.

---

You are integrating **Hub02 single-sign-on identity** into this tool. A user
who is already signed in to Hub02 should be authorized in this tool with **no
second login**. Do the work end-to-end, then run the verification step.

## The contract (do not change these constants)

```
Token algorithm : EdDSA (Ed25519)              ← NOT ES256
JWKS endpoint   : https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks
Identity JWT    : iss="hub02", aud="tool-identity",
                  claims { sub:<user uuid>, hub_id, tool_id, iat, exp(≤5m) }
Client identity : window.__HUB02__ (push-injected by the Hub02 proxy)
                  OR  GET /__hub02/me (same-origin)
Backend token   : the proxy injects  X-Hub02-Auth: <identity JWT>
                  (the SDK also accepts  Authorization: Bearer <jwt>)
Expiry signal   : 401 { authenticated:false, login_url }  → top-level redirect
```

**Durable-key rule:** key all stored user data on `user.id` (the stable Hub02
UUID = token `sub`). `email`/`name` are display-only and may change — never key
data on them, and on the server never trust a client-supplied `user_id`; read
it only from the verified token.

## Step 1 — detect the stack

- **Client:** is there a browser entry (React/Vue/vanilla `index.html`)? Bundled
  (`import`) or no-build (CDN `<script>`)?
- **Server:** Node (Express/Fastify/Next route handlers) or Python
  (FastAPI/Flask)? If the tool has no backend (e.g. Base44), do the client part
  only.

Ask the builder before editing auth-sensitive files. Be idempotent — if the SDK
is already wired, don't duplicate it.

## Step 2 — install the package

- Node: `npm install @hub02/sdk`
- Python: `pip install hub02-sdk`  (extras: `hub02-sdk[fastapi]` / `[flask]`)

> Not yet on npm/PyPI. If install fails, install from the repo:
> Node — add a dependency on the repo's `node/` package;
> Python — `pip install "git+https://github.com/Irshai02/hub02-sdk.git#subdirectory=python"`.

## Step 3 — wire the CLIENT (who is signed in)

Public client API (`@hub02/sdk`):
`hub02.user(): Promise<Hub02User|null>` · `hub02.isAuthenticated(): Promise<boolean>`
· `hub02.onExpire(cb?): () => void`. `Hub02User = { id, hub_id?, tool_id?, email?, name? }`.

**Bundled (import):**
```js
import { hub02 } from "@hub02/sdk";
const user = await hub02.user();          // null if not signed in
if (user) showUser(user);                 // user.id is the durable key
hub02.onExpire();                         // redirect to login on expiry
```

**React** (`@hub02/sdk/react`):
```jsx
import { useHub02User } from "@hub02/sdk/react";
const { user, loading } = useHub02User();
```

**No-build / CDN (IIFE exposes `window.hub02`):**
```html
<script src="https://unpkg.com/@hub02/sdk/dist/sdk.global.js"></script>
<script>const user = await window.hub02.user();</script>
```

## Step 4 — wire the SERVER (authorize API calls)

Only for tools with their own backend. Public server API (`@hub02/sdk/server`):
`verifyHub02Token(jwt, opts?)` · `requireHub02User(req, opts?)` ·
`extractToken(req)` · `hub02Express(opts?)`. `opts = { toolId?, jwksUrl?, jwks?,
clockToleranceSec? }`. Errors throw `Hub02AuthError` (`status === 401`).

**Express:**
```js
import { requireHub02User } from "@hub02/sdk/server";
app.get("/my-plan", async (req, res) => {
  try {
    const user = await requireHub02User(req);   // verifies Ed25519 vs JWKS
    res.json(getPlan(user.id));                 // trust user.id from the token
  } catch {
    res.status(401).json({ authenticated: false });
  }
});
// or middleware: app.use(hub02Express()); → req.hub02User
```

**Python — public API (`hub02_sdk.server`):** `verify_hub02_token(token, *,
tool_id=None, ...)` · `require_hub02_user(request, *, tool_id=None, ...)` ·
`extract_token(request)` · `fastapi_dependency(*, tool_id=None, ...)` ·
`flask_require_hub02_user(*, tool_id=None, ...)`. Errors raise `Hub02AuthError`
(`.status == 401`). `Hub02User` is a dataclass `{ id, hub_id, tool_id, email,
name }`.

**FastAPI:**
```python
from fastapi import Depends, FastAPI
from hub02_sdk.server import fastapi_dependency, Hub02User
require_user = fastapi_dependency()
app = FastAPI()

@app.get("/my-plan")
def my_plan(user: Hub02User = Depends(require_user)):
    return get_plan(user.id)
```

**Flask:**
```python
from hub02_sdk.server import flask_require_hub02_user, Hub02AuthError
@app.get("/my-plan")
def my_plan():
    try:
        user = flask_require_hub02_user()
    except Hub02AuthError as e:
        return {"authenticated": False, "error": str(e)}, 401
    return get_plan(user.id)
```

For replay safety, pass the tool's id: `requireHub02User(req, { toolId })` /
`fastapi_dependency(tool_id="…")`.

## Step 5 — verify it works (offline, no secrets)

Prove the verify path without network or Hub02 secrets by minting a token with a
local Ed25519 key and a mock JWKS:

- **Node:** `jose` — `generateKeyPair("EdDSA",{crv:"Ed25519"})`, build a JWT with
  `iss:"hub02"`, `aud:"tool-identity"`, `sub`, `exp`, and a `kid` header; pass a
  resolver as `requireHub02User(req, { jwks })`. Assert a valid token → user, a
  wrong-`aud`/expired token → 401.
- **Python:** `cryptography` `Ed25519PrivateKey.generate()` + `PyJWT`
  `jwt.encode(..., algorithm="EdDSA")`; pass a kid→key map as
  `require_hub02_user(request, jwks_client=...)`. Same assertions.

(Working versions of these tests ship in the SDK repo under `node/test/` and
`python/tests/`, and runnable apps under `examples/`.)

## Report back

Summarize: stack detected, package installed, files changed (client entry +
protected routes), and the verify result.
