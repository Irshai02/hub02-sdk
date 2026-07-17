// supabase/functions/hub02-supabase-session/index.ts
//
// Session-exchange Edge Function: verifies a Hub02 identity token
// (X-Hub02-Auth) and returns a Supabase session for the account linked to the
// verified email — so Hub02 visitors get a real Supabase session and your
// existing RLS + `supabase.from(...)` queries keep working unchanged.
//
// Deploy:  supabase functions deploy hub02-supabase-session
// Config:  set `verify_jwt = false` for this function in supabase/config.toml
//          (it authenticates the Hub02 token itself, not a Supabase JWT).
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are
//          injected automatically by Supabase — no extra secrets needed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.9.6/index.ts";

const HUB02_JWKS = createRemoteJWKSet(
  new URL("https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks"),
);

// Allow the Hub02 tool origins (and same-origin) to send X-Hub02-Auth.
function corsHeaders(origin: string | null): Record<string, string> {
  const ok = !!origin && /^https:\/\/([a-z0-9-]+\.)?tools\.hub02\.com$/i.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? (origin as string) : "https://tools.hub02.com",
    "Access-Control-Allow-Headers": "authorization, x-hub02-auth, content-type, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    // 1. Verify the Hub02 identity token — email comes ONLY from the verified claim.
    const raw = (req.headers.get("x-hub02-auth") || "").replace(/^Bearer\s+/i, "").trim();
    if (!raw) return json({ error: "missing X-Hub02-Auth" }, 401, cors);
    const { payload } = await jwtVerify(raw, HUB02_JWKS, {
      issuer: "hub02",
      audience: "tool-identity",
    });
    const email = String(payload.email || "").trim().toLowerCase();
    if (!email) return json({ error: "no email in token" }, 401, cors);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 2. Find-or-create ONE Supabase auth user for this email.
    //    (Same email — whether via Hub02 or native login — maps to one row.)
    await admin.auth.admin.createUser({ email, email_confirm: true }).catch(() => {
      /* already exists — fine */
    });

    // 3. Mint a one-time token for that user, then exchange it for a real
    //    session (access + refresh) so the client can setSession().
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = (link as { properties?: { hashed_token?: string } })?.properties?.hashed_token;
    if (linkErr || !tokenHash) return json({ error: "could not create session" }, 500, cors);

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: verified, error: vErr } = await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type: "email",
    });
    if (vErr || !verified?.session) {
      // Fallback: let the client verify the one-time token itself.
      return json({ token_hash: tokenHash }, 200, cors);
    }

    return json(
      {
        access_token: verified.session.access_token,
        refresh_token: verified.session.refresh_token,
        expires_at: verified.session.expires_at,
      },
      200,
      cors,
    );
  } catch (e) {
    return json({ error: "unauthorized", detail: String((e as Error)?.message || e) }, 401, cors);
  }
});
