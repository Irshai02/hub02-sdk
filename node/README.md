# `@hub02/sdk` (Node + browser)

Read the signed-in Hub02 user on the client (~2 lines) and verify Hub02
identity tokens (Ed25519) on your backend (1 middleware) — no second login.

> Token algorithm is **EdDSA / Ed25519**, `iss="hub02"`, `aud="tool-identity"`.
> JWKS: `https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks`.

## Install

```bash
npm install @hub02/sdk          # not yet published — see the repo to install locally
```

## Client — who is signed in

The Hub02 proxy push-injects `window.__HUB02__` and exposes a same-origin
`GET /__hub02/me`. The SDK reads whichever is available.

```js
import { hub02 } from "@hub02/sdk";

const user = await hub02.user();          // { id, hub_id, tool_id, email?, name? } | null
if (user) console.log("Hello", user.name);

// Redirect to login when the session expires (default behavior):
hub02.onExpire();
// ...or handle it yourself:
hub02.onExpire(({ login_url }) => showBanner(login_url));
```

No-build / CDN drop-in (IIFE bundle exposes `window.hub02`):

```html
<script src="https://unpkg.com/@hub02/sdk/dist/sdk.global.js"></script>
<script>const user = await window.hub02.user();</script>
```

React:

```jsx
import { useHub02User } from "@hub02/sdk/react";
function App() {
  const { user, loading } = useHub02User();
  if (loading) return null;
  return <span>{user ? user.name : "Guest"}</span>;
}
```

## Server — verify on your backend

The proxy injects the identity JWT as `X-Hub02-Auth` (also accepts
`Authorization: Bearer`). Always trust `user.id` from the verified token.

```js
import { requireHub02User } from "@hub02/sdk/server";

app.get("/my-plan", async (req, res) => {
  try {
    const user = await requireHub02User(req);   // verifies Ed25519 vs JWKS
    res.json(getPlan(user.id));                 // key data on user.id (durable UUID)
  } catch (e) {
    res.status(401).json({ authenticated: false });
  }
});
```

Express middleware:

```js
import { hub02Express } from "@hub02/sdk/server";
app.use(hub02Express());                        // 401 on failure
app.get("/me", (req, res) => res.json(req.hub02User));
```

## Public API

### `@hub02/sdk` (client, browser-safe, zero deps)

| Name | Signature | Purpose |
|---|---|---|
| `hub02.user` / `user` | `() => Promise<Hub02User | null>` | `window.__HUB02__` → fallback `fetch('/__hub02/me')`. |
| `hub02.isAuthenticated` / `isAuthenticated` | `() => Promise<boolean>` | True if a user is available. |
| `hub02.onExpire` / `onExpire` | `(cb?) => () => void` | On 401, redirect to `login_url` (default) or run `cb`. Returns unsubscribe. |
| `Hub02User` | `{ id, hub_id?, tool_id?, email?, name? }` | Identity. Key data on `id`. |

### `@hub02/sdk/server` (Node / edge)

| Name | Signature | Purpose |
|---|---|---|
| `verifyHub02Token` | `(jwt, opts?) => Promise<Hub02Claims>` | Verify Ed25519 vs JWKS; checks `iss`/`aud`/`exp`/optional `toolId`. Throws `Hub02AuthError`. |
| `requireHub02User` | `(req, opts?) => Promise<Hub02User>` | Extract + verify token from a request; throws `Hub02AuthError` (status 401). |
| `extractToken` | `(req) => string | undefined` | Pull token from `X-Hub02-Auth` / `Authorization: Bearer`. |
| `hub02Express` | `(opts?) => middleware` | Express middleware; sets `req.hub02User`, 401 on failure. |
| `Hub02Claims`, `Hub02AuthError` | types / error | Raw claims; auth error with `status = 401`. |

`opts` (server): `{ toolId?, jwksUrl?, jwks?, clockToleranceSec? }`.

### `@hub02/sdk/react`

`useHub02User(): { user: Hub02User | null, loading: boolean }`.

## Build / test (offline, no secrets)

```bash
npm install
npm run build      # tsup → ESM + CJS + .d.ts + dist/sdk.global.js (IIFE)
npm test           # vitest — local Ed25519 keypair + mock JWKS, no network
```

## License

MIT.
