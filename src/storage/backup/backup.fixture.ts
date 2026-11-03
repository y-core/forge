import type { BackupBucket } from "./types";

/** An in-memory bucket recording every delete, with listing paged by `pageSize`. */
export interface FakeBackupBucket extends BackupBucket {
  readonly objects: Map<string, { bytes: Uint8Array }>;
  readonly deleted: string[][];
}

export function fakeBackupBucket(pageSize = 1000): FakeBackupBucket {
  const bucket: FakeBackupBucket = {
    objects: new Map(),
    deleted: [],
    async put(key, value) {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
            ? value.slice()
            : new Uint8Array(await new Response(value).arrayBuffer());
      bucket.objects.set(key, { bytes });
      return {};
    },
    async get(key) {
      const stored = bucket.objects.get(key);
      if (stored === undefined) return null;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(stored.bytes.slice());
          controller.close();
        },
      });
      return { size: stored.bytes.byteLength, body, text: async () => new TextDecoder().decode(stored.bytes) };
    },
    async list(options) {
      const keys = [...bucket.objects.keys()].filter((key) => key.startsWith(options?.prefix ?? "")).sort();
      const start = options?.cursor === undefined ? 0 : Number(options.cursor);
      const page = keys.slice(start, start + pageSize);
      const truncated = start + pageSize < keys.length;
      const objects = page.map((key) => ({ key, size: bucket.objects.get(key)?.bytes.byteLength ?? 0 }));
      return truncated ? { objects, truncated, cursor: String(start + pageSize) } : { objects, truncated };
    },
    async delete(keys) {
      const list = typeof keys === "string" ? [keys] : keys;
      bucket.deleted.push([...list]);
      for (const key of list) bucket.objects.delete(key);
    },
  };
  return bucket;
}
