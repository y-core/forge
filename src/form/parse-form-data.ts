import type { RequestContext } from "@remix-run/fetch-router";
import { FORM_MAX_BYTES_DEFAULT } from "./config";
import type { ParseFormDataOptions, ReadonlyFormData } from "./types";

/** A single shared body parse plus the byte count every caller re-checks against its own cap. */
interface ParsedBody {
  formData: ReadonlyFormData;
  size: number;
}

const cache = new WeakMap<Request, Promise<ParsedBody>>();

/** Builds a 413 error carrying an HTTP status, surfaced by callers as a 413 response. */
function tooLarge(maxBytes: number): Error & { status: number } {
  return Object.assign(new Error(`Form body exceeds ${maxBytes} byte limit`), { status: 413 });
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
  // biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for form-data parsing
  context: RequestContext<any, any>,
  options: ParseFormDataOptions = {},
): Promise<ReadonlyFormData> {
  const req = context.request;
  const maxBytes = options.maxBytes ?? FORM_MAX_BYTES_DEFAULT;
  let cached = cache.get(req);
  if (!cached) {
    cached = parseWithByteLimit(req, maxBytes);
    // Pre-attached so a cache entry nobody awaits cannot surface as an unhandled rejection.
    cached.catch(() => {});
    cache.set(req, cached);
  }
  return cached.then((parsed) => {
    if (parsed.size > maxBytes) throw tooLarge(maxBytes);
    return parsed.formData;
  });
}
