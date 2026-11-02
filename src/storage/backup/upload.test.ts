import { describe, expect, it } from "bun:test";

import { fakeBackupBucket } from "./backup.fixture";
import { D1BackupError } from "./errors";
import { BACKUP_PART_BYTES, storeMultipart, uniformParts } from "./upload";

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>, partBytes: number): Promise<number[][]> {
  const parts: number[][] = [];
  for await (const part of uniformParts(body, partBytes)) parts.push([...part]);
  return parts;
}

describe("uniformParts()", () => {
  it("regroups uneven chunks into equal parts, the last one shorter", async () => {
    const body = streamOf(new Uint8Array([1, 2, 3]), new Uint8Array([4]), new Uint8Array([5, 6, 7, 8, 9]));
    expect(await collect(body, 4)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
  });

  it("yields no short tail when the body is an exact multiple", async () => {
    expect(await collect(streamOf(new Uint8Array([1, 2, 3, 4])), 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("yields nothing for an empty body", async () => {
    expect(await collect(streamOf(), 4)).toEqual([]);
  });
});

describe("storeMultipart()", () => {
  it("stores the body byte for byte in uniform parts with its metadata, answering its size", async () => {
    const bucket = fakeBackupBucket();
    const body = new Uint8Array(BACKUP_PART_BYTES * 2 + 3).map((_, index) => index % 251);
    const size = await storeMultipart(bucket, "k.sql", streamOf(body.subarray(0, 10), body.subarray(10)), { bookmark: "B" });

    expect(size).toBe(body.byteLength);
    expect(bucket.partSizes).toEqual([BACKUP_PART_BYTES, BACKUP_PART_BYTES, 3]);
    expect(bucket.objects.get("k.sql")?.bytes).toEqual(body);
    expect(bucket.objects.get("k.sql")?.customMetadata).toEqual({ bookmark: "B" });
  });

  it("aborts the upload and stores nothing when a part is refused", async () => {
    const bucket = fakeBackupBucket();
    bucket.failPart = 2;
    const body = new Uint8Array(BACKUP_PART_BYTES + 1);
    await expect(storeMultipart(bucket, "k.sql", streamOf(body), {})).rejects.toThrow("part 2 refused");
    expect([bucket.aborted, bucket.objects.size]).toEqual([["k.sql"], 0]);
  });

  it("refuses a length other than the one announced, aborting the upload", async () => {
    const bucket = fakeBackupBucket();
    const error = await storeMultipart(bucket, "k.sql", streamOf(new Uint8Array(3)), {}, 4).catch((thrown: unknown) => thrown);
    expect([(error as D1BackupError).kind, (error as Error).message, bucket.aborted, bucket.objects.size]).toEqual([
      "download",
      "the D1 export downloaded 3 bytes of the 4 its Content-Length announced",
      ["k.sql"],
      0,
    ]);
  });

  it("refuses an empty dump as a download failure, aborting the upload", async () => {
    const bucket = fakeBackupBucket();
    const error = await storeMultipart(bucket, "k.sql", streamOf(), {}).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(D1BackupError);
    expect((error as D1BackupError).kind).toBe("download");
    expect(bucket.aborted).toEqual(["k.sql"]);
  });
});
