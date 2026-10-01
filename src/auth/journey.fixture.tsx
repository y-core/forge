/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { Forge } from "../app/forge-app";
import { metaTags } from "../app/meta";
import { applyMiddlewareChain } from "../app/middleware-chain";
import type { PageShell } from "../app/types";
import { contextVar } from "../context/accessor";
import type { AppContext } from "../context/types";
import { csrfProtection, importCsrfKey } from "../form/csrf";
import type { CsrfSecretResolver } from "../form/types";
import { ok } from "../result/result";
import { createAnonymousSession } from "../session/anonymous";
import { sessionCtx } from "../session/session";
import { createD1Client } from "../storage/db/client";
import type { D1DatabaseLike } from "../storage/db/types";
import type { KVNamespace } from "../storage/kv/types";
import { Announcer } from "../ui/core/announcer";
import { createEmailOtpFactor } from "./factors/email-otp";
import { createPasskeyFactor } from "./factors/passkey";
import { createRecoveryCodeFactor } from "./factors/recovery-code";
import { createFactorRegistry } from "./factors/registry";
import { createTotpAppFactor } from "./factors/totp-app";
import { createEmailChangeFlow } from "./flows/email-change";
import { createSigninFlow } from "./flows/signin";
import { createSignupFlow } from "./flows/signup";
import { importAuthKeyRing } from "./keys/ring";
import { createAdminUserStore } from "./stores/admin-users";
import { createChallengeStore } from "./stores/challenges";
import { createCredentialStore } from "./stores/credentials";
import { createFactorStore } from "./stores/factors";
import { createNonceStore } from "./stores/nonces";
import { createOtpStateStore } from "./stores/otp-state";
import { createRecoveryCodeStore } from "./stores/recovery-codes";
import { createUserStore } from "./stores/users";
import type { AuthNotifier, UserStore } from "./types";
import { createAuthGuards, resolveAuth } from "./web/guards";
import { AUTH_NAV_SIGNOUT_SLOT, authNav } from "./web/nav";
import { authEnrolmentPaths, authPaths } from "./web/paths";
import { registerAccount, registerAdmin, registerAuth } from "./web/register";
import { accountRoutes, adminRoutes, authRoutes } from "./web/routes";
import type { AuthRequestServices, AuthWebOptions } from "./web/types";

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

const servicesCtx = contextVar<Promise<AuthRequestServices>>("journeyAuthServices");

const csrfKey: CsrfSecretResolver = (context) => importCsrfKey((context as AppContext<JourneyEnv>).env.CSRF_SECRET);

// wrangler prints a logged object across several lines, so the notice is one line of JSON instead.
const notifier: AuthNotifier = {
  send(message) {
    console.log(`${JOURNEY_NOTICE}${JSON.stringify({ kind: message.kind, to: message.to, code: message.code })}`);
    return Promise.resolve(ok());
  },
};

async function addressOf(users: UserStore, userId: string): Promise<string> {
  const found = await users.findById(userId);
  if (!found.ok || found.data === null) throw new Error("journey: no address for the identity a challenge was issued to");
  return found.data.email;
}

async function buildServices(c: AppContext<JourneyEnv>): Promise<AuthRequestServices> {
  const keys = await importAuthKeyRing([c.env.AUTH_KEY_RING]);
  const db = createD1Client(c.env.DB as never);
  const users = createUserStore(db);
  const enrolments = createFactorStore(db);
  const credentials = createCredentialStore(db);
  const state = createOtpStateStore(db);
  const nonces = createNonceStore(db);
  const address = (userId: string): Promise<string> => addressOf(users, userId);

  const factors = createFactorRegistry(enrolments, {
    offered: [
      { service: createEmailOtpFactor({ keys, state, nonces, notifier, address }), role: "primary" },
      {
        service: createTotpAppFactor({ keys, factors: enrolments, issuer: "Forge journey", account: address }),
        role: "second",
        requirement: "mandatory",
      },
      {
        service: createPasskeyFactor({
          rpId: c.url.hostname,
          rpName: "Forge journey",
          // http, not `c.url`'s scheme: the dev server stamps https onto the URL the Worker sees, while
          // the client data a passkey signs carries the http origin the page was loaded from.
          origin: `http://${c.url.host}`,
          sessionId: sessionCtx.get(c).id,
          users,
          factors: enrolments,
          credentials,
          challenges: createChallengeStore(db),
          subject: async (userId) => {
            const email = await address(userId);
            return { name: email, displayName: email };
          },
        }),
        role: "second",
        requirement: "optional",
      },
      { service: createRecoveryCodeFactor({ factors: enrolments, codes: createRecoveryCodeStore(db) }), role: "second", requirement: "optional" },
    ],
  });
  const defer = (work: Promise<unknown>): void => c.executionCtx.waitUntil(work);

  return {
    users,
    credentials,
    factors,
    enrolments,
    signin: createSigninFlow({ keys, users, factors, state, nonces, defer }),
    signup: createSignupFlow({ users, factors, defer }),
    emailChange: createEmailChangeFlow({ keys, users, nonces, notifier, defer, confirmUrl: (token) => `${c.url.origin}/?token=${token}` }),
    admin: createAdminUserStore(db),
  };
}

function resolveServices(c: AppContext<JourneyEnv>): Promise<AuthRequestServices> {
  const resolved = servicesCtx.getOptional(c);
  if (resolved !== undefined) return resolved;
  const building = buildServices(c);
  servicesCtx.set(c, building);
  return building;
}

const nav = authNav({ signoutPath: paths.auth.signout(), secret: csrfKey });

const shell: PageShell<JourneyEnv> = async (c, content, slot) => (
  <html lang='en'>
    <head>
      <meta charset='utf-8' />
      {metaTags(slot.meta)}
      <script type='module' src={JOURNEY_SCRIPT} />
    </head>
    <body>
      <Announcer />
      <nav>{(await nav(c)).slots[AUTH_NAV_SIGNOUT_SLOT]}</nav>
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
    session: createAnonymousSession<JourneyEnv>({ secret: (c) => c.env.SESSION_SECRET, kv: (c) => c.env.KV }),
    globals: [
      csrfProtection({ secret: csrfKey, subject: (c) => sessionCtx.getOptional(c)?.id }),
      resolveAuth<JourneyEnv>({ users: async (c) => (await resolveServices(c)).users }),
    ],
    guards: createAuthGuards<JourneyEnv>({
      routes: { auth: authMap, account: accountMap, admin: adminMap },
      auth: { users: async (c) => (await resolveServices(c)).users, signinPath: paths.auth.signin() },
      enrolment: {
        factors: async (c) => (await resolveServices(c)).factors,
        enrolmentPaths: authEnrolmentPaths(paths.auth),
        stepUpPath: paths.auth.verify.show(),
        settledPath: paths.account.passkeys(),
      },
      origin: { allowedOrigins: (c) => [c.url.origin] },
    }),
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
