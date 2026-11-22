/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { afterEach, describe, expect, it } from "bun:test";

import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../../app/forge-app";
import { applyMiddlewareChain } from "../../app/middleware-chain";
import type { MiddlewareContribution, MiddlewareGuardGroup } from "../../app/types";
import { createKeyRingResolver } from "../../crypto/keyring/resolver";
import { importKeyRing } from "../../crypto/keyring/ring";
import type { KeyRingResolver } from "../../crypto/keyring/types";
import { csrfMinterCtx } from "../../form/csrf";
import { csrfFieldCtx } from "../../form/csrf-context";
import { parseFormData } from "../../form/parse-form-data";
import { requestLog } from "../../logging/request-logger";
import type { RateLimit } from "../../security/types";
import { createAnonymousSession } from "../../session/anonymous";
import { sessionCtx, sessionMiddleware } from "../../session/session";
import { nullLogger } from "../../testing/context";
import { mapHandler } from "../../testing/route";
import { APPROVAL_TTL_MS } from "../config";
import type { AuthSessionStore } from "../types";
import { AUTH_FORM_MAX_BYTES } from "./actions";
import { APPROVAL_TURNSTILE_ACTION, defineApproval, registerApproval } from "./approval";
import { requireApproval } from "./guards";
import { AUTH_SESSION_TOKEN_KEY, establishAuthSession, NO_SESSION } from "./identity";
import type { Approval, ApprovalOptions } from "./types";
import {
  attrOf,
  elementOf,
  FAKE_APPROVAL_CODE,
  FAKE_RATE_LIMITS,
  fakeApproval,
  fakeLimiterContribution,
  fakeAuthSessionStore,
  fakeAuthUser,
  fakeSessionCookie,
  fakeWebRing,
  textOf,
} from "./web.fixture";

const ORIGIN = "https://app.example";

const ADMITTING: RateLimit = { limit: async () => ({ success: true }) };

/** `app` answering every request it is handed no bindings for under `{ LIMITER: limiter }`. */
function limitedBy<App extends Forge>(app: App, counter: RateLimit): App {
  const request = app.request.bind(app);
  app.request = (path: string, init?: RequestInit, env?: Record<string, unknown>) => request(path, init, env ?? { LIMITER: counter });
  return app;
}

/** The prompt mounted for `approval` with its contribution in the chain, a deterministic CSRF minter, and `/admin/users` behind its guard. */
function approvalApp(
  approval: Approval = fakeApproval(),
  warnings: unknown[] = [],
  ids: [string, string][] = [],
  { counter = ADMITTING, raisedParse = false, ...chain }: { trustCfHeaders?: boolean; counter?: RateLimit; raisedParse?: boolean } = {},
): Forge {
  const app = limitedBy(new Forge(), counter);
  app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
  if (raisedParse) {
    app.use("*", async (context, next) => {
      if (context.request.method === "POST") await parseFormData(context, { maxBytes: 1024 * 1024 });
      return next();
    });
  }
  app.use("*", async (context, next) => {
    const before = sessionCtx.get(context).id;
    const response = await next();
    ids.push([before, sessionCtx.get(context).id]);
    return response;
  });
  app.use("*", (context, next) => {
    csrfMinterCtx.set(context, (path) => Promise.resolve(`csrf-for:${path}`));
    csrfFieldCtx.set(context, "_csrf");
    requestLog.set(context, { ...nullLogger, warn: (message: string, data?: Record<string, unknown>) => void warnings.push([message, data]) });
    return next();
  });
  applyMiddlewareChain(app, {
    securityHeaders: {},
    ...chain,
    rateLimits: FAKE_RATE_LIMITS,
    contributions: [mintFaked(approval.contribution), fakeLimiterContribution],
  });
  registerApproval(app, approval);
  app.use("/admin/users", requireApproval(approval));
  mapHandler(app, "GET", "/admin/users", () => new Response("users"));
  return app;
}

