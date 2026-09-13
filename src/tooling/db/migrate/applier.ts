import { applyRecordedSql } from "../recorded";
import type { DbRunContext, Home, Migration } from "../types";
import { recordMigrationSql } from "./checksum";
import { ensureCompanionTables } from "./companions";

/** Applies each migration in order, staging its body with its own history row so a local load commits both or neither. @internal */
export function applyMigrations(
  run: DbRunContext,
  home: Home,
  migrations: readonly Migration[],
  options: { label: string; record: boolean },
): void {
  if (migrations.length === 0) return;
  if (options.record) ensureCompanionTables(run.io, home);
  for (const migration of migrations) {
    applyRecordedSql(run, home, {
      label: options.label,
      name: migration.name,
      sql: migration.sql,
      record: options.record ? recordMigrationSql(migration, run.io.now().getTime()) : null,
      remove: false,
    });
  }
}
