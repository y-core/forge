import { describe, expect, it } from "bun:test";

import { fakeBackupBucket } from "../../../storage/backup/backup.fixture";
import { listD1Backups } from "../../../storage/backup/list";
import { cfEnvelope, cfRefusal, fakeDbIo, r2RestRules, REMOTE_AUTH } from "../db.fixture";
import { R2_REST_PUT_MAX_BYTES, restBackupBucket } from "./rest-bucket";

const OBJECTS = "https://api.cloudflare.com/client/v4/accounts/acct/r2/buckets/app-backups/objects";

function remote(pageSize = 1000) {
  const io = fakeDbIo();
  const store = fakeBackupBucket(pageSize);
  io.restRules.push(...r2RestRules(store));
  return { io, store, bucket: restBackupBucket(io, REMOTE_AUTH, "app-backups") };
}

const put = (store: ReturnType<typeof fakeBackupBucket>, key: string, text: string) => store.put(key, text);

describe("restBackupBucket() — list", () => {
  it("asks for a thousand keys under the prefix, with the bearer token, and pages on is_truncated and the cursor", async () => {
    const { io, store, bucket } = remote(2);
    for (const name of ["a", "b", "c"]) await put(store, `d1-backups/db/${name}.sql`, name);
    const first = await bucket.list({ prefix: "d1-backups/db/" });
    expect(first).toEqual({
      objects: [
        { key: "d1-backups/db/a.sql", size: 1 },
        { key: "d1-backups/db/b.sql", size: 1 },
      ],
      truncated: true,
      cursor: "2",
    });
    expect(await bucket.list({ prefix: "d1-backups/db/", cursor: "2" })).toEqual({
      objects: [{ key: "d1-backups/db/c.sql", size: 1 }],
      truncated: false,
    });
    expect(io.restCalls[0]).toMatchObject({ url: `${OBJECTS}?per_page=1000&prefix=d1-backups%2Fdb%2F`, headers: { authorization: "Bearer tok" } });
    expect(io.restCalls[1]?.url).toBe(`${OBJECTS}?per_page=1000&prefix=d1-backups%2Fdb%2F&cursor=2`);
  });

  it("refuses a page whose cursor an earlier page of the same listing returned", async () => {
    const io = fakeDbIo();
    io.restRules.push({
      match: () => true,
      reply: () => Response.json({ success: true, errors: [], result: [], result_info: { is_truncated: true, cursor: "same" } }),
    });
    const bucket = restBackupBucket(io, REMOTE_AUTH, "app-backups");
    await expect(listD1Backups(bucket, { databaseId: "db" })).rejects.toThrow(
      "listing app-backups failed: a page returned cursor same, which an earlier page already returned",
    );
  });

  it("reads a reply that is not truncated as the last page, whatever cursor it carries", async () => {
    const io = fakeDbIo();
    io.restRules.push({ match: () => true, reply: () => Response.json({ success: true, errors: [], result: [], result_info: { cursor: "c" } }) });
    expect(await restBackupBucket(io, REMOTE_AUTH, "b").list()).toEqual({ objects: [], truncated: false });
  });

  it("names the permission when Cloudflare refuses the token, and the shape when the result is not a listing", async () => {
    const io = fakeDbIo();
    io.restRules.push({ match: () => true, reply: cfRefusal(10000, "Authentication error", 403) });
    await expect(restBackupBucket(io, REMOTE_AUTH, "b").list()).rejects.toThrow(
      "listing b failed: Authentication error (Cloudflare error 10000, HTTP 403) — the --api-token needs Account → Workers R2 Storage → Edit",
    );
    io.restRules.splice(0, 1, { match: () => true, reply: cfEnvelope({ objects: [] }) });
    await expect(restBackupBucket(io, REMOTE_AUTH, "b").list()).rejects.toThrow("answered an unexpected shape");
  });
});

