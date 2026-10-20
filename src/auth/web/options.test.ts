import { describe, expect, it } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import type { AppContext } from "../../context/types";
import { csrfMinterCtx } from "../../form/csrf";
import { createTestContext } from "../../testing/context";
import { TURNSTILE_ACTION_PATTERN } from "../../ui/contracts/turnstile-contract";
import {
  AUTH_TURNSTILE_ACTIONS,
  authNow,
  authPasskeyContract,
  authReturnPath,
  authReturnQuery,
  authServices,
  authSettledPath,
  authTurnstileCheck,
  authTurnstileWidget,
  turnstileCheckFor,
  turnstileWidgetFor,
} from "./options";
import type { AuthTurnstileFlow, AuthTurnstileOptions } from "./types";
import { fakeAuthServices, fakeAuthWebOptions } from "./web.fixture";

function context(url: string): AppContext {
  const c = new RequestContext(new Request(url));
  csrfMinterCtx.set(c, (path) => Promise.resolve(`csrf-for:${path}`));
  return c as unknown as AppContext;
}

describe("authNow", () => {
  it("reads the injected clock rather than the wall clock", () => {
    expect(authNow(fakeAuthWebOptions({ now: () => 42 }))).toBe(42);
  });
});

// `resolveServices` rebuilds every store, and one request runs a guard, a loader and often an
// action — each of which asked for them separately.
describe("authServices", () => {
  it("builds this request's services once, however many callers ask for them", async () => {
    let calls = 0;
    const options = fakeAuthWebOptions({
      resolveServices: () => {
        calls++;
        return fakeAuthServices();
      },
    });
    const c = context("https://app.example/account/passkeys");

    const first = await authServices(c, options);
    const second = await authServices(c, options);
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it("memoises the promise, so two parallel callers share one build rather than racing two", async () => {
    let calls = 0;
    const options = fakeAuthWebOptions({
      resolveServices: async () => {
        calls++;
        await Promise.resolve();
        return fakeAuthServices();
      },
    });
    const c = context("https://app.example/account/passkeys");

    const [first, second] = await Promise.all([authServices(c, options), authServices(c, options)]);
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it("builds again for a second request, since a ceremony is bound to its own session", async () => {
    let calls = 0;
    const options = fakeAuthWebOptions({
      resolveServices: () => {
        calls++;
        return fakeAuthServices();
      },
    });
    await authServices(context("https://app.example/a"), options);
    await authServices(context("https://app.example/b"), options);
    expect(calls).toBe(2);
  });
});

describe("authSettledPath", () => {
  it("falls back to the passkey page when the consumer named none", () => {
    expect(authSettledPath(fakeAuthWebOptions())).toBe("/account/passkeys");
  });

  it("uses the consumer's own landing page when one is named", () => {
    expect(authSettledPath(fakeAuthWebOptions({ settledPath: "/dashboard" }))).toBe("/dashboard");
  });
});

describe("authReturnPath", () => {
  it("takes a same-origin return-to off the query string", () => {
    expect(authReturnPath(context("http://localhost/auth/verify?next=%2Faccount%2Ftotp"), fakeAuthWebOptions())).toBe("/account/totp");
  });

  it("refuses an off-origin return-to and lands on the settled page instead", () => {
    expect(authReturnPath(context("http://localhost/auth/verify?next=https%3A%2F%2Fevil.example"), fakeAuthWebOptions())).toBe("/account/passkeys");
  });

  it("reads the parameter name the consumer configured", () => {
    const options = fakeAuthWebOptions({ returnParam: "back" });
    expect(authReturnPath(context("http://localhost/auth/verify?back=%2Faccount%2Ftotp"), options)).toBe("/account/totp");
  });
});

describe("authReturnQuery", () => {
  it("carries a same-origin return-to onto the path, encoded as one parameter", () => {
    const carried = authReturnQuery(context("http://localhost/auth/signin?next=%2Faccount%2Ftotp"), fakeAuthWebOptions(), "/auth/signin");
    expect(carried).toBe("/auth/signin?next=%2Faccount%2Ftotp");
  });

  // The value lands in a rendered `action=`, so an off-origin one would be an open redirect the
  // page itself offers.
  it("drops an off-origin return-to rather than rendering it into a form action", () => {
    const options = fakeAuthWebOptions();
    expect(authReturnQuery(context("http://localhost/auth/signin?next=https%3A%2F%2Fevil.example"), options, "/auth/signin")).toBe("/auth/signin");
    expect(authReturnQuery(context("http://localhost/auth/signin?next=%2F%2Fevil.example"), options, "/auth/signin")).toBe("/auth/signin");
  });

  it("leaves the path alone when this request asked to return nowhere", () => {
    expect(authReturnQuery(context("http://localhost/auth/signin"), fakeAuthWebOptions(), "/auth/signin")).toBe("/auth/signin");
  });

  it("reads the parameter name the consumer configured", () => {
    const options = fakeAuthWebOptions({ returnParam: "back" });
    expect(authReturnQuery(context("http://localhost/auth/signin?back=%2Faccount%2Ftotp"), options, "/auth/signin")).toBe(
      "/auth/signin?back=%2Faccount%2Ftotp",
    );
  });
});

describe("authPasskeyContract", () => {
  it("mints one token per endpoint, and never the same value for both", async () => {
    const contract = await authPasskeyContract(context("http://localhost/auth/signin"), "authentication", "/begin", "/finish", "/home");

    expect(contract).toEqual({
      mode: "authentication",
      optionsPath: "/begin",
      verifyPath: "/finish",
      optionsToken: "csrf-for:/begin",
      verifyToken: "csrf-for:/finish",
      redirect: "/home",
    });
  });
});

const FLOWS: readonly AuthTurnstileFlow[] = ["signin", "signup", "verify", "resend"];

const KEYS = { siteKey: "site-key-public", secretKey: "secret-key-private" };

/** A request whose bindings carry both Turnstile keys. */
function boundContext(url: string, headers: Record<string, string> = {}): AppContext {
  return createTestContext(new Request(url, { headers }), {
    env: { TURNSTILE_SITE_KEY: "site-from-env", TURNSTILE_SECRET_KEY: "secret-from-env" },
  });
}

function guarded(turnstile: Partial<AuthTurnstileOptions> = {}) {
  return fakeAuthWebOptions({ turnstile: { keys: () => KEYS, verify: () => ({ expectedHostname: "app.example" }), ...turnstile } });
}

describe("authTurnstileCheck and authTurnstileWidget", () => {
  it("answer undefined for every flow when the deployment configured no turnstile", async () => {
    const c = context("https://app.example/auth/signin");
    const answers = [];
    for (const flow of FLOWS) {
      answers.push({
        flow,
        check: await authTurnstileCheck(c, fakeAuthWebOptions(), flow),
        widget: await authTurnstileWidget(c, fakeAuthWebOptions(), flow),
      });
    }
    expect(answers).toEqual(FLOWS.map((flow) => ({ flow, check: undefined, widget: undefined })));
  });

  it("answer undefined for a flow outside `flows`, and a check and widget for the one inside it", async () => {
    const c = context("https://app.example/auth/signup");
    const options = guarded({ flows: ["signup"] });
    const covered = [];
    for (const flow of FLOWS) {
      covered.push({
        flow,
        check: (await authTurnstileCheck(c, options, flow)) !== undefined,
        widget: (await authTurnstileWidget(c, options, flow)) !== undefined,
      });
    }
    expect(covered).toEqual([
      { flow: "signin", check: false, widget: false },
      { flow: "signup", check: true, widget: true },
      { flow: "verify", check: false, widget: false },
      { flow: "resend", check: false, widget: false },
    ]);
  });

  it("cover all four flows when `flows` is omitted, each bound to its own action", async () => {
    const c = context("https://app.example/auth/verify");
    const options = guarded();
    const bound = [];
    for (const flow of FLOWS) {
      bound.push({
        flow,
        check: (await authTurnstileCheck(c, options, flow))?.verify.expectedAction,
        widget: (await authTurnstileWidget(c, options, flow))?.action,
      });
    }
    expect(bound).toEqual([
      { flow: "signin", check: "auth-signin", widget: "auth-signin" },
      { flow: "signup", check: "auth-signup", widget: "auth-signup" },
      { flow: "verify", check: "auth-verify", widget: "auth-verify" },
      { flow: "resend", check: "auth-resend", widget: "auth-resend" },
    ]);
  });
});

describe("authTurnstileCheck", () => {
  it("binds forge's own action over one a consumer's verify slipped past the type", async () => {
    const c = context("https://app.example/auth/signin");
    const options = guarded({ verify: () => ({ expectedHostname: "app.example", expectedAction: "auth-signup" }) as never });

    expect((await authTurnstileCheck(c, options, "signin"))?.verify.expectedAction).toBe("auth-signin");
  });

  it("verifies against the secret from keys, the default token field, and the consumer's hostname and remote address", async () => {
    const c = context("https://app.example/auth/signin");
    const options = guarded({ verify: () => ({ expectedHostname: "apex.example", remoteIp: "203.0.113.7" }) });

    expect(await authTurnstileCheck(c, options, "signin")).toEqual({
      secretKey: "secret-key-private",
      verify: { expectedHostname: "apex.example", remoteIp: "203.0.113.7", expectedAction: "auth-signin", tokenField: "cf-turnstile-response" },
    });
  });

  it("with neither keys nor verify, reads the secret off the bindings and the constraints off the request", async () => {
    const c = boundContext("https://app.example/auth/signin", { "CF-Connecting-IP": "203.0.113.7" });

    expect(await authTurnstileCheck(c, fakeAuthWebOptions({ turnstile: {} }), "signin")).toEqual({
      secretKey: "secret-from-env",
      verify: { expectedHostname: "app.example", remoteIp: "203.0.113.7", expectedAction: "auth-signin", tokenField: "cf-turnstile-response" },
    });
  });

  it("refuses to build a check when the bindings carry no secret, naming the key", async () => {
    const c = createTestContext(new Request("https://app.example/auth/signin"), { env: { TURNSTILE_SITE_KEY: "site-from-env" } });

    await expect(authTurnstileCheck(c, fakeAuthWebOptions({ turnstile: {} }), "signin")).rejects.toThrow(
      "Invalid environment: TURNSTILE_SECRET_KEY: missing",
    );
  });

  it("reads the keys and constraints off the request it is asked for", async () => {
    const c = context("https://app.example/auth/signin");
    const seen: unknown[] = [];
    const options = guarded({
      keys: (request) => {
        seen.push(request);
        return KEYS;
      },
      verify: (request) => {
        seen.push(request);
        return { expectedHostname: "app.example" };
      },
    });

    await authTurnstileCheck(c, options, "signin");
    expect(seen).toEqual([c, c]);
  });
});

describe("authTurnstileWidget", () => {
  it("with no keys, hands the view the site key the bindings carry", async () => {
    const widget = await authTurnstileWidget(boundContext("https://app.example/auth/signin"), fakeAuthWebOptions({ turnstile: {} }), "signin");

    expect(widget).toEqual({ siteKey: "site-from-env", action: "auth-signin" });
  });

  it("hands the view the site key and the action, and nothing that could carry the secret", async () => {
    const widget = await authTurnstileWidget(context("https://app.example/auth/signin"), guarded(), "signin");

    expect({ keys: Object.keys(widget ?? {}).sort(), widget }).toEqual({
      keys: ["action", "siteKey"],
      widget: { siteKey: "site-key-public", action: "auth-signin" },
    });
  });
});

describe("turnstileCheckFor and turnstileWidgetFor", () => {
  const turnstile = { keys: () => KEYS, verify: () => ({ expectedHostname: "app.example" }) };

  it("bind the action they are given, so a form outside the auth flows gets a token of its own", async () => {
    const c = context("https://app.example/approve");

    expect({ check: await turnstileCheckFor(c, turnstile, "approval"), widget: await turnstileWidgetFor(c, turnstile, "approval") }).toEqual({
      check: {
        secretKey: "secret-key-private",
        verify: { expectedHostname: "app.example", expectedAction: "approval", tokenField: "cf-turnstile-response" },
      },
      widget: { siteKey: "site-key-public", action: "approval" },
    });
  });

  it("read each key from its own binding alone when no keys override is given", async () => {
    const onlySecret = createTestContext(new Request("https://app.example/approve"), { env: { TURNSTILE_SECRET_KEY: "secret-from-env" } });
    const onlySite = createTestContext(new Request("https://app.example/approve"), { env: { TURNSTILE_SITE_KEY: "site-from-env" } });
    const defaults = { verify: () => ({ expectedHostname: "app.example" }) };

    expect({
      check: await turnstileCheckFor(onlySecret, defaults, "approval"),
      widget: await turnstileWidgetFor(onlySite, {}, "approval"),
    }).toEqual({
      check: {
        secretKey: "secret-from-env",
        verify: { expectedHostname: "app.example", expectedAction: "approval", tokenField: "cf-turnstile-response" },
      },
      widget: { siteKey: "site-from-env", action: "approval" },
    });
  });
});

describe("AUTH_TURNSTILE_ACTIONS", () => {
  it("names every flow with an action Cloudflare accepts, and no two flows alike", () => {
    const actions = FLOWS.map((flow) => AUTH_TURNSTILE_ACTIONS[flow]);
    expect({
      outside: actions.filter((action) => !TURNSTILE_ACTION_PATTERN.test(action)),
      distinct: new Set(actions).size === actions.length,
    }).toEqual({ outside: [], distinct: true });
  });
});
