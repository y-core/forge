import { base32Encode, crc32, utf8Encode } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import type { GuardResult } from "../../result/types";

/** Bytes of entropy in an access token's secret. @internal */
export const ACCESS_TOKEN_SECRET_BYTES = 24;

const ACCESS_TOKEN_BODY_LENGTH = Math.ceil((ACCESS_TOKEN_SECRET_BYTES * 8) / 5);

const ACCESS_TOKEN_CHECKSUM_LENGTH = 7;

const ACCESS_TOKEN_PREFIX_SHAPE = /^[a-z][a-z0-9]{1,15}_$/;

const ACCESS_TOKEN_TAIL_SHAPE = new RegExp(`^[A-Z2-7]{${ACCESS_TOKEN_BODY_LENGTH + ACCESS_TOKEN_CHECKSUM_LENGTH}}$`);

/** Throws, naming `operation`, unless `prefix` is one a secret scanner can key on. @internal */
export function assertAccessTokenPrefix(operation: string, prefix: string): void {
  if (ACCESS_TOKEN_PREFIX_SHAPE.test(prefix)) return;
  throw new Error(`${operation}: prefix "${prefix}" must match ${ACCESS_TOKEN_PREFIX_SHAPE.source}.`);
}

/** The base32 of the big-endian CRC-32 of `text`, as the last characters of a token. @internal */
export function accessTokenChecksum(text: string): string {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, crc32(utf8Encode(text)));
  return base32Encode(bytes);
}

/** Spells `secret` as a token under `prefix`, checksum included. @internal */
export function formatAccessToken(prefix: string, secret: Uint8Array): string {
  const head = `${prefix}${base32Encode(secret)}`;
  return `${head}${accessTokenChecksum(head)}`;
}

/** Checks a presented token's shape and checksum offline, without decoding its secret. @internal */
export function checkAccessToken(prefix: string, presented: string): GuardResult<"checksum-mismatch" | "malformed"> {
  if (!presented.startsWith(prefix) || !ACCESS_TOKEN_TAIL_SHAPE.test(presented.slice(prefix.length))) return err("malformed");
  const head = presented.slice(0, -ACCESS_TOKEN_CHECKSUM_LENGTH);
  return presented.slice(-ACCESS_TOKEN_CHECKSUM_LENGTH) === accessTokenChecksum(head) ? ok() : err("checksum-mismatch");
}
