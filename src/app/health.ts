import type { RequestHandler } from "@remix-run/fetch-router";

import { getAppContext } from "../context/types";
import type { CheckFn, HealthCheckOptions, HealthCheckResult } from "./types";

function checkWithin(run: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(run), expired]).finally(() => clearTimeout(timer));
}

/** Returns a RequestHandler that runs named check functions concurrently and responds with JSON health status. @public */
export function healthCheck<Bindings = Record<string, unknown>>(
  checks: Record<string, CheckFn<Bindings>>,
  options?: HealthCheckOptions,
): RequestHandler {
  const timeoutMs = Math.max(1, options?.timeoutMs ?? 5_000);
  return async (context) => {
    const c = getAppContext<Bindings>(context);
    const entries = Object.entries(checks);
    const settled = await Promise.allSettled(entries.map(([, fn]) => checkWithin(() => fn(c), timeoutMs)));
    const results: Record<string, boolean> = {};
    entries.forEach(([name], i) => {
      const outcome = settled[i];
      results[name] = outcome?.status === "fulfilled" ? outcome.value : false;
    });

    const allOk = Object.values(results).every(Boolean);
    const payload: HealthCheckResult = { ok: allOk, checks: results };

    return Response.json(payload, { status: allOk ? 200 : 503, headers: { "cache-control": "no-store" } });
  };
}
