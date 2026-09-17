import type { MatchData, Middleware, RequestHandler } from "@remix-run/fetch-router";
import { createRouter, RequestContext } from "@remix-run/fetch-router";
import type { MatcherLimits, Matcher, MultiMatcher } from "@remix-run/route-pattern/match";
import { createMatcher, createMultiMatcher } from "@remix-run/route-pattern/match";

import type { Config } from "../config/config";
import { resolveConfig } from "../config/config";
import { applyPendingHeaders } from "../context/pending-headers";
import type { AppContext } from "../context/types";
import { ConfigKey, EnvKey, ExecutionContextKey, getAppContext } from "../context/types";
import { escapeHtml } from "../http/escape";
import { createLogger } from "../logging/logger";
import { requestLog } from "../logging/request-logger";
import { serializeError } from "../logging/serialize-error";
import type { Logger } from "../logging/types";
import { toError } from "../result/result";
import { requestIdCtx } from "../security/request-id";
import { shellCtx } from "./shell";
import type { PageShell } from "./types";
import type { GlobalMiddlewareEntry, MethodMismatch, RequestState } from "./types";

// Baseline hardening: a response built where the consumer's security middleware cannot reach it —
// an out-of-chain throw, or a no-match — carries these and nothing else.
const BASELINE_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'",
  "referrer-policy": "no-referrer",
} as const;

function hardenedText(body: string, status: number, extra?: Record<string, string>): Response {
  return new Response(body, { status, headers: { ...BASELINE_HEADERS, "content-type": "text/plain; charset=utf-8", ...extra } });
}

// forge governs every matcher to hold a consumer's routing to a Workers-shaped budget.
/** Matcher ceilings every forge matcher is built with, tighter than route-pattern's defaults. */
const MATCHER_LIMITS: MatcherLimits = { maxPatternSize: 4096, maxMatcherSize: 1024 * 1024, maxMatchWork: 200_000 };

/** Rewrites a `use()` path convention into a route-pattern source. */
function toPatternSource(path: string): string {
  if (path.endsWith("/*")) return `${path.slice(0, -2)}(/*)`;
  return path;
}

/** Refuses a `use()` path whose wildcard is neither a bare `"*"` nor a `/*` suffix. */
function assertGuardPattern(path: string): void {
  if (path === "*") return;
  if (!(path.endsWith("/*") ? path.slice(0, -2) : path).includes("*")) return;
  throw new Error(
    `Forge.use: "${path}" is not a supported guard pattern. Use "*" to guard every path, or a "/prefix/*" suffix to guard a prefix; a "*" anywhere else matches only the prefix and its descendants, never a longer sibling segment.`,
  );
}

/** Compiles `use()` paths into one matcher, or `null` when any of them is the catch-all. */
function compileGuardMatcher(paths: readonly string[]): Matcher<string> | MultiMatcher<null> | null {
  // Every path is checked before the catch-all short-circuit: otherwise `["*", "/bad*"]` would
  // register a guard on every path and never look at the typo sitting beside it.
  for (const path of paths) assertGuardPattern(path);
  if (paths.includes("*")) return null;
  if (paths.length === 1) return createMatcher(toPatternSource(paths[0] as string), { limits: MATCHER_LIMITS });
  const multi = createMultiMatcher<null>({ limits: MATCHER_LIMITS });
  for (const path of paths) multi.add(toPatternSource(path), null);
  return multi;
}

function makeErrorContext<Bindings>(request: Request, env: Bindings, executionCtx: ExecutionContext): AppContext<Bindings> {
  const ctx = new RequestContext(request);
  ctx.set(EnvKey, env, { property: "env" });
  ctx.set(ExecutionContextKey, executionCtx, { property: "executionCtx" });
  return getAppContext<Bindings>(ctx);
}

/** The forge application object — a Workers-native request router with an error boundary. @public */
export class Forge<Bindings extends object = Record<string, unknown>> {
  private readonly _globals: GlobalMiddlewareEntry[] = [];
  private readonly _logger: Logger;
  private readonly _matcher: MultiMatcher<MatchData>;
  private readonly _setup: ReturnType<typeof createRouter>;
  private readonly _requestState = new WeakMap<Request, RequestState<Bindings>>();
  private _router?: ReturnType<typeof createRouter>;
  private _onError?: (err: Error, c: AppContext<Bindings>) => Response | Promise<Response>;
  private _notFound?: (c: AppContext<Bindings>, config: unknown) => Response | Promise<Response>;
  private _methodMismatch: MethodMismatch = "notFound";
  private _errorDetail = false;
  /** Config store attached by `registerConfig`. @internal */
  configStore?: Config<unknown>;
  private _shell?: PageShell<Bindings>;

