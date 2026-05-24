type CfSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
};

const subtle = crypto.subtle as CfSubtleCrypto;

/** Constant-time byte array comparison via Cloudflare Workers crypto. @public */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    subtle.timingSafeEqual(a, a);
    return false;
  }
  return subtle.timingSafeEqual(a, b);
}

/** Constant-time string comparison (UTF-8 encoded). @public */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  return timingSafeEqualBytes(encoder.encode(a), encoder.encode(b));
}
