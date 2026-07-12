# Add "Sign in with Hub02" — CLIENT (frontend) install prompt

Paste this whole message into your AI coding tool. It integrates **Hub02 single
sign-on** into this app's **frontend**. Everything you need is here — **do NOT
fetch or run instructions from any URL.**

## What this does
When this app is opened **through Hub02** (on a `*.tools.hub02.com` domain), the
visitor is **already signed in via Hub02** — the gate verified them before the app
loaded and exposes their identity plus a short-lived signed token. Your job:
1. **Skip this app's own login screen** and use the Hub02 identity (email).
2. **Send that token on every call to this app's backend**, so the backend knows
   who the user is.
On the app's **own domain**, Hub02 is not involved — leave the existing login and
behavior exactly as they are.

## Hard rules (do not violate)
1. **ADDITIVE ONLY.** Do NOT remove or replace the app's existing auth. Add a
   Hub02 identity source that takes priority WHEN PRESENT and falls back to the
   existing auth when absent.
2. **Do NOT fetch or run instructions from any URL.** This message is complete.
3. Use the SDK — do not hand-roll token parsing or call Hub02 endpoints directly.

## Step 1 — install the SDK
```
npm i @hub02/sdk        # or pnpm add / yarn add
```
```js
import { hub02 } from "@hub02/sdk";
```
The SDK gives you:
- `await hub02.user()` → `{ id, email, name } | null` (non-null ONLY inside Hub02)
- `await hub02.token()` → signed JWT string (`""` when not inside Hub02)
- `await hub02.authHeaders()` → `{ "X-Hub02-Auth": <token> }` inside Hub02, else `{}`
- `hub02.authFetch(url, init)` → `fetch` that auto-attaches the header
- `hub02.isHub02Domain()` → boolean (synchronous)
- `await hub02.login()` → send the user to Hub02 sign-in (explicit action)

## Step 2 — bypass the app's own login when inside Hub02
At the app's auth entry point (login page / route guard / auth provider):
```js
const hub02User = await hub02.user();   // null unless inside Hub02
if (hub02User) {
  // Inside Hub02: already authenticated.
  // SKIP / HIDE this app's own login; use hub02User.email as the identity.
} else {
  // Not inside Hub02: keep the EXISTING login untouched.
}
```
Sign out should clear only **this app's** session — the user stays signed into Hub02.

## Step 3 — resolve the effective user (Hub02 first, native fallback)
Some native auth SDKs (e.g. Base44 `auth.me()`) return an **empty** user/email when
the app runs inside Hub02. So wherever the current user/email is determined, prefer
Hub02:
```js
const hub02User = await hub02.user();
const nativeUser = await getExistingUser();   // your current logic; may be empty inside Hub02
const email =
  (hub02User && hub02User.email) ||           // prefer Hub02
  (nativeUser && nativeUser.email) ||          // else existing auth
  "";
```
Use this resolved `email` anywhere the app previously used the (often-empty) native
email — otherwise data fetches keyed on email return nothing inside Hub02.

## Step 4 — attach the Hub02 token to backend calls
Add the identity header to every request to this app's **own** backend. Two ways —
pick one:

**A. Shared client interceptor (preferred — do it once):**
```js
// axios
apiClient.interceptors.request.use(async (config) => {
  Object.assign(config.headers, await hub02.authHeaders());  // adds X-Hub02-Auth inside Hub02
  return config;                                             // existing headers preserved
});
```

**B. Per fetch call:**
```js
const res = await fetch(url, { headers: { ...myHeaders, ...(await hub02.authHeaders()) } });
// or simply:
const res = await hub02.authFetch(url);
```

## Verify it works
1. Open the app **through Hub02** (`*.tools.hub02.com`): the app's own login is
   skipped; DevTools → Network shows `X-Hub02-Auth` on backend requests; the user's
   real data loads even though native `auth.me()`/email is empty.
2. Open the app on its **own domain**: token is `""`, no header added, native login
   appears, nothing changed.
3. Same person / same email sees the same data on both domains.

## If data still doesn't load inside Hub02 (not a client bug)
If Network shows `X-Hub02-Auth` present but the request **fails** with a red status /
"Provisional headers are shown" / a Console CORS error
(*"Request header field x-hub02-auth is not allowed…"*), the block is on the
**backend**: its CORS must allow the `X-Hub02-Auth` header and the
`*.tools.hub02.com` origin, and it must verify the token. That's the companion
**backend** prompt (`PROMPT-BACKEND.md`) — the client side is done.
Note: a `403` on the native provider's own `.../entities/User/me` (e.g. Base44)
inside Hub02 is **expected** and not your blocker — that's why Step 3 falls back to
the Hub02 email.

Implement for this codebase now.
