import type { BackupBucket, BackupListing, BackupStoredObject } from "../../../storage/backup/types";
import { v } from "../../../validation/validation";
import { CF_API_BASE_URL } from "../../cf/api/client";
import { R2_PERMISSION, r2ObjectPath, r2ObjectsPath } from "../../cf/api/endpoints";
import { CF_ENVELOPE, CF_OPERATIONS } from "../../cf/api/operations";
import type { CfAuth } from "../../cf/types";
import { CliError } from "../../cli/errors";
import { D1_REQUEST_TIMEOUT_MS } from "../remote";
import type { DbIo } from "../types";
import type { RestBucketTimeouts } from "./types";

/** The largest body Cloudflare's REST object endpoint takes, the cap `wrangler r2 object put` holds too. @internal */
export const R2_REST_PUT_MAX_BYTES = 300 * 1024 * 1024;

const LIST_PAGE_SIZE = 1000;

/** How long a request may go without an answer or an upload's progress, and a download between two chunks. @internal */
export const REST_BUCKET_TIMEOUTS: RestBucketTimeouts = { requestMs: D1_REQUEST_TIMEOUT_MS, idleMs: 60_000 };

/** A wait that fails once `ms` pass without a `touch`: its signal aborts and `stalled` rejects, both with the same refusal. */
function watchdog(ms: number, what: string): { signal: AbortSignal; stalled: Promise<never>; touch(): void; stop(): void } {
  const controller = new AbortController();
  let fail: (error: CliError) => void = () => {};
  const stalled = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  stalled.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const timedOut = new CliError("external", `${what} within ${ms / 1000} s`);
      controller.abort(timedOut);
      fail(timedOut);
    }, ms);
  };
  touch();
  return { signal: controller.signal, stalled, touch, stop: () => clearTimeout(timer) };
}

/** `body` failing once it goes `idleMs` without a chunk, so a stalled download ends rather than waits. */
function idleBounded(body: ReadableStream<Uint8Array>, idleMs: number, what: string): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const dog = watchdog(idleMs, `${what} sent nothing`);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await Promise.race([reader.read(), dog.stalled]);
        if (done) {
          dog.stop();
          return controller.close();
        }
        dog.touch();
        controller.enqueue(value);
      } catch (error) {
        dog.stop();
        await reader.cancel(error).catch(() => {});
        throw error;
      }
    },
    async cancel(reason) {
      dog.stop();
      await reader.cancel(reason);
    },
  });
}

async function refusal(what: string, res: Response): Promise<CliError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = v.safeParse(CF_ENVELOPE, body);
  const first = parsed.success ? parsed.output.errors[0] : undefined;
  const detail =
    first === undefined
      ? `HTTP ${res.status}`
      : `${first.message} (${first.code === undefined ? "" : `Cloudflare error ${first.code}, `}HTTP ${res.status})`;
  const hint = res.status === 401 || res.status === 403 ? ` — the --api-token needs ${R2_PERMISSION}` : "";
  return new CliError("external", `${what} failed: ${detail}${hint}`);
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unsupported(verb: string): Error {
  return new Error(`restBackupBucket: ${verb} is not offered over Cloudflare's REST object endpoint`);
}

function bodyLength(
  value: string | Uint8Array | ReadableStream<Uint8Array>,
  stated: number | undefined,
): { body: Uint8Array | ReadableStream<Uint8Array>; size: number } {
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return { body: bytes, size: bytes.byteLength };
  }
  if (value instanceof Uint8Array) return { body: value, size: value.byteLength };
  if (stated === undefined) throw new Error("restBackupBucket: a stream body needs its contentLength stated");
  return { body: value, size: stated };
}