/** `contribution` asking no CSRF policy to cover its path, for an app whose minter is faked in place of one. */
function mintFaked(contribution: MiddlewareContribution): MiddlewareContribution {
  return { ...contribution, csrfCovers: undefined };
}

function presented(fields: Record<string, string>, cookie?: string): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams(fields).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
  };
}

function sessionCookie(res: Response): string {
  return (
    res.headers
      .getSetCookie()
      .find((header) => header.startsWith("__session="))
      ?.split(";")[0] ?? ""
  );
}

async function refusal(res: Response) {
  return { status: res.status, error: textOf(await res.text(), "p", 'id="field-code-error"') };
}

describe("defineApproval", () => {
  it("holds an approval for 15 minutes unless told otherwise", () => {
    expect(fakeApproval().ttlMs).toBe(APPROVAL_TTL_MS);
    expect(APPROVAL_TTL_MS).toBe(900_000);
  });

  it("asks the CSRF policy to cover its prompt at a non-default mount", () => {
    expect(fakeApproval({ path: "/members/approve" }).contribution.csrfCovers).toEqual(["/members/approve"]);
  });

  it("keeps a window it is given, and freezes what it returns", () => {
    const approval = fakeApproval({ ttlMs: 60_000 });
    expect({ ttlMs: approval.ttlMs, frozen: Object.isFrozen(approval) }).toEqual({ ttlMs: 60_000, frozen: true });
  });

  it("refuses a window under a second, which no approval could ever be inside", () => {
    expect(() => fakeApproval({ ttlMs: 999 })).toThrow("defineApproval: ttlMs is 999, below the 1000-millisecond floor");
  });

  it("refuses a definition with no origin policy, since the prompt answers a POST", () => {
    const untyped = { path: "/approve", code: () => FAKE_APPROVAL_CODE } as unknown as Parameters<typeof defineApproval>[0];
    expect(() => defineApproval(untyped)).toThrow("defineApproval: no `origin` policy was passed");
  });

  it("refuses a definition with no rate limit, since the prompt answers anyone's guess at a shared code", () => {
    const { rateLimit: _, ...untyped } = fakeApproval();
    expect(() => defineApproval(untyped as unknown as Parameters<typeof defineApproval>[0])).toThrow("defineApproval: no `rateLimit` was passed");
  });

  it("refuses a definition with no key ring, which the approval's digest of the code is signed under", () => {
    const { ring: _, ...untyped } = fakeApproval();
    expect(() => defineApproval(untyped as unknown as Parameters<typeof defineApproval>[0])).toThrow("defineApproval: no `ring` was passed");
  });

  it("resolves its key ring once across requests under one env", async () => {
    let calls = 0;
    const app = approvalApp(
      fakeApproval({
        ring: () => {
          calls++;
          return fakeWebRing;
        },
      }),
    );
    const env = { LIMITER: ADMITTING };
    await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }), env);
    await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }), env);
    expect(calls).toBe(1);
  });
});

describe("defineApproval — a ring over the app's Bindings", () => {
  interface Env {
    readonly APPROVAL_SECRET: string;
  }
  const options = {
    path: "/approve",
    code: () => FAKE_APPROVAL_CODE,
    origin: { allowedOrigins: [ORIGIN] },
    rateLimit: { binding: "LIMITER", key: () => "visitor" },
  };

  it("refuses a binding Env does not declare at bun check, and takes one it does", () => {
    const missing = () =>
      defineApproval<Env>({
        ...options,
        // @ts-expect-error — `APPROVAL_SECRETS` is not a binding of Env
        ring: (env) => importKeyRing([env.APPROVAL_SECRETS]),
      });
    const declared = () => defineApproval<Env>({ ...options, ring: (env) => importKeyRing([env.APPROVAL_SECRET]) });
    void [missing, declared];
  });
});

