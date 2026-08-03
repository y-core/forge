/**
 * UUIDv7 generation — RFC 9562 §5.7 layout with the §6.2 Method 1 monotonic counter — plus the
 * byte codec for storing one in a D1 `BLOB` column.
 *
 * @remarks
 * Implemented here, in the sealed-internal `crypto` module, so any namespace may consume it
 * without a layering violation. Its public surface is `@y-core/forge/storage/db`, which
 * re-exports it — there is no `@y-core/forge/crypto` import path.
 *
 * @module
 */

/** Version nibble (7) pre-shifted into position for the 16-bit `rand_a` word. @internal */
const VERSION_7 = 0x7000;
/** Clears the two variant bits in octet 8 before they are set. @internal */
const VARIANT_CLEAR_MASK = 0x3f;
/** RFC 9562 variant bits (`0b10`) for octet 8. @internal */
const VARIANT_BITS = 0x80;
/** `rand_a` is 12 bits, so this is the counter's inclusive maximum. @internal */
const COUNTER_MAX = 0x0fff;
/**
 * Masks the per-millisecond counter seed to 10 bits, guaranteeing at least 3072 increments of
 * headroom before rollover while keeping the low bits unguessable. @internal
 */
const COUNTER_SEED_MASK = 0x03ff;
/** Maximum value of the 48-bit `unix_ts_ms` field — 10889-08-02T05:31:50.655Z. @internal */
const MAX_UNIX_TS_MS = 0xffff_ffff_ffff;
/** A UUID is 16 octets. @internal */
const BYTE_LENGTH = 16;
/** Octet indices that a hyphen precedes in the 8-4-4-4-12 string form. @internal */
const HYPHEN_BEFORE_OCTET = new Set([4, 6, 8, 10]);
/** The canonical 36-character hyphenated form, any version, either case. @internal */
const CANONICAL_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Draws a fresh 10-bit counter seed. Seeding randomly rather than from zero keeps the counter
 * from disclosing how many IDs the isolate minted in the previous millisecond. @internal
 */
function randomCounterSeed(): number {
  const seed = crypto.getRandomValues(new Uint8Array(2));
  return new DataView(seed.buffer).getUint16(0) & COUNTER_SEED_MASK;
}

/**
 * The byte encodings a UUID may arrive in.
 *
 * @remarks
 * `readonly number[]` is the shape **D1 hands back for a `BLOB` column** — the JSON transport has
 * no binary type, so bytes arrive as an array of integers. The other two cover values produced
 * in-process.
 *
 * @public
 */
export type UuidByteInput = readonly number[] | Uint8Array | ArrayBuffer;

/** Normalises any accepted byte encoding to a `Uint8Array` view without copying when avoidable. @internal */
function asBytes(value: UuidByteInput): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}

/**
 * Renders 16 octets as the canonical lowercase 8-4-4-4-12 hyphenated string.
 *
 * @param value - The 16 bytes, in any encoding {@link UuidByteInput} accepts — including the
 *   `number[]` D1 returns for a `BLOB` column.
 * @returns The canonical lowercase 36-character form.
 * @throws Error If the value is not exactly 16 bytes. Only the length is checked; a caller
 *   passing the wrong column is the failure worth catching, and D1 cannot return out-of-range
 *   octets.
 * @public
 */
