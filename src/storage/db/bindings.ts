import type { Middleware } from "@remix-run/fetch-router";

import { bindingSchema, validateBindings } from "../../context/env-validation";
import type { AppContext, BindingSpec } from "../../context/types";
import { createLogger } from "../../logging/logger";
import { loggerFor } from "../../logging/request-logger";
import type { Logger } from "../../logging/types";
import { queryTallyFor } from "./budget";
import { clientCounting } from "./client";
import { queryableFor } from "./session";
import type { D1BindingOptions, D1Client, D1Database, D1DatabaseLike } from "./types";

const fallbackLogger = createLogger("storage/db");

function warnAndAbove(logger: Logger): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: (message, data) => logger.warn(message, data),
    error: (message, data) => logger.error(message, data),
    flush: () => logger.flush(),
    child: (bindings) => warnAndAbove(logger.child(bindings)),
  };
}

/** The binding spec a D1 database under `name` is held to: it must carry `prepare`. @internal */
export function d1BindingSpec(name: string): BindingSpec {
  return { name, methods: ["prepare"], label: "a D1 database binding" };
}

/** Middleware that validates a D1 database binding exists on first request. @public */
export function validateD1Binding(name: string): Middleware {
  const spec = d1BindingSpec(name);
  return validateBindings(bindingSchema(spec.name, spec.methods, spec.label));
}

/** Resolves a D1Client from the current request context. @public */
export function resolveD1Client<Bindings = Record<string, unknown>, DB extends D1DatabaseLike = D1Database>(
  c: AppContext<Bindings>,
  opts: D1BindingOptions<Bindings, DB>,
): D1Client | null {
  const db = opts.binding(c);
  if (!db) {
    if (opts.required === false) return null;
    throw new Error("D1 database binding not available");
  }
  const client =
    opts.client?.logger === undefined ? { ...opts.client, logger: warnAndAbove(loggerFor(c, "storage/db", fallbackLogger)) } : opts.client;
  return clientCounting(queryableFor(c as never, db), client, queryTallyFor(c as never));
}
