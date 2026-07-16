import type { AppContext } from "../context/types";
import { ConfigKey, EnvKey, ExecutionContextKey, RequestContext } from "../context/types";
import { requestLog } from "../logging/request-logger";
import type { Logger } from "../logging/types";

/**
 * Returns an `ExecutionContext` whose `waitUntil`/`passThroughOnException` are no-ops —
 * for direct handler tests outside a Workers runtime. @public
 */
export function mockExecutionContext(): ExecutionContext {
  // biome-ignore lint/suspicious/noExplicitAny: mock context for testing only
  return { waitUntil: () => {}, passThroughOnException: () => {} } as any;
}

/** A `Logger` that drops every record; `child()` returns itself and `flush()` resolves immediately. @public */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  flush: async () => {},
  child: () => nullLogger,
};

/** Options for `createTestContext`. @public */
export interface TestContextOptions<Bindings = Record<string, unknown>, ConfigData = unknown> {
  /** Workers bindings exposed as `c.env`. @defaultValue `{}` */
  env?: Bindings;
  /** Resolved app config exposed as `c.config` and via `ConfigKey`. */
  config?: ConfigData;
  /** Execution context exposed as `c.executionCtx`. @defaultValue `mockExecutionContext()` */
  executionCtx?: ExecutionContext;
  /** Request logger installed on the context. @defaultValue `nullLogger` */
  logger?: Logger;
}

/**
 * Builds a `RequestContext` pre-loaded with per-request state (`env`, `executionCtx`, `config`,
 * request logger) exactly as the Forge router injects it — for testing handlers and middleware
 * directly, without dispatching through an app. The result satisfies `getAppContext`.
 *
 * For full-chain tests prefer `app.request(...)`; reach for this when exercising a single
 * handler/middleware in isolation.
 *
 * @example
 * ```typescript
 * const c = createTestContext<AppEnv, AppConfig>(new Request("http://test/settings"), {
 *   env: { SETTINGS_KV: fakeKV() },
 *   config: testConfig,
 * });
 * const res = await settingsHandler(c);
 * ```
 * @public
 */
export function createTestContext<Bindings = Record<string, unknown>, ConfigData = unknown>(
  request: Request,
  options: TestContextOptions<Bindings, ConfigData> = {},
): AppContext<Bindings, Record<string, string>, ConfigData> {
  const context = new RequestContext(request);
  // Mirrors the router's provideRequestState injection (forge-app.ts) including the
  // `property` aliases that expose c.env / c.executionCtx / c.config.
  context.set(EnvKey, options.env ?? ({} as Bindings), { property: "env" });
  context.set(ExecutionContextKey, options.executionCtx ?? mockExecutionContext(), { property: "executionCtx" });
  context.set(ConfigKey, options.config, { property: "config" });
  requestLog.set(context, options.logger ?? nullLogger);
  return context as unknown as AppContext<Bindings, Record<string, string>, ConfigData>;
}
