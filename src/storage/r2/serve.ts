import type { ObjectBody, ObjectStorageBackend } from "./types";

/** Options for serveObject. @public */
export interface ServeOptions {
  cacheControl?: string;
  contentDisposition?: "inline" | "attachment";
}

function parseRange(header: string): { offset?: number; length?: number; suffix?: number } | null {
  const suffixMatch = /^bytes=-(\d+)$/.exec(header);
  if (suffixMatch) return { suffix: parseInt(suffixMatch[1], 10) };
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return null;
  const offset = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : undefined;
  return { offset, ...(end !== undefined ? { length: end - offset + 1 } : {}) };
}

function buildHeaders(obj: ObjectBody, opts?: ServeOptions): Headers {
  const h = new Headers();
  if (obj.contentType) h.set("Content-Type", obj.contentType);
  h.set("ETag", obj.httpEtag);
  h.set("Accept-Ranges", "bytes");
  const cc = opts?.cacheControl ?? obj.cacheControl;
  if (cc) h.set("Cache-Control", cc);
  if (opts?.contentDisposition) {
    const filename = obj.key.split("/").pop() ?? obj.key;
    h.set("Content-Disposition", `${opts.contentDisposition}; filename="${filename}"`);
  }
  return h;
}

/**
 * Serves an object from a storage backend with ETag / If-None-Match / Range support.
 * Returns 200, 206, 304, 404, or 416. @public
 */
export async function serveObject(
  backend: ObjectStorageBackend,
  request: Request,
  key: string,
  options?: ServeOptions,
): Promise<Response> {
  const ifNoneMatch = request.headers.get("If-None-Match");
  const rangeHeader = request.headers.get("Range");

  // Conditional GET without range: head to avoid downloading body
  if (ifNoneMatch && !rangeHeader) {
    const meta = await backend.head(key);
    if (!meta) return new Response(null, { status: 404 });
    if (ifNoneMatch === meta.httpEtag) {
      return new Response(null, { status: 304, headers: { ETag: meta.httpEtag } });
    }
  }

  let range: { offset?: number; length?: number; suffix?: number } | undefined;
  if (rangeHeader) {
    const parsed = parseRange(rangeHeader);
    if (!parsed) {
      return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": "bytes */*" } });
    }
    range = parsed;
  }

  const obj = await backend.get(key, range ? { range } : undefined);
  if (!obj) return new Response(null, { status: 404 });

  const headers = buildHeaders(obj, options);

  if (range) {
    const { offset = 0, length, suffix } = range;

    if (suffix !== undefined) {
      const start = Math.max(0, obj.size - suffix);
      const end = obj.size - 1;
      if (start > end) {
        return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${obj.size}` } });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${obj.size}`);
      headers.set("Content-Length", String(end - start + 1));
      return new Response(obj.body, { status: 206, headers });
    }

    if (offset >= obj.size) {
      return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${obj.size}` } });
    }
    const end = length !== undefined ? Math.min(offset + length - 1, obj.size - 1) : obj.size - 1;
    headers.set("Content-Range", `bytes ${offset}-${end}/${obj.size}`);
    headers.set("Content-Length", String(end - offset + 1));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
