import type { ObjectBody, ObjectStorageBackend, ServeOptions } from "./types";

function parseRange(header: string): { offset?: number; length?: number; suffix?: number } | null {
  const suffixMatch = /^bytes=-(\d+)$/.exec(header);
  if (suffixMatch) {
    const suffix = parseInt(suffixMatch[1] ?? "", 10);
    if (Number.isNaN(suffix)) return null;
    return { suffix };
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return null;
  const offset = parseInt(match[1] ?? "", 10);
  const end = match[2] ? parseInt(match[2], 10) : undefined;
  if (Number.isNaN(offset)) return null;
  if (end !== undefined && Number.isNaN(end)) return null;
  if (end !== undefined && offset > end) return null;
  return { offset, ...(end !== undefined ? { length: end - offset + 1 } : {}) };
}

/** Approximates a filename in printable ASCII — a non-Latin-1 character reaching `Headers.set` throws and turns a legitimate download into a 500. */
function asciiFallbackFilename(filename: string): string {
  const approximated = filename
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/(["\\])/g, "\\$1");
  return approximated === "" ? "download" : approximated;
}

function contentDisposition(type: "inline" | "attachment", filename: string): string {
  // encodeURIComponent leaves a few non-attr-chars unescaped; encode them too for a strict ext-value.
  const encoded = encodeURIComponent(filename).replace(/['()*!]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${asciiFallbackFilename(filename)}"; filename*=UTF-8''${encoded}`;
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
    h.set("Content-Disposition", contentDisposition(opts.contentDisposition, filename));
  }
  return h;
}

/** Serves an object from a storage backend with ETag / If-None-Match / Range support. @public */
export async function serveObject(backend: ObjectStorageBackend, request: Request, key: string, options?: ServeOptions): Promise<Response> {
  const ifNoneMatch = request.headers.get("If-None-Match");
  const rangeHeader = request.headers.get("Range");

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
