import type { BackoffPolicy } from "./types";

/** Waits `ms` on the real clock. @internal */
export function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `attempt` until it resolves, `retryable` refuses its error, or the policy's attempts are spent, doubling the wait between tries. @internal */
export async function retryWithBackoff<T>(
  attempt: (tried: number) => Promise<T>,
  retryable: (error: unknown) => boolean,
  policy: BackoffPolicy,
  sleep: (ms: number) => Promise<void> = sleepFor,
): Promise<T> {
  for (let tried = 1; ; tried += 1) {
    try {
      return await attempt(tried);
    } catch (error) {
      if (tried >= policy.attempts || !retryable(error)) throw error;
      await sleep(policy.firstDelayMs * 2 ** (tried - 1));
    }
  }
}
