import { CliError } from "../../cli/errors";
import { splitDumpStatements } from "./split";
import type { BackupDatabase, D1Transfer } from "./types";

/** miniflare's export statement, matched by its exact text: the dumper `wrangler d1 export --local` drives. @internal */
export const MINIFLARE_EXPORT_PRAGMA = "PRAGMA miniflare_d1_export(?,?,?);";

/** Reaches a local database's export and import through the platform proxy's bindings, since local D1 serves neither API and keeps no Time Travel. @internal */
export function localTransfer(source: BackupDatabase, openStandby: (binding: string) => Promise<BackupDatabase>): D1Transfer {
  return {
    startExport: async (at) => `local-${at.getTime()}`,
    async openExport() {
      const rows = await source.prepare(MINIFLARE_EXPORT_PRAGMA).bind(0, 0).raw();
      const statements = rows[0];
      if (!Array.isArray(statements) || !statements.every((statement) => typeof statement === "string")) {
        throw new CliError("external", "the local D1 binding did not answer miniflare's export");
      }
      const bytes = new TextEncoder().encode(statements.join("\n"));
      return { body: new Blob([bytes]).stream(), length: bytes.byteLength };
    },
    async openTarget(into) {
      if ("fresh" in into) {
        throw new CliError(
          "invalid-args",
          "a local target cannot create a database — restore into a standby binding with --into standby:<binding>",
        );
      }
      await openStandby(into.standby);
      return { databaseId: into.standby, name: into.standby };
    },
    // Local databases are dev-sized, so the dump is read whole and loaded in one batch, which D1 runs as one transaction.
    async startImport(target, src) {
      const db = await openStandby(target.databaseId);
      const statements = splitDumpStatements(await new Response(src.body).text());
      await db.batch(statements.map((statement) => db.prepare(statement)));
      return { status: "complete", bookmark: null, queries: statements.length };
    },
    pollImport: async () => ({ status: "error", error: "a local import finishes in the step that starts it" }),
    query: async (target, sql) => (await (await openStandby(target.databaseId)).prepare(sql).all()).results,
  };
}
