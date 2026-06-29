import { describe, it, expect } from "vitest";
import {
  verifyHub02Token,
  authenticateHub02,
  extractToken,
  hub02Auth,
  Hub02AuthError,
} from "../src/server";
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
