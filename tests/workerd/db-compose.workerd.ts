import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import type { DbRunContext } from "../../src/tooling/db/types";
import { type D1Handle, openD1 } from "./d1";

const FORGE = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = join(FORGE, "tests", "fixtures", "db-compose");
const BIN = join(FORGE, "src", "tooling", "root", "bin.ts");

interface Case {
  /** A second schema `config/db.ts` declares for the before state and no longer declares for the after one. */
  lib?: string;
  seed: string;
  after?: string;
  /** Extra compose flags; the token `<digest>` is replaced with the digest the refusal printed. */
  args?: string[];
  refusedWithout?: string;
  /** When set, the after state must be refused with this text, and nothing downstream of the compose runs. */
  composeRefused?: string;
  expectSql?: string[];
  expectStdout?: string[];
  /** When set, the second compose must write no migration. */
  expectNoMigration?: boolean;
  /** When set, the second migrate must fail on the seeded rows with this text, which hold a value the proof's own seeded row does not. */
  migrateFails?: string;
  query: string;
  rows: Record<string, unknown>[];
}

interface Step {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function forgeDb(root: string, args: string[]): Promise<Step> {
  const child = spawn("bun", ["run", BIN, "db", ...args, "--root", root], { cwd: FORGE });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf-8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf-8")));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr })));
}

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-compose-"));
  cpSync(join(FIXTURE, "wrangler.jsonc"), join(root, "wrangler.jsonc"));
  mkdirSync(join(root, "config"));
  declare(root, ["schema.sql"]);
  return root;
}

function declare(root: string, schemas: readonly string[]): void {
  writeFileSync(join(root, "config", "db.ts"), `export default { schemas: ${JSON.stringify(schemas)} };\n`);
}

const DIGEST = /--allow-destructive ([0-9a-f]{12})/;

function withoutApproval(args: readonly string[]): string[] {
  const at = args.indexOf("--allow-destructive");
  return at === -1 ? [...args] : [...args.slice(0, at), ...args.slice(at + 2)];
}

function composeArgs(spec: Case, refused: Step | null): string[] {
  return (spec.args ?? []).map((arg) => {
    if (arg !== "<digest>") return arg;
    const match = DIGEST.exec(refused?.stderr ?? "");
    if (match?.[1] === undefined) throw new Error(`the refusal printed no digest:\n${refused?.stderr ?? "(no refusal step)"}`);
    return match[1];
  });
}

interface Observed {
  first: Step;
  firstWritten: boolean;
  refused: Step | null;
  refusedWritten: boolean;
  second: Step;
  written: string;
  migrated: [Step, Step | null];
  check: Step | null;
  status: Step | null;
  again: Step | null;
  againWritten: boolean;
  rows: unknown;
}

function numbered(index: number, name: string): string {
  return `${String(index).padStart(4, "0")}_${name}.sql`;
}

