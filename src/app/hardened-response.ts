// Baseline hardening: a response built where the consumer's security middleware cannot reach it —
// an out-of-chain throw, or a no-match — carries these and nothing else.
/** @internal */
export const BASELINE_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'",
  "referrer-policy": "no-referrer",
} as const;

/** A plain-text answer carrying {@link BASELINE_HEADERS}, with `extra` set last. @internal */
export function hardenedText(body: string, status: number, extra?: Record<string, string>): Response {
  return new Response(body, { status, headers: { ...BASELINE_HEADERS, "content-type": "text/plain; charset=utf-8", ...extra } });
}