/** The R2 bucket `bucketName` reached over Cloudflare's REST object endpoint, as the surface the backup readers take. @internal */
export function restBackupBucket(io: DbIo, auth: CfAuth, bucketName: string, timeouts: RestBucketTimeouts = REST_BUCKET_TIMEOUTS): BackupBucket {
  const authorization = { Authorization: `Bearer ${auth.apiToken}` };
  const objectUrl = (key: string) => {
    if (key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new CliError("invalid-args", `${key} is not an object key this tool addresses — a key holds no empty, . or .. segment`);
    }
    return `${CF_API_BASE_URL}${r2ObjectPath(auth.accountId, bucketName, key)}`;
  };
  const reach = async (
    what: string,
    url: string,
    init: RequestInit,
    dog = watchdog(timeouts.requestMs, `${what} got no answer`),
  ): Promise<Response> => {
    try {
      const res = await Promise.race([io.fetch(url, { ...init, signal: dog.signal }), dog.stalled]);
      dog.stop();
      return res;
    } catch (error) {
      dog.stop();
      if (dog.signal.aborted) throw dog.signal.reason;
      throw new CliError("external", `${what} failed: network error — ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  };
  let answeredCursors = new Set<string>();

  return {
    async list(options = {}): Promise<BackupListing> {
      if (options.cursor === undefined) answeredCursors = new Set();
      const what = `listing ${bucketName}`;
      const query = new URLSearchParams({ per_page: String(LIST_PAGE_SIZE) });
      if (options.prefix !== undefined) query.set("prefix", options.prefix);
      if (options.cursor !== undefined) query.set("cursor", options.cursor);
      const res = await reach(what, `${CF_API_BASE_URL}${r2ObjectsPath(auth.accountId, bucketName)}?${query.toString()}`, {
        headers: authorization,
      });
      if (!res.ok) throw await refusal(what, res);
      const text = res.body === null ? "" : await new Response(idleBounded(res.body, timeouts.idleMs, what)).text();
      const envelope = v.safeParse(CF_ENVELOPE, parsedJson(text));
      const objects = envelope.success ? v.safeParse(CF_OPERATIONS.listR2Objects.result, envelope.output.result) : null;
      if (!envelope.success || objects === null || !objects.success) {
        throw new CliError("external", `${what} failed: ${CF_OPERATIONS.listR2Objects.name} answered an unexpected shape`);
      }
      const info = envelope.output.result_info;
      const cursor = info?.cursor ?? undefined;
      const listed = objects.output.map(({ key, size }) => ({ key, size }));
      if (info?.is_truncated !== true || cursor === undefined || cursor === "") return { objects: listed, truncated: false };
      if (answeredCursors.has(cursor))
        throw new CliError("external", `${what} failed: a page returned cursor ${cursor}, which an earlier page already returned`);
      answeredCursors.add(cursor);
      return { objects: listed, truncated: true, cursor };
    },

    async get(key): Promise<BackupStoredObject | null> {
      const what = `reading ${key} from ${bucketName}`;
      const res = await reach(what, objectUrl(key), { headers: authorization });
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok || res.body === null) throw await refusal(what, res);
      const body = idleBounded(res.body, timeouts.idleMs, what);
      return { size: Number(res.headers.get("content-length") ?? -1), body, text: () => new Response(body).text() };
    },

    async put(key, value, options = {}) {
      const what = `writing ${key} to ${bucketName}`;
      const { body, size } = bodyLength(value, options.contentLength);
      if (size > R2_REST_PUT_MAX_BYTES) {
        if (body instanceof ReadableStream) await body.cancel();
        throw new CliError(
          "invalid-args",
          `${key} is ${size} bytes, and Cloudflare's REST object endpoint — the one \`wrangler r2 object put\` uses — takes at most ${R2_REST_PUT_MAX_BYTES} — upload it through R2's S3 API instead`,
        );
      }
      const headers: Record<string, string> = { ...authorization, "Content-Length": String(size) };
      const contentType = options.httpMetadata?.contentType;
      if (contentType !== undefined) headers["Content-Type"] = contentType;
      // Bounded by progress, not in total: each chunk the upload takes restarts the wait, so a slow large push still completes.
      const dog = watchdog(timeouts.requestMs, `${what} made no progress`);
      const sent =
        body instanceof ReadableStream
          ? body.pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                  dog.touch();
                  controller.enqueue(chunk);
                },
              }),
            )
          : body;
      const init = { method: "PUT", headers, body: sent, duplex: "half" } as RequestInit;
      const res = await reach(what, objectUrl(key), init, dog);
      if (!res.ok) throw await refusal(what, res);
      await res.body?.cancel();
      return {};
    },

    async delete(keys) {
      for (const key of typeof keys === "string" ? [keys] : keys) {
        const what = `deleting ${key} from ${bucketName}`;
        const res = await reach(what, objectUrl(key), { method: "DELETE", headers: authorization });
        if (!res.ok && res.status !== 404) throw await refusal(what, res);
        await res.body?.cancel();
      }
    },
    createMultipartUpload: () => Promise.reject(unsupported("createMultipartUpload")),
  };
}