async function runCase(dir: string, spec: Case): Promise<Observed> {
  const root = freshRoot();
  let db: D1Handle | null = null;
  try {
    writeFileSync(join(root, "schema.sql"), readFileSync(join(dir, "before.sql")));
    if (spec.lib !== undefined) {
      writeFileSync(join(root, "lib.sql"), spec.lib);
      declare(root, ["lib.sql", "schema.sql"]);
    }
    const first = await forgeDb(root, ["migrate", "compose", "init"]);
    const firstWritten = existsSync(join(root, "config", "db", "migrations", "0001_init.sql"));
    const migratedFirst = await forgeDb(root, ["migrate", "--yes"]);
    db = await openD1(root);
    await db.exec(spec.seed);

    const changeFile = join(root, "config", "db", "migrations", numbered(2, "change"));
    writeFileSync(join(root, "schema.sql"), readFileSync(join(dir, "after.sql")));
    if (spec.lib !== undefined) declare(root, ["schema.sql"]);
    const refused =
      spec.refusedWithout === undefined ? null : await forgeDb(root, ["migrate", "compose", "change", ...withoutApproval(spec.args ?? [])]);
    const refusedWritten = existsSync(changeFile);
    const second = await forgeDb(root, ["migrate", "compose", "change", ...composeArgs(spec, refused)]);
    const written = existsSync(changeFile) ? readFileSync(changeFile, "utf-8") : "";
    if (spec.composeRefused !== undefined) {
      return {
        first,
        firstWritten,
        refused,
        refusedWritten,
        second,
        written,
        migrated: [migratedFirst, null],
        check: null,
        status: null,
        again: null,
        againWritten: false,
        rows: await db.rows(spec.query),
      };
    }
    const migratedSecond = await forgeDb(root, ["migrate", "--yes"]);
    if (spec.after !== undefined) await db.exec(spec.after);

    const check = await forgeDb(root, ["schema", "check", "--replay"]);
    const status = await forgeDb(root, ["migrate", "status", "--check"]);
    const again = await forgeDb(root, ["migrate", "compose", "again", "--dry-run"]);
    const againWritten = existsSync(join(root, "config", "db", "migrations", numbered(3, "again")));
    const read = await db.rows(spec.query);
    return {
      first,
      firstWritten,
      refused,
      refusedWritten,
      second,
      written,
      migrated: [migratedFirst, migratedSecond],
      check,
      status,
      again,
      againWritten,
      rows: read,
    };
  } finally {
    // Disposed before the state it holds open is removed.
    await db?.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

const cases = readdirSync(join(FIXTURE, "cases")).sort();
const specs = new Map(cases.map((name) => [name, JSON.parse(readFileSync(join(FIXTURE, "cases", name, "case.json"), "utf-8")) as Case]));
const observed = new Map<string, Observed>();

const CASE_CONCURRENCY = 4;

async function pooled<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  const results = await pooled(cases, CASE_CONCURRENCY, (name) => runCase(join(FIXTURE, "cases", name), specs.get(name) as Case));
  for (const [i, name] of cases.entries()) observed.set(name, results[i] as Observed);
});

for (const name of cases) {
  test.describe(`compose case ${name}`, () => {
    const spec = specs.get(name) as Case;
    const seen = () => observed.get(name) as Observed;

    test("composes and migrates the before state, then the after state over seeded rows", () => {
      const o = seen();
      expect(o.first.stderr).toBe("");
      expect(o.first.code).toBe(0);
      expect(o.firstWritten).toBe(true);
      expect(o.migrated[0].code).toBe(0);
      if (spec.composeRefused !== undefined) {
        expect(o.second.code).toBe(1);
        expect(o.second.stderr.includes(spec.composeRefused)).toBe(true);
        expect(o.written).toBe("");
        return;
      }
      if (spec.refusedWithout !== undefined) {
        expect(o.refused?.code).toBe(1);
        expect(o.refused?.stderr.includes(spec.refusedWithout)).toBe(true);
        expect(o.refusedWritten).toBe(false);
      }
      expect(o.second.stderr).toBe("");
      expect(o.second.code).toBe(0);
      if (spec.expectNoMigration === true) expect(o.written).toBe("");
      for (const fragment of spec.expectSql ?? []) expect(o.written.includes(fragment)).toBe(true);
      for (const fragment of spec.expectStdout ?? []) expect(o.second.stdout.includes(fragment)).toBe(true);
      if (spec.migrateFails === undefined) {
        expect(o.migrated[1]?.code).toBe(0);
      } else {
        expect(o.migrated[1]?.code).toBe(1);
        expect(o.migrated[1]?.stderr.includes(spec.migrateFails)).toBe(true);
      }
    });

    test("leaves the desired state, its snapshot and the migrations in step", () => {
      const o = seen();
      if (spec.composeRefused !== undefined) {
        expect(o.check).toBe(null);
        return;
      }
      expect(o.check?.stderr).toBe("");
      expect(o.check?.code).toBe(0);
      expect(o.status?.code).toBe(spec.migrateFails === undefined ? 0 : 1);
      expect(o.again?.stdout.includes("no changes")).toBe(true);
      expect(o.againWritten).toBe(false);
    });

    test("holds the rows D1 reads back to what the case expects", () => {
      expect(seen().rows).toEqual(spec.rows);
    });
  });
}

