import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { serveWorker } from "../../src/testing/harness";
import { expect, test } from "./harness.fixture";

const CONFIG = new URL("../fixtures/workers-form/wrangler.jsonc", import.meta.url).pathname;
const D1_CONFIG = new URL("../fixtures/auth-d1/wrangler.jsonc", import.meta.url).pathname;
const ENTRY = new URL("../fixtures/harness-entry/worker.ts", import.meta.url).pathname;

/** The pids of the `workerd` processes this test process spawned and has not yet reaped. */
function ownWorkerd(): string[] {
  return readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .filter((pid) => {
      try {
        // `pid (comm) state ppid …`, where `comm` may itself hold spaces, so the fields are read after its closing paren.
        const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
        const [, ppid] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        return ppid === String(process.pid) && stat.includes("(workerd)");
      } catch {
        return false;
      }
    });
}

test("starts two harnesses in one test, each answering on a port of its own, and leaves no workerd once both close", async () => {
  const served = await Promise.all([serveWorker({ config: CONFIG }), serveWorker({ config: CONFIG })]);
  try {
    const [first, second] = served;
    const answers = await Promise.all(served.map(({ origin }) => fetch(`${origin}/api/contact`).then((res) => res.status)));

    expect(new URL(first?.origin ?? "").port).not.toBe(new URL(second?.origin ?? "").port);
    expect(answers).toEqual([200, 200]);
    expect(ownWorkerd().length).toBeGreaterThan(0);
  } finally {
    await Promise.all(served.map(({ harness }) => harness.close()));
  }
  expect(ownWorkerd()).toEqual([]);
});

test("hands a secret holding a double quote, a backslash and a literal \\n to the Worker byte for byte", async () => {
  const tricky = 'say "hi", back\\slash, literal \\n';
  const { harness } = await serveWorker({ config: CONFIG, secrets: { TRICKY: tricky } });
  try {
    expect((await harness.getWorker<{ TRICKY: string }>().getEnv()).TRICKY).toBe(tricky);
  } finally {
    await harness.close();
  }
});

test("starts each harness on empty storage, so a table one harness wrote is gone from the next on the same config", async () => {
  const tables = async (env: { DB: D1Database }): Promise<string[]> =>
    (await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'left_by_first'").all<{ name: string }>()).results.map((row) => row.name);

  const first = await serveWorker({ config: D1_CONFIG });
  try {
    const env = await first.harness.getWorker<{ DB: D1Database }>().getEnv();
    await env.DB.prepare("CREATE TABLE left_by_first (id INTEGER)").run();
    expect(await tables(env)).toEqual(["left_by_first"]);
  } finally {
    await first.harness.close();
  }

  const second = await serveWorker({ config: D1_CONFIG });
  try {
    expect(await tables(await second.harness.getWorker<{ DB: D1Database }>().getEnv())).toEqual([]);
  } finally {
    await second.harness.close();
  }
});

test("serves an entry in place of the config's main, under the config's own D1 binding and the caller's vars", async () => {
  const { harness, origin } = await serveWorker({ config: D1_CONFIG, entry: ENTRY, vars: { MODE: "entry" } });
  try {
    expect(await (await fetch(origin)).json()).toEqual({ answer: "from-entry", siteOrigin: origin, mode: "entry" });
  } finally {
    await harness.close();
  }
});

test("tells the Worker its served origin as SITE_ORIGIN over a caller's own, on the host siteHost names", async () => {
  const { harness, origin } = await serveWorker({ config: CONFIG, siteHost: "localhost", vars: { SITE_ORIGIN: "https://stale.test" } });
  try {
    expect(new URL(origin).hostname).toBe("localhost");
    expect((await harness.getWorker<{ SITE_ORIGIN: string }>().getEnv()).SITE_ORIGIN).toBe(origin);
  } finally {
    await harness.close();
  }
});

test("applies the config's D1 migrations under an entry, reading migrations_dir from the config's directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-harness-migrations-"));
  try {
    mkdirSync(join(root, "migrations"));
    writeFileSync(join(root, "migrations", "0001_init.sql"), "CREATE TABLE migrated (id INTEGER);\n");
    writeFileSync(
      join(root, "wrangler.jsonc"),
      JSON.stringify({
        name: "harness-migrations",
        main: "missing.ts",
        compatibility_date: "2026-01-01",
        d1_databases: [{ binding: "DB", database_name: "harness-migrations", database_id: "harness-migrations-local" }],
      }),
    );
    const { harness } = await serveWorker({ config: join(root, "wrangler.jsonc"), entry: ENTRY });
    try {
      const worker = harness.getWorker<{ DB: D1Database }>();
      await worker.applyD1Migrations("DB");
      const env = await worker.getEnv();
      expect((await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'migrated'").all()).results).toEqual([{ name: "migrated" }]);
    } finally {
      await harness.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
