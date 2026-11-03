import { isD1Bookmark } from "../../../storage/backup/bookmark";
import type { D1RestoredDatabase } from "../../../storage/backup/types";
import type { v } from "../../../validation/validation";
import { createCfClient } from "../../cf/api/client";
import { D1_WRITE_PERMISSION, d1DatabasePath, d1Path } from "../../cf/api/endpoints";
import { classifyCfError } from "../../cf/api/errors";
import { CF_OPERATIONS } from "../../cf/api/operations";
import type { CfApiClientError } from "../../cf/api/types";
import type { CfAuth } from "../../cf/types";
import { CliError } from "../../cli/errors";
import { D1_REQUEST_TIMEOUT_MS } from "../remote";
import type { DbIo } from "../types";
import type { D1ExportState, D1ImportSource, D1ImportState, D1Transfer } from "./types";

const D1_POLL_MS = 1_000;

type D1ImportReply = v.InferOutput<typeof CF_OPERATIONS.importD1Database.result>;

function failed(what: string, e: CfApiClientError): CliError {
  const hint = classifyCfError(e) === "auth" ? ` — the --api-token needs ${D1_WRITE_PERMISSION}` : "";
  return new CliError("external", `the D1 ${what} request failed: ${detail(e)}${hint}`, { cause: e });
}

// Cloudflare's error text and a transport's thrown text can both echo the token, so a refusal is built from their structure alone.
function detail(e: CfApiClientError): string {
  if (e.kind === "network") return "network error";
  if (e.kind !== "api") return e.message;
  const code = e.cfErrors?.[0]?.code;
  return [e.statusCode === undefined ? "API error" : `HTTP ${e.statusCode}`, code === undefined ? "" : `, Cloudflare error ${code}`].join("");
}

function checkedBookmark(bookmark: string): string {
  if (!isD1Bookmark(bookmark)) throw new CliError("external", "D1 answered a bookmark outside its documented grammar");
  return bookmark;
}

function isLostReply(e: CfApiClientError): boolean {
  return e.kind === "network" || e.statusCode === undefined || e.statusCode >= 500;
}

function announcedLength(res: Response): number | null {
  const header = res.headers.get("Content-Length");
  return header !== null && /^\d+$/.test(header) ? Number(header) : null;
}

/** The import state a reply carries, wherever D1 is in it. @internal */
export function readImportState(reply: D1ImportReply): D1ImportState {
  if (!reply.success || reply.status === "error") {
    return { status: "error", error: reply.error ?? (reply.errors.join("; ") || "no detail") };
  }
  if (reply.status === "complete") {
    const bookmark = reply.result?.final_bookmark;
    return { status: "complete", bookmark: bookmark === undefined ? null : checkedBookmark(bookmark), queries: reply.result?.num_queries ?? 0 };
  }
  if (reply.at_bookmark === undefined) throw new CliError("external", "D1 answered an import still running without its bookmark");
  return { status: "active", bookmark: checkedBookmark(reply.at_bookmark) };
}

