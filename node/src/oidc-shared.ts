/** Hub02 OIDC provider constants (Sign in with Hub02 — authorization-code + PKCE). */

export const HUB02_OIDC_ISSUER_DEFAULT = "https://id.hub02.com";

/** Convention registered automatically for every published tool. */
export const HUB02_OIDC_CALLBACK_PATH = "/auth/hub02/callback";

export const HUB02_OIDC_COOKIE_VERIFIER = "hub02_oidc_pkce_verifier";
export const HUB02_OIDC_COOKIE_STATE = "hub02_oidc_state";
export const HUB02_OIDC_COOKIE_NONCE = "hub02_oidc_nonce";

export const HUB02_OIDC_STORAGE_VERIFIER = "hub02_oidc_pkce_verifier";
export const HUB02_OIDC_STORAGE_STATE = "hub02_oidc_state";
export const HUB02_OIDC_STORAGE_NONCE = "hub02_oidc_nonce";

export const HUB02_OIDC_DEFAULT_SCOPE = "openid profile email";

export interface Hub02OidcUser {
  /** Hub02 user UUID (`sub` claim). */
  id: string;
  email?: string;
  name?: string;
  hub02ToolId?: string;
  nonce?: string;
}

export interface Hub02OidcTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export function b64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  const b64 =
    typeof btoa === "function"
      ? btoa(s)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256B64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return b64Url(new Uint8Array(digest));
}

export function randomB64Url(byteLen = 32): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return b64Url(bytes);
}

export async function generatePkce(): Promise<{
  verifier: string;
  challenge: string;
  state: string;
  nonce: string;
}> {
  const verifier = randomB64Url(32);
  const challenge = await sha256B64Url(verifier);
  return {
    verifier,
    challenge,
    state: randomB64Url(16),
    nonce: randomB64Url(16),
  };
}

export function oidcDiscoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

export function oidcJwksUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`;
}
