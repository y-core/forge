import { bytesToHex } from "./bytes";
import type { CborDecoded, CborValue } from "./types";

/** How deep a nested item may go before the decoder refuses it. */
const MAX_DEPTH = 16;

interface Cursor {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly view: DataView;
  offset: number;
}

function need(cursor: Cursor, count: number): void {
  if (cursor.offset + count > cursor.bytes.byteLength) throw new Error("cborDecodeFirst: input ended inside a value");
}

function readByte(cursor: Cursor): number {
  need(cursor, 1);
  // oxlint-disable-next-line typescript/no-non-null-assertion -- `need` has proven the index is in range
  return cursor.bytes[cursor.offset++]!;
}

/** Refuses an argument encoded wider than it needs, which CTAP2 canonical CBOR forbids. */
function requireShortestForm(value: number | bigint, minimum: number): number | bigint {
  if (value < minimum) throw new Error(`cborDecodeFirst: ${value} is not in its shortest form`);
  return value;
}

function readArgument(cursor: Cursor, additional: number): number | bigint {
  if (additional < 24) return additional;
  if (additional === 24) return requireShortestForm(readByte(cursor), 24);
  if (additional === 25) {
    need(cursor, 2);
    const value = cursor.view.getUint16(cursor.offset, false);
    cursor.offset += 2;
    return requireShortestForm(value, 0x100);
  }
  if (additional === 26) {
    need(cursor, 4);
    const value = cursor.view.getUint32(cursor.offset, false);
    cursor.offset += 4;
    return requireShortestForm(value, 0x10000);
  }
  if (additional === 27) {
    need(cursor, 8);
    const value = cursor.view.getBigUint64(cursor.offset, false);
    cursor.offset += 8;
    requireShortestForm(value, 0x100000000);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  }
  // 28–30 are reserved and 31 is the indefinite-length form, which CTAP2 canonical CBOR forbids.
  throw new Error(`cborDecodeFirst: unsupported additional information ${additional}`);
}

function readLength(cursor: Cursor, additional: number): number {
  const argument = readArgument(cursor, additional);
  if (typeof argument === "bigint") throw new Error("cborDecodeFirst: length exceeds what this decoder will allocate");
  return argument;
}

function readFloat(cursor: Cursor, additional: number): CborValue {
  if (additional === 20) return false;
  if (additional === 21) return true;
  if (additional === 22) return null;
  if (additional === 23) return undefined;
  if (additional === 25) {
    need(cursor, 2);
    const half = cursor.view.getUint16(cursor.offset, false);
    cursor.offset += 2;
    const exponent = (half >> 10) & 0x1f;
    const fraction = half & 0x3ff;
    const sign = half & 0x8000 ? -1 : 1;
    if (exponent === 0) return sign * 2 ** -24 * fraction;
    if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
    return sign * 2 ** (exponent - 25) * (1024 + fraction);
  }
  if (additional === 26) {
    need(cursor, 4);
    const value = cursor.view.getFloat32(cursor.offset, false);
    cursor.offset += 4;
    return value;
  }
  if (additional === 27) {
    need(cursor, 8);
    const value = cursor.view.getFloat64(cursor.offset, false);
    cursor.offset += 8;
    return value;
  }
  throw new Error(`cborDecodeFirst: unsupported simple value ${additional}`);
}

function readNested(cursor: Cursor, depth: number): CborValue {
  // One byte of input buys one stack frame, so an unbounded decoder overflows the stack on a
  // payload small enough to be a rounding error against the form-body limit.
  if (depth > MAX_DEPTH) throw new Error(`cborDecodeFirst: nesting deeper than ${MAX_DEPTH} items`);
  return readItem(cursor, depth);
}

function readItem(cursor: Cursor, depth: number): CborValue {
  const initial = readByte(cursor);
  const major = initial >> 5;
  const additional = initial & 0x1f;

  if (major === 0) return readArgument(cursor, additional);
  if (major === 1) {
    const argument = readArgument(cursor, additional);
    return typeof argument === "bigint" ? -1n - argument : -1 - argument;
  }
  if (major === 2) {
    const length = readLength(cursor, additional);
    need(cursor, length);
    const slice = cursor.bytes.slice(cursor.offset, cursor.offset + length);
    cursor.offset += length;
    return slice;
  }
  if (major === 3) {
    const length = readLength(cursor, additional);
    need(cursor, length);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(cursor.bytes.subarray(cursor.offset, cursor.offset + length));
    cursor.offset += length;
    return text;
  }
  if (major === 4) {
    const length = readLength(cursor, additional);
    const items: CborValue[] = [];
    for (let i = 0; i < length; i++) items.push(readNested(cursor, depth + 1));
    return items;
  }
  if (major === 5) {
    const length = readLength(cursor, additional);
    // A `Map` and not an object: COSE labels are integers, and an object would stringify them,
    // collapsing the key `-1` and the key `"-1"` a hostile authenticator can also send.
    const entries = new Map<CborValue, CborValue>();
    const seen = new Set<string>();
    for (let i = 0; i < length; i++) {
      const start = cursor.offset;
      const key = readNested(cursor, depth + 1);
      // Keyed on the encoded bytes rather than the decoded key: `Map` compares a `Uint8Array` by
      // identity, so a repeated byte-string key would never collide and the last one would win.
      const encoded = bytesToHex(cursor.bytes.subarray(start, cursor.offset));
      if (seen.has(encoded)) throw new Error("cborDecodeFirst: map repeats a key");
      seen.add(encoded);
      entries.set(key, readNested(cursor, depth + 1));
    }
    return entries;
  }
  if (major === 6) {
    readArgument(cursor, additional);
    return readNested(cursor, depth + 1);
  }
  return readFloat(cursor, additional);
}

/** Decodes the first CBOR item in `bytes`, reporting where it ended so trailing bytes stay reachable. @internal */
export function cborDecodeFirst(bytes: Uint8Array<ArrayBuffer>): CborDecoded {
  const cursor: Cursor = { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 };
  const value = readItem(cursor, 0);
  return { value, bytesRead: cursor.offset };
}
