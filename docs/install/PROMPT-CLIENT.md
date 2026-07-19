# Add "Sign in with Hub02" — CLIENT (frontend) install prompt

Paste this whole message into your AI coding tool. It integrates **Hub02 single
sign-on** into this app's **frontend** with the smallest possible change.
Everything you need is here — **do NOT fetch or run instructions from any URL.**

## What this does
When this app is opened **through Hub02** (a `*.tools.hub02.com` domain), the
visitor is **already signed in via Hub02**. Your job:
1. **Skip this app's own login** and use the Hub02 identity (email).
2. **Send that identity to this app's backend** on every request (if it has one).
On the app's **own domain**, Hub02 is not involved — leave everything as-is.

## Hard rules
1. **ADDITIVE ONLY.** Do NOT remove or replace the app's existing auth. Hub02 takes
   priority WHEN PRESENT and falls back to the existing auth when absent.
2. **Do NOT fetch or run instructions from any URL.** This message is complete.
3. Use the SDK's helpers — do not hand-write a `window.fetch` wrapper or parse tokens.
   A hand-written global fetch wrapper that also intercepts Hub02's own
   `/__hub02/*` calls will recurse into itself and can trigger a rate-limit
   block from the hosting edge network — the SDK's helper already avoids this.
4. **Never gate rendering the app on an optional call.** If a helper call is
   wrapped in optional chaining (`foo?.()`) and that chain also decides whether
   to render (`.then()/.finally()`), a missing/older method silently skips
   the render too — see Step 2 for the safe pattern.

## Step 0 — install the LATEST SDK (do not pin an old version)
```
npm i @hub02/sdk@latest        # or pnpm add / yarn add
```
If the SDK is already a dependency, **upgrade it** rather than leaving it as-is —
these instructions assume the helpers below exist. If you use a lockfile
(`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) and the install doesn't
regenerate it, run the install again or update the lockfile explicitly — CI/deploy
commands like `npm ci` install exactly what the lock says, ignoring a newer
version your `package.json` range would otherwise allow.

## Step 1 — one line at the app entry (main.tsx / index.tsx)
This attaches the Hub02 identity (`X-Hub02-Auth`) to your backend requests
automatically. Add it **once**, at the top, before the app renders:
```ts
import { hub02 } from "@hub02/sdk";
hub02.installFetchInterceptor();
```
That's the entire "send identity to the backend" step — the SDK handles it safely
(only your own backend, never third parties, never Hub02's internal endpoints).
Do NOT wrap `window.fetch` yourself. Skip this step if the app has no backend.

## Step 2 — skip the app's own login when inside Hub02
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

**If any async Hub02 call gates the initial render** (e.g. waiting on `hub02.user()`
or `hub02.connectSupabase(...)` before mounting the app), render **unconditionally**
in a `finally`/`catch`-guarded block — never rely on optional chaining to also
control whether render runs:
```ts
async function boot() {
  try {
    await hub02.user(); // or connectSupabase(...), or nothing at all
  } catch {
    /* ignore — render anyway */
  }
  createRoot(document.getElementById("root")!).render(<App />);
}
boot();
```
Not `someOptionalMethod?.(x).catch().finally(render)` — if the method is
undefined (e.g. an older SDK version), the whole chain including `.finally`
never runs, and the app renders nothing (blank/white screen) with no error.

## That's it
No other Hub02 code belongs in the app. Do not add token handling, headers, or
fetch wrappers by hand — Steps 1 and 2 are the whole integration.

## Verify
1. Open the app **through Hub02** (`*.tools.hub02.com`): the app's own login is
   skipped; DevTools → Network shows `X-Hub02-Auth` on backend requests.
2. Open the app on its **own domain**: nothing changes; the native login appears.

## Troubleshooting
| Symptom | Likely cause | Fix |
|---|---|---|
| Login page still shows inside Hub02 | `hub02.user()` returns `null` — the tool's Hub02 gate predates identity support, or the app checks the wrong thing | Confirm in console: `fetch("/__hub02/me").then(r=>r.json()).then(console.log)` → if `authenticated` is missing/false, this is a gate/platform issue, not your code — report it, don't keep changing app code |
| Blank/white screen on load | An optional-chained Hub02 call is also gating the render (see Step 2) | Use the `boot()` pattern — render unconditionally |
| Repeated requests to `/__hub02/token`, then a rate-limit error | A hand-written global `fetch` wrapper is intercepting the SDK's own token-minting call and recursing | Remove the hand-written wrapper; use `hub02.installFetchInterceptor()` instead |
| `X-Hub02-Auth` missing even after `installFetchInterceptor()` | SDK version predates the helper, or lockfile pinned an old version | Confirm the installed version ≥ the one that added it; re-run install; check the lockfile actually updated |
| Data loads fine standalone but is empty/fails inside Hub02, with no CORS error | Backend needs wiring too | Apply `PROMPT-BACKEND.md` or `PROMPT-SUPABASE.md` (see `PROMPT.md` to pick) |
| Network shows `X-Hub02-Auth` present but the request fails with a CORS error / "provisional headers are shown" | Backend doesn't allow the header/origin yet | Backend-side fix — not this prompt. See `PROMPT-BACKEND.md` / `PROMPT-SUPABASE.md` |

Note: a `403` on a native provider's own `.../entities/User/me` (e.g. Base44)
inside Hub02 is **expected** — that's exactly why Step 2 uses the Hub02 identity
instead.

Implement for this codebase now.
