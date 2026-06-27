# Hub02 SDK — Integration Guide

Add "Sign in with Hub02" to your tool: read the signed-in user on the client
and authorize API calls on your backend — **no second login**, ~2 lines on the
client and 1 guard on the server.

This guide covers the contract, a worked example (a workout planner), the
`user_id`-vs-email durable-key rule, expiry/redirect behavior, and the security
checklist. For exact API names see [`../node/README.md`](../node/README.md) and
[`../python/README.md`](../python/README.md).

---

## 1. The contract

```
Token algorithm : EdDSA (Ed25519)              ← NOT ES256
JWKS endpoint   : https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks
Identity JWT    : iss="hub02", aud="tool-identity",
                  claims { sub:<user uuid>, hub_id, tool_id, iat, exp(≤5m) }
Client identity : window.__HUB02__ (push-injected by the proxy)
                  OR  GET /__hub02/me (same-origin)
Backend token   : proxy injects header  X-Hub02-Auth: <identity JWT>
                  (the SDK also accepts  Authorization: Bearer <jwt>)
Expiry signal   : 401 { authenticated:false, login_url }  → top-level redirect
```

The SDK pins the JWKS URL, `iss`, and `aud` so the client and server halves
can't drift.

---

## 2. Two kinds of tool

| Tool type | Client identity | Backend authorization |
|---|---|---|
| **Own-backend** | `hub02.user()` | `requireHub02User(req)` / `require_hub02_user(request)` verifies the `X-Hub02-Auth` JWT |
| **Base44 / no backend** | `hub02.user()` | none needed — identity is client-side; privileged ops route to a Hub02 function |

---

## 3. Worked example — a workout planner keyed on the user

The tool stores each user's plan and shows it back to them. The only thing it
needs from Hub02 is **who the user is** — `user.id`.

### Client (any tool, including Base44)

```js
import { hub02 } from "@hub02/sdk";

const user = await hub02.user();        // { id, hub_id, tool_id, email?, name? } | null
if (user) {
  document.querySelector("#hi").textContent = `Hi ${user.name ?? user.email}!`;
  renderPlan(loadPlan(user.id));        // key the plan on user.id — see §4
}

// No black screen when the session dies — redirect to Hub02 login:
hub02.onExpire();
```

### Server (own-backend tool — Node/Express)

```js
import { requireHub02User } from "@hub02/sdk/server";

app.get("/my-plan", async (req, res) => {
  try {
    const user = await requireHub02User(req);   // verifies Ed25519 vs JWKS, throws on bad token
    res.json(getPlan(user.id));                 // trust user.id from the TOKEN, never the client
  } catch {
    res.status(401).json({ authenticated: false });
  }
});
```

### Server (own-backend tool — Python/FastAPI)

```python
from fastapi import Depends, FastAPI
from hub02_sdk.server import fastapi_dependency, Hub02User

require_user = fastapi_dependency()
app = FastAPI()

@app.get("/my-plan")
def my_plan(user: Hub02User = Depends(require_user)):
    return get_plan(user.id)
```

That's the whole integration: one client call, one server guard.

---

## 4. The `user_id`-vs-email durable-key rule

**Key all stored data on `user.id`** — the stable Hub02 user UUID (the token's
`sub` claim). `email` and `name` are **display/notification only** and can
change. If you key a workout plan on the email and the user later changes their
email, their plan vanishes.

```js
// ✅ durable
const plan = db.get(`plan:${user.id}`);
// ❌ fragile — email can change
const plan = db.get(`plan:${user.email}`);
```

---

## 5. Expiry & redirect

Identity tokens are short-lived (≤5 min, re-minted from the live session).

- **Client navigation:** `hub02.onExpire()` watches for the
  `401 { authenticated:false, login_url }` signal and does a **top-level
  redirect** to Hub02 login, which re-launches your tool after sign-in. Pass a
  callback to handle it yourself: `hub02.onExpire(({ login_url }) => …)`.
- **Background API calls** can't be redirected by the browser — your fetch
  wrapper should treat a 401 from your own API as "re-auth needed" and trigger
  the same top-level redirect.

---

## 6. Security checklist

- **Verify on the server.** Never trust a client-sent `user_id`. Read identity
  only from the verified token (`requireHub02User` / `require_hub02_user`).
- **Bind to your tool.** Pass your `tool_id` (`{ toolId }` / `tool_id=`) so a
  token minted for tool A can't be replayed against tool B.
- **Ed25519 only.** The SDK enforces `alg=EdDSA`, `iss="hub02"`,
  `aud="tool-identity"`, and `exp`. Don't relax these.
- **Lock your upstream** to proxy-only traffic if you rely on injected headers,
  so a client can't hit your origin directly and forge `X-Hub02-*`. (The proxy
  strips inbound `X-Hub02-*` before injecting its own.)
- **Minimize PII.** `user.id` + `hub_id` usually suffice; request `email`/`name`
  only for display.

---

## 7. Install it with your coding agent

You don't have to wire this by hand. Point your agent at:

- [`install/PROMPT.md`](./install/PROMPT.md) — a self-contained, copy-paste
  prompt for any coding agent.
- [`install/SKILL.md`](./install/SKILL.md) — an OMC / Claude-Code skill that
  detects your stack, installs the package, and adds the guard.