describe("defineApproval — a ring wrapped in createKeyRingResolver", () => {
  interface AppEnv {
    readonly APPROVAL_SECRET: string;
  }
  const UNWRAP = "defineApproval: pass the `(env) => importKeyRing(…)` function itself, not `createKeyRingResolver(…)`";
  const { ring: _, ...unringed } = fakeApproval();

  it("is refused at bun check whatever Bindings it was made under, and throws at construction", () => {
    const inferred = () =>
      defineApproval({
        ...unringed,
        // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
        ring: createKeyRingResolver(() => fakeWebRing),
      });
    const typed = () =>
      defineApproval<AppEnv>({
        path: "/approve",
        code: () => FAKE_APPROVAL_CODE,
        origin: { allowedOrigins: [ORIGIN] },
        rateLimit: { binding: "LIMITER", key: () => "visitor" },
        // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
        ring: createKeyRingResolver<AppEnv>((env) => importKeyRing([env.APPROVAL_SECRET])),
      });
    expect(inferred).toThrow(new Error(UNWRAP));
    expect(typed).toThrow(new Error(UNWRAP));
  });

  it("cast past the type, throws at construction naming defineApproval and the fix", () => {
    const options: ApprovalOptions = { ...unringed, ring: createKeyRingResolver(() => fakeWebRing) as unknown as KeyRingResolver };
    expect(() => defineApproval(options)).toThrow(new Error(UNWRAP));
  });

  it("leaves a plain env resolver accepted, admitting the code under the env's ring", async () => {
    const approval = fakeApproval({ ring: (env) => importKeyRing([String(env.APPROVAL_SECRET)]) });
    const res = await approvalApp(approval).request("/approve", presented({ code: FAKE_APPROVAL_CODE }), {
      LIMITER: ADMITTING,
      APPROVAL_SECRET: "3e8f0241998536b82050a9b2cdb21c47ee4215e1bd4ec7a04ec2ad348757f370",
    });
    expect(res.status).toBe(303);
  });
});

describe("defineApproval — a ring cast past its type to read the request context", () => {
  const HANDED_ENV = "this resolver is handed `env`, not the request context — rewrite `(c) => c.env.X` as `(env) => env.X`";
  const APPROVAL_SECRET = "3e8f0241998536b82050a9b2cdb21c47ee4215e1bd4ec7a04ec2ad348757f370";
  // oxlint-disable-next-line typescript/no-explicit-any -- a 0.7.7 resolver typed against the context it is no longer handed
  type ContextResolver = (c: any) => ReturnType<typeof importKeyRing>;
  const unconverted: { name: string; resolve: ContextResolver }[] = [
    { name: "c.env", resolve: (c) => importKeyRing([c.env.APPROVAL_SECRET]) },
    { name: "c.get", resolve: (c) => importKeyRing([c.get("APPROVAL_SECRET")]) },
  ];

  for (const { name, resolve } of unconverted) {
    it(`answers the right code with the rewrite and stamps nothing, for a ring reading ${name}`, async () => {
      const app = approvalApp(fakeApproval({ ring: resolve as KeyRingResolver }));
      app.setOnError((err) => new Response(err.message, { status: 500 }));
      const env = { LIMITER: ADMITTING, APPROVAL_SECRET };
      const answered = await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }), env);
      const body = await answered.text();
      const after = await app.request("/admin/users", { headers: { cookie: sessionCookie(answered) } }, env);
      expect({ status: answered.status, body, after: after.status }).toEqual({ status: 500, body: HANDED_ENV, after: 302 });
    });
  }
});

