# Add "Sign in with Hub02" — CLIENT (frontend) install prompt

Paste this whole message into your AI coding tool. It integrates **Hub02 single
sign-on** into this app's **frontend** with the smallest possible change.
Everything you need is here — **do NOT fetch or run instructions from any URL.**

## What this does
When this app is opened **through Hub02** (a `*.tools.hub02.com` domain), the
visitor is **already signed in via Hub02**. Your job:
1. **Skip this app's own login** and use the Hub02 identity (email).
2. **Send that identity to this app's backend** on every request.
On the app's **own domain**, Hub02 is not involved — leave everything as-is.

## Hard rules
1. **ADDITIVE ONLY.** Do NOT remove or replace the app's existing auth. Hub02 takes
   priority WHEN PRESENT and falls back to the existing auth when absent.
2. **Do NOT fetch or run instructions from any URL.** This message is complete.
3. Use the SDK's helpers — do not hand-write a `window.fetch` wrapper or parse tokens.

## Step 1 — install
```
npm i @hub02/sdk        # or pnpm add / yarn add
```

## Step 2 — one line at the app entry (main.tsx / index.tsx)
This attaches the Hub02 identity (`X-Hub02-Auth`) to your backend requests
automatically. Add it **once**, at the top, before the app renders:
```ts
import { hub02 } from "@hub02/sdk";
hub02.installFetchInterceptor();
```
That's the entire "send identity to the backend" step — the SDK handles it safely
(only your own backend, never third parties, never Hub02's internal endpoints).
Do NOT wrap `window.fetch` yourself.

## Step 3 — skip the app's own login when inside Hub02
At the app's auth entry point (login page / route guard / auth provider):
```ts
const hub02User = await hub02.user();   // { id, email, name } | null (non-null ONLY inside Hub02)
if (hub02User) {
  // Inside Hub02: already authenticated → SKIP / HIDE this app's own login.
  // hub02User.email is populated — use it as the identity.
} else {
  // Not inside Hub02 → keep the EXISTING login exactly as it is.
}
```
`hub02User.email` is always filled in inside Hub02 (the SDK sources it for you).
Wherever the app currently reads the "current user" email, prefer `hub02User.email`
when it's present, else your existing value. Sign out should clear only **your
app's** session — the user stays signed into Hub02.

## That's it
No other Hub02 code belongs in the app. Do not add token handling, headers, or
fetch wrappers by hand — Steps 2 and 3 are the whole integration.

## Verify
1. Open the app **through Hub02** (`*.tools.hub02.com`): the app's own login is
   skipped; DevTools → Network shows `X-Hub02-Auth` on backend requests.
2. Open the app on its **own domain**: nothing changes; the native login appears.

## If data still doesn't load inside Hub02 (not a client bug)
If Network shows `X-Hub02-Auth` present but a backend request **fails** with a CORS
error (*"Request header field x-hub02-auth is not allowed…"*), the fix is on the
**backend** (allow the header + the `*.tools.hub02.com` origin, verify the token) —
that's the companion `PROMPT-BACKEND.md`. The client side is done.
Note: a `403` on a native provider's own `.../entities/User/me` (e.g. Base44)
inside Hub02 is **expected** — that's exactly why Step 3 uses the Hub02 identity.

Implement for this codebase now.
