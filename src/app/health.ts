import type { RequestHandler } from "@remix-run/fetch-router";
import { getAppContext } from "../context/types";
import type { CheckFn, HealthCheckResult } from "./types";

/** Returns a RequestHandler that runs named check functions concurrently and responds with JSON health status. @public */
export function healthCheck<Bindings = Record<string, unknown>>(checks: Record<string, CheckFn<Bindings>>): RequestHandler {
  return async (context) => {
    const c = getAppContext<Bindings>(context);
    const entries = Object.entries(checks);
    const settled = await Promise.allSettled(entries.map(([, fn]) => Promise.resolve().then(() => fn(c))));
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