describe("registerApproval — mounted through the app's own csrf policy", () => {
  const session = createAnonymousSession({ ring: () => fakeWebRing, storage: "cookie" });

  /** A chain minting under `csrf`, or under none when omitted, with `approval`'s contribution behind a bindings-only one. */
  function chainFor(approval: Approval, csrf?: { exclude?: readonly string[]; paths?: readonly string[] }): Forge {
    const app = limitedBy(new Forge(), ADMITTING);
    applyMiddlewareChain(app, {
      securityHeaders: {},
      session,
      ...(csrf === undefined ? {} : { csrf: { ...csrf, ring: () => fakeWebRing, subject: "session" as const } }),
      rateLimits: FAKE_RATE_LIMITS,
      contributions: [fakeLimiterContribution, approval.contribution],
    });
    return app;
  }

  const excluded = (route: string, entry: string) =>
    new Error(
      `applyMiddlewareChain: contribution 1's route \`${route}\` mints a CSRF token, but the csrf policy's exclude entry \`${entry}\` skips it — narrow the entry so it leaves the route covered.`,
    );

  it("throws at registration on an exclude entry matching the prompt, naming the path and the entry", () => {
    expect(() => chainFor(fakeApproval(), { exclude: ["/public/*", "/approve"] })).toThrow(excluded("/approve", "/approve"));
  });

  it("throws at registration on an exclude covering a non-default mount's prefix, naming that mount's path", () => {
    expect(() => chainFor(fakeApproval({ path: "/members/approve" }), { exclude: ["/members/*"] })).toThrow(
      excluded("/members/approve", "/members/*"),
    );
  });

  it("throws at registration on paths that miss the prompt", () => {
    expect(() => chainFor(fakeApproval(), { paths: ["/admin/*"] })).toThrow(
      new Error(
        "applyMiddlewareChain: contribution 1's route `/approve` mints a CSRF token, but the csrf policy's paths `/admin/*` leave it uncovered — add a pattern that matches it.",
      ),
    );
  });

  it("throws at registration with no csrf policy at all", () => {
    expect(() => chainFor(fakeApproval())).toThrow(
      new Error(
        "applyMiddlewareChain: contribution 1's route `/approve` mints a CSRF token, but no csrf policy is set — pass applyMiddlewareChain's root csrf option.",
      ),
    );
  });

  it("mounts beside an exclude that leaves the prompt covered, rendering a token the prompt's own POST accepts", async () => {
    const app = chainFor(fakeApproval(), { exclude: ["/approvals", "/approve/archive/*"] });
    registerApproval(app, fakeApproval());
    const prompt = await app.request("/approve?next=%2Fadmin%2Fusers");
    const html = await prompt.text();
    const cookie = prompt.headers.getSetCookie()[0]?.split(";")[0] ?? "";
    const accepted = await app.request(
      "/approve?next=%2Fadmin%2Fusers",
      presented({ code: FAKE_APPROVAL_CODE, _csrf: attrOf(html, 'name="_csrf"', "value") }, cookie),
    );

    expect({
      prompt: { status: prompt.status, action: attrOf(html, 'data-slot="form"', "action") },
      accepted: { status: accepted.status, location: accepted.headers.get("location") },
    }).toEqual({ prompt: { status: 200, action: "/approve?next=%2Fadmin%2Fusers" }, accepted: { status: 303, location: "/admin/users" } });
  });
});

