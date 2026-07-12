import { describe, it, expect } from "vitest";
import {
  verifyHub02Token,
  authenticateHub02,
  tryAuthenticateHub02,
  extractToken,
  hub02Auth,
  isHub02Origin,
  hub02CorsOptions,
  Hub02AuthError,
} from "../src/server";
import { SignJWT, generateKeyPair } from "jose";
import { makeKeys, mintToken, mockJwks, type TestKeys } from "./helpers";

let keys: TestKeys;
let jwks: ReturnType<typeof mockJwks>;

beforeAll(async () => {
  keys = await makeKeys("kid-A");
  jwks = mockJwks(keys);
});

describe("verifyHub02Token", () => {
  it("verifies a valid Ed25519 token and returns claims", async () => {
    const token = await mintToken(keys, {
      sub: "user-1",
      hub_id: "hub-1",
      tool_id: "tool-1",
      email: "a@b.com",
      name: "Ada",
    });
    const claims = await verifyHub02Token(token, { jwks });
    expect(claims.sub).toBe("user-1");
    expect(claims.iss).toBe("hub02");
    expect(claims.aud).toBe("tool-identity");
    expect(claims.hub_id).toBe("hub-1");
    expect(claims.tool_id).toBe("tool-1");
    expect(claims.email).toBe("a@b.com");
    expect(claims.name).toBe("Ada");
  });

  it("rejects a token with the wrong issuer", async () => {
    const token = await mintToken(keys, { iss: "evil" });
    await expect(verifyHub02Token(token, { jwks })).rejects.toBeInstanceOf(
      Hub02AuthError,
    );
  });

  it("rejects a token with the wrong audience", async () => {
    const token = await mintToken(keys, { aud: "some-other-aud" });
    await expect(verifyHub02Token(token, { jwks })).rejects.toBeInstanceOf(
      Hub02AuthError,
    );
  });

  it("rejects an expired token", async () => {
    const token = await mintToken(keys, { expSecondsFromNow: -120 });
    await expect(verifyHub02Token(token, { jwks })).rejects.toBeInstanceOf(
      Hub02AuthError,
    );
  });

  it("rejects a token signed by an unknown key", async () => {
    const other = await makeKeys("kid-B");
    const token = await mintToken(other, {});
    // jwks only knows keys.kid; resolver throws on unknown kid.
    await expect(verifyHub02Token(token, { jwks })).rejects.toBeInstanceOf(
      Hub02AuthError,
    );
  });

  it("enforces tool_id match when provided", async () => {
    const token = await mintToken(keys, { tool_id: "tool-A" });
    await expect(
      verifyHub02Token(token, { jwks, toolId: "tool-B" }),
    ).rejects.toBeInstanceOf(Hub02AuthError);
    const claims = await verifyHub02Token(token, { jwks, toolId: "tool-A" });
    expect(claims.tool_id).toBe("tool-A");
  });

  it("rejects empty / non-string tokens", async () => {
    // @ts-expect-error testing runtime guard
    await expect(verifyHub02Token(undefined, { jwks })).rejects.toBeInstanceOf(
      Hub02AuthError,
    );
    await expect(verifyHub02Token("", { jwks })).rejects.toBeInstanceOf(
      Hub02AuthError,
    );
  });
});

describe("extractToken", () => {
  it("reads X-Hub02-Auth header", () => {
    expect(extractToken({ headers: { "x-hub02-auth": "abc" } })).toBe("abc");
  });
  it("strips Bearer from X-Hub02-Auth", () => {
    expect(extractToken({ headers: { "x-hub02-auth": "Bearer abc" } })).toBe(
      "abc",
    );
  });
  it("reads Authorization Bearer", () => {
    expect(
      extractToken({ headers: { authorization: "Bearer xyz" } }),
    ).toBe("xyz");
  });
  it("prefers X-Hub02-Auth over Authorization", () => {
    expect(
      extractToken({
        headers: { "x-hub02-auth": "a", authorization: "Bearer b" },
      }),
    ).toBe("a");
  });
  it("works with a Fetch Headers object", () => {
    const headers = new Headers({ "x-hub02-auth": "fromfetch" });
    expect(extractToken({ headers })).toBe("fromfetch");
  });
  it("returns undefined when no token present", () => {
    expect(extractToken({ headers: {} })).toBeUndefined();
  });
});

