import type { KvCodec } from "./types";

/** Default codec — JSON serialises any value; decode parses. @public */
export function jsonCodec<T = unknown>(): KvCodec<T> {
  return { type: "text", encode: (value) => JSON.stringify(value), decode: (raw) => JSON.parse(raw as string) as T };
}

/** Identity codec for plain string values. @public */
export function textCodec(): KvCodec<string> {
  return { type: "text", encode: (value) => value, decode: (raw) => raw as string };
}

/** Raw bytes codec — stores as ArrayBuffer. @public */
export function bytesCodec(): KvCodec<Uint8Array> {
  return { type: "arrayBuffer", encode: (value) => value.buffer as ArrayBuffer, decode: (raw) => new Uint8Array(raw as ArrayBuffer) };
}
