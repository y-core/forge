import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { D1BackupSidecar } from "../../../storage/backup/types";
import type { D1RestoreReport } from "../../../storage/backup/types";
import { execute } from "../../cli/execute";
import { createDbCommands } from "../commands";
import { bufferedIO, cfEnvelope, cfRefusal, fakeDbIo, minimalWranglerConfig, REMOTE_ARGS } from "../db.fixture";
import type { DbConfig, FakeDbIo } from "../types";
import {
  BACKUP_WORKFLOW as BACKUP,
  describeRestore,
  describeSidecar,
  resolveWorkflow,
  devSessionWorkflowRoute,
  RESTORE_WORKFLOW as RESTORE,
  WORKFLOW_POLL_MS,
  WORKFLOW_WAIT_MS,
} from "./workflow";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const BACKUP_WORKFLOW = { name: "d1-backup", binding: "D1_BACKUP", class_name: "D1Backup" };

const SIDECAR: D1BackupSidecar = {
  key: "d1-backups/0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a/2026-11-02T03:00:00.000Z-B1.sql",
  databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
  bookmark: "B1",
  takenAt: "2026-11-02T03:00:00.000Z",
  size: 120,
  md5: "0".repeat(32),
  sha256: "1".repeat(64),
  schemaDigest: "2".repeat(64),
  migrationHead: "0002_users.sql",
  rows: { users: 2, notes: 0 },
  hazards: [],
};

function appRoot(workflows: unknown[] = [BACKUP_WORKFLOW]): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-workflow-"));
  roots.push(root);
  const written = minimalWranglerConfig(root, { workflows });
  writeFileSync(written.path, written.text);
  return root;
}

function config(workflows: unknown[] | undefined, env: string | null = null, envWorkflows?: unknown[]): DbConfig {
  return {
    configPath: "/app/wrangler.jsonc",
    env,
    config: { name: "app", workflows, env: envWorkflows === undefined ? {} : { staging: { workflows: envWorkflows } } },
  } as unknown as DbConfig;
}

/** Answers the instance-create POST with `i-1`, then each read with the next of `states`, the last repeating. */
function instances(io: FakeDbIo, base: string, states: unknown[]): void {
  let read = 0;
  io.restRules.push(
    { match: (url, init) => url === base && init?.method === "POST", reply: () => cfEnvelope({ id: "i-1" }) },
    { match: (url) => url === `${base}/i-1`, reply: () => cfEnvelope(states[Math.min(read++, states.length - 1)]) },
  );
}

async function runCli(io: FakeDbIo, argv: string[]): Promise<{ out: string[]; err: string[]; code: number | null }> {
  const buffer = bufferedIO();
  try {
    await execute(createDbCommands({ io }), argv, buffer);
  } catch {
    // `bufferedIO().exit` throws so a failing run stops here rather than ending the process.
  }
  return buffer;
}

const LOCAL = "http://localhost:8787/cdn-cgi/local/explorer/api/workflows/d1-backup/instances";
const REMOTE = "https://api.cloudflare.com/client/v4/accounts/acct/workflows/d1-backup/instances";

describe("resolveWorkflow()", () => {
  it("takes the config's only Workflow, skipping one bound from another script", () => {
    expect(resolveWorkflow(config([BACKUP_WORKFLOW, { ...BACKUP_WORKFLOW, name: "other", script_name: "w" }]), undefined, BACKUP)).toBe(
      "d1-backup",
    );
  });

  it("takes a named Workflow by its name or its binding", () => {
    const two = config([BACKUP_WORKFLOW, { name: "mail", binding: "MAIL", class_name: "Mail" }]);
    expect([resolveWorkflow(two, "d1-backup", BACKUP), resolveWorkflow(two, "D1_BACKUP", BACKUP)]).toEqual(["d1-backup", "d1-backup"]);
  });

  it("reads an environment's own Workflows, which wrangler does not inherit", () => {
    expect(resolveWorkflow(config([BACKUP_WORKFLOW], "staging", [{ ...BACKUP_WORKFLOW, name: "d1-backup-staging" }]), undefined, BACKUP)).toBe(
      "d1-backup-staging",
    );
    expect(() => resolveWorkflow(config([BACKUP_WORKFLOW], "staging", []), undefined, BACKUP)).toThrow("(env staging) declares no Workflow");
  });

  it("takes the conventional name among several, d1-restore for a restore", () => {
    const both = config([BACKUP_WORKFLOW, { name: "d1-restore", binding: "D1_RESTORE", class_name: "D1Restore" }]);
    expect([resolveWorkflow(both, undefined, BACKUP), resolveWorkflow(both, undefined, RESTORE)]).toEqual(["d1-backup", "d1-restore"]);
  });

  it("refuses none, several with no conventional name and no --workflow, and an unknown name, listing what is declared", () => {
    expect(() => resolveWorkflow(config(undefined), undefined, BACKUP)).toThrow(
      "declares no Workflow — add d1-backup, whose run() returns runD1Backup's sidecar",
    );
    const other = config([
      { ...BACKUP_WORKFLOW, name: "nightly" },
      { name: "mail", binding: "MAIL", class_name: "Mail" },
    ]);
    expect(() => resolveWorkflow(other, undefined, BACKUP)).toThrow("none named d1-backup — pass --workflow, one of nightly, mail");
    expect(() => resolveWorkflow(other, "nope", BACKUP)).toThrow("declares no Workflow named nope — declared: nightly, mail");
  });
});

