import { beforeAll, describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FORGE = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = join(FORGE, "tests", "fixtures", "db-compose");
const BIN = join(FORGE, "src", "tooling", "root", "bin.ts");

interface Case {
  seed: string;
  after?: string;
  /** Extra compose flags; the token `<digest>` is replaced with the digest the refusal printed. */
  args?: string[];
  refusedWithout?: string;
  /** SQL for a `--custom` migration composed and applied over the seed, which declares what no schema.sql owns. */
  custom?: string;
  /** When set, the after state must be refused with this text, and nothing downstream of the compose runs. */
  composeRefused?: string;
  expectSql?: string[];
  expectStdout?: string[];
  /** When set, the second compose's stderr must hold each fragment rather than be empty. */
  expectStderr?: string[];
  /** When set, the second compose must write no migration. */
  expectNoMigration?: boolean;
  /** When set, the second migrate must fail on the seeded rows with this text; the proof never sees them. */
  migrateFails?: string;
  query: string;
  rows: Record<string, unknown>[];
}

interface Step {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function forgeDb(root: string, args: string[]): Promise<Step> {
  const proc = Bun.spawn(["bun", "run", BIN, "db", ...args, "--root", root], { cwd: FORGE, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}

async function d1(root: string, sql: string, json = false): Promise<string> {
  const args = ["wrangler", "d1", "execute", "db-compose-fixture", "--local", "--persist-to", join(root, ".wrangler", "state"), "--yes"];
  const proc = Bun.spawn(["bunx", ...args, ...(json ? ["--json"] : []), "--command", sql], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`wrangler: ${stderr}\n${stdout}`);
  return stdout;
}

async function rows(root: string, sql: string): Promise<unknown> {
  const lines = (await d1(root, sql, true)).split("\n");
  const start = lines.findIndex((line) => /^\s*\[/.test(line));
  const payload = JSON.parse(lines.slice(start).join("\n")) as { results: unknown }[];
  return payload[0]?.results;
}

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-compose-"));
  cpSync(join(FIXTURE, "wrangler.jsonc"), join(root, "wrangler.jsonc"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "db.ts"), 'export default { schemas: ["schema.sql"] };\n');
  return root;
}

const DIGEST = /--allow-destructive ([0-9a-f]{12})/;

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
  try {
    writeFileSync(join(root, "schema.sql"), readFileSync(join(dir, "before.sql")));
    const first = await forgeDb(root, ["migrate", "compose", "init"]);
    const firstWritten = existsSync(join(root, "migrations", "0001_init.sql"));
    const migratedFirst = await forgeDb(root, ["migrate", "--yes"]);
    await d1(root, spec.seed);

    if (spec.custom !== undefined) {
      await forgeDb(root, ["migrate", "compose", "extra", "--custom"]);
      const file = join(root, "migrations", numbered(2, "extra"));
      writeFileSync(file, `${readFileSync(file, "utf-8")}${spec.custom}`);
      await forgeDb(root, ["migrate", "--yes"]);
    }

    const changeFile = join(root, "migrations", numbered(spec.custom === undefined ? 2 : 3, "change"));
    writeFileSync(join(root, "schema.sql"), readFileSync(join(dir, "after.sql")));
    const refused = spec.refusedWithout === undefined ? null : await forgeDb(root, ["migrate", "compose", "change"]);
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
        rows: await rows(root, spec.query),
      };
    }
    const migratedSecond = await forgeDb(root, ["migrate", "--yes"]);
    if (spec.after !== undefined) await d1(root, spec.after);

    const check = await forgeDb(root, ["schema", "check", "--replay"]);
    const status = await forgeDb(root, ["migrate", "status", "--check"]);
    const again = await forgeDb(root, ["migrate", "compose", "again", "--dry-run"]);
    const againWritten = existsSync(join(root, "migrations", numbered(spec.custom === undefined ? 3 : 4, "again")));
    const read = await rows(root, spec.query);
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

beforeAll(async () => {
  const results = await pooled(cases, CASE_CONCURRENCY, (name) => runCase(join(FIXTURE, "cases", name), specs.get(name) as Case));
  for (const [i, name] of cases.entries()) observed.set(name, results[i] as Observed);
}, 900_000);

describe.each(cases)("compose case %s", (name) => {
  const spec = specs.get(name) as Case;
  const seen = () => observed.get(name) as Observed;

  it("composes and migrates the before state, then the after state over seeded rows", () => {
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
    if (spec.expectStderr === undefined) expect(o.second.stderr).toBe("");
    else for (const fragment of spec.expectStderr) expect(o.second.stderr.includes(fragment)).toBe(true);
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

  it("leaves the desired state, its snapshot and the migrations in step", () => {
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

  it("holds the rows D1 reads back to what the case expects", () => {
    expect(seen().rows).toEqual(spec.rows);
  });
});
