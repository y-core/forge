import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CliContext } from "../cli/types";
import { createColorize, PLAIN } from "../term/color";
import { confirmPrinter, DEFAULT_DB_CONFIG, resolveDbContext, sharedDbFlags } from "./context";
import { fakeDbIo, minimalWranglerConfig } from "./db.fixture";
import type { SharedDbFlags } from "./types";

const roots: string[] = [];

function appRoot(hostConfig?: string): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-context-"));
  roots.push(root);
  const { path, text } = minimalWranglerConfig(root);
  writeFileSync(path, text, "utf-8");
  if (hostConfig !== undefined) {
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, DEFAULT_DB_CONFIG), hostConfig, "utf-8");
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function flags(over: Partial<SharedDbFlags> & { root: string }): SharedDbFlags {
  return { target: "local", db: undefined, config: "wrangler.jsonc", env: undefined, json: false, yes: false, ...over };
}

describe("resolveDbContext()", () => {
  it("resolves the config and the home of the target, and prints through the context's stdout", async () => {
    const root = appRoot();
    const io = fakeDbIo();
    const printed: string[] = [];
    const ctx: CliContext = {
      io: { stdout: (msg) => printed.push(msg), stderr: () => undefined, exit: (() => undefined) as unknown as (code: number) => never },
      out: PLAIN,
      err: PLAIN,
      width: 80,
    };
    const run = await resolveDbContext(flags({ root }), ctx, { io });
    run.print("one line");
    expect([run.config.root, run.home.label, run.home.dir, run.io === io, printed]).toEqual([root, "local", root, true, ["one line"]]);
  });

  it("styles a --json run plainly, whatever the terminal supports", async () => {
    const root = appRoot();
    const coloured = createColorize(3);
    const ctx: CliContext = {
      io: { stdout: () => undefined, stderr: () => undefined, exit: (() => undefined) as unknown as (code: number) => never },
      out: coloured,
      err: coloured,
      width: 80,
    };
    const json = await resolveDbContext(flags({ root, json: true }), ctx, { io: fakeDbIo() });
    const report = await resolveDbContext(flags({ root, json: false }), ctx, { io: fakeDbIo() });
    expect([json.json, json.style === PLAIN, report.json, report.style === coloured]).toEqual([true, true, false, true]);
  });

  it("styles plainly when there is no terminal context at all", async () => {
    const run = await resolveDbContext(flags({ root: appRoot() }), undefined, { io: fakeDbIo() });
    expect(run.style === PLAIN).toBe(true);
  });

  it("carries --yes through, so a destructive verb knows it was permitted", async () => {
    const root = appRoot();
    const permitted = await resolveDbContext(flags({ root, yes: true }), undefined, { io: fakeDbIo() });
    const asked = await resolveDbContext(flags({ root }), undefined, { io: fakeDbIo() });
    expect([permitted.yes, asked.yes]).toEqual([true, false]);
  });

  it("gives a standby target a generated home, written through the injected I/O", async () => {
    const root = appRoot();
    const io = fakeDbIo();
    const run = await resolveDbContext(flags({ root, target: "standby" }), undefined, { io });
    expect([run.home.label, run.home.database, run.home.dir, run.home.synthesized]).toEqual([
      "standby",
      "app-db-standby",
      join(root, ".forge", "standby", "app-db-standby"),
      true,
    ]);
    expect(io.files.has(join(root, ".forge", "standby", "app-db-standby", "wrangler.jsonc"))).toBe(true);
  });

  it("loads the host config from config/db.ts under the root", async () => {
    const run = await resolveDbContext(flags({ root: appRoot('export default { seeds: ["fixtures/seeds"] };\n') }), undefined, { io: fakeDbIo() });
    expect(run.host).toEqual({ seeds: ["fixtures/seeds"] });
  });

  it("refuses a host config whose field is the wrong shape, naming the file and the field", async () => {
    const bare = appRoot('export default { schemas: "schema.sql" };\n');
    await expect(resolveDbContext(flags({ root: bare }), undefined, { io: fakeDbIo() })).rejects.toThrow(
      'config/db.ts: schemas: Invalid type: Expected Array but received "schema.sql"',
    );

    const typo = appRoot('export default { seedsDir: "fixtures/seeds" };\n');
    await expect(resolveDbContext(flags({ root: typo }), undefined, { io: fakeDbIo() })).rejects.toThrow("config/db.ts: seedsDir: Invalid key");
  });

  it("is an empty host config when the app declares none", async () => {
    const run = await resolveDbContext(flags({ root: appRoot() }), undefined, { io: fakeDbIo() });
    expect(run.host).toEqual({});
  });

  it("takes the host config an override supplies instead of reading the file", async () => {
    const root = appRoot('export default { seedsDir: "fixtures/seeds" };\n');
    const run = await resolveDbContext(flags({ root }), undefined, { io: fakeDbIo(), host: { backupsDir: "tmp/backups" } });
    expect(run.host).toEqual({ backupsDir: "tmp/backups" });
  });

  it("resolves the root before anything is read from it", async () => {
    const root = appRoot();
    const run = await resolveDbContext(flags({ root: join(root, "migrations", "..") }), undefined, { io: fakeDbIo() });
    expect([run.config.root, run.config.configPath]).toEqual([root, join(root, "wrangler.jsonc")]);
  });

  it("refuses a target the config cannot serve", async () => {
    const root = appRoot();
    await expect(resolveDbContext(flags({ root, target: "preview" }), undefined, { io: fakeDbIo() })).rejects.toThrow(
      "preview is refused while wrangler.jsonc has no preview_database_id — run `forge cf sync --commit` to provision it, then retry",
    );
  });
});

describe("confirmPrinter()", () => {
  it("sends a confirmation to stderr under --json, so stdout stays the one JSON document, and to stdout otherwise", async () => {
    const root = appRoot();
    const io = fakeDbIo();
    const printed: string[] = [];
    const ctx: CliContext = {
      io: { stdout: (msg) => printed.push(msg), stderr: () => undefined, exit: (() => undefined) as unknown as (code: number) => never },
      out: PLAIN,
      err: PLAIN,
      width: 80,
    };
    confirmPrinter(await resolveDbContext(flags({ root, json: true }), ctx, { io }))("About to restore");
    confirmPrinter(await resolveDbContext(flags({ root }), ctx, { io }))("About to reset");
    expect([io.logs, printed]).toEqual([["About to restore"], ["About to reset"]]);
  });
});

describe("sharedDbFlags", () => {
  it("defaults the target to the app's own local database and the config to wrangler.jsonc", () => {
    expect([sharedDbFlags.target.default, sharedDbFlags.config.default, sharedDbFlags.target.short, sharedDbFlags.config.short]).toEqual([
      "local",
      "wrangler.jsonc",
      "t",
      "c",
    ]);
  });

  it("declares json and yes as boolean flags, and db, env and root as strings", () => {
    expect([sharedDbFlags.json.type, sharedDbFlags.yes.type, sharedDbFlags.db.type, sharedDbFlags.env.type, sharedDbFlags.root.type]).toEqual([
      "boolean",
      "boolean",
      "string",
      "string",
      "string",
    ]);
  });
});

describe("DEFAULT_DB_CONFIG", () => {
  it("is the path an app puts its db host config at", () => {
    expect(DEFAULT_DB_CONFIG).toBe("config/db.ts");
  });
});