describe("describeSidecar()", () => {
  it("names the key, size, bookmark, migration head and rows", () => {
    expect(describeSidecar(SIDECAR)).toEqual([
      `✓ ${SIDECAR.key}`,
      "  120 bytes at bookmark B1, migration head 0002_users.sql",
      "  rows: users 2, notes 0",
    ]);
  });

  it("warns of each hazard and names the exact restore Time Travel still offers", () => {
    const lines = describeSidecar({ ...SIDECAR, hazards: [{ table: "users", column: "bio", kind: "escape", count: 2 }] });
    expect(lines.slice(3)).toEqual([
      "  ! users.bio: 2 text value(s) holding a \\n or \\r escape beside a real newline or carriage return, which D1's dumper doubles",
      "  ! the dump will not reproduce these — forge db bookmark restore --bookmark B1 restores them exactly while Time Travel keeps that bookmark",
    ]);
  });

  it("says no exact restore exists for a local dump, which has no Time Travel", () => {
    const lines = describeSidecar({ ...SIDECAR, bookmark: "local-1", hazards: [{ table: "t", column: null, kind: "unscanned", count: 0 }] });
    expect(lines.slice(3)).toEqual([
      "  ! t: not scanned for hazards, because the scan failed",
      "  ! the dump will not reproduce these — local D1 keeps no Time Travel, so no exact restore exists",
    ]);
  });
});

