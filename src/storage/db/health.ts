import type { Middleware } from "@remix-run/fetch-router";

import { getAppContext } from "../../context/types";
import type { AppContext } from "../../context/types";
import { bytesToHex, sha256 } from "../../crypto/mod";
import { createLogger } from "../../logging/logger";
import { INVENTORY_SELECT, SCHEMA_FINGERPRINT_KEY, SCHEMA_META_SELECT, schemaFingerprintInput, toSchemaMeta, toSchemaObjects } from "./schema";
import type { D1DatabaseLike, SchemaHealth, SchemaHealthMonitorOptions, SchemaHealthOptions } from "./types";

const NO_SUCH_TABLE = /no such table/i;

/** Compares the fingerprint `forge db migrate` recorded against the schema as it stands; reads only, never repairs. @public */
export async function checkSchemaHealth(db: D1DatabaseLike, options?: SchemaHealthOptions): Promise<SchemaHealth> {
  let meta: Record<string, string>;
  try {
    meta = toSchemaMeta((await db.prepare(SCHEMA_META_SELECT).all<Record<string, unknown>>()).results);
  } catch (error) {
    if (NO_SUCH_TABLE.test(error instanceof Error ? error.message : String(error))) {
      return { state: "unavailable", recorded: null, actual: null };
    }
    throw error;
  }
  const inventory = await db.prepare(INVENTORY_SELECT).all<Record<string, unknown>>();
  const actual = bytesToHex(await sha256(schemaFingerprintInput(toSchemaObjects(inventory.results), options?.migrationsTable)));
  const recorded = meta[SCHEMA_FINGERPRINT_KEY] ?? null;
  const state = recorded === null ? "unrecorded" : recorded === actual ? "match" : "mismatch";
  return { state, recorded, actual };
}

/** A `healthCheck` predicate that fails only on a fingerprint mismatch; an absent binding also fails. @public */
export function schemaHealthCheck<Bindings = Record<string, unknown>>(
  binding: (c: AppContext<Bindings>) => D1DatabaseLike | undefined,
  options?: SchemaHealthOptions,
): (c: AppContext<Bindings>) => Promise<boolean> {
  let cachedEnvRef: unknown;
  let healthy: Promise<boolean> | undefined;
  return async (c) => {
    const db = binding(c);
    if (!db) return false;
    if (c.env !== cachedEnvRef || healthy === undefined) {
      cachedEnvRef = c.env;
      healthy = checkSchemaHealth(db, options).then(
        (health) => health.state !== "mismatch",
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
    const db = options.binding(c);
    if (!db) {
      logger.warn("d1.schema.health.skipped", { reason: "binding absent" });
      return;
    }
    try {
      const { state, recorded, actual } = await checkSchemaHealth(db, { migrationsTable: options.migrationsTable });
      logger[state === "mismatch" || state === "unavailable" ? "warn" : "info"]("d1.schema.health", { state, recorded, actual });
    } catch (error) {
      logger.warn("d1.schema.health.failed", { error });
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