async function loadForge() {
  const [context, compose, diff, proof] = await Promise.all([
    import("../../src/tooling/db/context"),
    import("../../src/tooling/db/schema/compose"),
    import("../../src/tooling/db/schema/diff"),
    import("../../src/tooling/db/schema/proof"),
  ]);
  return {
    withDbRun: context.withDbRun,
    composeMigration: compose.composeMigration,
    readSchemaInputs: compose.readSchemaInputs,
    baselineSchemaModel: compose.baselineSchemaModel,
    desiredSchemaModel: compose.desiredSchemaModel,
    diffSchemaModels: diff.diffSchemaModels,
    parseSchemaRename: diff.parseSchemaRename,
    proveComposed: proof.proveComposed,
  };
}

test.describe("the proof over one seeded row per table", () => {
  let forge: Awaited<ReturnType<typeof loadForge>>;
  test.beforeAll(async () => {
    forge = await loadForge();
  });

  const inRun = <T>(root: string, body: (run: DbRunContext) => Promise<T>): Promise<T> =>
    forge.withDbRun(
      { root, target: "local", db: undefined, config: "wrangler.jsonc", env: undefined, json: true, yes: true },
      undefined,
      { host: { schemas: ["schema.sql"] } },
      body,
    );
  const failure = (pending: Promise<unknown>) =>
    pending.then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

  async function compose(run: DbRunContext, name: string, renames: readonly string[], dryRun: boolean) {
    const options = { name, dryRun, renames, cache: true };
    const refused = await failure(forge.composeMigration(run, options));
    const digest = refused === null ? undefined : DIGEST.exec(refused)?.[1];
    if (refused !== null && digest === undefined) throw new Error(refused);
    return forge.composeMigration(run, digest === undefined ? options : { ...options, allowDestructive: digest });
  }

  async function proving(before: string, after: string, body: (run: DbRunContext) => Promise<void>) {
    const root = freshRoot();
    try {
      writeFileSync(join(root, "schema.sql"), before);
      await inRun(root, async (run) => {
        await forge.composeMigration(run, { name: "init", dryRun: false, renames: [], cache: true });
      });
      writeFileSync(join(root, "schema.sql"), after);
      await inRun(root, body);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  async function proofInput(run: DbRunContext, sql: string, renames: readonly string[]) {
    const inputs = forge.readSchemaInputs(run);
    const baseline = await forge.baselineSchemaModel(run, inputs, true);
    const desired = await forge.desiredSchemaModel(run, inputs, true);
    const steps = forge.diffSchemaModels(baseline, desired).dataDependent;
    return { inputs, proof: { sql, baseline, desired, renames: renames.map(forge.parseSchemaRename), steps } };
  }

  const PARENT_CHILD =
    'CREATE TABLE "parent" ("id" INTEGER PRIMARY KEY, "a" INTEGER);\n' +
    'CREATE TABLE "child" ("id" INTEGER PRIMARY KEY, "parent_id" INTEGER REFERENCES "parent" ("id"));\n';
  const DROP_CHILD = 'DROP TABLE IF EXISTS "child";\n';
  const RENAME_IN = /^ALTER TABLE "_forge_new_[^\n]* RENAME TO [^\n]*\n/gm;

  /** The bug-261018-02 order: the dropped child goes after the renames instead of before them. */
  function oldEmitOrder(sql: string): string {
    const without = sql.replace(DROP_CHILD, "");
    const last = [...without.matchAll(RENAME_IN)].at(-1);
    if (without === sql || last === undefined) throw new Error(`not the emitted shape the mutation moves:\n${sql}`);
    const at = last.index + last[0].length;
    return `${without.slice(0, at)}${DROP_CHILD}${without.slice(at)}`;
  }

  const variants = [
    { name: "a NOT NULL DEFAULT 0", after: 'CREATE TABLE "parent" ("id" INTEGER PRIMARY KEY, "a" INTEGER NOT NULL DEFAULT 0);\n' },
    { name: "a UNIQUE", after: 'CREATE TABLE "parent" ("id" INTEGER PRIMARY KEY, "a" INTEGER UNIQUE);\n' },
  ];

  for (const { name, after } of variants) {
    test(`refuses the bug-261018-02 counterexample in the old emit order, and proves the real one: parent gains ${name}`, async () => {
      test.setTimeout(120_000);
      await proving(PARENT_CHILD, after, async (run) => {
        const { sql } = await compose(run, "change", [], true);
        const { inputs, proof } = await proofInput(run, sql, []);
        const old = oldEmitOrder(sql);

        expect((await forge.proveComposed(run, inputs, proof)).warnings).toEqual([]);
        expect(await failure(forge.proveComposed(run, inputs, { ...proof, sql: old }))).toMatch(
          /^the composed migration does not apply to the baseline — this is a forge bug, and the file was not written:\nloading [^\n]*\/proof\.sql against scratch:compose-baseline \([^)]*\) failed:\nFOREIGN KEY constraint failed: child first held a row with no match in parent after `DROP TABLE "parent"`\n/,
        );
        const unseeded = { ...proof, sql: old, baseline: { tables: [], indexes: [], triggers: [], views: [] } };
        expect((await forge.proveComposed(run, inputs, unseeded)).warnings).toEqual([]);
      });
    });
  }

  const TAGS_BEFORE = 'CREATE TABLE "tags" ("id" INTEGER PRIMARY KEY);\n';
  const TAGS_AFTER = 'CREATE TABLE "tags" ("id" INTEGER PRIMARY KEY, "label" TEXT);\n';
  const ORPHANING_TRIGGER =
    PARENT_CHILD +
    'CREATE TABLE "orders" ("id" INTEGER PRIMARY KEY, "note" TEXT);\n' +
    'CREATE TRIGGER "orders_orphan" AFTER INSERT ON "orders" BEGIN INSERT INTO "child" ("id", "parent_id") VALUES (999, 999); END;\n';

  test("composes over a baseline whose trigger orphans a child row on the seed's insert, warning that the proof ran without rows", async () => {
    test.setTimeout(120_000);
    await proving(ORPHANING_TRIGGER + TAGS_BEFORE, ORPHANING_TRIGGER + TAGS_AFTER, async (run) => {
      const outcome = await forge.composeMigration(run, { name: "change", dryRun: false, renames: [], cache: true });

      expect(outcome.warnings).toEqual(["warning: the proof ran without rows — seeding child failed: FOREIGN KEY"]);
      expect(existsSync(outcome.path ?? "")).toBe(true);
    });
  });

  const BEFORE_VALID =
    'CREATE TABLE "parent" ("id" INTEGER PRIMARY KEY, "a" INTEGER, "note" TEXT);\n' +
    'CREATE TABLE "child" ("id" INTEGER PRIMARY KEY, "parent_id" INTEGER NOT NULL REFERENCES "parent" ("id"), "label" TEXT);\n';
  const AFTER_VALID =
    'CREATE TABLE "parent" ("id" INTEGER PRIMARY KEY, "a" INTEGER NOT NULL DEFAULT 0, "memo" TEXT);\n' +
    'CREATE TABLE "child" ("id" INTEGER PRIMARY KEY, "parent_id" INTEGER NOT NULL REFERENCES "parent" ("id"), "label" TEXT);\n';
  const RENAMES = ["parent.note:memo"];

  test("composes a parent rebuild with a child, a column rename and a NOT NULL tightening over its seeded rows, warning only of the tightening", async () => {
    test.setTimeout(120_000);
    await proving(BEFORE_VALID, AFTER_VALID, async (run) => {
      const outcome = await compose(run, "change", RENAMES, false);

      expect(outcome.path).toBe(join(run.config.root, "config", "db", "migrations", "0002_change.sql"));
      expect(outcome.warnings).toEqual([
        "warning: parent.a becomes NOT NULL — the rebuild copies existing rows as they are, so one holding NULL fails it (the DEFAULT does not fill it in); rehearse it on `standby` first",
      ]);
      await run.io.closeD1(null);
      const scratch = await openD1(join(run.config.root, ".forge", "scratch", "compose", "baseline"));
      try {
        expect({
          parent: await scratch.rows('SELECT "id", "a", "memo" FROM "parent"'),
          child: await scratch.rows('SELECT "id", "parent_id", "label" FROM "child"'),
        }).toEqual({ parent: [{ id: 1, a: 1, memo: "forge-seed" }], child: [{ id: 1, parent_id: 1, label: "forge-seed" }] });
      } finally {
        await scratch.dispose();
      }
    });
  });

  test("refuses, on local D1, a rebuild that leaves a renamed column out of its copy", async () => {
    test.setTimeout(120_000);
    await proving(BEFORE_VALID, AFTER_VALID, async (run) => {
      const { sql } = await compose(run, "change", RENAMES, true);
      const copy = 'INSERT INTO "_forge_new_parent" ("id", "a", "memo") SELECT "id", "a", "memo" FROM "parent";';
      const sabotaged = sql.replace(copy, 'INSERT INTO "_forge_new_parent" ("id", "a") SELECT "id", "a" FROM "parent";');
      expect(sabotaged).not.toBe(sql);
      const { inputs, proof } = await proofInput(run, sabotaged, RENAMES);

      expect(await failure(forge.proveComposed(run, inputs, proof))).toBe(
        "the composed migration does not keep the rows it was proven over — this is a forge bug, and the file was not written:\n  parent.memo was seeded 'forge-seed' and reads NULL",
      );
    });
  });

  const triggered = [
    {
      name: "an AFTER INSERT trigger on orders inserts into audit, which is seeded first",
      schema:
        'CREATE TABLE "audit" ("id" INTEGER PRIMARY KEY, "action" TEXT);\n' +
        'CREATE TABLE "orders" ("id" INTEGER PRIMARY KEY, "note" TEXT);\n' +
        'CREATE TRIGGER "orders_audit" AFTER INSERT ON "orders" BEGIN INSERT INTO "audit" ("action") VALUES (\'created\'); END;\n',
      read: 'SELECT "id", "action" FROM "audit" ORDER BY "id"',
      held: [
        { id: 1, action: "forge-seed" },
        { id: 2, action: "created" },
      ],
      loses: 'DELETE FROM "audit" WHERE "id" = 1;\n',
      refusal: "a row seeded into audit is gone: id = 1, action = 'forge-seed'",
    },
    {
      name: "an AFTER INSERT trigger on orders increments users.order_count, a seeded column with no DEFAULT",
      schema:
        'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "order_count" INTEGER);\n' +
        'CREATE TABLE "orders" ("id" INTEGER PRIMARY KEY, "user_id" INTEGER REFERENCES "users" ("id"));\n' +
        'CREATE TRIGGER "orders_count" AFTER INSERT ON "orders" BEGIN UPDATE "users" SET "order_count" = "order_count" + 1 WHERE "id" = NEW."user_id"; END;\n',
      read: 'SELECT "id", "order_count" FROM "users"',
      held: [{ id: 1, order_count: 2 }],
      loses: 'UPDATE "users" SET "order_count" = 0;\n',
      refusal: "users.order_count was seeded 2 and reads 0",
    },
  ];

  for (const { name, schema, read, held, loses, refusal } of triggered) {
    test(`composes and writes an unrelated ADD COLUMN over a baseline where ${name}`, async () => {
      test.setTimeout(120_000);
      await proving(schema + TAGS_BEFORE, schema + TAGS_AFTER, async (run) => {
        const outcome = await forge.composeMigration(run, { name: "change", dryRun: false, renames: [], cache: true });

        expect(outcome.path).toBe(join(run.config.root, "config", "db", "migrations", "0002_change.sql"));
        expect(existsSync(outcome.path ?? "")).toBe(true);
        expect(outcome.warnings).toEqual([]);
        await run.io.closeD1(null);
        const scratch = await openD1(join(run.config.root, ".forge", "scratch", "compose", "baseline"));
        try {
          expect(await scratch.rows(read)).toEqual(held);
        } finally {
          await scratch.dispose();
        }
      });
    });

    test(`still refuses a migration that loses what the seed left, where ${name}`, async () => {
      test.setTimeout(120_000);
      await proving(schema + TAGS_BEFORE, schema + TAGS_AFTER, async (run) => {
        const { sql } = await compose(run, "change", [], true);
        const { inputs, proof } = await proofInput(run, sql + loses, []);

        expect(await failure(forge.proveComposed(run, inputs, proof))).toBe(
          `the composed migration does not keep the rows it was proven over — this is a forge bug, and the file was not written:\n  ${refusal}`,
        );
      });
    });
  }
});