describe("forge db backup", () => {
  it("starts the Workflow through the local dev session, follows it to complete, and prints its sidecar", async () => {
    const io = fakeDbIo();
    instances(io, LOCAL, [{ status: "running" }, { status: "complete", output: SIDECAR, error: null }]);
    const buffer = await runCli(io, ["backup", "--root", appRoot()]);

    expect(buffer.code).toBeNull();
    expect(buffer.out).toContain(`✓ ${SIDECAR.key}`);
    expect(io.restCalls.map((call) => [call.method, call.url])).toEqual([
      ["POST", LOCAL],
      ["GET", `${LOCAL}/i-1`],
      ["GET", `${LOCAL}/i-1`],
    ]);
    expect(io.slept).toEqual([WORKFLOW_POLL_MS]);
  });

  it("starts a deployed database's Workflow through the Cloudflare API, and prints JSON on --json", async () => {
    const io = fakeDbIo();
    instances(io, REMOTE, [{ status: "complete", output: SIDECAR }]);
    const buffer = await runCli(io, ["backup", "--root", appRoot(), "--target", "remote", ...REMOTE_ARGS, "--json"]);

    expect(JSON.parse(buffer.out.at(-1) ?? "")).toEqual({ instance: "i-1", sidecar: SIDECAR });
    expect(io.restCalls[0]?.headers.authorization).toBe("Bearer tok");
  });

  it("refuses a sidecar of another database than the target, naming both ids", async () => {
    const io = fakeDbIo();
    instances(io, REMOTE, [{ status: "complete", output: { ...SIDECAR, databaseId: "other-db-id" } }]);
    const buffer = await runCli(io, ["backup", "--root", appRoot(), "--target", "remote", ...REMOTE_ARGS]);
    expect(buffer.code).not.toBeNull();
    expect(buffer.err.join("\n")).toContain(
      `i-1 dumped database other-db-id, not app-db (${SIDECAR.databaseId}) — the Workflow is wired to another database`,
    );
  });

  it("reaches the dev session on --port", async () => {
    const io = fakeDbIo();
    instances(io, LOCAL.replace("8787", "8790"), [{ status: "complete", output: SIDECAR }]);
    expect((await runCli(io, ["backup", "--root", appRoot(), "--port", "8790"])).code).toBeNull();
  });

  it("exits non-zero with the instance's own error when it fails", async () => {
    const io = fakeDbIo();
    instances(io, REMOTE, [{ status: "errored", error: { name: "Error", message: "D1's export refuses virtual tables" } }]);
    const buffer = await runCli(io, ["backup", "--root", appRoot(), "--target", "remote", ...REMOTE_ARGS]);
    expect(buffer.code).not.toBeNull();
    expect(buffer.err.join("\n")).toContain("d1-backup instance i-1 errored: D1's export refuses virtual tables");
  });

  it("refuses a run whose Workflow returns no sidecar, naming the fix", async () => {
    const io = fakeDbIo();
    instances(io, LOCAL, [{ status: "complete", output: null }]);
    const buffer = await runCli(io, ["backup", "--root", appRoot()]);
    expect(buffer.err.join("\n")).toContain("finished without returning runD1Backup's sidecar from run()");
  });

  it("hands back the instance id once it has followed it for the whole wait", async () => {
    const io = fakeDbIo();
    instances(io, LOCAL, [{ status: "running" }]);
    const buffer = await runCli(io, ["backup", "--root", appRoot()]);
    expect(buffer.err.join("\n")).toContain(`d1-backup instance i-1 is still running after ${WORKFLOW_WAIT_MS / 60_000} minutes; it keeps running`);
  });

  it("names `forge cf dev` when no dev session answers", async () => {
    const io = fakeDbIo();
    io.restRules.push({
      match: () => true,
      reply: () => {
        throw new TypeError("fetch failed");
      },
    });
    const buffer = await runCli(io, ["backup", "--root", appRoot()]);
    expect(buffer.err.join("\n")).toContain("nothing answered on port 8787 — start the app with `forge cf dev`");
  });

  it("fails a dev session that accepts the request and never answers, within the request timeout", async () => {
    const io = fakeDbIo();
    io.fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    const route = devSessionWorkflowRoute(io, 8787, 20);
    await expect(route.read("d1-backup", "i-1")).rejects.toThrow("the dev session on port 8787 did not answer within 0.02 s");
    await expect(route.create("d1-backup", {})).rejects.toThrow(
      "got no answer, so an instance may have started — check `wrangler workflows instances list d1-backup --local --port 8787`",
    );
  });

  it("says an instance may have started when the Cloudflare API drops the create", async () => {
    const io = fakeDbIo();
    io.restRules.push({
      match: () => true,
      reply: () => {
        throw new TypeError("socket hang up");
      },
    });
    const buffer = await runCli(io, ["backup", "--root", appRoot(), "--target", "remote", ...REMOTE_ARGS]);
    expect(buffer.err.join("\n")).toContain("starting the d1-backup Workflow got no answer, so an instance may have started");
    expect(io.restCalls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("refuses a Workflow entry with no name when it reads the config, before any request", async () => {
    const io = fakeDbIo();
    const buffer = await runCli(io, ["backup", "--root", appRoot([{ binding: "D1_BACKUP", class_name: "D1Backup" }])]);
    expect([buffer.err.join("\n").includes("workflows"), io.restCalls.length]).toEqual([true, 0]);
  });

  it("passes on the dev session's refusal", async () => {
    const io = fakeDbIo();
    io.restRules.push({ match: () => true, reply: () => cfRefusal(10501, "Workflow 'd1-backup' not found.", 404) });
    const buffer = await runCli(io, ["backup", "--root", appRoot()]);
    expect(buffer.err.join("\n")).toContain("the dev session on port 8787 refused: Workflow 'd1-backup' not found.");
  });

  it("refuses a config with no Workflow and a bad port before any request", async () => {
    for (const [argv, message] of [
      [[], "declares no Workflow"],
      [["--port", "99999"], "--port takes a TCP port, not 99999"],
    ] as const) {
      const io = fakeDbIo();
      const buffer = await runCli(io, ["backup", "--root", appRoot([]), ...argv]);
      expect([buffer.err.join("\n").includes(message), io.restCalls.length]).toEqual([true, 0]);
    }
  });
});

const REPORT: D1RestoreReport = { databaseId: "uuid-r", name: "app-db-restore", key: SIDECAR.key, bookmark: "B9", queries: 4, mismatches: [] };

const LOCAL_RESTORE = "http://localhost:8787/cdn-cgi/local/explorer/api/workflows/d1-restore/instances";
const REMOTE_RESTORE = "https://api.cloudflare.com/client/v4/accounts/acct/workflows/d1-restore/instances";
const BOTH = [BACKUP_WORKFLOW, { name: "d1-restore", binding: "D1_RESTORE", class_name: "D1Restore" }];

describe("describeRestore()", () => {
  it("says the restored database holds what the sidecar recorded, or lists each mismatch", () => {
    expect(describeRestore(REPORT)).toEqual([
      `✓ restored ${SIDECAR.key} into app-db-restore (uuid-r) at bookmark B9`,
      "  it holds what the dump's sidecar recorded",
    ]);
    expect(describeRestore({ ...REPORT, bookmark: null, mismatches: ["notes holds 1 rows, but the dump holds 2"] })).toEqual([
      `✗ restored ${SIDECAR.key} into app-db-restore (uuid-r), but it differs from the dump's sidecar:`,
      "  ! notes holds 1 rows, but the dump holds 2",
    ]);
  });
});

describe("forge db restore --from", () => {
  it("starts d1-restore on a deployed database with the key, into a fresh database by default", async () => {
    const io = fakeDbIo();
    instances(io, REMOTE_RESTORE, [{ status: "complete", output: REPORT }]);
    const buffer = await runCli(io, ["restore", "--root", appRoot(BOTH), "--target", "remote", ...REMOTE_ARGS, "--from", SIDECAR.key]);

    expect(buffer.code).toBeNull();
    expect(JSON.parse(io.restCalls[0]?.body ?? "")).toEqual({ params: { key: SIDECAR.key } });
    expect(buffer.out).toContain(`✓ restored ${SIDECAR.key} into app-db-restore (uuid-r) at bookmark B9`);
  });

  it("names the standby locally, through the dev session", async () => {
    const io = fakeDbIo();
    instances(io, LOCAL_RESTORE, [{ status: "complete", output: REPORT }]);
    const buffer = await runCli(io, ["restore", "--root", appRoot(BOTH), "--from", SIDECAR.key, "--into", "standby:STANDBY", "--json"]);

    expect(JSON.parse(io.restCalls[0]?.body ?? "")).toEqual({ params: { key: SIDECAR.key, standby: "STANDBY" } });
    expect(JSON.parse(buffer.out.at(-1) ?? "")).toEqual({ instance: "i-1", report: REPORT });
  });

  it("prints every mismatch and exits non-zero, saying the live database is untouched", async () => {
    const io = fakeDbIo();
    instances(io, REMOTE_RESTORE, [{ status: "complete", output: { ...REPORT, mismatches: ["the migration head is none"] } }]);
    const buffer = await runCli(io, ["restore", "--root", appRoot(BOTH), "--target", "remote", ...REMOTE_ARGS, "--from", SIDECAR.key]);

    expect(buffer.out).toContain("  ! the migration head is none");
    expect(buffer.code).not.toBeNull();
    expect(buffer.err.join("\n")).toContain("app-db-restore differs from the dump's sidecar; the live database is untouched");
  });

  it("refuses a fresh target locally, a bad --into, and no --from, before any request", async () => {
    for (const [argv, message] of [
      [["--from", "k.sql"], "a dev session cannot create a database — pass --into standby:<id>"],
      [["--from", "k.sql", "--into", "elsewhere"], "--into takes fresh or standby:<id>, not elsewhere"],
      [[], "--from"],
    ] as const) {
      const io = fakeDbIo();
      const buffer = await runCli(io, ["restore", "--root", appRoot(BOTH), ...argv]);
      expect([buffer.err.join("\n").includes(message), io.restCalls.length]).toEqual([true, 0]);
    }
  });
});
