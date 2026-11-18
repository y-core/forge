import { ContentRange, IfMatch, IfNoneMatch, IfRange, Range } from "../../http/headers";
import { isActiveContentType } from "./content-type";
import { UnsatisfiableRangeError } from "./errors";
import type { ObjectBody, ObjectStorageBackend, ServeOptions, StoreGetOptions, StoredObject } from "./types";

type ByteRange = { start?: number; end?: number };

const CONDITIONAL_HEADERS = ["If-Match", "If-Unmodified-Since", "If-None-Match", "If-Modified-Since"] as const;

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

function asciiFallbackFilename(filename: string): string {
  const approximated = filename
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/(["\\])/g, "\\$1");
  return approximated === "" ? "download" : approximated;
}

function filenameOf(key: string): string {
  return key.split("/").pop() ?? key;
}

function contentDisposition(type: "inline" | "attachment", filename: string): string {
  // encodeURIComponent leaves a few non-attr-chars unescaped; encode them too for a strict ext-value.
  const encoded = encodeURIComponent(filename).replace(/['()*!]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${asciiFallbackFilename(filename)}"; filename*=UTF-8''${encoded}`;
}

function buildHeaders(obj: ObjectBody, opts?: ServeOptions): Headers {
  const h = new Headers();
  if (obj.contentType) h.set("Content-Type", obj.contentType);
  if (obj.contentEncoding) h.set("Content-Encoding", obj.contentEncoding);
  if (obj.contentLanguage) h.set("Content-Language", obj.contentLanguage);
  h.set("ETag", obj.httpEtag);
  h.set("Last-Modified", obj.uploaded.toUTCString());
  h.set("Accept-Ranges", "bytes");
  // `nosniff` stops a sniff *into* a type and does nothing once the stored type already is one the
  // browser executes, so an active type is downloaded under an empty sandbox instead of rendered.
  h.set("X-Content-Type-Options", "nosniff");
  const active = obj.contentType !== undefined && isActiveContentType(obj.contentType);
  if (active) h.set("Content-Security-Policy", "sandbox");
  const cc = opts?.cacheControl ?? obj.cacheControl;
  if (cc) h.set("Cache-Control", cc);
  if (opts?.contentDisposition) {
    h.set("Content-Disposition", contentDisposition(opts.contentDisposition, filenameOf(obj.key)));
  } else if (active) {
    // A stored `inline` on an active type is the attack, so the caller states a disposition or gets
    // this one.
    h.set("Content-Disposition", contentDisposition("attachment", filenameOf(obj.key)));
  } else if (obj.contentDisposition !== undefined && PRINTABLE_ASCII.test(obj.contentDisposition)) {
    // A stored disposition carrying a non-Latin-1 byte throws from `Headers.set`, so it is dropped
    // rather than turned into a 500.
    h.set("Content-Disposition", obj.contentDisposition);
  }
  return h;
}

function toSeconds(time: Date | number): number {
  return Math.floor((time instanceof Date ? time.getTime() : time) / 1000);
}

function httpDate(header: string | null): number | undefined {
  if (header === null) return undefined;
  const parsed = Date.parse(header);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function validatorHeaders(meta: StoredObject): Headers {
  return new Headers({ ETag: meta.httpEtag, "Last-Modified": meta.uploaded.toUTCString() });
}

function preconditionResponse(headers: Headers, meta: StoredObject): Response | undefined {
  const ifMatch = headers.get("If-Match");
  if (ifMatch !== null && !IfMatch.from(ifMatch).matches(meta.httpEtag)) {
    return new Response("Precondition Failed", { status: 412, headers: validatorHeaders(meta) });
  }
  const ifUnmodifiedSince = ifMatch === null ? httpDate(headers.get("If-Unmodified-Since")) : undefined;
  if (ifUnmodifiedSince !== undefined && toSeconds(meta.uploaded) > toSeconds(ifUnmodifiedSince)) {
    return new Response("Precondition Failed", { status: 412, headers: validatorHeaders(meta) });
  }
  const ifNoneMatch = IfNoneMatch.from(headers.get("If-None-Match"));
  const ifModifiedSince = ifNoneMatch.tags.length === 0 ? httpDate(headers.get("If-Modified-Since")) : undefined;
  const notModified =
    ifNoneMatch.matches(meta.httpEtag) || (ifModifiedSince !== undefined && toSeconds(meta.uploaded) <= toSeconds(ifModifiedSince));
  return notModified ? new Response(null, { status: 304, headers: validatorHeaders(meta) }) : undefined;
}

function requestedByteRange(headers: Headers, meta: StoredObject | null): ByteRange | undefined {
  const range = Range.from(headers.get("Range"));
  if (range.unit.toLowerCase() !== "bytes" || range.ranges.length !== 1) return undefined;
  if (meta !== null && !IfRange.from(headers.get("If-Range")).matches({ etag: meta.httpEtag, lastModified: meta.uploaded })) return undefined;
  return range.ranges[0];
}

function toStoreRange({ start, end }: ByteRange): NonNullable<StoreGetOptions["range"]> {
  if (start === undefined) return { suffix: end ?? 0 };
  if (end === undefined) return { offset: start };
  return { offset: start, length: Math.min(end - start + 1, Number.MAX_SAFE_INTEGER) };
}

function unsatisfiableRange(size: number | undefined): Response {
  return new Response("Range Not Satisfiable", {
    status: 416,
    headers: { "Content-Range": ContentRange.from({ unit: "bytes", size: size ?? "*" }).toString() },
  });
}

/** Serves an object from a storage backend, honouring RFC 9110 preconditions and a single byte `Range`. @public */
export async function serveObject(backend: ObjectStorageBackend, request: Request, key: string, options?: ServeOptions): Promise<Response> {
  const requestHeaders = request.headers;
  // RFC 9110 §14.2 defines Range for GET alone; any other method, HEAD included, ignores it.
  const honoursRange = request.method === "GET";
  const needsValidators =
    CONDITIONAL_HEADERS.some((name) => requestHeaders.has(name)) || (honoursRange && requestHeaders.has("If-Range") && requestHeaders.has("Range"));

  let meta: StoredObject | null = null;
  if (needsValidators) {
    meta = await backend.head(key);
    if (!meta) return new Response(null, { status: 404 });
    const refusal = preconditionResponse(requestHeaders, meta);
    if (refusal) return refusal;
  }

  const byteRange = honoursRange ? requestedByteRange(requestHeaders, meta) : undefined;
  const range = byteRange && new Range({ unit: "bytes", ranges: [byteRange] });
  if (range && !range.canSatisfy(meta?.size ?? Number.MAX_SAFE_INTEGER)) return unsatisfiableRange(meta?.size);

  let obj: ObjectBody | null;
  try {
    obj = await backend.get(key, byteRange ? { range: toStoreRange(byteRange) } : undefined);
  } catch (thrown) {
    // Only the type forge owns is caught, and the extra `head` is spent only here — a satisfiable
    // ranged read stays one round trip.
    if (!(thrown instanceof UnsatisfiableRangeError)) throw thrown;
    return unsatisfiableRange((meta ?? (await backend.head(key)))?.size);
  }
  if (!obj) return new Response(null, { status: 404 });

  const headers = buildHeaders(obj, options);

  if (range) {
    if (!range.canSatisfy(obj.size)) {
      await obj.body?.cancel();
      return unsatisfiableRange(obj.size);
    }
    const [served] = range.normalize(obj.size);
    if (served) {
      headers.set("Content-Range", ContentRange.from({ unit: "bytes", start: served.start, end: served.end, size: obj.size }).toString());
      headers.set("Content-Length", String(served.end - served.start + 1));
      return new Response(obj.body, { status: 206, headers });
    }
  }

  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
