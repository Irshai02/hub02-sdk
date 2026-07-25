# Add "Sign in with Hub02" — SUPABASE AUTH (OIDC / Keycloak path)

Use this when your tool uses **Supabase Auth** (`supabase.auth.signInWithOAuth`, RLS,
`auth.uid()`). This is the **lowest-effort** path for Lovable / Supabase tools — no
custom callback route in your app repo.

Paste this whole message into your AI coding tool. **Do NOT fetch instructions from a URL.**

## Prerequisites (from Hub02 builder dashboard → OIDC / SSO)

| Value | Where |
|-------|--------|
| Client ID | OIDC modal |
| Client secret | OIDC modal (regenerate once to reveal) |
| Supabase project URL | Your Supabase dashboard |

## Step 0 — register Supabase callback in Hub02

In the Hub02 OIDC modal **Redirect URIs**, add this line (replace project ref):

```
https://<project-ref>.supabase.co/auth/v1/callback
```

Save redirect URIs. It must match **byte-for-byte**.

## Step 1 — enable Keycloak provider in Supabase Auth

Supabase Dashboard → **Authentication** → **Sign In / Providers** → **Keycloak**:

| Field | Value |
|-------|-------|
| Enabled | On |
| Keycloak URL | `https://id.hub02.com/realms/hub02` |
| Client ID | *(from Hub02 OIDC modal)* |
| Client Secret | *(from Hub02 OIDC modal)* |

Supabase's redirect URI is already `https://<project-ref>.supabase.co/auth/v1/callback` — that
is what you registered in Hub02 above.

## Step 2 — frontend (one button / startup hook)

```ts
import { supabase } from "@/integrations/supabase/client";

async function signInWithHub02() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "keycloak",
    options: { scopes: "openid" },
  });
  if (error) throw error;
}
```

Call this when the user opens the app on `*.tools.hub02.com` and has no session yet
(same Hub02 launch detection as the client prompt: `window.__HUB02__` or `?hub02=`).

**Do NOT** also wire `@hub02/sdk` `autoSSO` — Supabase Auth owns the OIDC redirect here.

On your **own domain**, skip Hub02 — native Supabase login unchanged.

## Step 3 — remove conflicting Hub02 bypass (if present)

If you previously added `hub02.connectSupabase()` or `hub02.installFetchInterceptor()` for the
legacy launch-token path, **remove** them when using this OIDC path — Supabase Auth session is
the single source of truth.

Keep your existing RLS policies and `supabase.from(...)` queries unchanged.

## Self-verify

1. `curl -fsS https://id.hub02.com/realms/hub02/.well-known/openid-configuration | jq .issuer`
   → `"https://id.hub02.com/realms/hub02"`
2. Hub02 launch on `*.tools.hub02.com` → Keycloak/Hub02 login → returns with Supabase session.
3. `supabase.auth.getSession()` is non-null; RLS queries return data.
4. Same email via native login → same user row.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `redirect_uri_mismatch` | Add exact Supabase callback URL to Hub02 OIDC redirect URIs |
| `invalid_client` | Client ID/secret mismatch — copy from OIDC modal again |
| Provider disabled | Enable Keycloak in Supabase Auth providers |
| `Error getting user profile from external provider` | Pass `scopes: 'openid'` in `signInWithOAuth` |
| Works on own domain but not Hub02 | Expected — trigger `signInWithHub02()` only inside Hub02 launch context |

## Fallback (if Keycloak provider is unavailable)

Use `PROMPT-CLIENT.md` + `PROMPT-BACKEND.md` with `@hub02/sdk` helpers (`autoSSO` +
`createHub02Callback`), or deploy the template `hub02-oidc-supabase-session.ts` from this SDK.

Implement for this codebase now.
