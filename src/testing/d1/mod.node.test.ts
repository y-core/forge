import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openBunD1 } from "./bun";
import type * as D1Module from "./mod";
import { explainPlan, scansTable, usesIndex } from "./mod";
import type { TestD1 } from "./types";

let root: string;
let db: TestD1;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "forge-d1-node-bundle-"));
  mkdirSync(join(root, "migrations"));
  writeFileSync(
    join(root, "migrations", "1_posts.sql"),
    "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT);\nCREATE INDEX posts_user ON posts (user_id);",
  );
  db = await openBunD1({ root, migrations: "migrations" });
});

afterAll(async () => {
  await db.dispose();
  rmSync(root, { recursive: true, force: true });
});

async function bundled(): Promise<typeof D1Module> {
  return (await import(new URL("./mod.node.mjs", import.meta.url).href)) as typeof D1Module;
}

describe("the node bundle of testing/d1", () => {
  it("plans a query as the source's explainPlan does: through the index for a keyed read, by a scan for an unkeyed one", async () => {
    const node = await bundled();
    const verdicts = async (explain: typeof explainPlan) => {
      const keyed = await explain(db, "SELECT id FROM posts WHERE user_id = ?", [7]);
      const unkeyed = await explain(db, "SELECT id FROM posts WHERE title = ?", ["a"]);
      return { keyed: usesIndex(keyed, "posts_user"), unkeyed: scansTable(unkeyed, "posts"), plans: [keyed, unkeyed] };
    };
    const fromSource = await verdicts(explainPlan);
    const fromBundle = await verdicts(node.explainPlan);
    expect([fromBundle.keyed, fromBundle.unkeyed, fromBundle.plans]).toEqual([true, true, fromSource.plans]);
  });
});
