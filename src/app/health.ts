import type { Context, Env } from "hono";
import type { HealthCheckResult } from "./types";

type CheckFn<E extends Env = Env> = (
  c: Context<E>,
) => boolean | Promise<boolean>;

/** Returns a route handler that runs named check functions concurrently and responds with JSON health status. @public */
export function healthCheck<E extends Env = Env>(checks: Record<string, CheckFn<E>>) {
  return async (c: Context<E>): Promise<Response> => {
    const entries = Object.entries(checks);
    // Promise.resolve().then wraps each call so synchronous throws become rejections,
    // which Promise.allSettled can then handle without aborting the batch.
    const settled = await Promise.allSettled(
      entries.map(([, fn]) => Promise.resolve().then(() => fn(c))),
    );
    const results: Record<string, boolean> = {};
    for (let i = 0; i < entries.length; i++) {
      const outcome = settled[i];
      results[entries[i][0]] = outcome.status === "fulfilled" ? outcome.value : false;
    }

    const allOk = Object.values(results).every(Boolean);
    const payload: HealthCheckResult = { ok: allOk, checks: results };

    c.header("cache-control", "no-store");
    return c.json(payload, allOk ? 200 : 503);
  };
}
