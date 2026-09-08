// The one route shape a consuming app's contact form has: `csrfProtection` ahead of a `defineAction`
// whose schema declares `name` first. Under Bun the co-located suites cover it; this fixture exists
// so the same chain is exercised where it actually runs — inside workerd.
import { createController } from "@remix-run/fetch-router";
import { createRoutes, Route } from "@remix-run/fetch-router/routes";

import { defineAction } from "../../../src/app/action";
import { Forge } from "../../../src/app/forge-app";
import { csrfProtection, importCsrfKey, mintCsrf } from "../../../src/form/csrf";
import { strictObject } from "../../../src/validation/strict-object";
import { v } from "../../../src/validation/validation";

interface Env {
  CSRF_SECRET: string;
}

const MAX_BYTES = 4096;

const ContactSchema = strictObject({
  name: v.pipe(v.string(), v.minLength(1)),
  email: v.pipe(v.string(), v.email()),
  message: v.pipe(v.string(), v.minLength(1)),
});

const routes = createRoutes({
  token: new Route("GET", "/api/contact"),
  contact: new Route("POST", "/api/contact"),
  guardedToken: new Route("GET", "/api/guarded"),
  guarded: new Route("POST", "/api/guarded"),
});

const app = new Forge<Env>();

app.use("/api/*", csrfProtection({ secret: (context) => importCsrfKey((context.env as Env).CSRF_SECRET), subject: false, maxBytes: MAX_BYTES }));

app.map(
  routes,
  createController(routes, {
    actions: {
      token: (context) => mintCsrf(context, "/api/contact").then((token) => new Response(token)),
      contact: defineAction<typeof ContactSchema, Env>({
        schema: ContactSchema,
        maxBytes: MAX_BYTES,
        handle: (data) => new Response(`<p>Thanks, ${data.name}.</p>`, { headers: { "content-type": "text/html" } }),
      }),
      guardedToken: (context) => mintCsrf(context, "/api/guarded").then((token) => new Response(token)),
      guarded: defineAction<typeof ContactSchema, Env>({
        schema: ContactSchema,
        maxBytes: MAX_BYTES,
        honeypot: "company",
        turnstile: { secretKey: () => "1x0000000000000000000000000000000AA", verify: () => ({ expectedHostname: "example.com" }) },
        handle: (data) => new Response(`<p>Thanks, ${data.name}.</p>`, { headers: { "content-type": "text/html" } }),
      }),
    },
  }),
);

export default { fetch: (request: Request, env: Env) => app.fetch(request, env) };
