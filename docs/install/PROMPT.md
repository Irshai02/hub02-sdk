# Add "Sign in with Hub02" — pick the right prompt

Integrating Hub02 SSO has up to **two** parts, usually in **two different repos**.
Answer the two questions below, then hand the matching prompt(s) to your coding
agent (in the repo they apply to). Each prompt is self-contained — no URL-fetch
needed, and don't paste more than the two you need.

## 1. Does this app have its own backend?

- **No backend at all** (e.g. Base44, a static/client-only tool) →
  **[`PROMPT-CLIENT.md`](./PROMPT-CLIENT.md)** only. Done.
- **Yes, keep reading** → also read the client prompt, then answer question 2.

## 2. How does the backend read/write data?

- **A server you control** (Node/Express/Fastify/Next API routes, Python
  FastAPI/Flask, a Deno/Supabase Edge Function you call explicitly) — the data
  path goes through a request handler where a header can be checked →
  **[`PROMPT-BACKEND.md`](./PROMPT-BACKEND.md)**.
- **Direct database access under row-level security** — the client calls
  `supabase.from(...)` (or an equivalent BaaS SDK) straight from the browser;
  there is no server-side handler to check a header in, because Postgres/the
  BaaS itself enforces authorization via the caller's session →
  **[`PROMPT-SUPABASE.md`](./PROMPT-SUPABASE.md)**.
  (This is the Supabase implementation of a general pattern — bridging identity
  into a database that authorizes by session, not by a header. If a future tool
  uses a different BaaS with the same direct-to-DB model, the same idea
  applies: mint that BaaS's own session from the verified Hub02 identity.)
- **Not sure?** If `grep -r "supabase.from(" src/` (or `.from<Table>`) turns up
  your data reads, it's the Supabase case, even if the project also has a few
  Edge Functions. If all data access goes through your own API endpoints, it's
  the backend case. A project can be both — apply both prompts.

## Why the split matters (real failure we hit)
Pasting the **Backend** prompt into a Supabase-RLS tool built a working-looking
but **orphaned** verify-token function — correct code, wrong data path, since no
query ever called it. The RLS case needs a session, not a header check. Picking
the wrong prompt burns a debug cycle; the questions above take 30 seconds.

## Order doesn't matter
CORS/session-exchange lives on the backend side, so wiring the client first
just means it won't fully work until the backend prompt lands too — nothing
breaks by doing it in either order.

## The contract (reference — do not fetch)
- Token: **EdDSA / Ed25519**, `iss="hub02"`, `aud="tool-identity"`, ~5 min expiry.
- JWKS: `https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks`
- Client identity: proxy-injected `window.__HUB02__` or same-origin `GET /__hub02/me`.
- Client → backend header: `X-Hub02-Auth: <jwt>` (SDK: `hub02.installFetchInterceptor()`).

## SDK helpers that do the heavy lifting
Always install the **latest** `@hub02/sdk` / `hub02-sdk` — older versions are
missing helpers these prompts assume exist (see each prompt's Step 1).

**Client** (`@hub02/sdk`): `hub02.installFetchInterceptor()` (one-line backend
wiring), `hub02.connectSupabase(supabase)` (one-line Supabase-RLS session),
`hub02.user()` (email auto-filled), `hub02.token()`, `hub02.authHeaders()`,
`hub02.authFetch()`, `hub02.isHub02Domain()`, `hub02.login()`.

**Backend** (`@hub02/sdk/server` · `hub02-sdk`): `tryAuthenticateHub02()` /
`try_authenticate_hub02()` (verify + fall back to native), `hub02CorsOptions()`
/ `hub02_cors_kwargs()` (CORS in one line).
