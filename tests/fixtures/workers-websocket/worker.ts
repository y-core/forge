// Socket routes behind the middleware and the `definePage` rebuild, run inside workerd because Bun
// drops `webSocket` from a `Response` and so cannot show the upgrade survives.
import { createController } from "@remix-run/fetch-router";
import { createRoutes, Route } from "@remix-run/fetch-router/routes";

import { Forge } from "../../../src/app/forge-app";
import { definePage } from "../../../src/app/page";
import { setPendingHeader } from "../../../src/context/pending-headers";
import { getAppContext } from "../../../src/context/types";
import { isWebSocketUpgrade } from "../../../src/http/upgrade";
import { cors } from "../../../src/security/cors";
import { createSecurityHeaders } from "../../../src/security/headers";
import { resolveD1Client } from "../../../src/storage/db/bindings";
import { d1Sessions } from "../../../src/storage/db/session";
import { sql } from "../../../src/storage/db/sql";
import type { D1DatabaseLike } from "../../../src/storage/db/types";

declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket & { accept(): void } };

function echoSocket(request: Request): Response {
  if (!isWebSocketUpgrade(request)) return new Response("Upgrade Required", { status: 426 });
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.addEventListener("message", (event) => server.send(`echo:${String(event.data)}`));
  return new Response(null, { status: 101, webSocket: client } as ResponseInit);
}

type Env = { DB: D1DatabaseLike };

const routes = createRoutes({ live: new Route("GET", "/live"), page: new Route("GET", "/page-live"), d1: new Route("GET", "/d1-live") });

const app = new Forge();

app.use("*", createSecurityHeaders());
app.use("*", cors({ origins: ["https://example.com"] }));
app.use("*", async (context, next) => {
  setPendingHeader(context, "set-cookie", "seen=1; Path=/", { append: true });
  return next();
});
app.use("/d1-live", d1Sessions<Env>({ binding: (c) => c.env.DB, bookmark: { cookie: "d1b" } }));

app.map(
  routes,
  createController(routes, {
    actions: {
      live: ({ request }) => echoSocket(request),
      page: definePage({ headers: { "x-page": "live" }, loader: (c) => echoSocket(c.request), view: () => new Response("unreachable") }),
      d1: async (context) => {
        await resolveD1Client<Env>(getAppContext<Env>(context), { binding: (c) => c.env.DB })?.query(sql`SELECT 1`);
        return echoSocket(context.request);
      },
    },
  }),
);

export default { fetch: (request: Request, env: unknown, ctx: ExecutionContext) => app.fetch(request, env, ctx) };
