import type { Context } from "hono";
import type { HealthCheckResult } from "./types";

type CheckFn<T extends object = Record<string, unknown>> = (
  c: Context<{ Bindings: T }>,
) => boolean | Promise<boolean>;

export function healthCheck<T extends object = Record<string, unknown>>(
  checks: Record<string, CheckFn<T>>,
) {
  return async (c: Context<{ Bindings: T }>): Promise<Response> => {
    const results: Record<string, boolean> = {};

    for (const [name, fn] of Object.entries(checks)) {
      try {
        results[name] = await fn(c);
      } catch {
        results[name] = false;
      }
    }

    const allOk = Object.values(results).every(Boolean);
    const payload: HealthCheckResult = { ok: allOk, checks: results };

    c.header("cache-control", "no-store");
    return c.json(payload, allOk ? 200 : 503);
  };
}
