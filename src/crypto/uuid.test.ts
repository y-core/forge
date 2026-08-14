import { describe, expect, it } from "bun:test";
import { createUuidv7, createUuidv7Bytes, uuidFromBytes, uuidToBytes, uuidv7, uuidv7Bytes } from "./uuid";

/** Canonical UUIDv7 string form: 8-4-4-4-12 lowercase hex, version `7`, variant `10xx`. */
const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Extracts the 48-bit `unix_ts_ms` field as 12 hex characters. */
function timestampHex(id: string): string {
  return id.slice(0, 8) + id.slice(9, 13);
}

/** Extracts the 12-bit `rand_a` counter field. */
function counterOf(id: string): number {
  return Number.parseInt(id.slice(15, 18), 16);
}

/** A clock frozen at `ms` — the Cloudflare Workers behaviour between I/O operations. */
function frozenClock(ms: number): () => number {
  return () => ms;
}

describe("uuidv7 — string form", () => {
  it("produces the canonical 8-4-4-4-12 lowercase hyphenated form", () => {
    const id = createUuidv7()();
    expect(id).toMatch(UUIDV7_RE);
    expect(id.length).toBe(36);
  });

  it("sets the version nibble to exactly 7", () => {
    const id = createUuidv7()();
    expect(id.slice(14, 15)).toBe("7");
  });

  it("sets the RFC 9562 variant bits, so the 17th hex digit is one of 8/9/a/b", () => {
    const variants = new Set<string>();
    for (let i = 0; i < 200; i++) variants.add(createUuidv7()().slice(19, 20));
    expect([...variants].sort()).toEqual(["8", "9", "a", "b"]);
  });

  it("places the hyphens at exactly positions 8, 13, 18 and 23", () => {
    const id = createUuidv7()();
    expect([...id].flatMap((ch, i) => (ch === "-" ? [i] : []))).toEqual([8, 13, 18, 23]);
  });
});

describe("uuidv7 — timestamp field", () => {
  it("encodes the clock's millisecond big-endian in the leading 48 bits", () => {
    const id = createUuidv7({ now: frozenClock(0x0102_0304_0506) })();
    expect(timestampHex(id)).toBe("010203040506");
  });

  it("zero-pads a small timestamp across the full 48-bit field", () => {
    const id = createUuidv7({ now: frozenClock(1) })();
    expect(timestampHex(id)).toBe("000000000001");
  });

  it("encodes a timestamp whose low 32 bits exceed the signed-int range", () => {
    const id = createUuidv7({ now: frozenClock(0x0000_ffff_ffff) })();
    expect(timestampHex(id)).toBe("0000ffffffff");
  });

  it("encodes the maximum representable 48-bit timestamp", () => {
    const id = createUuidv7({ now: frozenClock(0xffff_ffff_ffff) })();
    expect(timestampHex(id)).toBe("ffffffffffff");
  });

  it("floors a fractional clock reading rather than corrupting the field", () => {
    const id = createUuidv7({ now: () => 1.9 })();
    expect(timestampHex(id)).toBe("000000000001");
  });
});

describe("uuidv7 — monotonicity under a frozen clock", () => {
  it("keeps 1000 IDs minted in one frozen millisecond unique and in sort order", () => {
    const generate = createUuidv7({ now: frozenClock(1_700_000_000_000) });
    const ids = Array.from({ length: 1000 }, generate);

    expect(new Set(ids).size).toBe(1000);
    expect([...ids].sort()).toEqual(ids);
  });

  it("holds every ID in the frozen millisecond at the same timestamp", () => {
    const generate = createUuidv7({ now: frozenClock(0x0102_0304_0506) });
    const stamps = new Set(Array.from({ length: 500 }, generate).map(timestampHex));
    expect([...stamps]).toEqual(["010203040506"]);
  });

  it("advances the counter by exactly one per ID within a frozen millisecond", () => {
    const generate = createUuidv7({ now: frozenClock(1_700_000_000_000) });
    const first = counterOf(generate());
    expect(counterOf(generate())).toBe(first + 1);
    expect(counterOf(generate())).toBe(first + 2);
  });

  it("seeds the counter in the low 10 bits, leaving at least 3072 increments of headroom", () => {
    for (let i = 0; i < 200; i++) {
      const id = createUuidv7({ now: frozenClock(1_700_000_000_000) })();
      expect(counterOf(id)).toBeLessThanOrEqual(0x03ff);
    }
  });
});

describe("uuidv7 — counter overflow", () => {
  it("borrows the next millisecond on rollover and stays in sort order", () => {
    const frozen = 1_700_000_000_000;
    const generate = createUuidv7({ now: frozenClock(frozen) });
    const ids = Array.from({ length: 5000 }, generate);

    expect(new Set(ids).size).toBe(5000);
    expect([...ids].sort()).toEqual(ids);
    expect([...new Set(ids.map(timestampHex))].sort()).toEqual([
      frozen.toString(16).padStart(12, "0"),
      (frozen + 1).toString(16).padStart(12, "0"),
    ]);
  });

  it("resets the counter into the low 10 bits after borrowing", () => {
    const frozen = 1_700_000_000_000;
    const generate = createUuidv7({ now: frozenClock(frozen) });
    const borrowedHex = (frozen + 1).toString(16).padStart(12, "0");
    const borrowed = Array.from({ length: 5000 }, generate).filter((id) => timestampHex(id) === borrowedHex);

    expect(borrowed.length).toBeGreaterThan(0);
    expect(counterOf(borrowed[0] ?? "")).toBeLessThanOrEqual(0x03ff);
  });
});

