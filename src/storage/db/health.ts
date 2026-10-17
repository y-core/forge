import type { Middleware } from "@remix-run/fetch-router";

import { getAppContext } from "../../context/types";
import type { AppContext } from "../../context/types";
import { bytesToHex, sha256 } from "../../crypto/primitives/mod";
import { createLogger } from "../../logging/logger";
import { serializeError } from "../../logging/serialize-error";
import { INVENTORY_SELECT, RECORDED_FINGERPRINT_SELECT, schemaFingerprintInput, toSchemaObjects } from "./schema";
import type { D1DatabaseLike, SchemaHealth, SchemaHealthMemo, SchemaHealthMonitorOptions, SchemaHealthState, SchemaRecheckOptions } from "./types";

const NO_SUCH_TABLE = /no such table/i;

/** Compares the fingerprint the last applied migration certified against the schema as it stands; reads only, never repairs. @public */
export async function checkSchemaHealth(db: D1DatabaseLike): Promise<SchemaHealth> {
  let rows: Record<string, unknown>[];
  try {
    rows = (await db.prepare(RECORDED_FINGERPRINT_SELECT).all<Record<string, unknown>>()).results;
  } catch (error) {
    if (NO_SUCH_TABLE.test(error instanceof Error ? error.message : String(error))) {
      return { state: "unavailable", recorded: null, actual: null };
    }
    throw error;
  }
  const inventory = await db.prepare(INVENTORY_SELECT).all<Record<string, unknown>>();
  const actual = bytesToHex(await sha256(schemaFingerprintInput(toSchemaObjects(inventory.results))));
  const last = rows[0];
  if (last === undefined || last.fingerprint === null || last.fingerprint === undefined) {
    return { state: "unrecorded", recorded: null, actual };
  }
  const recorded = String(last.fingerprint);
  return { state: recorded === actual ? "match" : "mismatch", recorded, actual };
}

/** How long a schema verdict is trusted before the next request reads it again. @internal */
export const SCHEMA_RECHECK_MS = 60_000;

/** Creates the schema read a binding's monitor and health check share. @internal */
export function createSchemaHealthMemo(recheckMs: number): SchemaHealthMemo {
  let held: { env: unknown; at: number; health: Promise<SchemaHealth>; state?: SchemaHealthState } | undefined;
  return {
    read(db, env, at, reuseMismatch) {
      if (held !== undefined && held.env === env && at - held.at < recheckMs && (reuseMismatch || held.state !== "mismatch")) {
        return held.health;
      }
      const entry: NonNullable<typeof held> = { env, at, health: checkSchemaHealth(db) };
      held = entry;
      entry.health.then(
        (health) => {
          entry.state = health.state;
        },
        () => {
          if (held === entry) held = undefined;
        },
      );
      return entry.health;
    },
  };
}

/** The schema `healthCheck` predicate over a given memo, reusing only a healthy verdict. @internal */
export function schemaHealthCheckFrom<Bindings = Record<string, unknown>>(
  binding: (c: AppContext<Bindings>) => D1DatabaseLike | undefined,
  memo: SchemaHealthMemo,
  now: () => number,
): (c: AppContext<Bindings>) => Promise<boolean> {
  return async (c) => {
    const db = binding(c);
    if (!db) return false;
    // Only a healthy verdict is kept, so a migration that repairs a mismatch is seen on the next poll
    // rather than shedding traffic until `recheckMs` runs out.
    return (await memo.read(db, c.env, now(), false)).state !== "mismatch";
  };
}

/** A `healthCheck` predicate that fails only on a fingerprint mismatch, re-reading after `recheckMs`; an absent binding also fails. @public */
export function schemaHealthCheck<Bindings = Record<string, unknown>>(
  binding: (c: AppContext<Bindings>) => D1DatabaseLike | undefined,
  options: SchemaRecheckOptions = {},
): (c: AppContext<Bindings>) => Promise<boolean> {
  return schemaHealthCheckFrom(binding, createSchemaHealthMemo(options.recheckMs ?? SCHEMA_RECHECK_MS), options.now ?? Date.now);
}

/** Middleware that logs the schema health once per isolate and again after each `recheckMs`, at `warn` on a mismatch, and always calls `next()`. @public */
export function schemaHealthMonitor<Bindings = Record<string, unknown>>(options: SchemaHealthMonitorOptions<Bindings>): Middleware {
  return schemaHealthMonitorFrom(options, createSchemaHealthMemo(options.recheckMs ?? SCHEMA_RECHECK_MS));
}

/** The schema-health monitor over a given memo, logging once per window whichever caller started the read. @internal */
export function schemaHealthMonitorFrom<Bindings = Record<string, unknown>>(
  options: SchemaHealthMonitorOptions<Bindings>,
  memo: SchemaHealthMemo,
): Middleware {
  const logger = options.logger ?? createLogger("storage/db");
  const recheckMs = options.recheckMs ?? SCHEMA_RECHECK_MS;
  const now = options.now ?? Date.now;
  let cachedEnvRef: unknown;
  let observedAt = 0;
  let observed: Promise<void> | undefined;

  async function observe(c: AppContext<Bindings>, at: number): Promise<void> {
    try {
      const db = options.binding(c);
      if (!db) {
        logger.warn("d1.schema.health.skipped", { reason: "binding absent" });
        return;
      }
      try {
        const { state, recorded, actual } = await memo.read(db, c.env, at, true);
        logger[state === "mismatch" || state === "unavailable" ? "warn" : "info"]("d1.schema.health", { state, recorded, actual });
      } catch (error) {
        logger.warn("d1.schema.health.failed", { error: serializeError(error) });
      }
    } finally {
      await logger.flush();
    }
  }

  return async (context, next) => {
    const c = getAppContext<Bindings>(context);
    const at = now();
    if (c.env !== cachedEnvRef || observed === undefined || at - observedAt >= recheckMs) {
      cachedEnvRef = c.env;
      observedAt = at;
      observed = observe(c, at);
      // The observation writes nothing and gates nothing, so the first request of an isolate must not
      // wait on its two D1 reads and a hash. `waitUntil` keeps the isolate alive until the log lands.
      c.executionCtx.waitUntil(observed);
    }
    return next();
  };
}
