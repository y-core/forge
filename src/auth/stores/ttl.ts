import { AUTH_KV_MIN_TTL_SECONDS } from "../config";

/** Refuses a KV expiration shorter than the platform's own floor, naming the operation and what it stores. @internal */
export function assertKvTtl(operation: string, ttlSeconds: number, subject: string): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < AUTH_KV_MIN_TTL_SECONDS) {
    throw new Error(`${operation}: KV refuses an expiration under ${AUTH_KV_MIN_TTL_SECONDS} seconds — configure a longer ${subject} lifetime`);
  }
}
