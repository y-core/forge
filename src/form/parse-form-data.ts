import type { RequestContext } from "@remix-run/fetch-router";

import { FORM_MAX_BYTES_DEFAULT } from "./config";
import type { ParseFormDataOptions, ReadonlyFormData } from "./types";

/** A single shared body parse plus the byte count every caller re-checks against its own cap. */
interface ParsedBody {
  formData: ReadonlyFormData;
  size: number;
}

/** The shared parse, and the cap the body was actually metered at — `null` when no cap was consulted. */
interface CachedParse {
  parsed: Promise<ParsedBody>;
  meteredAt: number | null;
}

const cache = new WeakMap<Request, CachedParse>();

const CAP_CONFLICT_CODE = "form/body-cap-conflict";

/** Builds a 413 error carrying an HTTP status, surfaced by callers as a 413 response. */
function tooLarge(maxBytes: number): Error & { status: number } {
  return Object.assign(new Error(`Form body exceeds ${maxBytes} byte limit`), { status: 413 });
}

/** Builds the wiring error a caller raising the cap hits once an earlier, stricter caller has already metered the stream. */
function capConflict(meteredAt: number, maxBytes: number): Error & { code: string } {
  return Object.assign(
    new Error(
      `Form body was metered at ${meteredAt} bytes by an earlier parseFormData caller on this request and refused, so this ${maxBytes}-byte request cannot be served: the stream is gone. Raise the earlier caller's maxBytes — usually csrfProtection's — to at least ${maxBytes}.`,
    ),
    { code: CAP_CONFLICT_CODE },
  );
}

/** Whether `error` is the misconfiguration a later, larger `maxBytes` hits against an already-refused body, rather than an oversize submission. @public */
export function isFormCapConflict(error: unknown): boolean {
  return (error as { code?: unknown } | null | undefined)?.code === CAP_CONFLICT_CODE;
}

/** The cap the body will be metered at, or `null` for the bodyless parse that consults none. */
function meteringCap(req: Request, maxBytes: number): number | null {
  if (req.body !== null) return maxBytes;
  const contentLength = req.headers.get("content-length");
  return contentLength !== null && Number.isFinite(Number(contentLength)) ? maxBytes : null;
}

/** Parses the body through a counting transform that errors once the running total exceeds `maxBytes`. */
// The streaming count, not `Content-Length`, is what caps a chunked body whose header is absent or lying.
async function parseWithByteLimit(req: Request, maxBytes: number): Promise<ParsedBody> {
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) throw tooLarge(maxBytes);
  }

  if (!req.body) return { formData: await req.formData(), size: 0 };

  let seen = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        controller.error(tooLarge(maxBytes));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  // A `Response`, not a `Request`, wraps the metered stream: no `duplex` option is needed.
  const formData = await new Response(req.body.pipeThrough(counter), { headers: req.headers }).formData();
  return { formData, size: seen };
}

/** Reads the request body as form data once per request, capped at `maxBytes` and memoized so later callers share the parse. @public */
export function parseFormData(
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for form-data parsing
  context: RequestContext<any, any>,
  options: ParseFormDataOptions = {},
): Promise<ReadonlyFormData> {
  const req = context.request;
  const maxBytes = options.maxBytes ?? FORM_MAX_BYTES_DEFAULT;
  let cached = cache.get(req);
  if (!cached) {
    cached = { parsed: parseWithByteLimit(req, maxBytes), meteredAt: meteringCap(req, maxBytes) };
    // Pre-attached so a cache entry nobody awaits cannot surface as an unhandled rejection.
    cached.parsed.catch(() => {});
    cache.set(req, cached);
  }
  const entry = cached;
  return entry.parsed.then(
    (parsed) => {
      if (parsed.size > maxBytes) throw tooLarge(maxBytes);
      return parsed.formData;
    },
    (error: unknown) => {
      const refused = (error as { status?: unknown } | null | undefined)?.status === 413;
      // `bodyUsed: false` means the refusal came off the `Content-Length` header and never opened the
      // stream, so dropping the cached rejection lets a later, larger cap meter the body for itself.
      if (refused && !req.bodyUsed) {
        if (cache.get(req) === entry) cache.delete(req);
        throw error;
      }
      // Gated on the refusal, never on the caps alone: a body inside the strict cap parses fine and
      // the fulfilled branch above serves it, so only an already-refused parse is unrecoverable here.
      if (refused && entry.meteredAt !== null && maxBytes > entry.meteredAt) {
        throw capConflict(entry.meteredAt, maxBytes);
      }
      throw error;
    },
  );
}
