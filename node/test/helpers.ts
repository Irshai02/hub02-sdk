/**
 * Test helpers: generate a local Ed25519 keypair, mint identity tokens, and
 * build a mock JWKS resolver. No network, no Hub02 secrets.
 */
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type KeyLike,
} from "jose";
import { HUB02_AUD, HUB02_ISS } from "../src/shared";

export interface TestKeys {
  privateKey: KeyLike;
  publicKey: KeyLike;
  publicJwk: JWK;
  kid: string;
}

export async function makeKeys(kid = "test-key-1"): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = "EdDSA";
  publicJwk.use = "sig";
  return { privateKey, publicKey, publicJwk, kid };
}

export interface MintOptions {
  sub?: string;
  hub_id?: string;
  tool_id?: string;
  email?: string;
  name?: string;
  iss?: string;
  aud?: string;
  expiresIn?: string; // e.g. "5m"
  expSecondsFromNow?: number; // overrides expiresIn for testing expiry
  iat?: number;
}

export async function mintToken(
  keys: TestKeys,
  opts: MintOptions = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const builder = new SignJWT({
    hub_id: opts.hub_id ?? "hub-123",
    tool_id: opts.tool_id ?? "tool-abc",
    email: opts.email,
    name: opts.name,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: keys.kid })
    .setSubject(opts.sub ?? "11111111-1111-1111-1111-111111111111")
    .setIssuer(opts.iss ?? HUB02_ISS)
    .setAudience(opts.aud ?? HUB02_AUD)
    .setIssuedAt(opts.iat ?? now);

  if (opts.expSecondsFromNow !== undefined) {
    builder.setExpirationTime(now + opts.expSecondsFromNow);
  } else {
    builder.setExpirationTime(opts.expiresIn ?? "5m");
  }

  return builder.sign(keys.privateKey);
}

/**
 * Build a JWKS resolver usable as the `jwks` verify option. Mimics
 * createRemoteJWKSet but resolves locally from supplied public keys.
 */
export function mockJwks(...keys: TestKeys[]) {
  const byKid = new Map(keys.map((k) => [k.kid, k.publicKey]));
  return async (header: { kid?: string }) => {
    const key = header.kid
      ? byKid.get(header.kid)
      : keys[0]?.publicKey;
    if (!key) {
      throw new Error(`No key for kid ${header.kid}`);
    }
    return key;
  };
}

export interface Rs256TestKeys {
  privateKey: KeyLike;
  publicKey: KeyLike;
  publicJwk: JWK;
  kid: string;
}

export async function makeRs256Keys(kid = "oidc-test-key"): Promise<Rs256TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  return { privateKey, publicKey, publicJwk, kid };
}

export interface MintOidcOptions {
  sub?: string;
  email?: string;
  name?: string;
  hub02_tool_id?: string;
  nonce?: string;
  iss?: string;
  aud?: string;
  expiresIn?: string;
}

export async function mintOidcIdToken(
  keys: Rs256TestKeys,
  opts: MintOidcOptions = {},
): Promise<string> {
  return new SignJWT({
    email: opts.email ?? "user@example.com",
    name: opts.name ?? "Test User",
    hub02_tool_id: opts.hub02_tool_id,
    nonce: opts.nonce,
  })
    .setProtectedHeader({ alg: "RS256", kid: keys.kid })
    .setSubject(opts.sub ?? "11111111-1111-1111-1111-111111111111")
    .setIssuer(opts.iss ?? "https://id.hub02.com")
    .setAudience(opts.aud ?? "hub02_test_client")
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "5m")
    .sign(keys.privateKey);
}
