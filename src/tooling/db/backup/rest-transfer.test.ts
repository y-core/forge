import { describe, expect, it } from "bun:test";

import { D1_WRITE_PERMISSION } from "../../cf/api/endpoints";
import { CliError } from "../../cli/errors";
import { fakeDbIo } from "../db.fixture";
import { exportReply } from "./backup.fixture";
import { readImportState, restTransfer } from "./rest-transfer";
import type { D1Transfer } from "./types";

const TOKEN = "tkn-Zq9xW2vLp7";
const SIGNED = "https://d1-exports.example.com/dump.sql?X-Amz-Signature=deadbeef";
const AT = new Date("2026-11-01T02:00:00Z");
const COMPLETE = { status: "complete", at_bookmark: "B", result: { filename: "d.sql", signed_url: SIGNED } };

interface Call {
  readonly url: string;
  readonly init?: RequestInit;
}

function wire(
  reply: (url: string, init?: RequestInit) => Response | Promise<Response>,
  databaseId = "db/1",
  accountId = "acct",
): { transfer: D1Transfer; calls: Call[]; slept: number[]; sleptBefore: number[] } {
  const calls: Call[] = [];
  const sleptBefore: number[] = [];
  const io = fakeDbIo();
  io.fetch = async (input, init) => {
    const url = String(input);
    calls.push(init === undefined ? { url } : { url, init });
    sleptBefore.push(io.slept.length);
    return reply(url, init);
  };
  return { transfer: restTransfer(io, { accountId, apiToken: TOKEN }, databaseId), calls, slept: io.slept, sleptBefore };
}

async function failure(run: Promise<unknown>): Promise<CliError> {
  const error = await run.catch((thrown: unknown) => thrown);
  if (!(error instanceof CliError)) throw new Error(`expected a CliError, got ${String(error)}`);
  return error;
}

