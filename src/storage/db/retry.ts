import type { D1RetryPolicy } from "./types";

/** Full-jitter exponential backoff for D1's retryable failures. @internal */
export const D1_RETRY_POLICY: D1RetryPolicy = { attempts: 5, baseDelayMs: 100, maxDelayMs: 2_000 };

/** Waits `ms` on the real clock. @internal */
export function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `attempt` until it resolves, `retryable` refuses its error, or the policy's attempts are spent, with full jitter between tries. @internal */
export async function retryWithBackoff<T>(
  attempt: (tried: number) => Promise<T>,
  retryable: (error: unknown) => boolean,
  policy: D1RetryPolicy,
  clock: { sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<T> {
  const sleep = clock.sleep ?? sleepFor;
  const random = clock.random ?? Math.random;
  for (let tried = 1; ; tried += 1) {
    try {
      return await attempt(tried);
    } catch (error) {
      if (tried >= policy.attempts || !retryable(error)) throw error;
      await sleep(Math.floor(random() * Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (tried - 1))));
    }
  }
}