describe("registerApproval — the prompt page", () => {
  it("answers 404 on both methods while no code is configured", async () => {
    const app = approvalApp(fakeApproval({ code: () => undefined }));
    expect([(await app.request("/approve")).status, (await app.request("/approve", presented({ code: "" }))).status]).toEqual([404, 404]);
  });

  it("renders the prompt with a token for its own path and a form carrying the return-to back", async () => {
    const html = await (await approvalApp().request("/approve?next=%2Fadmin%2Fusers")).text();
    expect({
      action: attrOf(html, 'data-slot="form"', "action"),
      token: attrOf(html, 'data-slot="form-csrf"', "value"),
      code: attrOf(html, 'data-ref="approval-code"', "name"),
    }).toEqual({ action: "/approve?next=%2Fadmin%2Fusers", token: "csrf-for:/approve", code: "code" });
  });

  it("drops a return-to that leaves the site from the form it renders", async () => {
    const html = await (await approvalApp().request("/approve?next=https%3A%2F%2Fevil.example")).text();
    expect(attrOf(html, 'data-slot="form"', "action")).toBe("/approve");
  });

  it("renders the view the definition names in place of forge's own", async () => {
    const approval = fakeApproval({ view: ({ submitPath }) => <p data-ref='custom'>{submitPath}</p> });
    const html = await (await approvalApp(approval).request("/approve")).text();
    expect(elementOf(html, "p", 'data-ref="custom"')).toBe('<p data-ref="custom">/approve</p>');
  });

  it("refuses a cross-site POST before reading it", async () => {
    const res = await approvalApp().request("/approve", {
      ...presented({ code: FAKE_APPROVAL_CODE }),
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("is held to the definition's rate limit on both methods", async () => {
    const app = approvalApp(fakeApproval(), [], [], { counter: { limit: async () => ({ success: false }) } });
    expect([(await app.request("/approve")).status, (await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }))).status]).toEqual([
      429, 429,
    ]);
  });

  describe("keyed by the client IP", () => {
    const keys: string[] = [];
    const ipKeyed = fakeApproval({ rateLimit: { binding: "LIMITER" } });
    const recording: RateLimit = { limit: async ({ key }) => (keys.push(key), { success: true }) };
    const fromIp = { headers: { "CF-Connecting-IP": "203.0.113.7" } };

    it("renders the prompt counted under the CF-Connecting-IP when the chain trusts CF headers", async () => {
      keys.length = 0;
      const res = await approvalApp(ipKeyed, [], [], { trustCfHeaders: true, counter: recording }).request("/approve", fromIp);
      expect({ status: res.status, form: attrOf(await res.text(), 'data-slot="form"', "action"), keys }).toEqual({
        status: 200,
        form: "/approve",
        keys: ["203.0.113.7"],
      });
    });

    it("refuses at registration, naming the approval's path, when the chain declares no trust posture", () => {
      expect(() => approvalApp(ipKeyed)).toThrow(
        "guard group `/approve`: its `rateLimit` keys by client IP, which needs `trustCfHeaders: true` on `applyMiddlewareChain`, or a custom `key`.",
      );
    });
  });
});

describe("registerApproval — without its contribution in the chain", () => {
  for (const { name, register } of [
    { name: "answers 500 on both methods, failing closed", register: (app: Forge, approval: Approval) => registerApproval(app, approval) },
  ]) {
    it(name, async () => {
      const app = new Forge();
      app.setOnError((error) => new Response(error.message, { status: 500 }));
      register(app, fakeApproval());
      const answers = [await app.request("/approve"), await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }))];
      const unguarded = {
        status: 500,
        body: "auth/web approval: the prompt ran without its origin check and rate limit — pass `approval.contribution` to `applyMiddlewareChain`'s `contributions`.",
      };
      expect(await Promise.all(answers.map(async (res) => ({ status: res.status, body: await res.text() })))).toEqual([unguarded, unguarded]);
    });
  }
});

describe("registerApproval — without session middleware", () => {
  it("fails a presented code with the shared no-session message, rather than recording an approval nowhere", async () => {
    const approval = fakeApproval();
    const app = limitedBy(new Forge(nullLogger), ADMITTING);
    app.setOnError((error) => new Response(error.message, { status: 500 }));
    applyMiddlewareChain(app, {
      securityHeaders: {},
      rateLimits: FAKE_RATE_LIMITS,
      contributions: [mintFaked(approval.contribution), fakeLimiterContribution],
    });
    registerApproval(app, approval);

    const res = await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }));
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 500, body: NO_SESSION });
  });
});

