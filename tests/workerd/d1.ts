import { join } from "node:path";
import process from "node:process";

import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

/** A D1 binding over the state a `--persist-to` run wrote, and the workerd process behind it. */
export interface D1Handle {
  exec(sql: string): Promise<void>;
  rows<T>(sql: string): Promise<T[]>;
  dispose(): Promise<void>;
}

/** Opens `root`'s local D1 through its own `wrangler.jsonc`; `persistPath` is the directory the state is read from. */
export async function openD1(root: string, persistPath: string = join(root, ".wrangler", "state", "v3")): Promise<D1Handle> {
  // The default is the `v3` directory wrangler writes under, not the `--persist-to` argument that is
  // its parent: pointed at the parent, every read opens an empty database and asserts nothing.
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(root, "wrangler.jsonc"),
    persist: { path: persistPath },
    remoteBindings: false,
    envFiles: [],
  });
  let open = true;
  const dispose = async (): Promise<void> => {
    if (!open) return;
    open = false;
    live.delete(dispose);
    await proxy.dispose();
  };
  live.add(dispose);
  sweepOnSignal();
  return {
    // Each statement runs on its own and in order, never through `batch()`: `prepare` throws on a
    // multi-statement string, and a batch is one transaction where `d1 execute --command` is not.
    exec: async (sql) => {
      for (const statement of unstable_splitSqlQuery(sql)) await proxy.env.DB.prepare(statement).run();
    },
    rows: async <T>(sql: string) => (await proxy.env.DB.prepare(sql).all()).results as T[],
    dispose,
  };
}

const live = new Set<() => Promise<void>>();

// The handler ends the run itself: a listener suppresses bun's default termination, and a run that
// carries on past one meets the handles this disposed.
let bound = false;
function sweepOnSignal(): void {
  if (bound) return;
  bound = true;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      void Promise.allSettled([...live].map((dispose) => dispose())).then(() => process.exit(130));
    });
  }
}