describe("uuidv7 — clock movement", () => {
  it("follows an advancing clock and reseeds the counter each millisecond", () => {
    let ms = 1_700_000_000_000;
    const generate = createUuidv7({ now: () => ms });
    const ids = Array.from({ length: 100 }, () => {
      ms += 1;
      return generate();
    });

    expect(new Set(ids.map(timestampHex)).size).toBe(100);
    expect([...ids].sort()).toEqual(ids);
  });

  it("never emits an ID that sorts before an earlier one when the clock steps backwards", () => {
    const readings = [1_700_000_000_500, 1_700_000_000_400, 1_700_000_000_499, 1_700_000_000_001, 1_700_000_000_600];
    let index = 0;
    const generate = createUuidv7({ now: () => readings[index++] ?? 0 });
    const ids = readings.map(generate);

    expect(new Set(ids).size).toBe(readings.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it("pins the timestamp to the high-water mark while the clock is behind it", () => {
    const readings = [1_700_000_000_500, 1_700_000_000_400, 1_700_000_000_499];
    let index = 0;
    const generate = createUuidv7({ now: () => readings[index++] ?? 0 });
    const stamps = readings.map(() => timestampHex(generate()));

    expect(new Set(stamps).size).toBe(1);
    expect(stamps[0]).toBe("018bcfe569f4");
  });
});

describe("uuidv7 — invalid clock", () => {
  it("throws when the clock returns NaN", () => {
    expect(() => createUuidv7({ now: () => Number.NaN })()).toThrow("uuidv7: clock returned an invalid Unix millisecond value: NaN");
  });

  it("throws when the clock returns Infinity", () => {
    expect(() => createUuidv7({ now: () => Number.POSITIVE_INFINITY })()).toThrow(
      "uuidv7: clock returned an invalid Unix millisecond value: Infinity",
    );
  });

  it("throws when the clock returns a negative millisecond", () => {
    expect(() => createUuidv7({ now: () => -1 })()).toThrow("uuidv7: clock returned an invalid Unix millisecond value: -1");
  });

  it("throws when the timestamp exceeds the 48-bit field", () => {
    expect(() => createUuidv7({ now: frozenClock(0x1_0000_0000_0000) })()).toThrow(
      "uuidv7: timestamp 281474976710656 exceeds the 48-bit unix_ts_ms field",
    );
  });
});

describe("uuidv7 — generator isolation", () => {
  it("gives each createUuidv7 generator independent counter state", () => {
    const clock = frozenClock(1_700_000_000_000);
    const a = createUuidv7({ now: clock });
    const b = createUuidv7({ now: clock });

    const firstA = counterOf(a());
    a();
    a();
    expect(counterOf(a())).toBe(firstA + 3);
    expect(counterOf(b())).toBeLessThanOrEqual(0x03ff);
  });

  it("produces distinct IDs from two generators sharing one frozen millisecond", () => {
    const clock = frozenClock(1_700_000_000_000);
    const a = createUuidv7({ now: clock });
    const b = createUuidv7({ now: clock });
    const ids = [...Array.from({ length: 50 }, a), ...Array.from({ length: 50 }, b)];

    expect(new Set(ids).size).toBe(100);
  });
});

describe("uuidv7 — default generator", () => {
  it("produces canonical, unique, sort-ordered IDs from the real clock", () => {
    const ids = Array.from({ length: 500 }, uuidv7);

    for (const id of ids) expect(id).toMatch(UUIDV7_RE);
    expect(new Set(ids).size).toBe(500);
    expect([...ids].sort()).toEqual(ids);
  });

  it("continues in sort order across separate calls", () => {
    const first = uuidv7();
    const second = uuidv7();
    expect(second > first).toBe(true);
  });
});

/** A known UUID and its 16 octets, written out independently of the implementation. */
const FIXTURE_ID = "0192f8a1-b2c3-7d4e-8f01-234567890abc";
const FIXTURE_BYTES = [0x01, 0x92, 0xf8, 0xa1, 0xb2, 0xc3, 0x7d, 0x4e, 0x8f, 0x01, 0x23, 0x45, 0x67, 0x89, 0x0a, 0xbc];

/** Byte-wise comparison — what SQLite's `memcmp` does to a `BLOB` column. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}

describe("uuidFromBytes", () => {
  it("renders a number[] — the shape D1 returns for a BLOB column", () => {
    expect(uuidFromBytes(FIXTURE_BYTES)).toBe(FIXTURE_ID);
  });

  it("renders a Uint8Array", () => {
    expect(uuidFromBytes(new Uint8Array(FIXTURE_BYTES))).toBe(FIXTURE_ID);
  });

  it("renders an ArrayBuffer", () => {
    expect(uuidFromBytes(new Uint8Array(FIXTURE_BYTES).buffer)).toBe(FIXTURE_ID);
  });

  it("honours byteOffset when handed a view into a larger buffer", () => {
    const padded = new Uint8Array([0xff, 0xff, ...FIXTURE_BYTES, 0xff]);
    expect(uuidFromBytes(padded.subarray(2, 18))).toBe(FIXTURE_ID);
  });

  it("zero-pads octets below 0x10", () => {
    expect(uuidFromBytes(new Uint8Array(16))).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("throws on a short value", () => {
    expect(() => uuidFromBytes(FIXTURE_BYTES.slice(0, 15))).toThrow("uuidFromBytes: expected 16 bytes, received 15");
  });

  it("throws on a long value", () => {
    expect(() => uuidFromBytes([...FIXTURE_BYTES, 0x00])).toThrow("uuidFromBytes: expected 16 bytes, received 17");
  });

  it("throws on an empty value", () => {
    expect(() => uuidFromBytes([])).toThrow("uuidFromBytes: expected 16 bytes, received 0");
  });
});

describe("uuidToBytes", () => {
  it("parses the canonical form to its 16 octets", () => {
    expect([...uuidToBytes(FIXTURE_ID)]).toEqual(FIXTURE_BYTES);
  });

  it("accepts uppercase and emits identical bytes", () => {
    expect([...uuidToBytes(FIXTURE_ID.toUpperCase())]).toEqual(FIXTURE_BYTES);
  });

  it("round-trips with uuidFromBytes", () => {
    const id = uuidv7();
    expect(uuidFromBytes(uuidToBytes(id))).toBe(id);
  });

  it("round-trips a value that arrived as a D1 number[]", () => {
    const bytes = [...uuidv7Bytes()];
    expect([...uuidToBytes(uuidFromBytes(bytes))]).toEqual(bytes);
  });

  it("throws on an unhyphenated 32-character string", () => {
    expect(() => uuidToBytes(FIXTURE_ID.replace(/-/g, ""))).toThrow("uuidToBytes: expected a canonical 36-character UUID");
  });

  it("throws on a non-hex character", () => {
    expect(() => uuidToBytes("0192f8a1-b2c3-7d4e-8f01-23456789zzzz")).toThrow("uuidToBytes: expected a canonical 36-character UUID");
  });

  it("throws on a truncated string", () => {
    expect(() => uuidToBytes("0192f8a1-b2c3-7d4e-8f01")).toThrow("uuidToBytes: expected a canonical 36-character UUID");
  });

  it("throws on an empty string", () => {
    expect(() => uuidToBytes("")).toThrow('uuidToBytes: expected a canonical 36-character UUID, received ""');
  });
});

describe("uuidv7Bytes", () => {
  it("returns exactly 16 octets", () => {
    expect(uuidv7Bytes().byteLength).toBe(16);
  });

  it("sets the version nibble in the high half of octet 6", () => {
    for (let i = 0; i < 50; i++) expect((uuidv7Bytes()[6] ?? 0) >>> 4).toBe(7);
  });

  it("sets the variant bits in the high half of octet 8", () => {
    for (let i = 0; i < 50; i++) expect((uuidv7Bytes()[8] ?? 0) & 0xc0).toBe(0x80);
  });

  it("encodes the clock's millisecond in the leading six octets", () => {
    const bytes = createUuidv7Bytes({ now: frozenClock(0x0102_0304_0506) })();
    expect([...bytes.subarray(0, 6)]).toEqual([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
  });

  it("orders by memcmp exactly as the string form orders lexicographically", () => {
    const generate = createUuidv7Bytes({ now: frozenClock(1_700_000_000_000) });
    const minted = Array.from({ length: 1000 }, generate);

    expect([...minted].sort(compareBytes).map(uuidFromBytes)).toEqual(minted.map(uuidFromBytes));
    expect(minted.map(uuidFromBytes).sort()).toEqual(minted.map(uuidFromBytes));
  });

  it("keeps memcmp order across a counter rollover into a borrowed millisecond", () => {
    const generate = createUuidv7Bytes({ now: frozenClock(1_700_000_000_000) });
    const minted = Array.from({ length: 5000 }, generate);

    expect(new Set(minted.map(uuidFromBytes)).size).toBe(5000);
    expect([...minted].sort(compareBytes).map(uuidFromBytes)).toEqual(minted.map(uuidFromBytes));
  });

  it("returns an independent buffer per call", () => {
    const first = uuidv7Bytes();
    const snapshot = [...first];
    uuidv7Bytes();
    expect([...first]).toEqual(snapshot);
  });

  it("shares one counter with uuidv7, so the two forms stay ordered against each other", () => {
    const interleaved = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? uuidv7() : uuidFromBytes(uuidv7Bytes())));

    expect(new Set(interleaved).size).toBe(200);
    expect([...interleaved].sort()).toEqual(interleaved);
  });
});
