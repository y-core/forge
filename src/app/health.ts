import type { RequestHandler } from "@remix-run/fetch-router";

import { getAppContext } from "../context/types";
import type { HealthCheckFn, HealthCheckOptions, HealthCheckResult, HealthChecks } from "./types";

function checkWithin(run: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(run), expired]).finally(() => clearTimeout(timer));
}

/** Returns a RequestHandler that runs named check functions concurrently and responds with JSON health status. @public */
export function healthCheck<Bindings = Record<string, unknown>>(
  checks: Record<string, HealthCheckFn<Bindings>>,
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

/** Merges each slice's checks, in array order, into one frozen health route; throws on a check name two contributions share. @public */
export function createHealthChecks<Bindings = Record<string, unknown>>(
  contributions: readonly Record<string, HealthCheckFn<Bindings>>[],
): HealthChecks<Bindings> {
  const merged: Record<string, HealthCheckFn<Bindings>> = {};
  for (const checks of contributions) {
    const taken = Object.keys(checks).find((name) => Object.hasOwn(merged, name));
    if (taken !== undefined) throw new Error(`createHealthChecks: the check "${taken}" is already contributed.`);
    Object.assign(merged, checks);
  }
  const held = Object.freeze(merged);

  return Object.freeze({ checks: () => held, handler: (options?: HealthCheckOptions) => healthCheck<Bindings>(held, options) });
}
