import { D1BackupError } from "./errors";
import type { BackupBucket, BackupUploadedPart } from "./types";

/** The size of every multipart part but the last; R2 requires them uniform and at least 5 MiB. @internal */
export const BACKUP_PART_BYTES = 8 * 1024 * 1024;

/** Cuts a byte stream into `partBytes` pieces, the last one shorter. @internal */
export async function* uniformParts(body: ReadableStream<Uint8Array>, partBytes: number): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let part = new Uint8Array(partBytes);
  let filled = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.byteLength) {
        const taken = Math.min(partBytes - filled, value.byteLength - offset);
        part.set(value.subarray(offset, offset + taken), filled);
        filled += taken;
        offset += taken;
        if (filled === partBytes) {
          yield part;
          part = new Uint8Array(partBytes);
          filled = 0;
        }
      }
    }
    if (filled > 0) yield part.slice(0, filled);
  } finally {
    reader.releaseLock();
  }
}

/** Streams `body` into `key` as one multipart upload, aborting it on any failure, and answers the bytes stored. @internal */
export async function storeMultipart(
  bucket: BackupBucket,
  key: string,
  body: ReadableStream<Uint8Array>,
  customMetadata: Record<string, string>,
): Promise<number> {
  const upload = await bucket.createMultipartUpload(key, { customMetadata, httpMetadata: { contentType: "application/sql" } });
  try {
    const parts: BackupUploadedPart[] = [];
    let size = 0;
    for await (const part of uniformParts(body, BACKUP_PART_BYTES)) {
      parts.push(await upload.uploadPart(parts.length + 1, part));
      size += part.byteLength;
    }
    if (parts.length === 0) throw new D1BackupError("download", "the D1 export downloaded as an empty file");
    await upload.complete(parts);
    return size;
  } catch (error) {
    await upload.abort().catch(() => {});
    throw error;
  }
}