export function uuidFromBytes(value: UuidByteInput): string {
  const bytes = asBytes(value);
  if (bytes.byteLength !== BYTE_LENGTH) {
    throw new Error(`uuidFromBytes: expected ${BYTE_LENGTH} bytes, received ${bytes.byteLength}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = "";
  for (let octet = 0; octet < BYTE_LENGTH; octet++) {
    if (HYPHEN_BEFORE_OCTET.has(octet)) out += "-";
    out += view.getUint8(octet).toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Parses a canonical UUID string into its 16 bytes, for binding against a `BLOB` column.
 *
 * @remarks
 * Accepts either case and emits the same bytes for both. It is an **encoder, not a validator**:
 * a malformed string is a caller bug, because an ID arriving from a request should already have
 * been checked at the boundary with the `validation` namespace
 * (`v.pipe(v.string(), v.uuid())`) — see `INPUT_VALIDATION.md` §1.
 *
 * @param id - A canonical 36-character hyphenated UUID, any version.
 * @returns The 16 bytes, most-significant first — the order `memcmp` sorts by.
 * @throws Error If the string is not in canonical 36-character hyphenated form.
 * @public
 */
export function uuidToBytes(id: string): Uint8Array<ArrayBuffer> {
  if (!CANONICAL_UUID_RE.test(id)) {
    throw new Error(`uuidToBytes: expected a canonical 36-character UUID, received ${JSON.stringify(id)}`);
  }

  const hex = id.replace(/-/g, "");
  const bytes = new Uint8Array(BYTE_LENGTH);
  for (let octet = 0; octet < BYTE_LENGTH; octet++) {
    bytes[octet] = Number.parseInt(hex.slice(octet * 2, octet * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Options for {@link createUuidv7Bytes} and {@link createUuidv7}.
 * @public
 */
export interface Uuidv7Options {
  /**
   * Clock source returning Unix milliseconds. Defaults to `Date.now`.
   *
   * @remarks
   * Inject a fake to make generation deterministic in tests — the generator holds no other
   * dependency, so no global needs mocking (`PRODUCTION_TS_RULES.md` §4a).
   */
  now?: () => number;
}

/**
 * Creates a UUIDv7 generator with its own monotonic state, emitting the raw 16 bytes.
 *
 * @remarks
 * **Layout** (RFC 9562 §5.7): 48-bit big-endian `unix_ts_ms`, the 4-bit version `7`, a 12-bit
 * `rand_a`, the 2-bit variant `0b10`, and 62 bits of `rand_b` drawn per ID from
 * `crypto.getRandomValues`. Bytes are most-significant first, so SQLite's `memcmp` ordering over
 * a `BLOB` column matches the string form's lexicographic ordering exactly.
 *
 * **`rand_a` carries a monotonic counter, not raw randomness** (RFC 9562 Method 1, Section 6.2).
 * This is mandatory on Cloudflare Workers, not an optimisation: `Date.now()` does not advance
 * during synchronous execution — it is frozen at the time of the last I/O as a timing-attack
 * mitigation — so every ID minted between two awaits observes the *same* millisecond. With a
 * purely random `rand_a` those IDs would sort in random order, defeating the property the type
 * exists for.
 *
 * The counter is reseeded to a random 10-bit value whenever the clock advances, leaving at least
 * 3072 increments of headroom. On overflow the generator borrows the next millisecond rather
 * than throwing or stalling; the borrowed time is repaid as soon as the wall clock catches up.
 * A clock that moves backwards is likewise absorbed by the counter, so **a generator never emits
 * an ID that sorts before one it already emitted.**
 *
 * **Do not use a UUIDv7 as a secret.** Its timestamp discloses creation time and its counter
 * discloses mint rate — both by design. It is a primary key, not a session token or an
 * unguessable URL component.
 *
 * @param options - Optional clock injection; see {@link Uuidv7Options}.
 * @returns A generator producing 16-byte UUIDv7 values.
 * @throws Error If the clock returns a value that is not a non-negative finite number, or if the
 *   timestamp exceeds the 48-bit `unix_ts_ms` field. Both are broken-invariant conditions rather
 *   than expected failures, so they throw rather than returning a `Result`.
 * @public
 */
export function createUuidv7Bytes(options?: Uuidv7Options): () => Uint8Array<ArrayBuffer> {
  const now = options?.now ?? Date.now;
  let lastMs = -1;
  let counter = 0;

  return (): Uint8Array<ArrayBuffer> => {
    const wall = Math.floor(now());
    if (!Number.isFinite(wall) || wall < 0) {
      throw new Error(`uuidv7: clock returned an invalid Unix millisecond value: ${wall}`);
    }

    let timestamp: number;
    if (wall > lastMs) {
      timestamp = wall;
      counter = randomCounterSeed();
    } else {
      // The clock is frozen (the common case on Workers) or has stepped backwards. Either way the
      // previous timestamp is reused and ordering is carried by the counter.
      timestamp = lastMs;
      counter += 1;
      if (counter > COUNTER_MAX) {
        timestamp = lastMs + 1;
        counter = randomCounterSeed();
      }
    }

    if (timestamp > MAX_UNIX_TS_MS) {
      throw new Error(`uuidv7: timestamp ${timestamp} exceeds the 48-bit unix_ts_ms field`);
    }
    lastMs = timestamp;

    const bytes = new Uint8Array(BYTE_LENGTH);
    const view = new DataView(bytes.buffer);
    // Split across two writes because a 48-bit integer exceeds what bitwise operators can address:
    // `ts >>> 0` is ToUint32, which is exactly the low 32 bits.
    view.setUint16(0, Math.floor(timestamp / 0x1_0000_0000));
    view.setUint32(2, timestamp >>> 0);
    view.setUint16(6, VERSION_7 | counter);
    crypto.getRandomValues(bytes.subarray(8));
    view.setUint8(8, (view.getUint8(8) & VARIANT_CLEAR_MASK) | VARIANT_BITS);
    return bytes;
  };
}

/**
 * Creates a UUIDv7 generator with its own monotonic state, emitting the canonical string form.
 *
 * @remarks
 * The string encoding of {@link createUuidv7Bytes}, which owns the generation contract — the
 * monotonic counter, the frozen-Workers-clock rationale, and the throw conditions.
 *
 * @param options - Optional clock injection; see {@link Uuidv7Options}.
 * @returns A generator producing canonical lowercase UUIDv7 strings.
 * @public
 */
export function createUuidv7(options?: Uuidv7Options): () => string {
  const generate = createUuidv7Bytes(options);
  return (): string => uuidFromBytes(generate());
}

/**
 * The process-wide default generator. Shared by {@link uuidv7} and {@link uuidv7Bytes} so the two
 * forms advance one counter and stay ordered relative to each other. @internal
 */
const defaultGenerator = createUuidv7Bytes();

/**
 * Generates a UUIDv7 — a time-ordered, unique, non-sequential identifier suitable for a D1
 * primary key.
 *
 * @remarks
 * A convenience binding over a module-level {@link createUuidv7Bytes} generator, shared with
 * {@link uuidv7Bytes}. Reach for `createUuidv7` instead when you need an injected clock or
 * isolated state.
 *
 * **On the module-level state.** `PRODUCTION_TS_RULES.md` §1a bans module-level mutable
 * variables, and this is a deliberate, documented exception (`STORAGE_BINDINGS.md` §1e). That
 * rule's prohibition is on *request-scoped data*, and its rationale is bleed between recycled
 * isolates. Neither applies: the retained state is a timestamp and a counter, nothing derived
 * from a request, and the bleed across requests sharing an isolate is precisely what keeps two
 * concurrent requests from colliding inside one frozen millisecond.
 *
 * Sequential IDs append to the right edge of the primary-key B-tree instead of scattering
 * inserts across it, and they give you `ORDER BY id` cursor pagination for free.
 *
 * @returns A canonical lowercase UUIDv7 string, e.g. `01920a3f-8c4d-7abc-8def-0123456789ab`.
 * @public
 */
export function uuidv7(): string {
  return uuidFromBytes(defaultGenerator());
}

/**
 * Generates a UUIDv7 as its raw 16 bytes, for a D1 `BLOB` primary key.
 *
 * @remarks
 * The same value {@link uuidv7} produces, from the same shared generator — so the two forms are
 * ordered relative to each other and never collide. Storing the bytes rather than the
 * 36-character string is a **density** trade, not a semantic one: it costs roughly a quarter of
 * the total table-plus-index footprint, and costs you readable output in every console query,
 * log line and `wrangler d1 execute` result. Take it per table, on tables you do not hand-query.
 *
 * Round-trip a value read back from D1 with {@link uuidFromBytes}, and bind a string ID against a
 * `BLOB` column with {@link uuidToBytes}.
 *
 * @returns 16 bytes, most-significant first — the order SQLite's `memcmp` sorts a `BLOB` by.
 * @public
 */
export function uuidv7Bytes(): Uint8Array<ArrayBuffer> {
  return defaultGenerator();
}
