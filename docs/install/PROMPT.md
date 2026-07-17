# Add "Sign in with Hub02" — install prompts

Integrating Hub02 SSO has **two halves**, which usually live in **different repos**.
Give each agent the prompt for the repo it's working in:

| Repo | Prompt | What it does |
|------|--------|--------------|
| **Frontend** (the app UI) | [`PROMPT-CLIENT.md`](./PROMPT-CLIENT.md) | Skip the app's own login inside Hub02; attach the identity token to backend calls. |
| **Backend** (the API) | [`PROMPT-BACKEND.md`](./PROMPT-BACKEND.md) | Verify the token, link users by email (one account), fix CORS for the `X-Hub02-Auth` header. |
| **Supabase + RLS** (direct `supabase.from(...)`) | [`PROMPT-SUPABASE.md`](./PROMPT-SUPABASE.md) | Give the Hub02 visitor a real Supabase session so RLS queries keep working (fixes `42501`). Use **instead of** the backend prompt when your data is Supabase RLS, not a separate API. |

Each prompt is **self-contained** (no URL-fetching), **additive-only** (never
replaces your existing auth/DB), and copy-paste ready.

## Which do I need?
- **Frontend-only tool** (no backend, or you don't own the backend): use the
  **client** prompt. Users get signed in and their email is read from Hub02.
- **Has a backend that authorizes by user**: use **both**. The client sends the
  token; the backend verifies it and resolves one account per verified email.
- **Order doesn't matter.** CORS lives on the backend, so if you wire the client
  first it simply won't succeed until the backend deploys.

## The contract (reference — do not fetch)
- Token: **EdDSA / Ed25519**, `iss="hub02"`, `aud="tool-identity"`, ~5 min expiry.
- JWKS: `https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks`
- Client identity: proxy-injected `window.__HUB02__` or same-origin `GET /__hub02/me`.
- Client → backend header: `X-Hub02-Auth: <jwt>` (SDK: `hub02.authHeaders()`).

## SDK helpers that do the heavy lifting
**Client** (`@hub02/sdk`): `hub02.installFetchInterceptor()` (one-line backend wiring),
`hub02.connectSupabase(supabase)` (one-line Supabase-RLS session), `hub02.user()` (email
auto-filled), `hub02.token()`, `hub02.authHeaders()`, `hub02.authFetch()`,
`hub02.isHub02Domain()`, `hub02.login()`.
**Backend** (`@hub02/sdk/server` · `hub02-sdk`): `tryAuthenticateHub02()` /
`try_authenticate_hub02()` (verify + fall back to native), `hub02CorsOptions()` /
`hub02_cors_kwargs()` (CORS in one line).