describe("registerApproval — under a chain group whose CSRF verification covers its path", () => {
  const EVIL = "https://evil.example";

  function coveredApp(events: string[], allowed: boolean): Forge {
    const approval = fakeApproval();
    const chainGroup: MiddlewareGuardGroup = {
      paths: ["*"],
      origin: { allowedOrigins: [ORIGIN, EVIL] },
      guards: [(_context, next) => (events.push("chain-guard"), next())],
    };
    const app = limitedBy(new Forge(), { limit: async () => (events.push("limit"), { success: allowed }) });
    applyMiddlewareChain(app, {
      securityHeaders: {},
      rateLimits: FAKE_RATE_LIMITS,
      csrf: { ring: () => fakeWebRing, subject: false },
      onRefuse: (_context, refused) => {
        const why = "reason" in refused ? refused.reason : refused.status;
        events.push(`${refused.guard}:${why}`);
        return new Response(`${refused.guard} refused: ${why}`, { status: refused.status });
      },
      guards: [chainGroup],
      contributions: [approval.contribution, fakeLimiterContribution],
    });
    registerApproval(app, approval);
    return app;
  }

  for (const { name, origin, allowed, expected } of [
    {
      name: "refuses a POST the chain group's origin admits but the approval's does not at the approval's origin check, through the chain's hook, never verifying",
      origin: EVIL,
      allowed: true,
      expected: { status: 403, body: "origin refused: disallowed", events: ["origin:disallowed"] },
    },
    {
      name: "refuses an over-limit POST 429 at the approval's limiter, through the chain's hook, never verifying",
      origin: ORIGIN,
      allowed: false,
      expected: { status: 429, body: "rate-limit refused: 429", events: ["limit", "rate-limit:429"] },
    },
    {
      name: "verifies a tokenless POST only after the approval's origin check and rate limit, and before any group's guards",
      origin: ORIGIN,
      allowed: true,
      expected: { status: 403, body: "csrf refused: missing-token", events: ["limit", "csrf:missing-token"] },
    },
  ]) {
    it(name, async () => {
      const events: string[] = [];
      const res = await coveredApp(events, allowed).request("/approve", {
        method: "POST",
        body: new URLSearchParams({ code: FAKE_APPROVAL_CODE }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded", origin },
      });
      expect({ status: res.status, body: await res.text(), events }).toEqual(expected);
    });
  }
});

describe("registerApproval — presenting the code", () => {
  it("stamps the session and returns to the path the guard sent it from, which then admits it", async () => {
    const app = approvalApp();
    const sent = await app.request("/admin/users");
    expect(sent.headers.get("location")).toBe("/approve?next=%2Fadmin%2Fusers");

    const accepted = await app.request("/approve?next=%2Fadmin%2Fusers", presented({ code: FAKE_APPROVAL_CODE }));
    expect({ status: accepted.status, location: accepted.headers.get("location") }).toEqual({ status: 303, location: "/admin/users" });

    const admitted = await app.request("/admin/users", { headers: { cookie: sessionCookie(accepted) } });
    expect(await admitted.text()).toBe("users");
  });

  it("ends an approval when the code changes, sending the next request back to the prompt", async () => {
    let code = "code-A";
    const app = approvalApp(fakeApproval({ code: () => code }));
    const cookie = sessionCookie(await app.request("/approve?next=%2Fadmin%2Fusers", presented({ code: "code-A" })));
    const underA = await (await app.request("/admin/users", { headers: { cookie } })).text();

    code = "code-B";
    const underB = await app.request("/admin/users", { headers: { cookie } });
    expect({ underA, underB: { status: underB.status, location: underB.headers.get("location") } }).toEqual({
      underA: "users",
      underB: { status: 302, location: "/approve?next=%2Fadmin%2Fusers" },
    });
  });

  it("keeps a digest of the code on the session, never the code itself", async () => {
    const pair = sessionCookie(await approvalApp().request("/approve", presented({ code: FAKE_APPROVAL_CODE })));
    const stored = JSON.stringify(JSON.parse((await fakeSessionCookie.parse(pair)) ?? "null"));
    expect({ approved: stored.includes('"approval.at"'), leaked: stored.includes(FAKE_APPROVAL_CODE) }).toEqual({ approved: true, leaked: false });
  });

  it("rotates the session id on a correct code and keeps it on a wrong one", async () => {
    const ids: [string, string][] = [];
    const app = approvalApp(fakeApproval(), [], ids);
    await app.request("/approve", presented({ code: "wrong" }));
    await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }));
    expect(ids.map(([before, after]) => before === after)).toEqual([true, false]);
  });

  it("keeps a signed-in visitor's session token and row while rotating the session id, and asks the session store nothing", async () => {
    const rows = fakeAuthSessionStore([fakeAuthUser({ id: "u1" })]);
    const calls: string[] = [];
    const sessions: AuthSessionStore = {
      create: (...args) => rows.create(...args),
      resolve: (...args) => (calls.push("resolve"), rows.resolve(...args)),
      rotate: (...args) => (calls.push("rotate"), rows.rotate(...args)),
      remove: (...args) => (calls.push("remove"), rows.remove(...args)),
      listByUser: (...args) => (calls.push("listByUser"), rows.listByUser(...args)),
      revoke: (...args) => (calls.push("revoke"), rows.revoke(...args)),
      revokeOthers: (...args) => (calls.push("revokeOthers"), rows.revokeOthers(...args)),
    };
    const ids: [string, string][] = [];
    const app = approvalApp(fakeApproval(), [], ids);
    mapHandler(app, "GET", "/seed", async (context) => {
      const now = Date.now();
      await establishAuthSession(sessionCtx.get(context), sessions, "u1", now, now, { kind: "email-otp" });
      return new Response("seeded");
    });
    const tokenOf = async (pair: string) =>
      (JSON.parse((await fakeSessionCookie.parse(pair)) ?? "null") as { d: [Record<string, unknown>] }).d[0][AUTH_SESSION_TOKEN_KEY];

    const seeded = sessionCookie(await app.request("/seed"));
    const rowsBefore = [...rows.rows.keys()];
    calls.length = 0;
    ids.length = 0;
    const accepted = await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }, seeded));

    expect({
      token: await tokenOf(sessionCookie(accepted)),
      rows: [...rows.rows.keys()],
      rotated: ids.map(([before, after]) => before !== after),
      calls,
    }).toEqual({ token: await tokenOf(seeded), rows: rowsBefore, rotated: [true], calls: [] });
    expect({ seededRows: rowsBefore.length, held: typeof (await tokenOf(seeded)) }).toEqual({ seededRows: 1, held: "string" });
  });

  it("goes to `/` when the return-to is absent or points off-site", async () => {
    const app = approvalApp();
    const bare = await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }));
    const offsite = await app.request("/approve?next=%2F%2Fevil.example", presented({ code: FAKE_APPROVAL_CODE }));
    expect([bare.headers.get("location"), offsite.headers.get("location")]).toEqual(["/", "/"]);
  });

  it("refuses a wrong code at 422 naming the code field, stamps nothing, and logs why at warn", async () => {
    const warnings: unknown[] = [];
    const app = approvalApp(fakeApproval(), warnings);
    const refused = await app.request("/approve", presented({ code: "wrong" }));
    const after = await app.request("/admin/users", { headers: { cookie: sessionCookie(refused) } });

    expect({ ...(await refusal(refused)), after: after.status, warnings }).toEqual({
      status: 422,
      error: "Approval failed. Please try again.",
      after: 302,
      warnings: [["auth.approval.refused", { reason: "mismatch" }]],
    });
  });

  it("refuses an empty code the same way, so an empty field is never compared as a guess", async () => {
    expect(await refusal(await approvalApp().request("/approve", presented({ code: "" })))).toEqual(
      await refusal(await approvalApp().request("/approve", presented({ code: "wrong" }))),
    );
  });

  it("answers a body over the auth form cap at 413 in the too-large copy, and stamps nothing", async () => {
    const app = approvalApp();
    const refused = await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE, padding: "x".repeat(AUTH_FORM_MAX_BYTES) }));
    const after = await app.request("/admin/users", { headers: { cookie: sessionCookie(refused) } });

    expect({ ...(await refusal(refused)), after: after.status }).toEqual({
      status: 413,
      error: "That form was too large to read. Please try again.",
      after: 302,
    });
  });
});

