/**
 * Builds a `Request` for handler tests, replacing hand-rolled `new Request("http://test/…", {…})`
 * boilerplate. A relative `path` resolves against `baseUrl` (default `http://test`). Supply exactly
 * one body helper: `formData` (url-encoded record or a `FormData`), `json` (JSON body), or raw `body`.
 * The method defaults to `POST` when a body is supplied, else `GET`.
 *
 * @example
 * ```typescript
 * const req = buildRequest("/settings", { method: "POST", formData: { theme: "dark" } });
 * ```
 * @public
 */
export function buildRequest(
  path: string,
  opts?: {
    method?: string;
    headers?: HeadersInit;
    formData?: Record<string, string> | FormData;
    json?: unknown;
    body?: BodyInit;
    baseUrl?: string;
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
  return new Request(url, { method, headers, ...(body !== undefined ? { body } : {}) });
}
