import { describe, expect, it } from "bun:test";

import { COOKIE_ATTRIBUTES_DEFAULT, createUnsignedCookie, decodePayload, encodePayload, mergeAttributes, readWire, setCookie } from "./cookie";
import * as httpBarrel from "./mod";
import type { ResolvedAttributes } from "./types";

/** The `name=value` pair a browser would send back from a `Set-Cookie`. */
function back(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0] as string;
}

const UNSET: ResolvedAttributes = {
  domain: undefined,
  expires: undefined,
  httpOnly: undefined,
  maxAge: undefined,
  partitioned: undefined,
  path: undefined,
  sameSite: undefined,
  secure: undefined,
};

describe("COOKIE_ATTRIBUTES_DEFAULT", () => {
  it("holds exactly Path=/, SameSite=Lax, HttpOnly and Secure", () => {
    expect(COOKIE_ATTRIBUTES_DEFAULT).toEqual({ path: "/", sameSite: "Lax", httpOnly: true, secure: true });
  });
});

describe("http barrel", () => {
  it("exports createUnsignedCookie, whose cookie round-trips a value", async () => {
    const cookie = httpBarrel.createUnsignedCookie("c");
    expect(await cookie.parse(back(await cookie.serialize("café")))).toBe("café");
  });

  it("exports COOKIE_ATTRIBUTES_DEFAULT holding the four shared attributes", () => {
    expect(httpBarrel.COOKIE_ATTRIBUTES_DEFAULT).toEqual({ path: "/", sameSite: "Lax", httpOnly: true, secure: true });
  });
});

describe("createUnsignedCookie — attributes", () => {
  it("serializes an unprefixed name with Path=/ and SameSite=Lax, and neither HttpOnly nor Secure", async () => {
    expect(await createUnsignedCookie("c").serialize("v")).toBe("c=dg==; Path=/; SameSite=Lax");
  });

  it("overrides every attribute it names", async () => {
    const cookie = createUnsignedCookie("c", { path: "/", sameSite: "Lax" });
    const header = await cookie.serialize("v", { domain: "example.com", path: "/x", sameSite: "None", secure: true, httpOnly: true });
    expect(header).toBe("c=dg==; Domain=example.com; HttpOnly; Path=/x; SameSite=None; Secure");
  });
});

describe("createUnsignedCookie — parse", () => {
  const unsigned = createUnsignedCookie("c");

  it("answers null for junk base64", async () => {
    expect(await unsigned.parse("c=!!!!")).toBeNull();
    expect(await unsigned.parse("c=====")).toBeNull();
  });

  it("answers null for malformed UTF-8 rather than mojibake", async () => {
    // `wyg=` is 0xC3 0x28, a truncated two-byte sequence a lenient decoder reads as "Ã(".
    expect(await unsigned.parse("c=wyg=")).toBeNull();
    expect(await unsigned.parse("c=abc")).toBeNull();
  });

  it("reads the first value on a duplicate cookie name", async () => {
    expect(await unsigned.parse("c=aGVsbG8=; c=Y2Fmw6k=")).toBe("hello");
  });
});

describe("encodePayload and decodePayload", () => {
  it("encodes to standard base64 of the UTF-8 bytes, and decodes back", () => {
    expect(encodePayload("café")).toBe("Y2Fmw6k=");
    expect(decodePayload("Y2Fmw6k=")).toBe("café");
  });

  it("refuses a lone surrogate on encode", () => {
    expect(() => encodePayload("\uD83D")).toThrow("cookie value must not contain lone surrogates");
  });

  const malformed = [
    { input: "!!!!", why: "not base64" },
    { input: "wyg=", why: "base64 of malformed UTF-8" },
  ];
  for (const { input, why } of malformed) {
    it(`decodes ${why} to null`, () => {
      expect(decodePayload(input)).toBeNull();
    });
  }
});

describe("readWire", () => {
  const cases = [
    { header: null, expected: null },
    { header: "", expected: null },
    { header: "d=1", expected: null },
    { header: "d=1; c=raw", expected: "raw" },
    { header: "c=", expected: "" },
  ];
  for (const { header, expected } of cases) {
    it(`reads ${JSON.stringify(header)} as ${JSON.stringify(expected)}`, () => {
      expect(readWire(header, "c")).toBe(expected);
    });
  }
});

describe("mergeAttributes", () => {
  it("answers the defaults, every unnamed field undefined, when there is no override", () => {
    expect(mergeAttributes({ path: "/", maxAge: 60 }, undefined)).toEqual({ ...UNSET, path: "/", maxAge: 60 });
  });

  it("keeps an override of maxAge: 0 rather than falling back to the default", () => {
    expect(mergeAttributes({ maxAge: 60 }, { maxAge: 0 })).toEqual({ ...UNSET, maxAge: 0 });
  });

  it("keeps an override of secure: false on an unpartitioned cookie", () => {
    expect(mergeAttributes({ secure: true }, { secure: false })).toEqual({ ...UNSET, secure: false });
  });

  it("forces Secure on a partitioned cookie whose override drops it", () => {
    expect(mergeAttributes({ secure: true }, { partitioned: true, secure: false })).toEqual({ ...UNSET, partitioned: true, secure: true });
  });
});

