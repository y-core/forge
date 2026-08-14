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

// biome-ignore lint/suspicious/noExplicitAny: mock context for testing only
const MOCK_CTX: ExecutionContext = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

/** Compiles a `use()` path convention into a route-pattern matcher, or `null` for the catch-all. */
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

    // `errorBoundary` appears twice deliberately: the inner one keeps an error response flowing back
    // out through guards that queue `set-cookie` after `next()`; the outer one catches a guard's own
    // throw, which would otherwise skip the `applyHeaders` flush entirely.
    return createRouter({ matcher: this._matcher, middleware: [provideRequestState, applyHeaders, errorBoundary, ...guarded, errorBoundary] });
  }

  /** Handles a Workers `fetch` event. */
  async fetch(request: Request, env: Bindings, executionCtx: ExecutionContext = MOCK_CTX): Promise<Response> {
    const isHead = request.method.toUpperCase() === "HEAD";
    const req = isHead ? new Request(request.url, { method: "GET", headers: request.headers }) : request;

    try {
      // Inside the try so a deployment defect produces the app's own error page rather than
      // escaping `fetch` and letting the runtime render its own untouchable one.
      const config = resolveConfig(this.configStore, (env ?? {}) as object);
      this._requestState.set(req, { env, executionCtx, config });
      this._router ??= this._buildRouter();

      const res = await this._router.fetch(req);
      if (isHead) {
        return new Response(null, { status: res.status, headers: res.headers });
      }
      return res;
    } catch (err) {
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
    const reqLog = requestLog.getOptional(context);
    if (reqLog) {
      reqLog.error("unhandled error", { error: serializeError(err) });
      // Flushed at the point of write, not left to `requestLogger`: on the guard-throw path its
      // `finally` has already run, so a record appended afterwards would sit in a buffer nobody
      // awaits and may never reach an async channel before isolate teardown.
      const flush = reqLog.flush();
      try {
        context.executionCtx.waitUntil(flush);
      } catch {
        await flush;
      }
    }
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
    // Baseline hardening: an error thrown outside the middleware chain never reaches the consumer's
    // security middleware, so these headers are the only ones such a response would carry.
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
