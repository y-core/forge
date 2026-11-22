import { setPendingHeader } from "../context/pending-headers";
import { refuseHookCtx } from "../context/refusal";
import { matchedRoutePattern } from "../context/route-pattern";
import type { Refusal, RefuseHook } from "../context/types";
import { getAppContext } from "../context/types";
import { createLogger } from "../logging/logger";
import { loggerFor } from "../logging/request-logger";
import { serializeError } from "../logging/serialize-error";
import { requestIdCtx } from "./request-id";
import type { RefusalAnswer } from "./types";

const COLLAPSE_WINDOW_MS = 60_000;

const DEFAULT_BODY: Record<Refusal["status"], string> = {
  400: "Bad Request",
  403: "Forbidden",
  413: "Payload Too Large",
  429: "Too many requests. Please try again later.",
  503: "Service Unavailable",
};

/** The body forge answers a refusal with when no hook is declared. @internal */
export function defaultRefusalResponse(refusal: Refusal): Response {
  return new Response(DEFAULT_BODY[refusal.status], { status: refusal.status });
}

/** How many identical `429` lines were held back before this one, or `null` to hold this one back too. */
function collapsingWindows(): (key: string) => number | null {
  const windows = new Map<string, { since: number; held: number }>();
  return (key) => {
    const now = Date.now();
    const window = windows.get(key);
    if (window !== undefined && now - window.since < COLLAPSE_WINDOW_MS) {
      window.held += 1;
      return null;
    }
    windows.set(key, { since: now, held: 0 });
    return window?.held ?? 0;
  };
}

// oxlint-disable-next-line typescript/no-explicit-any -- hooks of every bindings shape compose here
const constituentsOf = new WeakMap<RefuseHook<any>, readonly RefuseHook<any>[]>();

/** `hooks` with each composed hook replaced by the hooks it was composed of, in order, each asked once. */
function constituents<Bindings>(hooks: readonly (RefuseHook<Bindings> | undefined)[]): RefuseHook<Bindings>[] {
  const flat = new Set<RefuseHook<Bindings>>();
  for (const hook of hooks) {
    if (hook === undefined) continue;
    for (const part of constituentsOf.get(hook) ?? [hook]) flat.add(part);
  }
  return [...flat];
}

/** A hook asking each of `hooks` in order until one answers, whose constituents `createRefusalAnswer` asks once each however many levels name them. @internal */
export function composeRefuseHooks<Bindings>(...hooks: readonly (RefuseHook<Bindings> | undefined)[]): RefuseHook<Bindings> {
  const parts = constituents(hooks);
  const composed: RefuseHook<Bindings> = async (c, refusal) => {
    for (const hook of parts) {
      const response = await hook(c, refusal);
      if (response !== undefined) return response;
    }
    return undefined;
  };
  constituentsOf.set(composed, parts);
  return composed;
}

/** The first answer among `hooks`, passing over each that declines, else forge's plain-text default. */
async function firstAnswer<Bindings>(
  context: Parameters<RefusalAnswer>[0],
  refusal: Refusal,
  hooks: readonly (RefuseHook<Bindings> | undefined)[],
): Promise<Response> {
  for (const hook of hooks) {
    const response = hook === undefined ? undefined : await hook(getAppContext<Bindings>(context), refusal);
    if (response !== undefined) return response;
  }
  return defaultRefusalResponse(refusal);
}

/** One guard instance's refusal step: its own hook, else the hook the chain published, else forge's plain-text default, a declining hook passing to the next. @internal */
export function createRefusalAnswer<Bindings = Record<string, unknown>>(own?: RefuseHook<Bindings>): RefusalAnswer {
  const fallbackLogger = createLogger("security");
  const collapse = collapsingWindows();
  return async (context, refusal, cause) => {
    const reason = "reason" in refusal ? refusal.reason : null;
    const routePattern = matchedRoutePattern.getOptional(context) ?? null;
    const held = refusal.status === 429 ? collapse(`${refusal.guard}|${reason ?? ""}|${routePattern ?? ""}`) : 0;
    if (held !== null) {
      const level = refusal.status >= 500 ? "error" : "warn";
      loggerFor(context, "security", fallbackLogger)[level](`security.${refusal.guard}.refused`, {
        guard: refusal.guard,
        status: refusal.status,
        reason,
        routePattern,
        requestId: requestIdCtx.getOptional(context) ?? null,
        ...(held > 0 ? { collapsed: held } : {}),
        ...(cause !== undefined ? { error: serializeError(cause) } : {}),
      });
    }
    const chain = refuseHookCtx.getOptional(context);
    const response = await firstAnswer(context, refusal, constituents([own, chain]));
    const retryAfter = "retryAfter" in refusal ? refusal.retryAfter : undefined;
    if (retryAfter !== undefined && !response.headers.has("Retry-After")) setPendingHeader(context, "Retry-After", String(retryAfter));
    return response;
  };
}
