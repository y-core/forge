import type { MatchData, Middleware } from "@remix-run/fetch-router";
import { createRouter, RequestContext } from "@remix-run/fetch-router";
import type { Matcher, MultiMatcher } from "@remix-run/route-pattern/match";
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
import type { GlobalMiddlewareEntry, RequestState } from "./types";

/** Mock ExecutionContext for use in tests and non-Workers environments. */
// biome-ignore lint/suspicious/noExplicitAny: mock context for testing only
const MOCK_CTX: ExecutionContext = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

/**
 * Compiles a `use()` path convention into a route-pattern matcher.
 * `"*"` matches every request; `"/admin/*"` becomes `"/admin(/*)"` so it matches the bare
 * `/admin` as well as `/admin/x` (but not `/administrator`). Returns `null` for the catch-all.
 */
function compileGuardMatcher(path: string): Matcher<string> | null {
  if (path === "*") return null;
  let source = path;
  if (path.endsWith("/*")) source = `${path.slice(0, -2)}(/*)`;
  else if (path.endsWith("*")) source = `${path.slice(0, -1)}(/*)`;
  return createMatcher(source);
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
  private _isDebug?: (c: AppContext<Bindings>) => boolean;
  /** Config store attached by `registerConfig`. @internal */
  configStore?: Config<unknown>;

  constructor(logger?: Logger) {
    this._logger = logger ?? createLogger("app");
    this._matcher = createMultiMatcher<MatchData>();
    this._setup = createRouter({ matcher: this._matcher });
  }

  setOnError(fn: (err: Error, c: AppContext<Bindings>) => Response | Promise<Response>): void {
    this._onError = fn;
  }

  setIsDebug(fn: (c: AppContext<Bindings>) => boolean): void {
    this._isDebug = fn;
  }

  /** Register path-scoped middleware. `"*"` matches all paths; `"/api/*"` matches the prefix. */
  use(path: string, ...handlers: Middleware[]): void {
    const matcher = compileGuardMatcher(path);
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
    // Re-publish per-request state (set in `fetch`) onto the context as direct properties.
    // A miss means the request object was replaced between `fetch` and routing (e.g. the router
    // cloned it) — `env`/`config` would then be silently absent and surface later as opaque
    // `undefined env` errors. Fail loudly here so the cause is unambiguous and the version
    // contract with the underlying router is pinned.
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
      return next();
    };

    // Outermost response transform: flush all pending headers in a single rebuild.
    const applyHeaders: Middleware = async (context, next) => {
      const res = await next();
      return applyPendingHeaders(context, res);
    };

    // Precompiled, path-scoped guards.
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

    // The boundary sits at two depths because the two failure sites need different guarantees.
    // Innermost, it catches throws from route handlers and route-level middleware so the error
    // response still flows back *out* through the guards. `createSecurityHeaders` no longer needs
    // that — it queues before `next()` — but the guards that genuinely queue on the way out still
    // do: `session.ts` and `flash-cookie.ts` both set their `set-cookie` after `await next()`, and
    // an error response that skipped them would drop a rotated session or a pending flash.
    // Wrapped around the guard stack, the boundary catches a throw from a guard itself, which would
    // otherwise escape the router entirely and skip the `applyHeaders` flush along with every
    // header already queued.
    //
    // Collapsing to a single depth is deliberately *not* done here: with only the outer boundary,
    // `requestLogger`'s `catch` becomes the primary path for handler throws too, which widens the
    // flush-window hazard `_handleError` now closes rather than narrowing it.
    return createRouter({ matcher: this._matcher, middleware: [provideRequestState, applyHeaders, errorBoundary, ...guarded, errorBoundary] });
  }

  /** Handles a Workers `fetch` event. */
  async fetch(request: Request, env: Bindings, executionCtx: ExecutionContext = MOCK_CTX): Promise<Response> {
    const isHead = request.method.toUpperCase() === "HEAD";
    const req = isHead ? new Request(request.url, { method: "GET", headers: request.headers }) : request;

    try {
      // Config resolution validates the env and throws on a deployment defect. It runs inside the
      // try so that failure produces the app's own error page rather than escaping `fetch` as a
      // raw throw — which the runtime would render as its own untouchable error page.
      const config = resolveConfig(this.configStore, (env ?? {}) as object);
      this._requestState.set(req, { env, executionCtx, config });
      this._router ??= this._buildRouter();

      const res = await this._router.fetch(req);
      if (isHead) {
        return new Response(null, { status: res.status, headers: res.headers });
      }
      return res;
    } catch (err) {
      // Last resort: an error thrown outside the middleware chain — env/config resolution above,
      // or router internals. Neither reaches the consumer's security middleware, so the response
      // carries the baseline hardening `_handleError` applies itself.
      const res = await this._handleError(toError(err), makeErrorContext(request, env, executionCtx));
      if (isHead) {
        return new Response(null, { status: res.status, headers: res.headers });
      }
      return res;
    }
  }

  private async _handleError(err: Error, context: AppContext<Bindings>): Promise<Response> {
    if (this._onError) {
      try {
        return await this._onError(err, context);
      } catch {
        // fall through to default error page
      }
    }
    // This boundary converts the throw into a 500 *below* `requestLogger`, so that middleware's
    // `await next()` resolves normally and its summary record sees only a status code. Publishing
    // here is what puts the error detail on the per-request logger — the request's own channels
    // and bindings, so a persisted 500 stays correlated with the request that caused it. Absent
    // when the throw happened outside the middleware chain, hence the optional read.
    const reqLog = requestLog.getOptional(context);
    if (reqLog) {
      reqLog.error("unhandled error", { error: serializeError(err) });
      // Flushed here rather than left to `requestLogger`. On the guard-throw path that middleware's
      // `finally` has *already* run by the time this executes, and `flush()` splices the pending
      // buffer (`logging/logger.ts`) — so a record appended afterwards sits in a buffer nobody
      // awaits and, with a genuinely asynchronous channel such as `kvLogChannel`, may never reach
      // storage before isolate teardown. Flushing at the point of write puts the boundary's record
      // inside an awaited window on *both* throw paths. On the handler-throw path this simply
      // flushes early and `requestLogger`'s own flush then covers the summary; a second flush of an
      // empty buffer costs nothing.
      const flush = reqLog.flush();
      try {
        context.executionCtx.waitUntil(flush);
      } catch {
        await flush;
      }
    }
    // Same serialized shape as the line above, deliberately. `this._logger` is a `consoleChannel`
    // (the worker log stream, not the HTTP client), and redaction in forge is a *channel*-level
    // decision — `STRUCTURED_LOGGING.md` §6a puts stacks in `consoleChannel` only, and §2e has
    // `kvLogChannel` strip them via `persistStack: false`. Dropping `name` and `stack` here made
    // the console the *least* informative sink, which is backwards. What must not leak is the
    // response body, and that is guarded separately below by `isDebug`.
    this._logger.error("Unhandled error", { error: serializeError(err) });
    let isDebug = false;
    try {
      if (this._isDebug) {
        isDebug = this._isDebug(context);
      }
    } catch {
      /* ignore */
    }
    const detail = isDebug ? `<p>${escapeHtml(err.message)}</p>` : "<p>An unexpected error occurred.</p>";
    // Baseline hardening for errors thrown outside the middleware chain (router internals), which
    // never reach the consumer's security middleware. The in-chain path overlays the consumer CSP
    // via `applyPendingHeaders` (which set-overwrites these). Self-contained — no new imports.
    return new Response(`<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1>${detail}</body></html>`, {
      status: 500,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
        "referrer-policy": "no-referrer",
      },
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