  constructor(logger?: Logger) {
    this._logger = logger ?? createLogger("app");
    this._matcher = createMultiMatcher<MatchData>({ limits: MATCHER_LIMITS });
    this._setup = createRouter({ matcher: this._matcher });
  }

  setOnError(fn: (err: Error, c: AppContext<Bindings>) => Response | Promise<Response>): void {
    this._onError = fn;
  }

  /** Registers the answer to an unmatched URL, replacing the hardened `404`; a method mismatch reaches it too unless `setMethodMismatch` says otherwise. */
  setNotFound(fn: (c: AppContext<Bindings>, config: unknown) => Response | Promise<Response>): void {
    this._notFound = fn;
  }

  /** Chooses between hiding a method mismatch behind the not-found answer and advertising it as a `405`. */
  setMethodMismatch(mode: MethodMismatch): void {
    this._methodMismatch = mode;
  }

  /** Renders the app's not-found answer, or forge's default when none is registered. @internal */
  notFound(c: AppContext<Bindings>, config: unknown): Response | Promise<Response> {
    if (this._notFound) return this._notFound(c, config);
    return hardenedText("Not Found", 404);
  }

  /** Whether the boundary's 500 page prints the thrown message; only a `DevAllowance` turns it on. */
  setErrorDetail(enabled: boolean): void {
    this._errorDetail = enabled;
  }

  /** Registers the document shell every mounted page renders into — the single writer of that slot. */
  setShell(shell: PageShell<Bindings>): void {
    this._shell = shell;
  }

  /** Register path-scoped middleware. `"*"` matches all paths; `"/api/*"` matches the prefix; an array matches any of them. */
  use(path: string | readonly string[], ...handlers: Middleware[]): void {
    const paths = typeof path === "string" ? [path] : path;
    if (paths.length === 0) return;
    const matcher = compileGuardMatcher(paths);
    for (const h of handlers) {
      this._globals.push({ matcher, handler: h });
    }
  }

  /** Declarative, map-based route registration — the canonical way to add routes. @public */
  map(...args: Parameters<typeof this._setup.map>): ReturnType<typeof this._setup.map> {
    return this._setup.map(...args);
  }

  /** Builds the dispatching router once, with a static middleware stack. */
  private _buildRouter(): ReturnType<typeof createRouter> {
    const provideRequestState: Middleware = (context, next) => {
      const state = this._requestState.get(context.request);
      if (!state) {
        throw new Error(
          "Forge: per-request state missing — the request object was replaced between fetch() and routing. This breaks env/config propagation and likely indicates an incompatible @remix-run/fetch-router version.",
        );
      }
      context.set(EnvKey, state.env, { property: "env" });
      context.set(ExecutionContextKey, state.executionCtx, { property: "executionCtx" });
      context.set(ConfigKey, state.config, { property: "config" });
      if (this._shell) shellCtx.set(context, this._shell);
      return next();
    };

    const applyHeaders: Middleware = async (context, next) => {
      const res = await next();
      return applyPendingHeaders(context, res);
    };

    const guarded: Middleware[] = this._globals.map(
      ({ matcher, handler }) =>
        (context, next) =>
          matcher === null || matcher.match(context.url) ? handler(context, next) : next(),
    );

    const errorBoundary: Middleware = async (context, next) => {
      try {
        return await next();
      } catch (err) {
        return this._handleError(toError(err), getAppContext<Bindings>(context));
      }
    };

    const answerMethodMismatch: Middleware = async (context, next) => {
      const res = await next();
      if (res.status !== 405) return res;
      const matches = this._matcher.matchAll(context.url);
      if (matches.length === 0) return res;
      // Sound only because `fetch` rewrites HEAD to GET: the router's dispatch loop breaks on its
      // HEAD fallback, so a surviving HEAD would make this rewrite a handler's own answer.
      if (matches.some(({ data }) => data.method === "ANY" || data.method === context.method)) return res;
      const allow = res.headers.get("allow");
      await res.body?.cancel();
      if (this._methodMismatch === "notFound") {
        const c = getAppContext<Bindings>(context);
        return this.notFound(c, c.config);
      }
      return hardenedText("Method Not Allowed", 405, allow === null ? undefined : { allow });
    };

    // Twice deliberately: the inner boundary keeps an error response flowing back out through guards
    // that queue `set-cookie` after `next()`; the outer one catches a guard's own throw.
    const defaultHandler: RequestHandler = (context) => {
      const c = getAppContext<Bindings>(context);
      return this.notFound(c, c.config);
    };

    return createRouter({
      matcher: this._matcher,
      defaultHandler,
      middleware: [provideRequestState, applyHeaders, errorBoundary, ...guarded, errorBoundary, answerMethodMismatch],
    });
  }

