import { isAbsolute, join, resolve } from "node:path";

import type { DbRunContext, DeclaredPath } from "./types";

/** Resolves one declared position against the root, keeping the text it was written as. @internal */
export function declaredPath(root: string, declared: string): DeclaredPath {
  return { path: isAbsolute(declared) ? declared : resolve(root, declared), declared };
}

/** Every desired-state file the app composes from, in the order `config/db.ts` names them. @internal */
export function declaredSchemas(run: DbRunContext): DeclaredPath[] {
  return (run.host.schemas ?? []).map((declared) => declaredPath(run.config.root, declared));
}

/** Every seeds directory the app runs, in the order `config/db.ts` names them. @internal */
export function declaredSeeds(run: DbRunContext): DeclaredPath[] {
  return (run.host.seeds ?? []).map((declared) => declaredPath(run.config.root, declared));
}

/** Where the migrations live: the host config's `migrations`, else `migrations` under the root. @internal */
export function declaredMigrations(run: DbRunContext): DeclaredPath {
  return declaredPath(run.config.root, run.host.migrations ?? "migrations");
}

/** Where the composed snapshot lives: the host config's `snapshot`, else `schema.snapshot.json` under the root. @internal */
export function snapshotPath(run: DbRunContext): string {
  const declared = run.host.snapshot;
  if (declared !== undefined) return declaredPath(run.config.root, declared).path;
  return join(run.config.root, "schema.snapshot.json");
}

/** What `compose` says when refusing to compose from no schema while history exists. @internal */
export const NO_SCHEMAS =
  "config/db.ts names no `schemas` — every desired-state file is declared there, including a library's, so that nothing contributes DDL to this database without being asked for:\n" +
  '  export default { schemas: ["node_modules/@y-core/forge/src/auth/schema.sql", "config/schema.sql"] } satisfies DbHostConfig;\n' +
  "Each entry is a file of plain `CREATE TABLE` text stating that schema once — write it, then compose.";
