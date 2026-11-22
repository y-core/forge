/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { Forge } from "../app/forge-app";
import { metaTags } from "../app/meta";
import { applyMiddlewareChain } from "../app/middleware-chain";
import type { PageShell } from "../app/types";
import { importKeyRing } from "../crypto/keyring/ring";
import type { KeyRingResolver } from "../crypto/keyring/types";
import type { JSXNode } from "../render/jsx/types";
import { ok } from "../result/result";
import { createAnonymousSession } from "../session/anonymous";
import { createD1Client } from "../storage/db/client";
import type { D1DatabaseLike } from "../storage/db/types";
import type { KVNamespace } from "../storage/kv/types";
import type { NavState } from "../ui/chrome/types";
import { Announcer } from "../ui/core/announcer";
import { importAuthKeyRing } from "./keys/ring";
import type { AuthNotifier } from "./types";
import { createAuthGuards, resolveAuth } from "./web/guards";
import { AUTH_NAV_SIGNOUT_SLOT, authNav } from "./web/nav";
import { authEnrolmentPaths, authPaths } from "./web/paths";
import { registerAccount, registerAdmin, registerAuth } from "./web/register";
import { accountRoutes, adminRoutes, authRoutes } from "./web/routes";
import { authRequestServices } from "./web/services";
import type { AuthWebOptions } from "./web/types";

// The real mount a deployment writes, every factor live, so `journey.browser.ts` drives what ships;
// `web/mount.test.ts` is the same composition with the ceremonies stubbed.

/** The bindings `tests/fixtures/auth-web/wrangler.jsonc` declares, and the secrets the spec writes per run. @internal */
export interface JourneyEnv extends Record<string, unknown> {
  readonly DB: D1DatabaseLike;
  readonly KV: KVNamespace;
  readonly AUTH_KEY_RING: string;
  readonly SESSION_SECRET: string;
  readonly CSRF_SECRET: string;
}

/** The path the shell loads the client bundle from, which the spec answers itself. @internal */
export const JOURNEY_SCRIPT = "/assets/journey.js";

/** Drops every table the DDL creates and applies it again, so a run never meets an earlier run's rows. @internal */
export const JOURNEY_RESET = "/__reset";

/** The prefix every notification line starts with, followed by its JSON. @internal */
export const JOURNEY_NOTICE = "auth.notify ";

const authMap = authRoutes("/auth");
const accountMap = accountRoutes("/account");
const adminMap = adminRoutes("/admin");
const paths = { auth: authPaths(authMap), account: authPaths(accountMap), admin: authPaths(adminMap) };

const csrfKey: KeyRingResolver<JourneyEnv> = (env) => importKeyRing([env.CSRF_SECRET]);

// wrangler prints a logged object across several lines, so the notice is one line of JSON instead.
const notifier: AuthNotifier = {
  send(message) {
    console.log(
      `${JOURNEY_NOTICE}${JSON.stringify({ kind: message.kind, to: message.to, code: message.kind === "otp" ? message.code : undefined })}`,
    );
    return Promise.resolve(ok());
  },
};

const resolveServices = authRequestServices<JourneyEnv>({
  auth: { ring: (env) => importAuthKeyRing([env.AUTH_KEY_RING]) },
  db: (c) => createD1Client(c.env.DB as never),
  notifier: () => notifier,
  defer: (c) => (work) => c.executionCtx.waitUntil(work),
  confirmUrl: (c, token) => `${c.url.origin}/?token=${token}`,
  // The starter's shape: the authenticator app mandatory, a passkey optional.
  secondFactors: {
    "totp-app": { issuer: "Forge journey", requirement: "mandatory" },
    passkey: {
      rpId: (c) => c.url.hostname,
      rpName: "Forge journey",
      // http, not `c.url`'s scheme: the dev server stamps https onto the URL the Worker sees, while
      // the client data a passkey signs carries the http origin the page was loaded from.
      origin: (c) => `http://${c.url.host}`,
      requirement: "optional",
    },
  },
});

const nav = authNav({ signoutPath: paths.auth.signout() });

function signoutControl(state: NavState): JSXNode {
  const slot = state.slots[AUTH_NAV_SIGNOUT_SLOT];
  return typeof slot === "function" ? slot({ inMenu: false }) : slot;
}

const shell: PageShell<JourneyEnv> = async (c, content, slot) => (
  <html lang='en'>
    <head>
      <meta charset='utf-8' />
      {metaTags(slot.meta)}
      <script type='module' src={JOURNEY_SCRIPT} />
    </head>
    <body>
      <Announcer />
      <nav>{signoutControl(await nav(c))}</nav>
      <main>{content}</main>
    </body>
  </html>
);

/** Each table the DDL creates, in the order it creates them. */
function tablesOf(ddl: string): string[] {
  return [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((match) => match[1] ?? "");
}

async function resetSchema(db: D1DatabaseLike, ddl: string): Promise<Response> {
  for (const table of tablesOf(ddl).reverse()) await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  const statements = ddl
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  for (const statement of statements) await db.prepare(statement).run();
  return new Response(null, { status: 204 });
}

/** The whole auth mount over real D1 and KV, in the order `web/mount.test.ts` holds it to. @internal */
export function journeyWorker(ddl: string): { fetch(request: Request, env: JourneyEnv, ctx: ExecutionContext): Promise<Response> } {
  const options: AuthWebOptions<JourneyEnv> = { resolveServices, paths, icon: () => null };
  const app = new Forge<JourneyEnv>();
  app.setShell(shell);

  applyMiddlewareChain<JourneyEnv>(app, {
    securityHeaders: { scriptSrc: ["'self'"] },
    session: createAnonymousSession<JourneyEnv>({ ring: (env) => importKeyRing([env.SESSION_SECRET]), kv: (env) => env.KV }),
    csrf: { ring: csrfKey, subject: "session" },
    globals: [resolveAuth<JourneyEnv>({ services: resolveServices })],
    contributions: [
      createAuthGuards<JourneyEnv>({
        routes: { auth: authMap, account: accountMap, admin: adminMap },
        auth: { services: resolveServices, signinPath: paths.auth.signin() },
        enrolment: {
          factors: async (c) => (await resolveServices(c)).factors,
          enrolmentPaths: authEnrolmentPaths(paths.auth),
          stepUpPath: paths.auth.verify.show(),
          settledPath: paths.account.passkeys(),
        },
        origin: { allowedOrigins: (c) => [c.url.origin] },
      }),
    ],
  });

  registerAuth(app, authMap, options);
  registerAccount(app, accountMap, options);
  registerAdmin(app, adminMap, options);

  return {
    async fetch(request, env, ctx) {
      if (new URL(request.url).pathname === JOURNEY_RESET && request.method === "POST") return resetSchema(env.DB, ddl);
      return app.fetch(request, env, ctx);
    },
  };
}
