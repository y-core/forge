import { describe, expect, it } from "bun:test";

import { createSignedCookie, createUnsignedCookie } from "./cookie";

const SECRET_32 = "a".repeat(32);
const SECRET_64 = "b".repeat(64);
const SECRET = "s".repeat(32);
const OTHER = "o".repeat(32);

/** The `name=value` pair a browser would send back from a `Set-Cookie`. */
function back(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0] as string;
}

// Captured from a differential run against `@remix-run/cookie` 0.5.4, the implementation this file
// replaced. They are the wire-format contract: a cookie in the wild must keep verifying.
const GOLDEN = {
  hello: { unsigned: "c=aGVsbG8=", signed: "c=aGVsbG8=.uoovmJ2VqIgTjdJDvVNBw2gWM8OGq76JA366LG3+vLg" },
  "a+b/c=d": { unsigned: "c=YStiL2M9ZA==", signed: "c=YStiL2M9ZA==.Xgh4Y09ZKUbR3sTEMaYXM8eUHypbQDrgkLHhT8W/eOA" },
  café: { unsigned: "c=Y2Fmw6k=", signed: "c=Y2Fmw6k=.0+0fPenBZMMrthNXyPkESo2dgs1ZzhK3R4mqU9wjMQY" },
  "🎉": { unsigned: "c=8J+OiQ==", signed: "c=8J+OiQ==.G18giGWY9SQDW7pqTqTkD830gtk0duc+wPB3UDSg8OI" },
  '{"i":"abc","d":{}}': {
    unsigned: "c=eyJpIjoiYWJjIiwiZCI6e319",
    signed: "c=eyJpIjoiYWJjIiwiZCI6e319.dA3fbiAsNbjDsKTJC7H8aFslzw4X85hiEwkRFaU3hXo",
  },
  "ÿÿÿ~": { unsigned: "c=w7/Dv8O/fg==", signed: "c=w7/Dv8O/fg==.BVR4+jJ8gEBkERuWgJUkCmn8aQtQnsJ+fIXks7kB8s8" },
} as const;

describe("wire format — golden vectors", () => {
  for (const [value, expected] of Object.entries(GOLDEN)) {
    it(`serializes ${JSON.stringify(value)} to the bytes the previous implementation produced`, async () => {
      expect(back(await createUnsignedCookie("c").serialize(value))).toBe(expected.unsigned);
      expect(back(await createSignedCookie("c", { secrets: [SECRET] }).serialize(value))).toBe(expected.signed);
    });

    it(`parses the stored wire bytes of ${JSON.stringify(value)} back to the value`, async () => {
      expect(await createUnsignedCookie("c").parse(expected.unsigned)).toBe(value);
      expect(await createSignedCookie("c", { secrets: [SECRET] }).parse(expected.signed)).toBe(value);
    });
  }

  // The base64url alphabet would spell these `-`, `_` and no padding — a slip that breaks a
  // fraction of live sessions while a round-trip-only test still passes.
  it("uses the standard alphabet, padding retained", async () => {
    const payload = back(await createUnsignedCookie("c").serialize("a+b/c=d")).slice(2);
    expect(payload).toBe("YStiL2M9ZA==");
    expect(payload[1]).toBe("S");
    expect(payload[4]).toBe("L");
    expect(payload.endsWith("==")).toBe(true);
  });

  it("strips the signature's padding to 43 characters", async () => {
    const wire = back(await createSignedCookie("c", { secrets: [SECRET] }).serialize("hello")).slice(2);
    const signature = wire.slice(wire.lastIndexOf(".") + 1);
    expect(signature).toHaveLength(43);
    expect(signature).not.toContain("=");
  });
});

describe("round trip", () => {
  const values = ["", "hello", "café", "日本語", "🎉🚀", "a+b/c=d", "semi;colon", 'quotes "x"', "x".repeat(4096)];

  it("round-trips through an unsigned cookie", async () => {
    const cookie = createUnsignedCookie("c");
    for (const value of values) {
      expect(await cookie.parse(back(await cookie.serialize(value)))).toBe(value);
    }
  });

  it("round-trips through a signed cookie", async () => {
    const cookie = createSignedCookie("c", { secrets: [SECRET] });
    for (const value of values) {
      expect(await cookie.parse(back(await cookie.serialize(value)))).toBe(value);
    }
  });
});

