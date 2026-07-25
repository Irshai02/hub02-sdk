/**
 * Fallback: OIDC callback → native Supabase session (when Keycloak provider path isn't used).
 *
 * Deploy as `supabase/functions/hub02-oidc-callback/index.ts`
 * Set verify_jwt = false in supabase/config.toml
 *
 * Env (set in Supabase secrets):
 *   HUB02_OIDC_ISSUER=https://id.hub02.com
 *   HUB02_OIDC_CLIENT_ID=hub02_...
 *   HUB02_OIDC_CLIENT_SECRET=sec_...
 *   HUB02_OIDC_REDIRECT_URI=https://your-tool.tools.hub02.com/auth/hub02/callback
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.9.6/index.ts";

const ISSUER = (Deno.env.get("HUB02_OIDC_ISSUER") ?? "https://id.hub02.com").replace(/\/+$/, "");
const CLIENT_ID = Deno.env.get("HUB02_OIDC_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("HUB02_OIDC_CLIENT_SECRET") ?? "";
const REDIRECT_URI = Deno.env.get("HUB02_OIDC_REDIRECT_URI") ?? "";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

function cors(req: Request) {
  const origin = req.headers.get("origin");
  const ok = !!origin && /^https:\/\/([a-z0-9-]+\.)?tools\.hub02\.com$/i.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "https://tools.hub02.com",
    "Access-Control-Allow-Headers":
      req.headers.get("access-control-request-headers") ??
      "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function exchangeCode(code: string, verifier: string) {
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const res = await fetch(`${ISSUER}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error_description || body.error || "token_exchange_failed");
  return body as { id_token: string; access_token: string };
}

Deno.serve(async (req) => {
  const c = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return json({ error: "missing_code_or_state" }, 400, c);

  const cookies = req.headers.get("cookie") ?? "";
  const readCookie = (name: string) =>
    cookies.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1);

  const expectedState = readCookie("hub02_oidc_state");
  const verifier = readCookie("hub02_oidc_pkce_verifier");
  if (!expectedState || expectedState !== state) return json({ error: "invalid_state" }, 400, c);
  if (!verifier) return json({ error: "missing_pkce_verifier" }, 400, c);

  try {
    const tokens = await exchangeCode(decodeURIComponent(code), decodeURIComponent(verifier));
    const { payload } = await jwtVerify(tokens.id_token, JWKS, {
      issuer: ISSUER,
      audience: CLIENT_ID,
    });
    const email = String(payload.email ?? "").trim().toLowerCase();
    if (!email) return json({ error: "no_email_in_id_token" }, 401, c);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    await admin.auth.admin.createUser({ email, email_confirm: true }).catch(() => {});
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = (link as { properties?: { hashed_token?: string } })?.properties?.hashed_token;
    if (linkErr || !tokenHash) return json({ error: "session_mint_failed" }, 500, c);

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    for (const type of ["email", "magiclink"] as const) {
      const { data } = await anon.auth.verifyOtp({ token_hash: tokenHash, type });
      if (data?.session) {
        return json(
          {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
          },
          200,
          c,
        );
      }
    }
    return json({ token_hash: tokenHash }, 200, c);
  } catch (e) {
    return json({ error: "oidc_callback_failed", detail: String((e as Error).message || e) }, 401, c);
  }
});
