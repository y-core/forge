// Socket routes behind the middleware and the `definePage` rebuild, run inside workerd because Bun
// drops `webSocket` from a `Response` and so cannot show the upgrade survives.
import { createController } from "@remix-run/fetch-router";
import { createRoutes, Route } from "@remix-run/fetch-router/routes";

import { Forge } from "../../../src/app/forge-app";
import { definePage } from "../../../src/app/page";
import { setPendingHeader } from "../../../src/context/pending-headers";
import { isWebSocketUpgrade } from "../../../src/http/upgrade";
import { cors } from "../../../src/security/cors";
import { createSecurityHeaders } from "../../../src/security/headers";

declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket & { accept(): void } };

function echoSocket(request: Request): Response {
  if (!isWebSocketUpgrade(request)) return new Response("Upgrade Required", { status: 426 });
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.addEventListener("message", (event) => server.send(`echo:${String(event.data)}`));
  return new Response(null, { status: 101, webSocket: client } as ResponseInit);
}

const routes = createRoutes({ live: new Route("GET", "/live"), page: new Route("GET", "/page-live") });

const app = new Forge();

app.use("*", createSecurityHeaders());
app.use("*", cors({ origins: ["https://example.com"] }));
app.use("*", async (context, next) => {
  setPendingHeader(context, "set-cookie", "seen=1; Path=/", { append: true });
  return next();
});

app.map(
  routes,
  createController(routes, {
    actions: {
      live: ({ request }) => echoSocket(request),
      page: definePage({ headers: { "x-page": "live" }, loader: (c) => echoSocket(c.request), view: () => new Response("unreachable") }),
    },
  }),
);

export default { fetch: (request: Request, env: unknown, ctx: ExecutionContext) => app.fetch(request, env, ctx) };
