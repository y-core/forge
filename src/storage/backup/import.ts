import { v } from "../../validation/mod";
import { checkedBookmark } from "./bookmark";
import { D1BackupError } from "./errors";
import { callD1Api, databasePath } from "./rest";
import type { CloudflareAccess, D1ImportSource, D1ImportState, D1RestoredDatabase } from "./types";

const IMPORT_REPLY = v.looseObject({
  success: v.optional(v.boolean(), true),
  status: v.optional(v.string()),
  at_bookmark: v.optional(v.string()),
  upload_url: v.optional(v.string()),
  filename: v.optional(v.string()),
  error: v.optional(v.string()),
  errors: v.optional(v.array(v.string()), []),
  result: v.optional(v.looseObject({ num_queries: v.optional(v.number()), final_bookmark: v.optional(v.string()) })),
});

type ImportReply = v.InferOutput<typeof IMPORT_REPLY>;

const DATABASE = v.object({ uuid: v.string(), name: v.string() });

function readReply(value: unknown): ImportReply {
  const parsed = v.safeParse(IMPORT_REPLY, value);
  if (!parsed.success) throw new D1BackupError("malformed", "the D1 import reply was not the shape Cloudflare documents");
  return parsed.output;
}

/** The import state a reply carries, wherever D1 is in it. @internal */
export function readImportState(reply: ImportReply): D1ImportState {
  if (!reply.success || reply.status === "error") {
    return { status: "error", error: reply.error ?? (reply.errors.join("; ") || "no detail") };
  }
  if (reply.status === "complete") {
    const bookmark = reply.result?.final_bookmark;
    return { status: "complete", bookmark: bookmark === undefined ? null : checkedBookmark(bookmark), queries: reply.result?.num_queries ?? 0 };
  }
  if (reply.at_bookmark === undefined) throw new D1BackupError("malformed", "D1 answered an import still running without its bookmark");
  return { status: "active", bookmark: checkedBookmark(reply.at_bookmark) };
}

function isLostReply(error: unknown): boolean {
  return !(error instanceof D1BackupError) || error.status === undefined || error.status >= 500;
}

/** Creates the database a restore imports into, adopting one of that name a lost reply already created. @internal */
export async function createRestoreDatabase(access: CloudflareAccess, name: string): Promise<D1RestoredDatabase> {
  let created: unknown;
  try {
    created = await callD1Api(access, "database create", "", { name });
  } catch (error) {
    if (!isLostReply(error)) throw error;
    const listed = v.safeParse(v.array(DATABASE), await callD1Api(access, "database list", `?name=${encodeURIComponent(name)}`));
    const same = listed.success ? listed.output.filter((database) => database.name === name) : [];
    if (same.length !== 1 || same[0] === undefined) throw error;
    return { databaseId: same[0].uuid, name };
  }
  const parsed = v.safeParse(DATABASE, created);
  if (!parsed.success) throw new D1BackupError("malformed", "the D1 database create reply was not the shape Cloudflare documents");
  return { databaseId: parsed.output.uuid, name: parsed.output.name };
}

/** Reads the standby a restore imports into, refusing one that does not exist with `not-found`. @internal */
export async function readRestoreDatabase(access: CloudflareAccess, databaseId: string): Promise<D1RestoredDatabase> {
  const parsed = v.safeParse(DATABASE, await callD1Api(access, "database get", databasePath(databaseId)));
  if (!parsed.success) throw new D1BackupError("malformed", "the D1 database get reply was not the shape Cloudflare documents");
  return { databaseId: parsed.output.uuid, name: parsed.output.name };
}

// The upload URL and the uploaded file's name are bearer credentials: neither leaves this call or
// reaches an error message, so neither lands in a Workflow instance's persisted state.
/** Starts D1's import of `source` into `target`: init by md5, the upload when D1 lacks the file, then ingest. @internal */
export async function startD1Import(access: CloudflareAccess, target: D1RestoredDatabase, source: D1ImportSource): Promise<D1ImportState> {
  const path = databasePath(target.databaseId, "import");
  const init = readReply(await callD1Api(access, "import", path, { action: "init", etag: source.md5 }));
  if (init.upload_url === undefined || init.filename === undefined) {
    await source.body.cancel().catch(() => {});
    return readImportState(init);
  }
  if (!init.upload_url.startsWith("https://")) throw new D1BackupError("malformed", "D1 answered an upload URL that is not HTTPS");
  const fetchFn = access.fetch ?? ((input, request) => globalThis.fetch(input, request));
  let res: Response;
  try {
    res = await fetchFn(init.upload_url, { method: "PUT", headers: { "Content-Length": String(source.size) }, body: source.body });
  } catch {
    throw new D1BackupError("import", "uploading the dump to D1's import store failed: network error");
  }
  if (res.status !== 200)
    throw new D1BackupError("import", `uploading the dump to D1's import store failed (HTTP ${res.status})`, { status: res.status });
  if ((res.headers.get("etag") ?? "").replace(/^"|"$/g, "") !== source.md5) {
    throw new D1BackupError("import", "D1's import store answered an etag other than the dump's md5, so the upload is not the dump");
  }
  return readImportState(readReply(await callD1Api(access, "import", path, { action: "ingest", etag: source.md5, filename: init.filename })));
}

/** Polls the import running in `target` at `bookmark`. @internal */
export async function pollD1Import(access: CloudflareAccess, target: D1RestoredDatabase, bookmark: string): Promise<D1ImportState> {
  const reply = await callD1Api(access, "import", databasePath(target.databaseId, "import"), { action: "poll", current_bookmark: bookmark });
  return readImportState(readReply(reply));
}

/** Runs one read statement against `target` over REST, answering its rows. @internal */
export async function queryD1(access: CloudflareAccess, target: D1RestoredDatabase, sql: string): Promise<Record<string, unknown>[]> {
  const parsed = v.safeParse(
    v.array(v.object({ results: v.optional(v.array(v.record(v.string(), v.unknown())), []) })),
    await callD1Api(access, "query", databasePath(target.databaseId, "query"), { sql }),
  );
  if (!parsed.success) throw new D1BackupError("malformed", "the D1 query reply was not the shape Cloudflare documents");
  return parsed.output[0]?.results ?? [];
}
