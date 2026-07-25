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
  `supabase.from(...)` from the browser → pick **one**:
  - **OIDC / real Supabase sessions (recommended):**
    **[`PROMPT-SUPABASE-OIDC.md`](./PROMPT-SUPABASE-OIDC.md)** — enable Keycloak
    provider in Supabase Auth, paste 3 values, call `signInWithOAuth`.
  - **Legacy launch-token bridge:**
    **[`PROMPT-SUPABASE.md`](./PROMPT-SUPABASE.md)** — `hub02.connectSupabase()` +
    `hub02-supabase-session` edge function (header-injection path).
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

**Client** (`@hub02/sdk`): `hub02.autoSSO()` / `hub02.startSSO()` (OIDC redirect),
`hub02.installFetchInterceptor()` (legacy header path), `hub02.connectSupabase()`
(legacy Supabase bridge), `hub02.user()`, `hub02.isHub02Domain()`.

**Backend** (`@hub02/sdk/server`): `createHub02Callback()` (OIDC callback),
`tryAuthenticateHub02()` (legacy header verify), `hub02CorsOptions()`.

**Supabase Auth (no SDK protocol code):** Keycloak provider URL
`https://id.hub02.com/realms/hub02` — see `PROMPT-SUPABASE-OIDC.md`.