describe("restTransfer() — the export", () => {
  it("starts a polled export with the bearer token at the encoded database path", async () => {
    const { transfer, calls } = wire(() => exportReply({ status: "active", at_bookmark: "B" }));
    expect(await transfer.startExport(AT)).toBe("B");

    expect(calls[0]?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/d1/database/db%2F1/export");
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ output_format: "polling" });
  });

  it("polls a running export by its bookmark, and downloads the dump its signed URL serves", async () => {
    const { transfer, calls } = wire((url) =>
      url === SIGNED
        ? new Response("dump")
        : exportReply({ status: "complete", at_bookmark: "B", result: { filename: "d.sql", signed_url: SIGNED } }),
    );
    const opened = await transfer.openExport("B");

    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ output_format: "polling", current_bookmark: "B" });
    expect(await new Response(opened.body).text()).toBe("dump");
  });

  it("refuses an export D1 reports failed at its start", async () => {
    const { transfer } = wire(() => exportReply({ status: "error", error: "too big" }));
    expect((await failure(transfer.startExport(AT))).message).toBe("D1 refused to start the export: too big");
  });

  it("refuses a bookmark outside D1's grammar", async () => {
    const { transfer } = wire(() => exportReply({ status: "active", at_bookmark: "../x" }));
    const error = await failure(transfer.startExport(AT));
    expect([error.kind, error.message]).toEqual(["external", "D1 answered a bookmark outside its documented grammar"]);
  });

  it("refuses an export whose bookmark moves while it is polled", async () => {
    const { transfer } = wire(() => exportReply({ status: "active", at_bookmark: "other" }));
    expect((await failure(transfer.openExport("B"))).message).toBe("D1 moved the export's bookmark while it ran");
  });

  it("refuses a finished export at a bookmark other than the one polled, before any download", async () => {
    const { transfer, calls } = wire(() =>
      exportReply({ status: "complete", at_bookmark: "other", result: { filename: "d.sql", signed_url: SIGNED } }),
    );
    expect((await failure(transfer.openExport("B"))).message).toBe("D1 moved the export's bookmark while it ran");
    expect(calls.map((call) => call.url).includes(SIGNED)).toBe(false);
  });

  it("refuses an export D1 starts without naming its bookmark", async () => {
    const { transfer } = wire(() => exportReply({ status: "complete", result: { filename: "d.sql", signed_url: SIGNED } }));
    expect((await failure(transfer.startExport(AT))).message).toBe("D1 started the export without naming its bookmark");
  });

  it("waits a second on io.sleep before each repeat poll of a running export, and none before the first", async () => {
    const states = [{ status: "active", at_bookmark: "B" }, { status: "active", at_bookmark: "B" }, COMPLETE];
    let polled = 0;
    const { transfer, slept, sleptBefore } = wire((url) => (url === SIGNED ? new Response("dump") : exportReply(states[polled++])));
    await transfer.openExport("B");
    expect([slept, sleptBefore]).toEqual([
      [1000, 1000],
      [0, 1, 2, 2],
    ]);
  });

  it("refuses a signed URL that is not HTTPS", async () => {
    const plain = "http://d1-exports.example.com/dump.sql";
    const { transfer } = wire(() => exportReply({ status: "complete", at_bookmark: "B", result: { filename: "d.sql", signed_url: plain } }));
    expect((await failure(transfer.openExport("B"))).message).toBe("D1 answered a signed URL that is not HTTPS");
  });

  it("names the token's permission on an auth refusal, and the status on any other", async () => {
    for (const [status, permission] of [
      [401, true],
      [403, true],
      [404, false],
      [500, false],
    ] as const) {
      const { transfer } = wire(() => new Response("{}", { status }));
      const error = await failure(transfer.startExport(AT));
      expect([error.kind, error.message.includes(`HTTP ${status}`), error.message.includes(D1_WRITE_PERMISSION)]).toEqual([
        "external",
        true,
        permission,
      ]);
    }
  });

  it("refuses a reply that is not the documented shape, naming the operation, and a network failure", async () => {
    const messageOf = async (reply: () => Response | Promise<Response>) => (await failure(wire(reply).transfer.startExport(AT))).message;
    expect(await messageOf(() => exportReply({ status: "pending" }))).toContain("POST /accounts/{account_id}/d1/database/{database_id}/export");
    expect(await messageOf(() => new Response("<html>"))).toContain("Failed to parse response");
    expect(await messageOf(() => Promise.reject(new Error("reset")))).toBe("the D1 export request failed: network error");
  });

  it("never quotes the token or a signed URL in a refusal", async () => {
    const replies = [
      () => new Response(JSON.stringify({ message: TOKEN }), { status: 403 }),
      () => Response.json({ success: false, errors: [{ code: 7500, message: `bad ${TOKEN}` }], messages: [], result: null }, { status: 400 }),
      () => Response.json({ success: false, errors: [{ code: 7500, message: `bad ${TOKEN}` }], messages: [], result: null }),
      () => exportReply({ status: "complete", result: { signed_url: SIGNED } }),
    ];
    for (const reply of replies) {
      const error = await failure(wire(reply).transfer.openExport("B"));
      expect([error.message.includes(TOKEN), error.message.includes("X-Amz-Signature")]).toEqual([false, false]);
    }
  });

  it("names an envelope error by its status and code alone", async () => {
    const error = await failure(
      wire(() =>
        Response.json({ success: false, errors: [{ code: 7500, message: `bad ${TOKEN}` }], messages: [], result: null }, { status: 400 }),
      ).transfer.startExport(AT),
    );
    expect(error.message).toBe("the D1 export request failed: HTTP 400, Cloudflare error 7500");
  });

  it("never quotes a network failure's own text, which can carry the token, on any D1 request", async () => {
    const target = { databaseId: "db", name: "db" };
    const source = () => ({ body: new Response("x").body ?? new ReadableStream(), size: 1, md5: "m" });
    const requests: [string, (transfer: D1Transfer) => Promise<unknown>][] = [
      ["export", (transfer) => transfer.startExport(AT)],
      ["export", (transfer) => transfer.openExport("B")],
      ["database get", (transfer) => transfer.openTarget({ standby: "s" })],
      ["import", (transfer) => transfer.startImport(target, source())],
      ["import", (transfer) => transfer.pollImport(target, "B")],
      ["query", (transfer) => transfer.query(target, "SELECT 1")],
    ];
    for (const [what, run] of requests) {
      const error = await failure(run(wire(() => Promise.reject(new Error(`connect refused for Bearer ${TOKEN}`))).transfer));
      expect([error.kind, error.message]).toEqual(["external", `the D1 ${what} request failed: network error`]);
    }
  });

  it("fails a download that never connects without quoting the signed URL", async () => {
    const { transfer } = wire((url) => (url === SIGNED ? Promise.reject(new Error(`reset ${SIGNED}`)) : exportReply(COMPLETE)));
    expect((await failure(transfer.openExport("B"))).message).toBe("downloading the D1 export failed: network error");
  });

  it("fails a refused download naming the status, not the URL", async () => {
    const { transfer } = wire((url) =>
      url === SIGNED
        ? new Response("denied", { status: 403 })
        : exportReply({ status: "complete", at_bookmark: "B", result: { filename: "d.sql", signed_url: SIGNED } }),
    );
    const error = await failure(transfer.openExport("B"));
    expect([error.message.includes("HTTP 403"), error.message.includes("X-Amz-Signature")]).toEqual([true, false]);
  });
});

