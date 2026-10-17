import type { AppContext } from "../../context/types";
import { d1BindingSpec, resolveD1Client } from "./bindings";
import { createSchemaHealthMemo, SCHEMA_RECHECK_MS, schemaHealthCheckFrom, schemaHealthMonitorFrom } from "./health";
import type { D1BindingDefinition, D1BindingMount, D1Client, D1DatabaseLike } from "./types";

/** Declares a D1 binding once and returns its binding check, schema-health monitor, health checks and client. @public */
export function defineD1Binding<Bindings = Record<string, unknown>>(definition: D1BindingDefinition): D1BindingMount<Bindings> {
  const { name } = definition;
  const binding = (c: AppContext<Bindings>): D1DatabaseLike | undefined => {
    const value = (c.env as Record<string, unknown> | undefined)?.[name];
    return typeof (value as D1DatabaseLike | undefined)?.prepare === "function" ? (value as D1DatabaseLike) : undefined;
  };
  const recheck = { recheckMs: definition.recheckMs, now: definition.now };
  const memo = createSchemaHealthMemo(definition.recheckMs ?? SCHEMA_RECHECK_MS);
  return {
    spec: d1BindingSpec(name),
    globals: [schemaHealthMonitorFrom<Bindings>({ binding, logger: definition.logger, ...recheck }, memo)],
    health: {
      [name]: (c) => binding(c) !== undefined,
      [`${name}:schema`]: schemaHealthCheckFrom<Bindings>(binding, memo, definition.now ?? Date.now),
    },
    client: (c) => resolveD1Client(c, { binding, ...(definition.client === undefined ? {} : { client: definition.client }) }) as D1Client,
  };
}
