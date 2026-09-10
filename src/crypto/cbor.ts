import type { CborDecoded, CborValue } from "./types";

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

function readArgument(cursor: Cursor, additional: number): number | bigint {
  if (additional < 24) return additional;
  if (additional === 24) return readByte(cursor);
  if (additional === 25) {
    need(cursor, 2);
    const value = cursor.view.getUint16(cursor.offset, false);
    cursor.offset += 2;
    return value;
  }
  if (additional === 26) {
    need(cursor, 4);
    const value = cursor.view.getUint32(cursor.offset, false);
    cursor.offset += 4;
    return value;
  }
  if (additional === 27) {
    need(cursor, 8);
    const value = cursor.view.getBigUint64(cursor.offset, false);
    cursor.offset += 8;
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

function readItem(cursor: Cursor): CborValue {
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
    for (let i = 0; i < length; i++) items.push(readItem(cursor));
    return items;
  }
  if (major === 5) {
    const length = readLength(cursor, additional);
    // A `Map` and not an object: COSE labels are integers, and an object would stringify them,
    // collapsing the key `-1` and the key `"-1"` a hostile authenticator can also send.
    const entries = new Map<CborValue, CborValue>();
    for (let i = 0; i < length; i++) {
      const key = readItem(cursor);
      entries.set(key, readItem(cursor));
    }
    return entries;
  }
  if (major === 6) {
    readArgument(cursor, additional);
    return readItem(cursor);
  }
  return readFloat(cursor, additional);
}

/** Decodes the first CBOR item in `bytes`, reporting where it ended so trailing bytes stay reachable. @internal */
export function cborDecodeFirst(bytes: Uint8Array<ArrayBuffer>): CborDecoded {
  const cursor: Cursor = { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 };
  const value = readItem(cursor);
  return { value, bytesRead: cursor.offset };
}
