import type { AppContext } from "../context/types";
import { ConfigKey, EnvKey, ExecutionContextKey, RequestContext } from "../context/types";
import { requestLog } from "../logging/request-logger";
import type { Logger } from "../logging/types";

/** Returns an `ExecutionContext` whose `waitUntil`/`passThroughOnException` are no-ops. @public */
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

/** Builds a `RequestContext` pre-loaded with `env`, `executionCtx`, `config`, and a request logger exactly as the Forge router injects them. @public */
export function createTestContext<Bindings = Record<string, unknown>, ConfigData = unknown>(
  request: Request,
  options: TestContextOptions<Bindings, ConfigData> = {},
): AppContext<Bindings, Record<string, string>, ConfigData> {
  const context = new RequestContext(request);
  context.set(EnvKey, options.env ?? ({} as Bindings), { property: "env" });
  context.set(ExecutionContextKey, options.executionCtx ?? mockExecutionContext(), { property: "executionCtx" });
  context.set(ConfigKey, options.config, { property: "config" });
  requestLog.set(context, options.logger ?? nullLogger);
  return context as unknown as AppContext<Bindings, Record<string, string>, ConfigData>;
}
