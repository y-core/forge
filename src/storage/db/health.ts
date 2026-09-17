import type { Middleware } from "@remix-run/fetch-router";

import { getAppContext } from "../../context/types";
import type { AppContext } from "../../context/types";
import { bytesToHex, sha256 } from "../../crypto/mod";
import { createLogger } from "../../logging/logger";
import { serializeError } from "../../logging/serialize-error";
import { INVENTORY_SELECT, RECORDED_FINGERPRINT_SELECT, schemaFingerprintInput, toSchemaObjects } from "./schema";
import type { D1DatabaseLike, SchemaHealth, SchemaHealthMonitorOptions } from "./types";

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

/** A `healthCheck` predicate that fails only on a fingerprint mismatch; an absent binding also fails. @public */
export function schemaHealthCheck<Bindings = Record<string, unknown>>(
  binding: (c: AppContext<Bindings>) => D1DatabaseLike | undefined,
): (c: AppContext<Bindings>) => Promise<boolean> {
  let cachedEnvRef: unknown;
  let healthy: Promise<boolean> | undefined;
  return async (c) => {
    const db = binding(c);
    if (!db) return false;
    if (c.env !== cachedEnvRef || healthy === undefined) {
      cachedEnvRef = c.env;
      healthy = checkSchemaHealth(db).then(
        (health) => {
          // Only a healthy verdict is kept. A mismatch repaired by a migration would otherwise shed
          // traffic for the rest of the isolate's life with no way for an operator to force a recheck.
          const ok = health.state !== "mismatch";
          if (!ok) healthy = undefined;
          return ok;
        },
        (error: unknown) => {
          healthy = undefined;
          throw error;
        },
      );
    }
    return healthy;
  };
}

/** Middleware that logs the schema health once per isolate, at `warn` on a mismatch, and always calls `next()`. @public */
export function schemaHealthMonitor<Bindings = Record<string, unknown>>(options: SchemaHealthMonitorOptions<Bindings>): Middleware {
  const logger = options.logger ?? createLogger("storage/db");
  let cachedEnvRef: unknown;
  let observed: Promise<void> | undefined;

  async function observe(c: AppContext<Bindings>): Promise<void> {
    try {
      const db = options.binding(c);
      if (!db) {
        logger.warn("d1.schema.health.skipped", { reason: "binding absent" });
        return;
      }
      try {
        const { state, recorded, actual } = await checkSchemaHealth(db);
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
    if (c.env !== cachedEnvRef || observed === undefined) {
      cachedEnvRef = c.env;
      observed = observe(c);
      // The observation writes nothing and gates nothing, so the first request of an isolate must not
      // wait on its two D1 reads and a hash. `waitUntil` keeps the isolate alive until the log lands.
      c.executionCtx.waitUntil(observed);
    }
    return next();
  };
}
