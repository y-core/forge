/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { afterEach, describe, expect, it } from "bun:test";

import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../../app/forge-app";
import { csrfMinterCtx } from "../../form/csrf";
import { csrfFieldCtx } from "../../form/csrf-context";
import { requestLog } from "../../logging/request-logger";
import { sessionCtx, sessionMiddleware } from "../../session/session";
import { nullLogger } from "../../testing/context";
import { mapHandler } from "../../testing/route";
import { APPROVAL_TTL_MS } from "../config";
import { APPROVAL_TURNSTILE_ACTION, defineApproval, registerApproval } from "./approval";
import { requireApproval } from "./guards";
import type { Approval } from "./types";
import { attrOf, elementOf, FAKE_APPROVAL_CODE, fakeApproval, fakeSessionCookie, fakeWebRing, textOf } from "./web.fixture";

const ORIGIN = "https://app.example";

/** The prompt mounted for `approval`, with a deterministic CSRF minter and `/admin/users` behind its guard. */
function approvalApp(approval: Approval = fakeApproval(), warnings: unknown[] = [], ids: [string, string][] = []): Forge {
  const app = new Forge();
  app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
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
  registerApproval(app, approval);
  app.use("/admin/users", requireApproval(approval));
  mapHandler(app, "GET", "/admin/users", () => new Response("users"));
  return app;
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
    expect(() => defineApproval(untyped as Parameters<typeof defineApproval>[0])).toThrow("defineApproval: no `ring` was passed");
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
    const env = {};
    await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }), env);
    await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }), env);
    expect(calls).toBe(1);
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
    const approval = fakeApproval({ rateLimit: { limiter: () => ({ limit: async () => ({ success: false }) }), key: () => "visitor" } });
    const app = approvalApp(approval);
    expect([(await app.request("/approve")).status, (await app.request("/approve", presented({ code: FAKE_APPROVAL_CODE }))).status]).toEqual([
      429, 429,
    ]);
  });
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
    const ENV = { TURNSTILE_SITE_KEY: "site-from-env", TURNSTILE_SECRET_KEY: "secret-from-env" };

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
