import type { D1Client, D1Outcome, RowLoader, RowLoaderOptions } from "./types";

/** Creates a loader whose `load`s within one microtask tick are answered by a single `query`, binding their distinct keys as one JSON array for `select`'s `json_each`. @public */
export function createRowLoader<K extends string | number, T>(db: D1Client, options: RowLoaderOptions<K, T>): RowLoader<K, T> {
  let open: { keys: Set<K>; answer: Promise<D1Outcome<Map<K, T>>> } | undefined;

  const read = async (keys: Set<K>): Promise<D1Outcome<Map<K, T>>> => {
    const outcome = await db.query<T>(options.select(JSON.stringify([...keys])));
    if (!outcome.ok) return outcome;
    const byKey = new Map<K, T>();
    for (const row of outcome.data) {
      const key = options.keyOf(row);
      if (!byKey.has(key)) byKey.set(key, row);
    }
    return { ok: true, data: byKey, meta: outcome.meta };
  };

  return {
    load(key) {
      if (open === undefined) {
        const keys = new Set<K>();
        open = {
          keys,
          answer: Promise.resolve().then(() => {
            open = undefined;
            return read(keys);
          }),
        };
      }
      open.keys.add(key);
      return open.answer.then((outcome) => (outcome.ok ? { ok: true, data: outcome.data.get(key) ?? null, meta: outcome.meta } : outcome));
    },
  };
}