describe("restBackupBucket() — get", () => {
  it("streams a body in the chunks it arrives in, each key segment encoded", async () => {
    const { io, store, bucket } = remote();
    const text = "INSERT INTO t VALUES (1);\n".repeat(20);
    await put(store, "d1-backups/db 1/a?.sql", text);
    const object = await bucket.get("d1-backups/db 1/a?.sql");
    const chunks: number[] = [];
    for await (const chunk of object?.body ?? new ReadableStream()) chunks.push((chunk as Uint8Array).byteLength);
    expect([chunks.length > 1, chunks.reduce((sum, size) => sum + size, 0), object?.size]).toEqual([true, text.length, text.length]);
    expect(io.restCalls[0]?.url).toBe(`${OBJECTS}/d1-backups/db%201/a%3F.sql`);
  });

  it("answers null for a key the bucket does not hold", async () => {
    expect(await remote().bucket.get("d1-backups/absent.sql")).toBeNull();
  });

  it("refuses a key with an empty, . or .. segment, before any request", async () => {
    const { io, bucket } = remote();
    for (const key of ["a//b.sql", "a/./b.sql", "a/../b.sql"])
      await expect(bucket.get(key)).rejects.toThrow("is not an object key this tool addresses");
    expect(io.restCalls).toEqual([]);
  });

  it("reports a network failure as an external refusal naming the object", async () => {
    const io = fakeDbIo();
    io.fetch = () => Promise.reject(new Error("socket hang up"));
    await expect(restBackupBucket(io, REMOTE_AUTH, "b").get("k.sql")).rejects.toThrow(
      "reading k.sql from b failed: network error — socket hang up",
    );
  });
});

describe("restBackupBucket() — put", () => {
  it("streams a stated-length body, half duplex, with its length and content type", async () => {
    const { io, store, bucket } = remote();
    let seen: RequestInit | undefined;
    io.restRules.unshift({
      match: (_url, init) => {
        seen = init;
        return false;
      },
      reply: new Response(),
    });
    const body = new Response("abc").body as ReadableStream<Uint8Array>;
    await bucket.put("d1-backups/a.json", body, { contentLength: 3, httpMetadata: { contentType: "application/json" } });
    expect(new TextDecoder().decode(store.objects.get("d1-backups/a.json")?.bytes)).toBe("abc");
    expect([seen?.method, (seen as { duplex?: string }).duplex, new Headers(seen?.headers).get("content-length")]).toEqual(["PUT", "half", "3"]);
    expect(new Headers(seen?.headers).get("content-type")).toBe("application/json");
  });

  it("refuses a body over 300 MiB before sending anything, naming wrangler and R2's S3 API, and cancels the stream", async () => {
    const { io, bucket } = remote();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const refused = bucket.put("d1-backups/big.sql", body, { contentLength: R2_REST_PUT_MAX_BYTES + 1 });
    await expect(refused).rejects.toThrow("`wrangler r2 object put`");
    await expect(refused).rejects.toThrow("upload it through R2's S3 API instead");
    expect([io.restCalls, cancelled]).toEqual([[], true]);
  });

  it("refuses a stream whose length is not stated", async () => {
    const { bucket } = remote();
    await expect(bucket.put("k.sql", new ReadableStream<Uint8Array>())).rejects.toThrow("a stream body needs its contentLength stated");
  });

  it("reports Cloudflare's refusal of a write", async () => {
    const io = fakeDbIo();
    io.restRules.push({ match: () => true, reply: cfRefusal(10004, "Bucket is read only", 400) });
    await expect(restBackupBucket(io, REMOTE_AUTH, "b").put("k.sql", "x")).rejects.toThrow(
      "writing k.sql to b failed: Bucket is read only (Cloudflare error 10004, HTTP 400)",
    );
  });
});

