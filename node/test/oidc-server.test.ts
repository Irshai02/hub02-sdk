import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { importJWK } from "jose";
import {
  exchangeHub02Code,
  verifyHub02IdToken,
  handleHub02Callback,
  Hub02OidcError,
} from "../src/oidc-server";
import { makeRs256Keys, mintOidcIdToken, type Rs256TestKeys } from "./helpers";

const TEST_ISSUER = "https://id.hub02.com";
const CLIENT_ID = "hub02_test_client";
const REDIRECT_URI = "https://demo.tools.hub02.com/auth/hub02/callback";

let rs256: Rs256TestKeys;
let localJwks: ReturnType<typeof import("jose").createRemoteJWKSet>;

beforeAll(async () => {
  rs256 = await makeRs256Keys("oidc-kid-1");
  const key = await importJWK(rs256.publicJwk, "RS256");
  localJwks = async () => key;
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/.well-known/jwks.json")) {
        return new Response(JSON.stringify({ keys: [rs256.publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/token") && init?.method === "POST") {
        const idToken = await mintOidcIdToken(rs256, {
          iss: TEST_ISSUER,
          aud: CLIENT_ID,
          email: "ada@example.com",
          nonce: "nonce-abc",
        });
        return new Response(
          JSON.stringify({
            access_token: "at_test",
            id_token: idToken,
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exchangeHub02Code", () => {
  it("exchanges a code for tokens", async () => {
    const tokens = await exchangeHub02Code({
      code: "code-123",
      redirectUri: REDIRECT_URI,
      codeVerifier: "verifier-123",
      clientId: CLIENT_ID,
      clientSecret: "sec_test",
      issuer: TEST_ISSUER,
    });
    expect(tokens.access_token).toBe("at_test");
    expect(tokens.id_token).toBeTruthy();
  });
});

describe("verifyHub02IdToken", () => {
  it("verifies RS256 ID token from JWKS", async () => {
    const idToken = await mintOidcIdToken(rs256, {
      iss: TEST_ISSUER,
      aud: CLIENT_ID,
      email: "ada@example.com",
      name: "Ada",
      nonce: "nonce-abc",
    });
    const user = await verifyHub02IdToken({
      idToken,
      clientId: CLIENT_ID,
      issuer: TEST_ISSUER,
      nonce: "nonce-abc",
      jwks: localJwks,
    });
    expect(user.id).toBeTruthy();
    expect(user.email).toBe("ada@example.com");
    expect(user.name).toBe("Ada");
  });

  it("rejects nonce mismatch", async () => {
    const idToken = await mintOidcIdToken(rs256, {
      iss: TEST_ISSUER,
      aud: CLIENT_ID,
      nonce: "expected",
    });
    await expect(
      verifyHub02IdToken({
        idToken,
        clientId: CLIENT_ID,
        issuer: TEST_ISSUER,
        nonce: "wrong",
        jwks: localJwks,
      }),
    ).rejects.toBeInstanceOf(Hub02OidcError);
  });
});

describe("handleHub02Callback", () => {
  it("exchanges code, verifies token, calls onUser", async () => {
    const onUser = vi.fn();
    const resBody: { status?: number; json?: unknown } = {};
    const res = {
      status(code: number) {
        resBody.status = code;
        return this;
      },
      json(body: unknown) {
        resBody.json = body;
        return this;
      },
      redirect: vi.fn(),
      send: vi.fn(),
    };

    await handleHub02Callback(
      {
        headers: {
          cookie:
            "hub02_oidc_state=state-1; hub02_oidc_pkce_verifier=verifier-1; hub02_oidc_nonce=nonce-abc",
        },
        query: { code: "code-123", state: "state-1" },
      },
      res,
      {
        clientId: CLIENT_ID,
        clientSecret: "sec_test",
        redirectUri: REDIRECT_URI,
        issuer: TEST_ISSUER,
        jwks: localJwks,
        onUser,
      },
    );

    expect(onUser).toHaveBeenCalledOnce();
    expect(onUser.mock.calls[0][0].email).toBe("ada@example.com");
  });

  it("rejects invalid state", async () => {
    const resBody: { status?: number; json?: unknown } = {};
    const res = {
      status(code: number) {
        resBody.status = code;
        return this;
      },
      json(body: unknown) {
        resBody.json = body;
        return this;
      },
      redirect: vi.fn(),
      send: vi.fn(),
    };

    await handleHub02Callback(
      {
        headers: { cookie: "hub02_oidc_state=expected" },
        query: { code: "code-123", state: "wrong" },
      },
      res,
      {
        clientId: CLIENT_ID,
        clientSecret: "sec_test",
        redirectUri: REDIRECT_URI,
        issuer: TEST_ISSUER,
        onUser: vi.fn(),
      },
    );

    expect(resBody.status).toBe(400);
    expect(resBody.json).toEqual({ error: "invalid_state" });
  });
});
