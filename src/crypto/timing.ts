import { utf8Encode } from "./bytes";

type CfSubtleCrypto = SubtleCrypto & { timingSafeEqual?: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) => boolean };
const subtle = crypto.subtle as CfSubtleCrypto;

/** Constant-time JS fallback for runtimes without `crypto.subtle.timingSafeEqual`. @internal */
function timingSafeEqualBytesFallback(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    // Must still run a full pass: an early `return false` here would leak length by timing.
    let acc = 1;
    // oxlint-disable-next-line typescript/no-non-null-assertion -- optional chaining would branch in constant-time code; bounds guaranteed by the loop condition.
    for (let i = 0; i < a.byteLength; i++) acc |= a[i]! ^ a[i]!;
    return acc === 0;
  }
  let diff = 0;
  // oxlint-disable-next-line typescript/no-non-null-assertion -- optional chaining would branch in constant-time code; bounds guaranteed by the loop condition.
  for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Constant-time byte array comparison, preferring Workers' native `crypto.subtle.timingSafeEqual`. @internal */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (typeof subtle.timingSafeEqual !== "function") {
    return timingSafeEqualBytesFallback(a, b);
  }

  if (a.byteLength !== b.byteLength) {
    subtle.timingSafeEqual(a, a);
    return false;
  }
  return subtle.timingSafeEqual(a, b);
}

/** Constant-time string comparison (UTF-8 encoded). @internal */
export function timingSafeEqual(a: string, b: string): boolean {
  return timingSafeEqualBytes(utf8Encode(a), utf8Encode(b));
}