describe("registerApproval — the form cap behind a 1 MiB parse", () => {
  /** The right code, padded to exactly `bytes` in the CSRF field the approval drops before it validates. */
  function presentedOfBytes(bytes: number): RequestInit {
    const prefix = `${new URLSearchParams({ code: FAKE_APPROVAL_CODE }).toString()}&_csrf=`;
    return { ...presented({}), body: `${prefix}${"x".repeat(bytes - prefix.length)}` };
  }

  async function presentedAt(bytes: number) {
    const app = approvalApp(fakeApproval(), [], [], { raisedParse: true });
    const answered = await app.request("/approve", presentedOfBytes(bytes));
    const after = await app.request("/admin/users", { headers: { cookie: sessionCookie(answered) } });
    return { status: answered.status, after: after.status };
  }

  it("stamps the right code in a body of exactly 100 KiB, and refuses it at 413 a byte longer, stamping nothing", async () => {
    expect({ at: await presentedAt(100 * 1024), over: await presentedAt(100 * 1024 + 1) }).toEqual({
      at: { status: 303, after: 200 },
      over: { status: 413, after: 302 },
    });
  });
});

describe("registerApproval — behind a Turnstile challenge", () => {
  const KEYS = { siteKey: "site-key", secretKey: "secret-key" };
  const turnstile = { keys: () => KEYS, verify: () => ({ expectedHostname: "app.example" }) };

  let savedFetch: typeof globalThis.fetch | undefined;

  afterEach(() => {
    if (savedFetch !== undefined) globalThis.fetch = savedFetch;
    savedFetch = undefined;
  });

  function siteverify(answer: Record<string, unknown>): void {
    savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(answer))) as unknown as typeof globalThis.fetch;
  }

  it("renders the widget bound to the approval's own action", async () => {
    const html = await (await approvalApp(fakeApproval({ turnstile })).request("/approve")).text();
    expect(attrOf(html, 'data-sitekey="site-key"', "data-action")).toBe(APPROVAL_TURNSTILE_ACTION);
  });

  it("refuses a failed challenge with the 422 a wrong code gets, naming neither cause, even when the code is right", async () => {
    siteverify({ success: false, "error-codes": ["invalid-input-response"] });
    const failed = await approvalApp(fakeApproval({ turnstile })).request(
      "/approve",
      presented({ code: FAKE_APPROVAL_CODE, "cf-turnstile-response": "t" }),
    );
    const wrong = await approvalApp().request("/approve", presented({ code: "wrong" }));
    const answer = await refusal(failed);
    expect({ answer, wrong: await refusal(wrong) }).toEqual({
      answer: { status: 422, error: "Approval failed. Please try again." },
      wrong: answer,
    });
  });

  describe("with forge's defaults", () => {
    const ENV = { TURNSTILE_SITE_KEY: "site-from-env", TURNSTILE_SECRET_KEY: "secret-from-env", LIMITER: ADMITTING };

    it("renders the widget under the site key the bindings carry", async () => {
      const html = await (await approvalApp(fakeApproval({ turnstile: {} })).request(`${ORIGIN}/approve`, {}, ENV)).text();
      expect(attrOf(html, 'data-sitekey="site-from-env"', "data-action")).toBe(APPROVAL_TURNSTILE_ACTION);
    });

    for (const { outcome, hostname, status } of [
      { outcome: "admits a challenge solved for the request's own hostname", hostname: "app.example", status: 303 },
      { outcome: "refuses a challenge solved for another hostname", hostname: "elsewhere.example", status: 422 },
    ]) {
      it(outcome, async () => {
        siteverify({ success: true, hostname, action: APPROVAL_TURNSTILE_ACTION });
        const res = await approvalApp(fakeApproval({ turnstile: {} })).request(
          `${ORIGIN}/approve`,
          presented({ code: FAKE_APPROVAL_CODE, "cf-turnstile-response": "t" }),
          ENV,
        );
        expect(res.status).toBe(status);
      });
    }
  });

  it("admits the right code once the challenge is solved for the approval's action", async () => {
    siteverify({ success: true, hostname: "app.example", action: APPROVAL_TURNSTILE_ACTION });
    const res = await approvalApp(fakeApproval({ turnstile })).request(
      "/approve",
      presented({ code: FAKE_APPROVAL_CODE, "cf-turnstile-response": "t" }),
    );
    expect(res.status).toBe(303);
  });
});