describe("setCookie", () => {
  it("emits no attribute the merge left undefined", () => {
    expect(setCookie("c", "v", UNSET)).toBe("c=v");
  });

  it("refuses a header past 4096 bytes, naming the cookie", () => {
    expect(() => setCookie("big", "x".repeat(4096), UNSET)).toThrow('serialize: the Set-Cookie for "big" must be at most 4096 bytes');
  });
});

describe("createUnsignedCookie — the __Host- and __Secure- prefixes", () => {
  it("refuses a __Host- domain or a path other than / at construction", () => {
    expect(() => createUnsignedCookie("__Host-u", { domain: "example.com" })).toThrow(
      'createUnsignedCookie: "__Host-u" is a __Host- cookie, so it must not carry a domain (got example.com)',
    );
    expect(() => createUnsignedCookie("__Host-u", { path: "/app" })).toThrow(
      'createUnsignedCookie: "__Host-u" is a __Host- cookie, so its path must be "/" (got /app)',
    );
  });

  it("refuses a __Host- domain or a path other than / on a per-call override", async () => {
    const cookie = createUnsignedCookie("__Host-u");
    await expect(cookie.serialize("v", { domain: "example.com" })).rejects.toThrow(
      'serialize: "__Host-u" is a __Host- cookie, so it must not carry a domain',
    );
    await expect(cookie.serialize("v", { path: "/app" })).rejects.toThrow('serialize: "__Host-u" is a __Host- cookie, so its path must be "/"');
  });

  for (const name of ["__Host-u", "__Secure-u", "__secure-u", "__HOST-u"]) {
    it(`gives ${name} Secure where no secure option is given`, async () => {
      expect(await createUnsignedCookie(name).serialize("v")).toBe(`${name}=dg==; Path=/; SameSite=Lax; Secure`);
    });
  }

  for (const name of ["__Secure_u", "x__Secure-u", "__Host", "_Host-u"]) {
    it(`does not treat ${name} as prefixed, so leaves it without Secure`, async () => {
      expect(await createUnsignedCookie(name, { domain: "example.com", path: "/app" }).serialize("v")).toBe(
        `${name}=dg==; Domain=example.com; Path=/app; SameSite=Lax`,
      );
    });
  }

  it("accepts a __Host- cookie on path / with Secure stated, at construction and per call", async () => {
    const cookie = createUnsignedCookie("__Host-u", { path: "/", secure: true });
    expect(await cookie.serialize("v", { path: "/", secure: true })).toBe("__Host-u=dg==; Path=/; SameSite=Lax; Secure");
  });

  it("accepts a __Secure- cookie with a domain and a path other than /, which only __Host- forbids", async () => {
    expect(await createUnsignedCookie("__Secure-u", { domain: "example.com", path: "/app" }).serialize("v")).toBe(
      "__Secure-u=dg==; Domain=example.com; Path=/app; SameSite=Lax; Secure",
    );
  });

  it("applies the __Host- scope rule whatever the prefix's case", () => {
    expect(() => createUnsignedCookie("__HOST-u", { domain: "example.com" })).toThrow(
      'createUnsignedCookie: "__HOST-u" is a __Host- cookie, so it must not carry a domain (got example.com)',
    );
    expect(() => createUnsignedCookie("__host-u", { path: "/app" })).toThrow(
      'createUnsignedCookie: "__host-u" is a __Host- cookie, so its path must be "/" (got /app)',
    );
  });

  it("refuses a __Host- name with secure: false on a per-call override", async () => {
    await expect(createUnsignedCookie("__Host-u").serialize("v", { secure: false })).rejects.toThrow(
      'serialize: "__Host-u" is a __Host- cookie, so it must be Secure (got secure: false)',
    );
  });

  it("keeps Secure on a partitioned prefixed cookie whose override asks to drop it", async () => {
    expect(await createUnsignedCookie("__Secure-u").serialize("v", { partitioned: true, secure: false })).toBe(
      "__Secure-u=dg==; Partitioned; Path=/; SameSite=Lax; Secure",
    );
  });

  it("refuses a prefixed name with secure: false at construction", () => {
    expect(() => createUnsignedCookie("__Secure-u", { secure: false })).toThrow(
      'createUnsignedCookie: "__Secure-u" is a __Secure- cookie, so it must be Secure (got secure: false)',
    );
    expect(() => createUnsignedCookie("__Host-u", { secure: false })).toThrow(
      'createUnsignedCookie: "__Host-u" is a __Host- cookie, so it must be Secure (got secure: false)',
    );
  });

  it("refuses a prefixed name with secure: false on a per-call override", async () => {
    await expect(createUnsignedCookie("__Secure-u").serialize("v", { secure: false })).rejects.toThrow(
      'serialize: "__Secure-u" is a __Secure- cookie, so it must be Secure (got secure: false)',
    );
  });

  it("leaves an unprefixed name's secure flag as given", async () => {
    expect(await createUnsignedCookie("theme").serialize("v")).not.toContain("Secure");
    expect(await createUnsignedCookie("theme", { secure: false }).serialize("v")).not.toContain("Secure");
  });
});