  /** Handles a Workers `fetch` event. */
  async fetch(request: Request, env: Bindings, executionCtx: ExecutionContext): Promise<Response> {
    // Thrown rather than stubbed: a no-op `waitUntil` drops the request-log flush, the schema
    // observation and every consumer `waitUntil` with no signal of any kind.
    if (executionCtx === undefined || executionCtx === null) {
      throw new Error(
        "Forge.fetch: `executionCtx` is required — export `{ fetch: (req, env, ctx) => app.fetch(req, env, ctx) }`, not the two-argument form. Without it every `waitUntil` is discarded: request logs never flush, the D1 schema observation never lands, and audit writes are lost.",
      );
    }

    const isHead = request.method.toUpperCase() === "HEAD";
    // Copy-construct rather than rebuild from url + headers, so `signal`, `cf`, `redirect` and
    // `credentials` carry into the handler. Safe only because HEAD carries no body.
    const req = isHead ? new Request(request, { method: "GET" }) : request;

    try {
      // Inside the try so a deployment defect produces the app's own error page rather than
      // escaping `fetch` and letting the runtime render its own untouchable one.
      const config = resolveConfig(this.configStore, (env ?? {}) as object);
      this._requestState.set(req, { env, executionCtx, config });
      this._router ??= this._buildRouter();

      const res = await this._router.fetch(req);
      return isHead ? await this._toHeadResponse(res) : res;
    } catch (err) {
      const res = await this._handleError(toError(err), makeErrorContext(request, env, executionCtx));
      return isHead ? await this._toHeadResponse(res) : res;
    }
  }

  /** Strips the body from a derived GET response, cancelling the stream it abandons. */
  private async _toHeadResponse(res: Response): Promise<Response> {
    await res.body?.cancel();
    return new Response(null, { status: res.status, headers: res.headers });
  }

  private async _handleError(err: Error, context: AppContext<Bindings>): Promise<Response> {
    // A disconnected client is cancellation, not a failure: nothing to report and nobody to render
    // for. Checked before the override so a consumer's page is not built for a gone request.
    if (context.request.signal.aborted) return new Response(null, { status: 499 });
    if (this._onError) {
      try {
        return await this._onError(err, context);
      } catch (overrideErr) {
        // Attributed to the hook, not folded into the original: the records below still report that.
        this._logger.error("onError override threw", { error: serializeError(overrideErr), original: serializeError(err) });
      }
    }
    const reqLog = requestLog.getOptional(context);
    if (reqLog) reqLog.error("unhandled error", { error: serializeError(err) });
    this._logger.error("Unhandled error", { error: serializeError(err) });
    // Nothing else covers either core: `requestLogger`'s `finally` has already run on the guard-throw path,
    // and the app logger has no middleware to flush it at all.
    const flush = Promise.all([reqLog?.flush(), this._logger.flush()]);
    try {
      context.executionCtx.waitUntil(flush);
    } catch {
      await flush;
    }
    const detail = this._errorDetail ? `<p>${escapeHtml(err.message)}</p>` : "<p>An unexpected error occurred.</p>";
    // Only ever echoed, never generated here: an id exists only where `requestId` middleware ran.
    const reference = requestIdCtx.getOptional(context);
    const quote = reference ? `<p>Reference: ${escapeHtml(reference)}</p>` : "";
    return new Response(`<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1>${detail}${quote}</body></html>`, {
      status: 500,
      headers: { ...BASELINE_HEADERS, "content-type": "text/html; charset=utf-8", ...(reference ? { "x-request-id": reference } : {}) },
    });
  }

  /** Convenience method for testing: builds a `Request` from `path` and dispatches it. */
  async request(path: string, init: RequestInit = {}, env: Bindings = {} as Bindings): Promise<Response> {
    const url = path.startsWith("http") ? path : `http://localhost${path}`;
    const request = new Request(url, init);
    const pending: Promise<unknown>[] = [];
    const testCtx = {
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p);
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    const res = await this.fetch(request, env, testCtx);
    if (pending.length > 0) {
      await Promise.all(pending);
    }
    return res;
  }
}
