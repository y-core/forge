/** Shortest secret any forge key accepts — HMAC-SHA-256's full security margin, and HKDF's input keying material floor. @internal */
export const SECRET_MIN_BYTES = 32;

const SECRET_MIN_DISTINCT_BYTES = 8;

/** Refuses a secret too short or too uniform to have come from a CSPRNG, naming `operation` in the refusal. @internal */
export function assertSecretStrength(operation: string, secret: Uint8Array): void {
  if (secret.byteLength < SECRET_MIN_BYTES) {
    throw new Error(`${operation}: each secret must be at least ${SECRET_MIN_BYTES} bytes (got ${secret.byteLength})`);
  }
  const distinct = new Set(secret).size;
  if (distinct === 1) {
    throw new Error(`${operation}: a secret whose bytes are all the same value is not a secret — generate one with a CSPRNG`);
  }
  if (distinct < SECRET_MIN_DISTINCT_BYTES) {
    throw new Error(
      `${operation}: a secret carrying only ${distinct} distinct byte values is not one a CSPRNG produced — at least ${SECRET_MIN_DISTINCT_BYTES} are required`,
    );
  }
}