describe("restTransfer() — the target", () => {
  it("answers the name the API returns for a standby, not its id, read by a GET with no body", async () => {
    const { transfer, calls } = wire(() => exportReply({ uuid: "uuid-standby", name: "app-db-standby" }));
    const target = await transfer.openTarget({ standby: "uuid-standby" });

    expect(target).toEqual({ databaseId: "uuid-standby", name: "app-db-standby" });
    expect([calls[0]?.url, calls[0]?.init?.method, calls[0]?.init?.body]).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/acct/d1/database/uuid-standby",
      "GET",
      undefined,
    ]);
  });

  it("refuses a missing standby on the database read, before any import call", async () => {
    const { transfer, calls } = wire(() => new Response("{}", { status: 404 }));
    const error = await failure(transfer.openTarget({ standby: "uuid-standby" }));

    expect([error.kind, error.message.includes("HTTP 404")]).toEqual(["external", true]);
    expect(calls.map((call) => call.url)).toEqual(["https://api.cloudflare.com/client/v4/accounts/acct/d1/database/uuid-standby"]);
  });

  const LISTED = () => Response.json({ success: true, errors: [], result: [{ uuid: "uuid-existing", name: "app-db-restore" }] });

  it("refuses a 4xx create without listing, even where one database of that name exists", async () => {
    const { transfer, calls } = wire((_url, init) => (init?.method === "POST" ? new Response("{}", { status: 409 }) : LISTED()));
    const error = await failure(transfer.openTarget({ fresh: "app-db-restore" }));

    expect([error.message.includes("HTTP 409"), calls.map((call) => call.init?.method)]).toEqual([true, ["POST"]]);
  });

  it("adopts the one database of that name a create whose reply was lost already made", async () => {
    for (const create of [() => Promise.reject(new Error("reset")), () => new Response("{}", { status: 502 })]) {
      const { transfer, calls } = wire((_url, init) => (init?.method === "POST" ? create() : LISTED()));
      expect(await transfer.openTarget({ fresh: "app-db-restore" })).toEqual({ databaseId: "uuid-existing", name: "app-db-restore" });
      expect(calls.map((call) => call.init?.method)).toEqual(["POST", "GET"]);
    }
  });

  it("creates a fresh target by posting its name to the account's databases, answering the id D1 assigns", async () => {
    const { transfer, calls } = wire(() => exportReply({ uuid: "uuid-new", name: "app-db-restore" }));
    expect(await transfer.openTarget({ fresh: "app-db-restore" })).toEqual({ databaseId: "uuid-new", name: "app-db-restore" });
    expect([calls[0]?.url, calls[0]?.init?.method, JSON.parse(String(calls[0]?.init?.body))]).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/acct/d1/database",
      "POST",
      { name: "app-db-restore" },
    ]);
  });

  it("looks a lost create up by its encoded name, and refuses it unless exactly one database answers to that name", async () => {
    const one = { uuid: "uuid-1", name: "app&db" };
    for (const listed of [[], [one, { uuid: "uuid-2", name: "app&db" }], [{ uuid: "uuid-3", name: "app&db-other" }]]) {
      const { transfer, calls } = wire((_url, init) =>
        init?.method === "POST" ? new Response("{}", { status: 502 }) : Response.json({ success: true, errors: [], result: listed }),
      );
      const error = await failure(transfer.openTarget({ fresh: "app&db" }));
      expect([error.kind, error.message.startsWith("the D1 database create request failed: "), error.message.includes("HTTP 502")]).toEqual([
        "external",
        true,
        true,
      ]);
      expect(new URL(calls[1]?.url ?? "").searchParams.get("name")).toBe("app&db");
    }
  });
});

