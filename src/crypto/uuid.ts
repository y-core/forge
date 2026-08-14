/** Version nibble (7) pre-shifted into position for the 16-bit `rand_a` word. @internal */
const VERSION_7 = 0x7000;
/** Clears the two variant bits in octet 8 before they are set. @internal */
const VARIANT_CLEAR_MASK = 0x3f;
/** RFC 9562 variant bits (`0b10`) for octet 8. @internal */
const VARIANT_BITS = 0x80;
/** `rand_a` is 12 bits, so this is the counter's inclusive maximum. @internal */
const COUNTER_MAX = 0x0fff;
/** Masks the per-millisecond counter seed to 10 bits. @internal */
const COUNTER_SEED_MASK = 0x03ff;
/** Maximum value of the 48-bit `unix_ts_ms` field — 10889-08-02T05:31:50.655Z. @internal */
const MAX_UNIX_TS_MS = 0xffff_ffff_ffff;
/** A UUID is 16 octets. @internal */
const BYTE_LENGTH = 16;
/** Octet indices that a hyphen precedes in the 8-4-4-4-12 string form. @internal */
const HYPHEN_BEFORE_OCTET = new Set([4, 6, 8, 10]);
/** The canonical 36-character hyphenated form, any version, either case. @internal */
const CANONICAL_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Draws a fresh 10-bit counter seed. @internal */
function randomCounterSeed(): number {
  const seed = crypto.getRandomValues(new Uint8Array(2));
  return new DataView(seed.buffer).getUint16(0) & COUNTER_SEED_MASK;
}

/** The byte encodings a UUID may arrive in — `readonly number[]` is what D1 returns for a `BLOB` column. @public */
export type UuidByteInput = readonly number[] | Uint8Array | ArrayBuffer;

/** Normalises any accepted byte encoding to a `Uint8Array` view without copying when avoidable. @internal */
function asBytes(value: UuidByteInput): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}

/** Renders 16 octets as the canonical lowercase 8-4-4-4-12 hyphenated string. @public */
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

/** Parses a canonical UUID string into its 16 bytes, most-significant first, for binding against a `BLOB` column. @public */
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

/** Options for {@link createUuidv7Bytes} and {@link createUuidv7}. @public */
export interface Uuidv7Options {
  now?: () => number;
}

/** Creates a UUIDv7 generator with its own monotonic state, emitting the raw 16 bytes per RFC 9562 §5.7. @public */
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
      // Workers freezes `Date.now()` between I/O, so `rand_a` must carry a monotonic counter (RFC 9562 §6.2) or same-millisecond IDs sort randomly.
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
    // Two writes because bitwise operators are 32-bit and `unix_ts_ms` is 48.
    view.setUint16(0, Math.floor(timestamp / 0x1_0000_0000));
    view.setUint32(2, timestamp >>> 0);
    view.setUint16(6, VERSION_7 | counter);
    crypto.getRandomValues(bytes.subarray(8));
    view.setUint8(8, (view.getUint8(8) & VARIANT_CLEAR_MASK) | VARIANT_BITS);
    return bytes;
  };
}

/** Creates a UUIDv7 generator with its own monotonic state, emitting the canonical string form. @public */
export function createUuidv7(options?: Uuidv7Options): () => string {
  const generate = createUuidv7Bytes(options);
  return (): string => uuidFromBytes(generate());
}

/** The process-wide default generator, shared by {@link uuidv7} and {@link uuidv7Bytes}. @internal */
const defaultGenerator = createUuidv7Bytes();

/** Generates a UUIDv7 — a time-ordered identifier suitable for a D1 primary key. @public */
export function uuidv7(): string {
  return uuidFromBytes(defaultGenerator());
}

/** Generates a UUIDv7 as its raw 16 bytes, for a D1 `BLOB` primary key. @public */
export function uuidv7Bytes(): Uint8Array<ArrayBuffer> {
  return defaultGenerator();
}