describe("authenticateHub02", () => {
  it("returns a trusted user from a valid request", async () => {
    const token = await mintToken(keys, {
      sub: "u-42",
      email: "e@x.com",
      name: "Grace",
    });
    const user = await authenticateHub02(
      { headers: { "x-hub02-auth": token } },
      { jwks },
    );
    expect(user.id).toBe("u-42");
    expect(user.email).toBe("e@x.com");
    expect(user.name).toBe("Grace");
  });

  it("throws 401 when no token", async () => {
    try {
      await authenticateHub02({ headers: {} }, { jwks });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Hub02AuthError);
      expect((err as Hub02AuthError).status).toBe(401);
    }
  });
});

describe("tryAuthenticateHub02", () => {
  it("returns the user for a valid X-Hub02-Auth token", async () => {
    const token = await mintToken(keys, { sub: "u-try" });
    const user = await tryAuthenticateHub02(
      { headers: { "x-hub02-auth": token } },
      { jwks },
    );
    expect(user?.id).toBe("u-try");
  });

  it("returns null when no identity is present (fall back to native)", async () => {
    expect(await tryAuthenticateHub02({ headers: {} }, { jwks })).toBeNull();
  });

  it("throws on a present-but-invalid X-Hub02-Auth token", async () => {
    await expect(
      tryAuthenticateHub02({ headers: { "x-hub02-auth": "garbage" } }, { jwks }),
    ).rejects.toBeInstanceOf(Hub02AuthError);
  });

  it("uses an Authorization Bearer only when it is a Hub02 token", async () => {
    const token = await mintToken(keys, { sub: "u-bearer" });
    const user = await tryAuthenticateHub02(
      { headers: { authorization: `Bearer ${token}` } },
      { jwks },
    );
    expect(user?.id).toBe("u-bearer");
  });

  it("ignores a foreign JWT bearer (iss !== hub02) → null", async () => {
    const { privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const foreign = await new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer("some-other-idp")
      .setSubject("x")
      .sign(privateKey);
    expect(
      await tryAuthenticateHub02(
        { headers: { authorization: `Bearer ${foreign}` } },
        { jwks },
      ),
    ).toBeNull();
  });

  it("ignores an opaque (non-JWT) bearer → null", async () => {
    expect(
      await tryAuthenticateHub02(
        { headers: { authorization: "Bearer opaque-token-123" } },
        { jwks },
      ),
    ).toBeNull();
  });
});

describe("isHub02Origin / hub02CorsOptions", () => {
  it("accepts *.tools.hub02.com over https", () => {
    expect(isHub02Origin("https://parlex-test.tools.hub02.com")).toBe(true);
    expect(isHub02Origin("https://tools.hub02.com")).toBe(true);
  });
  it("rejects other origins and non-https", () => {
    expect(isHub02Origin("https://evil.com")).toBe(false);
    expect(isHub02Origin("http://x.tools.hub02.com")).toBe(false);
    expect(isHub02Origin("https://tools.hub02.com.evil.com")).toBe(false);
    expect(isHub02Origin(undefined)).toBe(false);
  });

  it("cors options allow Hub02 origins, no-origin, and extra allow-list", () => {
    const opts = hub02CorsOptions({ origin: ["https://my-app.com"] });
    const allow = (o?: string) =>
      new Promise<boolean>((resolve) =>
        opts.origin(o, (_e, ok) => resolve(!!ok)),
      );
    expect(opts.allowedHeaders).toContain("X-Hub02-Auth");
    return Promise.all([
      allow("https://x.tools.hub02.com").then((v) => expect(v).toBe(true)),
      allow("https://my-app.com").then((v) => expect(v).toBe(true)),
      allow(undefined).then((v) => expect(v).toBe(true)),
      allow("https://evil.com").then((v) => expect(v).toBe(false)),
    ]);
  });
});

describe("hub02Auth middleware", () => {
  function mockRes() {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    return res;
  }

  it("attaches req.hub02User and calls next on success", async () => {
    const token = await mintToken(keys, { sub: "u-mw" });
    const req = { headers: { "x-hub02-auth": token } } as Record<
      string,
      unknown
    >;
    const res = mockRes();
    let nexted = false;
    await hub02Auth({ jwks })(
      req as never,
      res as never,
      () => {
        nexted = true;
      },
    );
    expect(nexted).toBe(true);
    expect((req as { hub02User?: { id: string } }).hub02User?.id).toBe("u-mw");
  });

  it("responds 401 on a bad token", async () => {
    const req = { headers: { "x-hub02-auth": "garbage" } };
    const res = mockRes();
    await hub02Auth({ jwks })(req as never, res as never, () => {
      throw new Error("next should not be called");
    });
    expect(res.statusCode).toBe(401);
    expect((res.body as { authenticated: boolean }).authenticated).toBe(false);
  });
});
