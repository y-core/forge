// workerd's `Response` carries the accepted socket of a 101; the ambient lib types do not declare it.
type UpgradeResponse = Response & { readonly webSocket?: unknown };

/** Copies `response` under new `headers`, keeping a 101's `webSocket` so an upgrade survives the copy. @internal */
export function rebuildResponse(response: Response, headers: Headers): Response {
  const init: ResponseInit & { webSocket: unknown } = {
    status: response.status,
    statusText: response.statusText,
    headers,
    webSocket: (response as UpgradeResponse).webSocket ?? null,
  };
  return new Response(response.body, init);
}
