import { describe, expect, it } from "bun:test";

import { base64Encode, hmacSign, importHmacKey, utf8Encode } from "../crypto/mod";
import { createSignedCookie, createUnsignedCookie } from "./cookie";
import type { SignedCookie } from "./types";

const SECRET_32 = "a".repeat(32);
const SECRET_64 = "b".repeat(64);
const SECRET = "s".repeat(32);
const OTHER = "o".repeat(32);

/** The `name=value` pair a browser would send back from a `Set-Cookie`. */
function back(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0] as string;
}

/** A wire value carrying `covered` verbatim under a valid signature — the only way to reach a segment `serialize` would never emit. */
async function forgeWire(covered: string): Promise<string> {
  const signature = await hmacSign(await importHmacKey(utf8Encode(SECRET)), covered);
  return `c=${covered}.${base64Encode(signature).replace(/=+$/, "")}`;
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
  const values = ["", "hello", "café", "日本語", "🎉🚀", "a+b/c=d", "semi;colon", 'quotes "x"', "x".repeat(2048)];

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
    const header = await cookie.serialize("v", { maxAge: 30 });
    expect(header).toContain("Path=/app");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Max-Age=30");
  });

  it("refuses the three attributes it forces, so a caller cannot be quietly ignored", async () => {
    const cookie = createSignedCookie("c", { secrets: [SECRET] });
    // @ts-expect-error -- `sameSite` is not part of SignedCookieAttributes
    await cookie.serialize("v", { sameSite: "None" });
    // @ts-expect-error -- `httpOnly` is not part of SignedCookieAttributes
    await cookie.serialize("v", { httpOnly: false });
    // @ts-expect-error -- `secure` is not part of SignedCookieAttributes
    expect(await cookie.serialize("v", { secure: false })).toContain("SameSite=Lax");
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

describe("createSignedCookie — read", () => {
  const cookie = createSignedCookie("c", { secrets: [SECRET, OTHER] });

  it("tells an absent cookie apart from one whose value did not verify", async () => {
    expect(await cookie.read(null)).toBeNull();
    expect(await cookie.read("d=value")).toBeNull();
    expect(await cookie.read("c=aGVsbG8=.AAAA")).toEqual({ value: null, current: false });
  });

  it("reports which secret signed a value it verified", async () => {
    const mine = back(await cookie.serialize("hello"));
    const retired = back(await createSignedCookie("c", { secrets: [OTHER] }).serialize("hello"));
    expect(await cookie.read(mine)).toEqual({ value: "hello", current: true });
    expect(await cookie.read(retired)).toEqual({ value: "hello", current: false });
  });
});

describe("createSignedCookie — the signed expiry", () => {
  const bounded = createSignedCookie("c", { secrets: [SECRET], maxAge: 600 });

  /** The wire value `bounded` would emit for `value`, with its expiry segment replaced by `expiry`. */
  async function restamp(value: string, expiry: string): Promise<string> {
    const wire = back(await bounded.serialize(value)).slice(2);
    return `c=${expiry}${wire.slice(wire.indexOf("."))}`;
  }

  it("parses a value still inside its window", async () => {
    expect(await bounded.parse(back(await bounded.serialize("hello")))).toBe("hello");
  });

  it("round-trips the destroy sentinel under a configured lifetime", async () => {
    expect(await bounded.parse(back(await bounded.serialize("")))).toBe("");
  });

  it("answers null once the value is past its expiry", async () => {
    const brief = createSignedCookie("c", { secrets: [SECRET], maxAge: 1 });
    const wire = back(await brief.serialize("hello"));
    expect(await brief.parse(wire)).toBe("hello");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await brief.parse(wire)).toBeNull();
  });

  it("answers null for an expiry pushed forward, because the HMAC covers it", async () => {
    expect(await bounded.parse(await restamp("hello", "4102444800"))).toBeNull();
  });

  it("answers null for a value carrying no expiry at all", async () => {
    const unbounded = createSignedCookie("c", { secrets: [SECRET] });
    expect(await bounded.parse(back(await unbounded.serialize("hello")))).toBeNull();
  });

  it("accepts a correctly signed decimal expiry, so the forging helper below proves what it claims", async () => {
    expect(await bounded.parse(await forgeWire("4102444800.aGVsbG8="))).toBe("hello");
  });

  // Every one of these is a second spelling of an instant that `Number` would accept, and therefore
  // a second wire form for one expiry.
  it("answers null for a signed but non-decimal expiry segment", async () => {
    for (const spelling of ["0x7fffffff", "1e12", "+1789000000", " 1789000000 ", "Infinity", "17890000000000"]) {
      expect(await bounded.parse(await forgeWire(`${spelling}.aGVsbG8=`))).toBeNull();
    }
  });

  it("moves the embedded expiry with a per-call maxAge override, so the header never outlives the value", async () => {
    const wire = back(await bounded.serialize("hello", { maxAge: 1 })).slice(2);
    const embedded = Number(wire.slice(0, wire.indexOf(".")));
    expect(embedded - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(1);
  });

  it("honours expires where no maxAge is given", async () => {
    const future = createSignedCookie("c", { secrets: [SECRET], expires: new Date(Date.now() + 60_000) });
    const wire = back(await future.serialize("hello")).slice(2);
    expect(wire.slice(0, wire.indexOf("."))).toMatch(/^\d{10}$/);
    expect(await future.parse(`c=${wire}`)).toBe("hello");
  });

  // The segment count, not `parse`: a cookie that silently lost its expiry parses its own output
  // perfectly well, and every value it ever signed then verifies forever.
  it("puts an expiry segment on the wire of a bounded cookie, and none on an unbounded one", async () => {
    expect(
      back(await bounded.serialize("hello"))
        .slice(2)
        .split("."),
    ).toHaveLength(3);
    const unbounded = createSignedCookie("c", { secrets: [SECRET] });
    expect(
      back(await unbounded.serialize("hello"))
        .slice(2)
        .split("."),
    ).toHaveLength(2);
  });

  it("refuses an elapsed expires rather than signing values that verify forever", () => {
    expect(() => createSignedCookie("c", { secrets: [SECRET], expires: new Date(Date.now() - 60_000) })).toThrow(
      "createSignedCookie: expires must be in the future",
    );
  });

  it("refuses a per-call override that leaves a bounded cookie nothing to embed", async () => {
    await expect(bounded.serialize("hello", { maxAge: 0 })).rejects.toThrow('serialize: "c" carries a lifetime');
    const byExpires = createSignedCookie("c", { secrets: [SECRET], expires: new Date(Date.now() + 60_000) });
    await expect(byExpires.serialize("hello", { expires: new Date(Date.now() - 60_000) })).rejects.toThrow("expires must be in the future");
    expect(back(await bounded.serialize("", { maxAge: 0 }))).toBe("c=");
  });

  it("refuses a non-finite maxAge rather than signing NaN", () => {
    expect(() => createSignedCookie("c", { secrets: [SECRET], maxAge: Number.NaN })).toThrow("must be a finite number");
    expect(() => createSignedCookie("c", { secrets: [SECRET], expires: new Date("nonsense") })).toThrow("must be a valid date");
  });

  // A year in milliseconds is the slip this catches: the expiry would overflow ten digits, every
  // value minted under it would fail its own format check, and nothing would say why.
  it("refuses a maxAge whose expiry would not fit the segment", async () => {
    expect(() => createSignedCookie("c", { secrets: [SECRET], maxAge: 60 * 60 * 24 * 365 * 1000 })).toThrow("at most 9999999999 epoch seconds");
    const brief = createSignedCookie("c", { secrets: [SECRET], maxAge: 60 });
    await expect(brief.serialize("hello", { maxAge: 60 * 60 * 24 * 365 * 1000 })).rejects.toThrow("at most 9999999999 epoch seconds");
  });

  it("clears with Max-Age=0 rather than carrying the construction lifetime onto the clearing header", async () => {
    const yearly = createSignedCookie("c", { secrets: [SECRET], maxAge: 31_536_000 });
    expect(await yearly.serialize("", { maxAge: 0 })).toBe("c=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure");
    expect(await yearly.serialize("")).toContain("Max-Age=31536000");
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

  // The per-call override wins everywhere else in the merge, so without the re-force a decorated
  // `serialize` — or one line of consumer code — drops `httpOnly` and `secure` back off.
  it("re-forces HttpOnly and Secure over a serialize-time override that drops them", async () => {
    const cookie = createSignedCookie("session", { secrets: [SECRET_32] });
    // @ts-expect-error -- neither is part of SignedCookieAttributes; this is the untyped caller
    const header = await cookie.serialize("value", { httpOnly: false, secure: false });
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
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

describe("serialize — the browser's size cap", () => {
  /** The longest value `cookie` still serializes, found by bisection because each attempt costs an HMAC. */
  async function largestFitting(cookie: SignedCookie): Promise<string> {
    let low = 0;
    let high = 4096;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      try {
        await cookie.serialize("x".repeat(mid));
        low = mid;
      } catch {
        high = mid - 1;
      }
    }
    return "x".repeat(low);
  }

  it("serializes a payload that still fits, and reads it back whole", async () => {
    const cookie = createSignedCookie("session", { secrets: [SECRET] });
    const value = await largestFitting(cookie);
    expect(value.length).toBeGreaterThan(2048);
    expect(await cookie.parse(back(await cookie.serialize(value)))).toBe(value);
  });

  it("throws naming the measured size once one character more is asked for", async () => {
    const cookie = createSignedCookie("session", { secrets: [SECRET] });
    const over = `${await largestFitting(cookie)}x`;
    const message = await cookie.serialize(over).then(
      () => "",
      (thrown: Error) => thrown.message,
    );
    expect(message).toContain('the Set-Cookie for "session" must be at most 4096 bytes');
    expect(Number(/\(got (\d+)\)/.exec(message)?.[1])).toBeGreaterThan(4096);
  });

  it("caps an unsigned cookie by the same measure", async () => {
    const cookie = createUnsignedCookie("theme");
    await expect(cookie.serialize("x".repeat(4096))).rejects.toThrow("must be at most 4096 bytes");
  });

  // The clearing header is a name and a handful of attributes, so no session can be large enough to
  // leave its own holder unable to sign out.
  it("never trips on the destroy path, however large the value it replaces", async () => {
    const cookie = createSignedCookie("session", { secrets: [SECRET], maxAge: 600 });
    expect(await cookie.serialize("", { maxAge: 0 })).toContain("Max-Age=0");
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