describe("restBackupBucket() — delete", () => {
  it("deletes each key with its own DELETE, and treats a key already gone as deleted", async () => {
    const { io, store, bucket } = remote();
    await put(store, "d1-backups/db/a.sql", "a");
    await bucket.delete(["d1-backups/db/a.sql", "d1-backups/db/gone.sql"]);
    expect(io.restCalls.map(({ url, method }) => [method, url])).toEqual([
      ["DELETE", `${OBJECTS}/d1-backups/db/a.sql`],
      ["DELETE", `${OBJECTS}/d1-backups/db/gone.sql`],
    ]);
    expect([...store.objects.keys()]).toEqual([]);
  });

  it("reports Cloudflare's refusal of a delete", async () => {
    const io = fakeDbIo();
    io.restRules.push({ match: () => true, reply: cfRefusal(10004, "Bucket is read only", 400) });
    await expect(restBackupBucket(io, REMOTE_AUTH, "b").delete("k.sql")).rejects.toThrow(
      "deleting k.sql from b failed: Bucket is read only (Cloudflare error 10004, HTTP 400)",
    );
  });
});

describe("restBackupBucket() — what the REST endpoint does not offer", () => {
  it("refuses a multipart upload, which nothing on this path calls", async () => {
    const { bucket } = remote();
    await expect(bucket.createMultipartUpload("k.sql")).rejects.toThrow("createMultipartUpload is not offered");
  });
});

describe("restBackupBucket() — bounded waits", () => {
  const FAST = { requestMs: 20, idleMs: 20 };

  /** A fetch that is accepted and never answered, failing only when its signal aborts. */
  const hanging = (_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));

  /** A body that sends one chunk and then nothing more. */
  const stalling = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("PRAGMA"));
      },
    });

  it("fails a listing and a read that Cloudflare accepts and never answers, within the request timeout", async () => {
    const io = fakeDbIo();
    io.fetch = hanging;
    const bucket = restBackupBucket(io, REMOTE_AUTH, "b", FAST);
    await expect(bucket.list()).rejects.toThrow("listing b got no answer within 0.02 s");
    await expect(bucket.get("k.sql")).rejects.toThrow("reading k.sql from b got no answer within 0.02 s");
  });

  it("fails a write that answers nothing once its body is sent, within the request timeout", async () => {
    const io = fakeDbIo();
    io.fetch = hanging;
    await expect(restBackupBucket(io, REMOTE_AUTH, "b", FAST).put("k.sql", "x")).rejects.toThrow(
      "writing k.sql to b made no progress within 0.02 s",
    );
  });

  it("fails a body that stalls between chunks on the idle timeout, after passing what did arrive", async () => {
    const io = fakeDbIo();
    io.restRules.push({ match: () => true, reply: () => new Response(stalling()) });
    const object = await restBackupBucket(io, REMOTE_AUTH, "b", FAST).get("k.sql");
    const reader = (object?.body ?? new ReadableStream()).getReader();
    expect(new TextDecoder().decode((await reader.read()).value as Uint8Array)).toBe("PRAGMA");
    await expect(reader.read()).rejects.toThrow("reading k.sql from b sent nothing within 0.02 s");
  });

  it("lets a slow body through while every chunk arrives inside the idle timeout", async () => {
    const io = fakeDbIo();
    let sent = 0;
    const slow = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (sent++ === 5) return controller.close();
        controller.enqueue(new TextEncoder().encode("ab"));
      },
    });
    io.restRules.push({ match: () => true, reply: () => new Response(slow) });
    const object = await restBackupBucket(io, REMOTE_AUTH, "b", { requestMs: 20, idleMs: 40 }).get("k.sql");
    expect(await object?.text()).toBe("ab".repeat(5));
  });

  it("fails a listing whose body stalls, on the idle timeout", async () => {
    const io = fakeDbIo();
    io.restRules.push({ match: () => true, reply: () => new Response(stalling()) });
    await expect(restBackupBucket(io, REMOTE_AUTH, "b", FAST).list()).rejects.toThrow("listing b sent nothing within 0.02 s");
  });
});
