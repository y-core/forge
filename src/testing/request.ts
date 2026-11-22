/** Builds a `Request` for handler tests from a path plus one of `formData`, `json`, or raw `body`. @public */
export function buildRequest(
  path: string,
  opts?: {
    method?: string;
    headers?: HeadersInit;
    formData?: Record<string, string> | FormData;
    json?: unknown;
    body?: BodyInit;
    baseUrl?: string;
    /** Bun-only: a browser's `Request` constructor refuses `"navigate"`, which Bun keeps. */
    mode?: RequestMode;
    /** Bun-only: Bun's `Request` reports `"include"` whatever it is given, so the value is pinned on the returned instance. */
    credentials?: RequestCredentials;
  },
): Request {
  const url = new URL(path, opts?.baseUrl ?? "http://test");
  const headers = new Headers(opts?.headers);

  let body: BodyInit | undefined;
  if (opts?.formData !== undefined) {
    if (opts.formData instanceof FormData) {
      body = opts.formData;
    } else {
      body = new URLSearchParams(opts.formData).toString();
      if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded");
    }
  } else if (opts?.json !== undefined) {
    body = JSON.stringify(opts.json);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  } else if (opts?.body !== undefined) {
    body = opts.body;
  }

  const method = opts?.method ?? (body !== undefined ? "POST" : "GET");
  const request = new Request(url, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
    ...(opts?.mode !== undefined ? { mode: opts.mode } : {}),
  });
  if (opts?.credentials !== undefined) Object.defineProperty(request, "credentials", { value: opts.credentials });
  return request;
}
