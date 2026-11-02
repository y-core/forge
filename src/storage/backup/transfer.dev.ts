import { isDevBuildArmed, whenArmed } from "../../relax/armed";
import { D1BackupError } from "./errors";
import { splitDumpStatements } from "./split";
import { d1Transfer as strictD1Transfer } from "./transfer.strict";
import type { BackupDatabase, D1RestoreOptions, D1Transfer, RelaxD1Transfer } from "./types";

function standby(options: D1RestoreOptions): BackupDatabase {
  if ("fresh" in options.into) {
    throw new D1BackupError(
      "unsupported",
      "a dev session cannot create a database — restore into a standby binding with `into: { standby, database }`",
    );
  }
  if (options.into.database === undefined)
    throw new D1BackupError("options", "a restore under `forge cf dev` needs the standby's binding as `into.database`");
  return options.into.database;
}

/** miniflare's export statement, matched by its exact text: the same dumper `wrangler d1 export --local` drives. @internal */
export const MINIFLARE_EXPORT_PRAGMA = "PRAGMA miniflare_d1_export(?,?,?);";

/** Reaches a local database's export and import through bindings, since `wrangler dev` serves neither API and keeps no Time Travel. @internal */
export const localTransfer: D1Transfer = {
  credentials: [],
  startExport: async (options) => `local-${options.at.getTime()}`,
  async openExport(options) {
    const rows = await options.database.prepare(MINIFLARE_EXPORT_PRAGMA).bind(0, 0).raw();
    const statements = rows[0];
    if (!Array.isArray(statements) || !statements.every((statement) => typeof statement === "string")) {
      throw new D1BackupError("malformed", "the local D1 binding did not answer miniflare's export — is this running under `forge cf dev`?");
    }
    const bytes = new TextEncoder().encode(statements.join("\n"));
    return { body: new Blob([bytes]).stream(), length: bytes.byteLength };
  },
  async openTarget(options) {
    standby(options);
    return { databaseId: "standby" in options.into ? options.into.standby : "", name: "standby" in options.into ? options.into.standby : "" };
  },
  // Local databases are dev-sized, so the dump is read whole and loaded in one batch, which D1 runs as one transaction.
  async startImport(options, _target, source) {
    const database = standby(options);
    const statements = splitDumpStatements(await new Response(source.body).text());
    await database.batch(statements.map((statement) => database.prepare(statement)));
    return { status: "complete", bookmark: null, queries: statements.length };
  },
  pollImport: async () => ({ status: "error", error: "a local import finishes in the step that starts it" }),
  query: async (options, _target, sql) => (await standby(options).prepare(sql).all()).results,
};

/** The transport a build armed for development reaches D1's export by: the local binding, and REST otherwise. @internal */
export const d1Transfer: RelaxD1Transfer = whenArmed(isDevBuildArmed, () => localTransfer, strictD1Transfer);