/** Reaches a deployed database's export and import over D1's REST API, waiting between polls on `io.sleep`. @internal */
export function restTransfer(io: DbIo, auth: CfAuth, databaseId: string): D1Transfer {
  const client = createCfClient(auth, io.fetch, D1_REQUEST_TIMEOUT_MS, (ms) => io.sleep(ms));
  const exportPath = `${d1DatabasePath(auth.accountId, databaseId)}/export`;
  const importPath = (target: D1RestoredDatabase) => `${d1DatabasePath(auth.accountId, target.databaseId)}/import`;

  async function requestExport(bookmark: string | null): Promise<D1ExportState> {
    const reply =
      bookmark === null
        ? await client.post(exportPath, { output_format: "polling" }, CF_OPERATIONS.startD1Export)
        : await client.post(exportPath, { output_format: "polling", current_bookmark: bookmark }, CF_OPERATIONS.pollD1Export);
    if (!reply.ok) throw failed("export", reply.error);
    const state = reply.data;
    if (state.status === "active") return { status: "active", bookmark: state.at_bookmark };
    if (state.status === "error") return { status: "error", error: state.error };
    return { status: "complete", bookmark: state.at_bookmark ?? null, signedUrl: state.result.signed_url };
  }

  async function awaitExport(bookmark: string): Promise<string> {
    for (;;) {
      const state = await requestExport(bookmark);
      if (state.status === "error") throw new CliError("external", `D1 reported the export failed: ${state.error || "no detail"}`);
      if (state.status === "complete") {
        if (state.bookmark !== null && state.bookmark !== bookmark) throw new CliError("external", "D1 moved the export's bookmark while it ran");
        if (!state.signedUrl.startsWith("https://")) throw new CliError("external", "D1 answered a signed URL that is not HTTPS");
        return state.signedUrl;
      }
      if (state.bookmark !== bookmark) throw new CliError("external", "D1 moved the export's bookmark while it ran");
      await io.sleep(D1_POLL_MS);
    }
  }

  async function createDatabase(name: string): Promise<D1RestoredDatabase> {
    const created = await client.post(d1Path(auth.accountId), { name }, CF_OPERATIONS.createD1Database);
    if (created.ok) return { databaseId: created.data.uuid, name: created.data.name };
    if (!isLostReply(created.error)) throw failed("database create", created.error);
    const listed = await client.list(`${d1Path(auth.accountId)}?name=${encodeURIComponent(name)}`, CF_OPERATIONS.listD1Databases);
    const same = listed.ok ? listed.data.filter((database) => database.name === name) : [];
    if (same.length !== 1 || same[0] === undefined) throw failed("database create", created.error);
    return { databaseId: same[0].uuid, name };
  }

  async function readDatabase(id: string): Promise<D1RestoredDatabase> {
    const read = await client.get(d1DatabasePath(auth.accountId, id), CF_OPERATIONS.getD1Database);
    if (!read.ok) throw failed("database get", read.error);
    return { databaseId: read.data.uuid, name: read.data.name };
  }

  async function upload(url: string, source: D1ImportSource): Promise<void> {
    if (!url.startsWith("https://")) throw new CliError("external", "D1 answered an upload URL that is not HTTPS");
    let res: Response;
    try {
      res = await io.fetch(url, { method: "PUT", headers: { "Content-Length": String(source.size) }, body: source.body });
    } catch {
      throw new CliError("external", "uploading the dump to D1's import store failed: network error");
    }
    if (res.status !== 200) throw new CliError("external", `uploading the dump to D1's import store failed (HTTP ${res.status})`);
    if ((res.headers.get("etag") ?? "").replace(/^"|"$/g, "") !== source.md5) {
      throw new CliError("external", "D1's import store answered an etag other than the dump's md5, so the upload is not the dump");
    }
  }

  return {
    async startExport() {
      const state = await requestExport(null);
      if (state.status === "error") throw new CliError("external", `D1 refused to start the export: ${state.error || "no detail"}`);
      if (state.bookmark === null) throw new CliError("external", "D1 started the export without naming its bookmark");
      return checkedBookmark(state.bookmark);
    },
    async openExport(bookmark) {
      const signedUrl = await awaitExport(bookmark);
      let res: Response;
      try {
        res = await io.fetch(signedUrl);
      } catch {
        throw new CliError("external", "downloading the D1 export failed: network error");
      }
      if (!res.ok || res.body === null) throw new CliError("external", `downloading the D1 export failed (HTTP ${res.status})`);
      return { body: res.body, length: announcedLength(res) };
    },
    openTarget: async (into) => ("fresh" in into ? createDatabase(into.fresh) : readDatabase(into.standby)),
    async startImport(target, source) {
      const init = await client.post(importPath(target), { action: "init", etag: source.md5 }, CF_OPERATIONS.importD1Database);
      if (!init.ok) throw failed("import", init.error);
      const { upload_url: uploadUrl, filename } = init.data;
      if (uploadUrl === undefined || filename === undefined) {
        await source.body.cancel().catch(() => {});
        return readImportState(init.data);
      }
      await upload(uploadUrl, source);
      const ingest = await client.post(importPath(target), { action: "ingest", etag: source.md5, filename }, CF_OPERATIONS.importD1Database);
      if (!ingest.ok) throw failed("import", ingest.error);
      return readImportState(ingest.data);
    },
    async pollImport(target, bookmark) {
      await io.sleep(D1_POLL_MS);
      const reply = await client.post(importPath(target), { action: "poll", current_bookmark: bookmark }, CF_OPERATIONS.pollD1Import);
      if (!reply.ok) throw failed("import", reply.error);
      return readImportState(reply.data);
    },
    async query(target, sql) {
      const reply = await client.post(`${d1DatabasePath(auth.accountId, target.databaseId)}/query`, { sql }, CF_OPERATIONS.readD1Database);
      if (!reply.ok) throw failed("query", reply.error);
      return reply.data[0]?.results ?? [];
    },
  };
}