describe("restTransfer() — the query", () => {
  it("posts the statement with the bearer token under the encoded account, and answers its rows", async () => {
    const { transfer, calls } = wire(() => exportReply([{ results: [{ ok: 1 }], success: true }]), "unused", "acct/1");
    const rows = await transfer.query({ databaseId: "db/1", name: "db" }, "SELECT 1");

    expect(rows).toEqual([{ ok: 1 }]);
    expect(calls[0]?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct%2F1/d1/database/db%2F1/query");
    expect([calls[0]?.init?.method, new Headers(calls[0]?.init?.headers).get("Authorization")]).toEqual(["POST", `Bearer ${TOKEN}`]);
  });
});

describe("restTransfer() — the import", () => {
  it("sends the init once, since D1 begins work at it", async () => {
    const { transfer, calls } = wire(() => new Response("{}", { status: 503 }));
    await failure(
      transfer.startImport({ databaseId: "db", name: "db" }, { body: new Response("x").body ?? new ReadableStream(), size: 1, md5: "m" }),
    );
    expect(calls.length).toBe(1);
  });

  const MD5 = "9e107d9d372bb6826bd81d3542a419d6";
  const UPLOAD = "https://upload.example.com/put?sig=secret";
  const TARGET = { databaseId: "db", name: "db" };

  function tracked(text = "dump"): { body: ReadableStream<Uint8Array>; size: number; md5: string; cancelled: () => boolean } {
    let cancelled = false;
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({ start: (controller) => controller.enqueue(bytes), cancel: () => void (cancelled = true) });
    return { body, size: bytes.byteLength, md5: MD5, cancelled: () => cancelled };
  }

  function importer(put: (init?: RequestInit) => Response | Promise<Response>, uploadUrl = UPLOAD) {
    return wire((url, init) => {
      if (url === uploadUrl) return put(init);
      const action = (JSON.parse(String(init?.body)) as { action: string }).action;
      return action === "init"
        ? exportReply({ upload_url: uploadUrl, filename: "secret-file.sql" })
        : exportReply({ success: true, status: "active", at_bookmark: "B-import" });
    });
  }

  it("skips the upload when D1 already holds a file with the dump's md5, releasing the dump unread", async () => {
    const source = tracked();
    const { transfer, calls } = wire(() => exportReply({ success: true, status: "active", at_bookmark: "B-import" }));
    expect(await transfer.startImport(TARGET, source)).toEqual({ status: "active", bookmark: "B-import" });
    expect([calls.length, JSON.parse(String(calls[0]?.init?.body)), source.cancelled()]).toEqual([1, { action: "init", etag: MD5 }, true]);
  });

  it("puts the dump at its announced length, then ingests the uploaded file under the dump's md5", async () => {
    const { transfer, calls } = importer(() => new Response(null, { headers: { etag: `"${MD5}"` } }));
    expect(await transfer.startImport(TARGET, tracked())).toEqual({ status: "active", bookmark: "B-import" });
    expect([calls[1]?.init?.method, new Headers(calls[1]?.init?.headers).get("Content-Length"), JSON.parse(String(calls[2]?.init?.body))]).toEqual([
      "PUT",
      "4",
      { action: "ingest", etag: MD5, filename: "secret-file.sql" },
    ]);
  });

  it("refuses an upload that cannot be trusted to be the dump, never quoting the upload URL or the file's name, and never ingests it", async () => {
    const cases: [ReturnType<typeof importer>, string][] = [
      [importer(() => new Response(null), "http://upload.example.com/put?sig=secret"), "D1 answered an upload URL that is not HTTPS"],
      [importer(() => Promise.reject(new Error(`reset ${UPLOAD}`))), "uploading the dump to D1's import store failed: network error"],
      [importer(() => new Response(null, { status: 403 })), "uploading the dump to D1's import store failed (HTTP 403)"],
      [
        importer(() => new Response(null, { headers: { etag: '"0cc175b9c0f1b6a831c399e269772661"' } })),
        "D1's import store answered an etag other than the dump's md5, so the upload is not the dump",
      ],
    ];
    for (const [{ transfer, calls }, message] of cases) {
      const error = await failure(transfer.startImport(TARGET, tracked()));
      expect([error.kind, error.message]).toEqual(["external", message]);
      expect(calls.some((call) => String(call.init?.body).includes('"ingest"'))).toBe(false);
    }
  });

  it("waits a second on io.sleep before polling a running import by its bookmark", async () => {
    const { transfer, calls, slept, sleptBefore } = wire(() =>
      exportReply({ success: true, status: "complete", result: { num_queries: 2, final_bookmark: "B-final" } }),
    );
    expect(await transfer.pollImport(TARGET, "B-import")).toEqual({ status: "complete", bookmark: "B-final", queries: 2 });
    expect([slept, sleptBefore, JSON.parse(String(calls[0]?.init?.body))]).toEqual([[1000], [1], { action: "poll", current_bookmark: "B-import" }]);
  });

  it("names the token's permission when D1 refuses the import's credentials", async () => {
    const { transfer } = wire(() => new Response("{}", { status: 403 }));
    const error = await failure(transfer.pollImport(TARGET, "B-import"));
    expect(error.message.endsWith(` — the --api-token needs ${D1_WRITE_PERMISSION}`)).toBe(true);
  });
});

const reply = (over: Record<string, unknown>) => ({ success: true, errors: [], ...over });

describe("readImportState()", () => {
  it("reads a running import by its bookmark, and a finished one by its final bookmark and query count", () => {
    expect(readImportState(reply({ status: "active", at_bookmark: "B1" }))).toEqual({ status: "active", bookmark: "B1" });
    expect(readImportState(reply({ status: "complete", result: { num_queries: 4, final_bookmark: "B2" } }))).toEqual({
      status: "complete",
      bookmark: "B2",
      queries: 4,
    });
  });

  it("reads a refused or failed import as an error, with D1's own words", () => {
    expect(readImportState(reply({ success: false, error: "too big" }))).toEqual({ status: "error", error: "too big" });
    expect(readImportState(reply({ status: "error", errors: ["a", "b"] }))).toEqual({ status: "error", error: "a; b" });
  });

  it("refuses a running import with no bookmark, or one outside D1's grammar", () => {
    for (const bad of [reply({ status: "active" }), reply({ status: "active", at_bookmark: "../x" })]) {
      expect(() => readImportState(bad)).toThrow(CliError);
    }
  });

  it("reads a failure D1 gives no words for as having no detail", () => {
    expect(readImportState(reply({ status: "error" }))).toEqual({ status: "error", error: "no detail" });
  });

  it("reads a finished import that names no final bookmark or count as holding neither", () => {
    expect(readImportState(reply({ status: "complete" }))).toEqual({ status: "complete", bookmark: null, queries: 0 });
  });

  it("refuses a finished import whose final bookmark is outside D1's grammar", () => {
    const error = (() => {
      try {
        return readImportState(reply({ status: "complete", result: { final_bookmark: "../x" } }));
      } catch (thrown) {
        return thrown;
      }
    })();
    expect([error instanceof CliError, (error as CliError).kind]).toEqual([true, "external"]);
  });
});
