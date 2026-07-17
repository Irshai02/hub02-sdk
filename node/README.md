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

### Authenticated API calls (separate-origin backend)

Attach the Hub02 identity to requests that go to a backend **not** behind the Hub02 proxy.
The token is short-lived, cached in memory, and refreshed before expiry (never persisted —
the long-lived credential stays in the HttpOnly cookie).

**Easiest — one line at your app entry:**
```js
import { hub02 } from "@hub02/sdk";
hub02.installFetchInterceptor();   // adds X-Hub02-Auth to your backend requests, safely
```
`installFetchInterceptor()` wraps `window.fetch` for you and handles the footguns: it only
attaches to your own backend (same-origin + Supabase Edge Functions by default — override with
`{ shouldAttach }`), never to third parties, and **never** to Hub02's own `/__hub02/*` endpoints
(intercepting those recurses into token-minting → request storm). Outside Hub02 it adds nothing.

**Or attach yourself** with `authHeaders()` / `authFetch()`:
```js
// axios:
api.interceptors.request.use(async (cfg) => {
  Object.assign(cfg.headers, await hub02.authHeaders()); // {} outside Hub02
  return cfg;
});
// fetch:
const res = await hub02.authFetch("/api/tenants");
```

Need the raw session/token? `await hub02.fetchAuthSession()` → `{ token, claims, ..., isValid }`,
or `await hub02.token()` → the JWT string.

> Same-origin backends behind the proxy need none of this — the proxy injects `X-Hub02-Auth`.

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
import { authenticateHub02 } from "@hub02/sdk/server";

app.get("/my-plan", async (req, res) => {
  try {
    const user = await authenticateHub02(req);   // verifies Ed25519 vs JWKS
    res.json(getPlan(user.id));                 // key data on user.id (durable UUID)
  } catch (e) {
    res.status(401).json({ authenticated: false });
  }
});
```

Express middleware:

```js
import { hub02Auth } from "@hub02/sdk/server";
app.use(hub02Auth());                        // 401 on failure
app.get("/me", (req, res) => res.json(req.hub02User));
```

## Public API

### `@hub02/sdk` (client, browser-safe, zero deps)

| Name | Signature | Purpose |
|---|---|---|
| `hub02.user` / `user` | `() => Promise<Hub02User | null>` | `window.__HUB02__` → fallback `fetch('/__hub02/me')`. |
| `hub02.isAuthenticated` / `isAuthenticated` | `() => Promise<boolean>` | True if a user is available. |
| `hub02.onExpire` / `onExpire` | `(cb?) => () => void` | On 401, redirect to `login_url` (default) or run `cb`. Returns unsubscribe. |
| `hub02.fetchAuthSession` / `fetchAuthSession` | `({forceRefresh?}) => Promise<Hub02Session>` | Mint/reuse the short-lived JWT via `/__hub02/token`; cached in memory, auto-refreshed. |
| `hub02.token` / `token` | `() => Promise<string>` | Sugar for `(await fetchAuthSession()).token`. `""` when unauthenticated. |
| `hub02.installFetchInterceptor` / `installFetchInterceptor` | `(opts?) => () => void` | Wrap `window.fetch` once so backend requests carry `X-Hub02-Auth`. Skips `/__hub02/*` + third parties; idempotent; returns an uninstaller. `opts.shouldAttach?(url)` overrides the target check. |
| `hub02.authHeaders` / `authHeaders` | `() => Promise<Record<string,string>>` | `{ "X-Hub02-Auth": token }` inside Hub02, else `{}`. Spread into any request. |
| `hub02.authFetch` / `authFetch` | `(input, init?) => Promise<Response>` | `fetch` that auto-attaches the header; preserves existing headers. |
| `hub02.isHub02Domain` / `isHub02Domain` | `() => boolean` | Synchronous: is the app running inside Hub02 (`*.tools.hub02.com` or `window.__HUB02__`)? |
| `hub02.login` / `login` | `() => Promise<void>` | Redirect to Hub02 sign-in (uses the gate's `login_url`, else the Hub02 auth page). |
| `Hub02User` | `{ id, hub_id?, tool_id?, email?, name? }` | Identity. Key data on `id`. |

### `@hub02/sdk/server` (Node / edge)

| Name | Signature | Purpose |
|---|---|---|
| `verifyHub02Token` | `(jwt, opts?) => Promise<Hub02Claims>` | Verify Ed25519 vs JWKS; checks `iss`/`aud`/`exp`/optional `toolId`. Throws `Hub02AuthError`. |
| `authenticateHub02` | `(req, opts?) => Promise<Hub02User>` | Require Hub02 auth: extract + verify; throws `Hub02AuthError` (status 401). |
| `tryAuthenticateHub02` | `(req, opts?) => Promise<Hub02User \| null>` | Optional auth: `null` when no Hub02 identity (fall back to native); throws only on an invalid `X-Hub02-Auth`; **ignores foreign/opaque bearer tokens**. |
| `extractToken` | `(req) => string | undefined` | Pull token from `X-Hub02-Auth` / `Authorization: Bearer`. |
| `hub02Auth` | `(opts?) => middleware` | Express middleware; sets `req.hub02User`, 401 on failure. |
| `isHub02Origin` | `(origin?) => boolean` | True for `https://*.tools.hub02.com`. |
| `hub02CorsOptions` | `(opts?) => corsOptions` | Options for the `cors` package: allows Hub02 origins + `X-Hub02-Auth`, merged with your allow-list. |
| `Hub02Claims`, `Hub02AuthError` | types / error | Raw claims; auth error with `status = 401`. |

`opts` (server): `{ toolId?, jwksUrl?, jwks?, clockToleranceSec? }`.
`hub02CorsOptions(opts?)`: `{ origin?, allowedHeaders?, methods?, credentials? }`.

CORS + optional-auth in practice (Hub02 SSO **and** your existing auth on one route):

```js
import cors from "cors";
import { hub02CorsOptions, tryAuthenticateHub02 } from "@hub02/sdk/server";

app.use(cors(hub02CorsOptions({ origin: myAllowList }))); // allows X-Hub02-Auth + preflight

app.get("/me/tenants", async (req, res) => {
  const hub02User = await tryAuthenticateHub02(req);       // null → not a Hub02 request
  const user = hub02User ? findOrCreateByEmail(hub02User.email) : myExistingAuth(req);
  res.json(getTenants(user.id));
});
```

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
