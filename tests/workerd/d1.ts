import { join } from "node:path";

import type { D1Database, D1PreparedStatement } from "../../src/storage/db/types";
import { openPlatformD1 } from "../../src/testing/d1";
import { cutSqlStatements } from "../../src/tooling/db/backup/split";

/** A workerd statement, which also answers `raw()` — the read `PRAGMA miniflare_d1_export` returns its dump through. */
export interface WorkerdStatement extends D1PreparedStatement {
  bind(...values: unknown[]): WorkerdStatement;
  raw<T = unknown[]>(): Promise<T[]>;
}

/** A workerd D1 binding: forge's structural `D1Database`, plus the `raw()` reads only a test makes. */
export interface WorkerdD1 extends D1Database {
  prepare(query: string): WorkerdStatement;
}

/** A D1 binding over the state a `--persist-to` run wrote, and the workerd process behind it. */
export interface D1Handle {
  binding: WorkerdD1;
  exec(sql: string): Promise<void>;
  rows<T>(sql: string): Promise<T[]>;
  dispose(): Promise<void>;
}

/** Opens `root`'s local D1 through its own `wrangler.jsonc`; `persistPath` is the directory the state is read from. */
export async function openD1(root: string, persistPath: string = join(root, ".wrangler", "state", "v3")): Promise<D1Handle> {
  // The default is the `v3` directory wrangler writes under, not the `--persist-to` argument that is
  // its parent: pointed at the parent, every read opens an empty database and asserts nothing.
  const platform = await openPlatformD1(join(root, "wrangler.jsonc"), persistPath);
  const binding = platform.binding as WorkerdD1;
  return {
    binding,
    // Each statement runs on its own and in order, never through `batch()`: `prepare` throws on a
    // multi-statement string, and a batch is one transaction where `d1 execute --command` is not.
    exec: async (sql) => {
      for (const statement of cutSqlStatements(sql)) await binding.prepare(statement).run();
    },
    rows: async <T>(sql: string) => (await binding.prepare(sql).all()).results as T[],
    dispose: platform.dispose,
  };
}
