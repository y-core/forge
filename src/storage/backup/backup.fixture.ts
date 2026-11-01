import type { BackupBucket, BackupMultipartUpload, BackupStepConfig, BackupUploadedPart, BackupWorkflowStep } from "./types";

/** An in-memory bucket recording every multipart upload, with listing paged by `pageSize`. */
export interface FakeBackupBucket extends BackupBucket {
  readonly objects: Map<string, { bytes: Uint8Array; customMetadata: Record<string, string> }>;
  readonly aborted: string[];
  readonly partSizes: number[];
  readonly deleted: string[][];
  failPart?: number;
}

export function fakeBackupBucket(pageSize = 1000): FakeBackupBucket {
  const bucket: FakeBackupBucket = {
    objects: new Map(),
    aborted: [],
    partSizes: [],
    deleted: [],
    async createMultipartUpload(key, options) {
      const parts = new Map<number, Uint8Array>();
      const upload: BackupMultipartUpload = {
        async uploadPart(partNumber, value): Promise<BackupUploadedPart> {
          if (bucket.failPart === partNumber) throw new Error(`fake r2: part ${partNumber} refused`);
          parts.set(partNumber, value.slice());
          bucket.partSizes.push(value.byteLength);
          return { partNumber, etag: `etag-${partNumber}` };
        },
        async complete(uploaded) {
          const ordered = uploaded.map((part) => parts.get(part.partNumber) ?? new Uint8Array());
          const bytes = new Uint8Array(ordered.reduce((sum, part) => sum + part.byteLength, 0));
          let offset = 0;
          for (const part of ordered) {
            bytes.set(part, offset);
            offset += part.byteLength;
          }
          bucket.objects.set(key, { bytes, customMetadata: options?.customMetadata ?? {} });
          return {};
        },
        async abort() {
          bucket.aborted.push(key);
        },
      };
      return upload;
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

/** A step that runs each callback once, recording the name and config it was given. */
export function fakeStep(): BackupWorkflowStep & { readonly ran: { name: string; config: BackupStepConfig; result: unknown }[] } {
  const ran: { name: string; config: BackupStepConfig; result: unknown }[] = [];
  return {
    ran,
    async do<T>(name: string, config: BackupStepConfig, callback: () => Promise<T>): Promise<T> {
      const result = await callback();
      ran.push({ name, config, result });
      return result;
    },
  };
}

/** A Cloudflare success envelope around an export state. */
export function exportReply(result: unknown, status = 200): Response {
  return Response.json({ success: true, errors: [], messages: [], result }, { status });
}