describe("parse — never throws", () => {
  const cookie = createSignedCookie("c", { secrets: [SECRET] });
  const unsigned = createUnsignedCookie("c");

  it("answers null for a falsy header", async () => {
    expect(await cookie.parse(null)).toBeNull();
    expect(await cookie.parse("")).toBeNull();
  });

  it("answers null when the name is absent", async () => {
    expect(await cookie.parse("d=value")).toBeNull();
  });

  it("answers null for a signed value with no dot", async () => {
    expect(await cookie.parse("c=aGVsbG8=")).toBeNull();
  });

  it("answers null for a bad signature", async () => {
    expect(await cookie.parse("c=aGVsbG8=.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
  });

  it("answers null for a non-base64 signature", async () => {
    expect(await cookie.parse("c=aGVsbG8=.!!!!")).toBeNull();
  });

  it("answers null for a signature from a foreign secret", async () => {
    const foreign = back(await createSignedCookie("c", { secrets: [OTHER] }).serialize("hello"));
    expect(await cookie.parse(foreign)).toBeNull();
  });

  it("answers null for a tampered payload", async () => {
    const wire = back(await cookie.serialize("hello"));
    expect(await cookie.parse(wire.replace("c=", "c=X"))).toBeNull();
  });

  it("answers null for junk base64 on the unsigned path", async () => {
    expect(await unsigned.parse("c=!!!!")).toBeNull();
    expect(await unsigned.parse("c=====")).toBeNull();
  });

  it("answers null for malformed UTF-8 rather than mojibake", async () => {
    // `0xC3 0x28` is a truncated two-byte sequence: a lenient decoder answers "Ã(" and the
    // mojibake then flows into JSON.parse or the session store.
    expect(await unsigned.parse("c=wyg=")).toBeNull();
    expect(await unsigned.parse("c=abc")).toBeNull();
  });

  it("answers the empty string for an empty value without verifying", async () => {
    expect(await cookie.parse("c=")).toBe("");
    expect(await unsigned.parse("c=")).toBe("");
  });

  it("reads the first value on a duplicate cookie name", async () => {
    expect(await unsigned.parse("c=aGVsbG8=; c=Y2Fmw6k=")).toBe("hello");
  });
});

describe("serialize — the empty-value sentinel", () => {
  it("emits `name=` with no encode and no HMAC", async () => {
    const cookie = createSignedCookie("c", { secrets: [SECRET] });
    expect(back(await cookie.serialize(""))).toBe("c=");
  });

  it("keeps the overridden Path while clearing", async () => {
    const cookie = createSignedCookie("c", { secrets: [SECRET], path: "/" });
    expect(await cookie.serialize("", { path: "/x" })).toContain("Path=/x");
  });
});

describe("serialize — attribute override", () => {
  it("emits Max-Age=0 rather than dropping it as falsy", async () => {
    const cookie = createSignedCookie("c", { secrets: [SECRET], maxAge: 60 });
    expect(await cookie.serialize("", { maxAge: 0, path: "/" })).toContain("Max-Age=0");
  });

  it("leaves untouched fields at their construction defaults", async () => {
    const cookie = createSignedCookie("c", { secrets: [SECRET], path: "/app", maxAge: 60, sameSite: "Strict" });
    const header = await cookie.serialize("v", { maxAge: 0 });
    expect(header).toContain("Path=/app");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Max-Age=0");
  });

  it("overrides every attribute it names", async () => {
    const cookie = createUnsignedCookie("c", { path: "/", sameSite: "Lax" });
    const header = await cookie.serialize("v", { domain: "example.com", path: "/x", sameSite: "None", secure: true, httpOnly: true });
    expect(header).toContain("Domain=example.com");
    expect(header).toContain("Path=/x");
    expect(header).toContain("SameSite=None");
    expect(header).toContain("Secure");
    expect(header).toContain("HttpOnly");
  });
});

describe("createSignedCookie — secret validation", () => {
  it("does not throw for a single secret of exactly 32 characters", () => {
    expect(() => createSignedCookie("session", { secrets: [SECRET_32] })).not.toThrow();
  });

  it("does not throw for a single secret longer than 32 characters", () => {
    expect(() => createSignedCookie("session", { secrets: [SECRET_64] })).not.toThrow();
  });

  it("does not throw when all secrets in a multi-secret array are valid", () => {
    expect(() => createSignedCookie("session", { secrets: [SECRET_32, SECRET_64] })).not.toThrow();
  });

  it("throws when the only secret is shorter than 32 characters", () => {
    expect(() => createSignedCookie("session", { secrets: ["short"] })).toThrow("at least 32 characters");
  });

  it("throws when one secret in a multi-secret array is too short (even if first is valid)", () => {
    expect(() => createSignedCookie("session", { secrets: [SECRET_32, "short"] })).toThrow("at least 32 characters");
  });

  it("throws with a message that includes the offending length", () => {
    let message = "";
    try {
      createSignedCookie("session", { secrets: ["abc"] });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("3");
    expect(message).toContain("at least 32 characters");
  });
});

describe("createSignedCookie — returned cookie", () => {
  it("returns a cookie object with the provided name", () => {
    expect(createSignedCookie("auth-session", { secrets: [SECRET_32] }).name).toBe("auth-session");
  });

  it("returns a cookie with the provided name when multiple secrets are supplied", () => {
    expect(createSignedCookie("my-cookie", { secrets: [SECRET_32, SECRET_64] }).name).toBe("my-cookie");
  });

  it("defaults sameSite to Lax when not specified", async () => {
    expect(await createSignedCookie("session", { secrets: [SECRET_32] }).serialize("value")).toContain("SameSite=Lax");
  });

  it("respects a Strict sameSite override", async () => {
    expect(await createSignedCookie("session", { secrets: [SECRET_32], sameSite: "Strict" }).serialize("value")).toContain("SameSite=Strict");
  });

  it("always sets HttpOnly on the serialized cookie", async () => {
    expect(await createSignedCookie("session", { secrets: [SECRET_32] }).serialize("value")).toContain("HttpOnly");
  });

  // Hardcoded, with no option to relax it: development is https at every hop, so `Secure` is
  // correct there by construction (`WORKERS_PLATFORM.md` §4e).
  it("always sets Secure, and takes no option that could drop it", async () => {
    expect(await createSignedCookie("session", { secrets: [SECRET_32] }).serialize("value")).toContain("Secure");
    // @ts-expect-error -- `secure` is not part of SignedCookieOptions
    const relaxed = createSignedCookie("session", { secrets: [SECRET_32], secure: false });
    expect(await relaxed.serialize("value")).toContain("Secure");
  });

  it("reports rotating only when more than one secret is held", () => {
    expect(createSignedCookie("c", { secrets: [SECRET_32] }).rotating).toBe(false);
    expect(createSignedCookie("c", { secrets: [SECRET_32, SECRET_64] }).rotating).toBe(true);
  });

  it("verifies against every secret, in array order", async () => {
    const seeded = back(await createSignedCookie("c", { secrets: [OTHER] }).serialize("payload"));
    expect(await createSignedCookie("c", { secrets: [SECRET, OTHER] }).parse(seeded)).toBe("payload");
    expect(await createSignedCookie("c", { secrets: [SECRET] }).parse(seeded)).toBeNull();
  });
});

describe("construction guards", () => {
  it("throws on an empty name", () => {
    // An empty name is the one path to `SetCookie.toString()` returning `""`, i.e. an empty header.
    expect(() => createSignedCookie("", { secrets: [SECRET_32] })).toThrow("must not be empty");
    expect(() => createUnsignedCookie("")).toThrow("must not be empty");
  });

  it("throws on a lone surrogate rather than substituting U+FFFD", async () => {
    await expect(createUnsignedCookie("c").serialize("\uD83D")).rejects.toThrow("lone surrogates");
    await expect(createSignedCookie("c", { secrets: [SECRET] }).serialize("bad \uDC00 here")).rejects.toThrow("lone surrogates");
  });
});

describe("key cache", () => {
  /** Counts `importKey` calls while `run` executes. */
  async function countImports(run: () => Promise<unknown>): Promise<number> {
    const original = crypto.subtle.importKey.bind(crypto.subtle);
    let calls = 0;
    // oxlint-disable-next-line typescript/no-explicit-any -- overload-heavy WebCrypto signature
    crypto.subtle.importKey = ((...args: any[]) => {
      calls++;
      // oxlint-disable-next-line typescript/no-explicit-any -- forwarding the same arguments
      return (original as any)(...args);
    }) as typeof crypto.subtle.importKey;
    try {
      await run();
    } finally {
      crypto.subtle.importKey = original;
    }
    return calls;
  }

  it("imports a key once, then never again", async () => {
    const cookie = createSignedCookie("c", { secrets: [SECRET] });
    const first = await countImports(async () => {
      await cookie.parse(back(await cookie.serialize("warm")));
    });
    expect(first).toBe(1);
    const rest = await countImports(async () => {
      for (let i = 0; i < 5; i++) await cookie.parse(back(await cookie.serialize(`v${i}`)));
    });
    expect(rest).toBe(0);
  });

  it("imports once under concurrent first use", async () => {
    const cookie = createSignedCookie("c", { secrets: [SECRET] });
    const calls = await countImports(() => Promise.all([cookie.serialize("a"), cookie.serialize("b"), cookie.serialize("c")]));
    expect(calls).toBe(1);
  });

  it("imports one key per secret, not one per call", async () => {
    const cookie = createSignedCookie("c", { secrets: [SECRET, OTHER] });
    const seeded = back(await createSignedCookie("c", { secrets: [OTHER] }).serialize("payload"));
    const calls = await countImports(async () => {
      expect(await cookie.parse(seeded)).toBe("payload");
      expect(await cookie.parse(seeded)).toBe("payload");
    });
    expect(calls).toBe(2);
  });

  it("clears the slot when the import fails, so a transient failure is not permanent", async () => {
    const cookie = createSignedCookie("c", { secrets: [SECRET] });
    const original = crypto.subtle.importKey.bind(crypto.subtle);
    crypto.subtle.importKey = (() => Promise.reject(new Error("transient"))) as typeof crypto.subtle.importKey;
    try {
      await expect(cookie.serialize("v")).rejects.toThrow("transient");
    } finally {
      crypto.subtle.importKey = original;
    }
    expect(await cookie.parse(back(await cookie.serialize("v")))).toBe("v");
  });
});
