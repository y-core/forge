import { afterEach, beforeAll, describe, expect, it } from "bun:test";

import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../../app/forge-app";
import { csrfMinterCtx } from "../../form/csrf";
import { csrfFieldCtx } from "../../form/csrf-context";
import { parseFormData } from "../../form/parse-form-data";
import { requestLog } from "../../logging/request-logger";
import { err, ok } from "../../result/result";
import { sessionCtx, sessionMiddleware } from "../../session/session";
import { nullLogger } from "../../testing/context";
import { mapHandler } from "../../testing/route";
import type { TestAction } from "../../testing/types";
import { AuthStoreError } from "../errors";
import { createPasskeyFactor } from "../factors/passkey";
import { createFactorRegistry } from "../factors/registry";
import type { AuthFactorService } from "../factors/types";
import { createPasskeyKeyPair, fakePasskeyRegistration } from "../passkey/passkey.fixture";
import type { PasskeyKeyPair } from "../passkey/types";
import type { AuthChallenge, AuthCredential, AuthFactor, AuthFactorKind, CredentialStore, UserStore } from "../types";
import {
  createAdminElevateActions,
  createAdminUserActions,
  createEmailChangeActions,
  createPasskeyAccountEnrolActions,
  createPasskeyEnrolActions,
  createPasskeyManageActions,
  createPasskeyStepUpActions,
  createRecoveryCodeActions,
  AUTH_CEREMONY_MAX_BYTES,
  createSigninActions,
  createSignoutActions,
  createSignupActions,
  createTotpManageActions,
  createVerifyActions,
} from "./actions";
import { requireApproval, requireFreshStepUp } from "./guards";
import { AUTH_PENDING_SIGNIN_SESSION_KEY, AUTH_SESSION_KEY, AUTH_STEP_UP_SESSION_KEY, authCtx } from "./identity";
import { authEnrolmentPaths } from "./paths";
import type { AuthRequestServices, AuthTurnstileOptions, AuthWebOptions } from "./types";
import {
  approvedSession,
  attrOf,
  elementOf,
  HOSTILE_TEXT,
  fakeAdminUserStore,
  fakeApproval,
  fakeAuthCredential,
  fakeAuthCredentialStore,
  fakeAuthEmailChangeFlow,
  fakeAuthServices,
  fakeAuthSigninFlow,
  fakeAuthSignupFlow,
  fakeAuthUser,
  fakeAuthUserStore,
  fakeAuthWebOptions,
  fakeFactorRegistry,
  fakeFactorService,
  fakeFactorStore,
  fakeSessionCookie,
  recoveryOffer,
  textOf,
} from "./web.fixture";

interface Seed {
  readonly userId?: string;
  /** The address the seeded identity carries; the pages an action re-renders name it. */
  readonly email?: string;
  /** Whether the seeded identity is an administrator, as `requireAdmin` would have found it. */
  readonly admin?: boolean;
  readonly pendingEmail?: string;
  readonly stepUpWrites?: number[];
  /** When the seeded identity last stepped up, as `requireAuth` would have read it off the session. */
  readonly stepUpAt?: number;
  readonly stepUpAfter?: unknown[];
}

/** A `Forge` app with a seeded session and a deterministic CSRF minter, but no CSRF verification. */
function actionApp(seed: Seed = {}): Forge {
  const app = new Forge();
  app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
  app.use("*", async (context, next) => {
    const session = sessionCtx.get(context);
    // Both, because a mounted route has both: the guards establish the identity every action reads,
    // and the session is what a sign-out clears and a step-up marks.
    if (seed.userId !== undefined) {
      session.set(AUTH_SESSION_KEY, seed.userId);
      authCtx.set(context, {
        userId: seed.userId,
        email: seed.email ?? signedIn.email,
        isAdmin: seed.admin === true,
        stepUpAt: seed.stepUpAt ?? null,
      });
    }
    if (seed.pendingEmail !== undefined) session.set(AUTH_PENDING_SIGNIN_SESSION_KEY, seed.pendingEmail);
    if (seed.stepUpAt !== undefined) session.set(AUTH_STEP_UP_SESSION_KEY, seed.stepUpAt);
    const marks = seed.stepUpWrites;
    if (marks !== undefined) {
      const write = session.set.bind(session);
      session.set = ((key: string, value: unknown) => {
        if (key === AUTH_STEP_UP_SESSION_KEY) marks.push(Number(value));
        return write(key as never, value as never);
      }) as typeof session.set;
    }
    csrfMinterCtx.set(context, (path) => Promise.resolve(`csrf-for:${path}`));
    csrfFieldCtx.set(context, "_csrf");
    const response = await next();
    seed.stepUpAfter?.push(session.get(AUTH_STEP_UP_SESSION_KEY) ?? null);
    return response;
  });
  return app;
}

function mounted(app: Forge, method: "POST" | "PATCH" | "DELETE", pattern: string, action: TestAction): Forge {
  mapHandler(app, method, pattern, action);
  return app;
}

function approved(app: Forge): Forge {
  app.use("*", approvedSession(), requireApproval(fakeApproval()));
  return app;
}

function formBody(fields: Record<string, string>, method = "POST"): RequestInit {
  return { method, body: new URLSearchParams(fields).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } };
}

function jsonBody(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } };
}

const HX_REQUEST = { "HX-Request": "true" };

const signedIn = fakeAuthUser({ id: "u9", email: "grace@example.com" });

function optionsWith(overrides: Partial<AuthRequestServices>): AuthWebOptions {
  const services = fakeAuthServices(overrides);
  return fakeAuthWebOptions({ resolveServices: () => services });
}

describe("createSigninActions", () => {
  it("redirects to the verification page once the challenge is asked for", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp(), "POST", "/auth/signin", createSigninActions(options).signinSubmit);

    const res = await app.request("/auth/signin", formBody({ email: "ada@example.com" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  it("re-renders the page at 422 for an address the schema refuses", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp(), "POST", "/auth/signin", createSigninActions(options).signinSubmit);

    const res = await app.request("/auth/signin", formBody({ email: "not-an-address" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("keeps the refused address in the field of the 422 re-render, so the visitor can correct it", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp(), "POST", "/auth/signin", createSigninActions(options).signinSubmit);

    const res = await app.request("/auth/signin", formBody({ email: "ada@example" }));
    expect(res.status).toBe(422);
    expect(attrOf(await res.text(), 'id="field-email"', "value")).toBe("ada@example");
  });

  for (const [kind, name] of [
    ["another form's field", "role"],
    ["an inherited name", "__proto__"],
    ["an inherited method", "constructor"],
  ] as const) {
    it(`refuses ${kind} sent as an undeclared field at 422 with the generic copy, not a message looked up by its name`, async () => {
      const options = fakeAuthWebOptions();
      const app = mounted(actionApp(), "POST", "/auth/signin", createSigninActions(options).signinSubmit);

      const res = await app.request("/auth/signin", formBody({ email: "ada@example.com", [name]: "x" }));
      expect(res.status).toBe(422);
      const html = await res.text();
      expect(html).toContain("We could not read that. Please check the form and try again.");
      expect(html).not.toContain("Pick a role from the list.");
      expect(html).not.toContain("[object Object]");
      expect(html).not.toContain("[native code]");
    });
  }

  it("accepts the body a browser posts, CSRF field and all", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp(), "POST", "/auth/signin", createSigninActions(options).signinSubmit);

    const res = await app.request("/auth/signin", formBody({ _csrf: "csrf-for:/auth/signin", email: "ada@example.com" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  // The bare `catch` here blames the visitor's field for everything; a cap conflict is the app's own
  // wiring and must reach the boundary instead of re-rendering the form with a generic refusal.
  it("rethrows a body-cap conflict rather than turning it into a field refusal", async () => {
    const options = fakeAuthWebOptions();
    const app = actionApp();
    app.use("*", async (c, next) => {
      await parseFormData(c, { maxBytes: 4 }).catch(() => {});
      return next();
    });
    mounted(app, "POST", "/auth/signin", createSigninActions(options).signinSubmit);

    const res = await app.request("/auth/signin", formBody({ email: "ada@example.com" }));
    expect(res.status).toBe(500);
  });

  it("still re-renders the form for an oversize body, which is the visitor's to fix", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp(), "POST", "/auth/signin", createSigninActions(options).signinSubmit);

    const res = await app.request("/auth/signin", formBody({ email: `${"x".repeat(200_000)}@example.com` }));
    expect(res.status).toBe(422);
  });
});

describe("createSignupActions", () => {
  it("accepts the body a browser posts — the CSRF field is dropped and nothing else is injected", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp(), "POST", "/auth/signup", createSignupActions(options).signupSubmit);

    const res = await app.request("/auth/signup", formBody({ _csrf: "csrf-for:/auth/signup", email: "ada@example.com" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  it("still refuses a body carrying a field the schema never declared", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp(), "POST", "/auth/signup", createSignupActions(options).signupSubmit);

    const res = await app.request("/auth/signup", formBody({ _csrf: "csrf-for:/auth/signup", email: "ada@example.com", stray: "" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("answers a new address and a known one alike, with the same redirect", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp(), "POST", "/auth/signup", createSignupActions(options).signupSubmit);

    for (const email of ["ada@example.com", "nobody@example.com"]) {
      const res = await app.request("/auth/signup", formBody({ email }));
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/auth/verify");
    }
  });
});

describe("createVerifyActions on the second half of a sign-in", () => {
  function completing(resolution: Parameters<typeof ok>[0]): AuthWebOptions {
    return optionsWith({
      signin: fakeAuthSigninFlow({ complete: async () => ok({ user: signedIn, kind: "email-otp" as const, resolution: resolution as never }) }),
    });
  }

  it("redirects an owed enrolment to the enrolment page rather than refusing the sign-in", async () => {
    const options = completing({ status: "enrolment-required", kinds: ["passkey"], stepUpKinds: [] });
    const app = mounted(actionApp({ pendingEmail: "grace@example.com" }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify", formBody({ code: "123456" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/enrol/passkey");
  });

  it("carries the return-to onto the enrolment page an owed enrolment redirects to", async () => {
    const options = completing({ status: "enrolment-required", kinds: ["passkey"], stepUpKinds: [] });
    const app = mounted(actionApp({ pendingEmail: "grace@example.com" }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify?next=%2Faccount%2Ftotp", formBody({ code: "123456" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/enrol/passkey?next=%2Faccount%2Ftotp");
  });

  it("redirects an owed step-up back to the verification page", async () => {
    const options = completing({ status: "step-up-required", kinds: ["totp-app"] });
    const app = mounted(actionApp({ pendingEmail: "grace@example.com" }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify", formBody({ code: "123456" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  it("parses the code at the width the presented factor asks for, not at a constant", async () => {
    const wide = { ...fakeFactorService("email-otp"), codeDigits: 8 };
    const options = optionsWith({
      signin: fakeAuthSigninFlow({ complete: async () => ok({ user: signedIn, kind: "email-otp" as const, resolution: { status: "satisfied" } }) }),
      factors: createFactorRegistry(fakeFactorStore([]), { offered: [{ service: wide, role: "primary" }] }),
    });
    const app = mounted(actionApp({ pendingEmail: "grace@example.com" }), "POST", "/auth/verify", createVerifyActions(options).submit);

    expect((await app.request("/auth/verify", formBody({ code: "12345678" }))).status).toBe(303);
    // A six-digit code is the wrong shape for this factor, however correct it looks.
    expect((await app.request("/auth/verify", formBody({ code: "123456" }))).status).toBe(422);
  });

  it("redirects a settled sign-in to the same-origin return-to the request carried", async () => {
    const options = completing({ status: "satisfied" });
    const app = mounted(actionApp({ pendingEmail: "grace@example.com" }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify?next=%2Faccount%2Ftotp", formBody({ code: "123456" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/totp");
  });

  it("sends a request with no started sign-in back to the sign-in page", async () => {
    const options = completing({ status: "satisfied" });
    const app = mounted(actionApp(), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify", formBody({ code: "123456" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/signin");
  });

  const emailNotices = [
    ["unrecognised", "That did not match. Ask for a new code and try again."],
    ["too-many-attempts", "Too many attempts. Wait a while before asking for another code."],
  ] as const;

  for (const [reason, notice] of emailNotices) {
    it(`answers an emailed code refused as ${reason} by pointing at a new code`, async () => {
      const options = optionsWith({ signin: fakeAuthSigninFlow({ complete: async () => err(reason) }) });
      const app = mounted(actionApp({ pendingEmail: "grace@example.com" }), "POST", "/auth/verify", createVerifyActions(options).submit);

      const res = await app.request("/auth/verify", formBody({ code: "123456" }));
      expect({ status: res.status, notice: textOf(await res.text(), "div", 'data-slot="alert-description"') }).toEqual({ status: 422, notice });
    });
  }

  it("re-renders at 422 for a code the schema refuses, without reaching the flow", async () => {
    const options = completing({ status: "satisfied" });
    const app = mounted(actionApp({ pendingEmail: "grace@example.com" }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify", formBody({ code: "12" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("createVerifyActions on a step-up", () => {
  const stepUpServices: Partial<AuthRequestServices> = {
    users: fakeAuthUserStore([signedIn]),
    factors: createFactorRegistry(fakeFactorStore(["totp-app"]), {
      offered: [
        { service: fakeFactorService("email-otp"), role: "primary" },
        { service: fakeFactorService("totp-app"), role: "second", requirement: "optional" },
        recoveryOffer(),
      ],
    }),
  };

  // `signin.stepUp` excludes the primary factor, so showing the code field to a session owing an
  // enrolment is a dead end: every correct code comes back as "That did not match".
  it("sends a signed-in session owing an enrolment to the page that can clear it, rather than asking for a code", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore([]), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          { service: fakeFactorService("totp-app"), role: "second", requirement: "mandatory" },
          recoveryOffer(),
        ],
      }),
    });
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify", formBody({ code: "123456" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/enrol/totp");
  });

  it("marks the step-up and redirects, and marks it nowhere else", async () => {
    const stepUpWrites: number[] = [];
    const options = optionsWith({
      ...stepUpServices,
      signin: fakeAuthSigninFlow({ stepUp: async () => ok({ kind: "totp-app" as const, userId: "u9", verifiedAt: 1_000 }) }),
    });
    const app = mounted(actionApp({ userId: "u9", stepUpWrites }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify", formBody({ code: "123456" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/passkeys");
    expect(stepUpWrites).toEqual([1_000]);
  });

  it("leaves the step-up unmarked when the code is refused", async () => {
    const stepUpWrites: number[] = [];
    const options = optionsWith(stepUpServices);
    const app = mounted(actionApp({ userId: "u9", stepUpWrites }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify", formBody({ code: "123456" }));
    expect(res.status).toBe(422);
    expect(stepUpWrites).toEqual([]);
  });

  it("refuses an unreadable recovery code in a recovery code's words, never the digit-worded copy", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore(["totp-app", "recovery-code"]), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          { service: fakeFactorService("totp-app"), role: "second", requirement: "optional" },
          recoveryOffer(),
        ],
      }),
    });
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify?factor=recovery-code", formBody({ code: "A".repeat(65) }));
    expect(res.status).toBe(422);
    expect(textOf(await res.text(), "p", 'id="field-code-error"')).toBe("That is not a recovery code. Enter one exactly as you saved it.");
  });

  function loggedApp(seed: Seed, options: AuthWebOptions, warnings: unknown[]): Forge {
    const app = actionApp(seed);
    const logger = { ...nullLogger, warn: (message: string, data?: Record<string, unknown>) => void warnings.push([message, data]) };
    app.use("*", (context, next) => {
      requestLog.set(context, logger);
      return next();
    });
    return mounted(app, "POST", "/auth/verify", createVerifyActions(options).submit);
  }

  const holdingBoth: Partial<AuthRequestServices> = {
    users: fakeAuthUserStore([signedIn]),
    factors: createFactorRegistry(fakeFactorStore(["totp-app", "recovery-code"]), {
      offered: [
        { service: fakeFactorService("email-otp"), role: "primary" },
        { service: fakeFactorService("totp-app"), role: "second", requirement: "optional" },
        recoveryOffer(),
      ],
    }),
  };

  it("answers an unusable factor at 422 with a notice pointing at the others, and warns the operator which kind it was", async () => {
    const warnings: unknown[] = [];
    const stepUpWrites: number[] = [];
    const options = optionsWith({ ...holdingBoth, signin: fakeAuthSigninFlow({ stepUp: async () => err("unusable" as const) }) });
    const app = loggedApp({ userId: "u9", stepUpWrites }, options, warnings);

    const res = await app.request("/auth/verify?factor=totp-app", formBody({ code: "123456" }));
    const html = await res.text();
    expect({
      status: res.status,
      notice: textOf(html, "div", 'data-slot="alert-description"'),
      choice: attrOf(html, 'data-ref="verify-choice"', "href"),
      warnings,
      stepUpWrites,
    }).toEqual({
      status: 422,
      notice: "This sign-in method can&#39;t be checked right now. Choose another method below.",
      choice: "/auth/verify?factor=recovery-code",
      warnings: [["auth.factor.unusable", { kind: "totp-app" }]],
      stepUpWrites: [],
    });
  });

  it("logs nothing for a code that simply did not match, which is the visitor's mistake and no operator's", async () => {
    const warnings: unknown[] = [];
    const options = optionsWith({ ...holdingBoth, signin: fakeAuthSigninFlow({ stepUp: async () => err("unrecognised" as const) }) });
    const app = loggedApp({ userId: "u9" }, options, warnings);

    const res = await app.request("/auth/verify?factor=totp-app", formBody({ code: "123456" }));
    expect({ status: res.status, warnings }).toEqual({ status: 422, warnings: [] });
  });

  const stepUpNotices = [
    ["totp-app", "123456", "unrecognised", "That code did not match. Enter the code your app shows now."],
    ["totp-app", "123456", "too-many-attempts", "Too many attempts. Wait a while, then try again."],
    ["recovery-code", "ABCD-EFGH", "unrecognised", "That recovery code did not match. Check it and try again."],
    ["recovery-code", "ABCD-EFGH", "too-many-attempts", "Too many attempts. Wait a while, then try again."],
  ] as const;

  for (const [factor, code, reason, notice] of stepUpNotices) {
    it(`answers a ${factor} step-up refused as ${reason} without offering a new code, which only an email can send`, async () => {
      const options = optionsWith({ ...holdingBoth, signin: fakeAuthSigninFlow({ stepUp: async () => err(reason) }) });
      const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/verify", createVerifyActions(options).submit);

      const res = await app.request(`/auth/verify?factor=${factor}`, formBody({ code }));
      expect({ status: res.status, notice: textOf(await res.text(), "div", 'data-slot="alert-description"') }).toEqual({ status: 422, notice });
    });
  }

  it("hands the presented kind to the flow, so a recovery code is never checked as an app code", async () => {
    const presented: string[] = [];
    const signin = fakeAuthSigninFlow({
      stepUp: async (userId, kind, code, at) => {
        presented.push(`${kind}:${code}`);
        return ok({ kind, userId, verifiedAt: at });
      },
    });
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/verify", createVerifyActions(optionsWith({ ...holdingBoth, signin })).submit);

    await app.request("/auth/verify?factor=recovery-code", formBody({ code: " abcd-efgh " }));
    expect(presented).toEqual(["recovery-code:abcd-efgh"]);
  });

  it("lands a step-up by recovery code on the factors page flagged for repair, with the step-up marked", async () => {
    const stepUpWrites: number[] = [];
    const signin = fakeAuthSigninFlow({ stepUp: async (userId, kind, _code, at) => ok({ kind, userId, verifiedAt: at }) });
    const options = optionsWith({ ...holdingBoth, signin });
    const app = mounted(actionApp({ userId: "u9", stepUpWrites }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify?factor=recovery-code&next=%2Fapp", formBody({ code: "ABCD-EFGH" }));
    expect({ status: res.status, location: res.headers.get("location"), stepUpWrites }).toEqual({
      status: 303,
      location: "/account/factors?recovered=1",
      stepUpWrites: [1_000],
    });
  });

  it("asks for another code and comes back to the verification page", async () => {
    const options = optionsWith(stepUpServices);
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/verify/resend", createVerifyActions(options).resend);

    const res = await app.request("/auth/verify/resend", formBody({}));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify?resent=1000");
  });

  // The mark says a code was asked for, never that one was sent. Only a registered address can be
  // inside the reissue window, so an answer that differed would bin an address list by pressing a button.
  it("answers a registered and an unknown address alike, so the resend tells nothing about either", async () => {
    const options = optionsWith(stepUpServices);
    const answer = async (pendingEmail: string) => {
      const app = mounted(actionApp({ pendingEmail }), "POST", "/auth/verify/resend", createVerifyActions(options).resend);
      const res = await app.request("/auth/verify/resend", formBody({}));
      return { status: res.status, location: res.headers.get("location"), body: await res.text() };
    };

    expect(await answer("grace@example.com")).toEqual(await answer("nobody@example.com"));
  });
});

describe("a step-up is recorded on a verified factor and on no other outcome", () => {
  const EARLIER = 400;
  const VERIFIED_AT = 1_000;
  const PRIMARY = { service: fakeFactorService("email-otp"), role: "primary" } as const;

  async function marked(action: TestAction, route: string, url: string, init: RequestInit, seed: Seed = {}) {
    const stepUpWrites: number[] = [];
    const stepUpAfter: unknown[] = [];
    const app = mounted(actionApp({ ...seed, stepUpWrites, stepUpAfter }), "POST", route, action);
    const res = await app.request(url, init);
    return { status: res.status, location: res.headers.get("location"), stepUpWrites, stepUpAt: stepUpAfter[0] };
  }

  const acceptingStepUp = fakeAuthSigninFlow({ stepUp: async (userId, kind, _code, at) => ok({ kind, userId, verifiedAt: at }) });

  function secondFactor(enrolled: readonly AuthFactorKind[], requirement: "optional" | "mandatory"): Partial<AuthRequestServices> {
    return {
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore(enrolled), {
        offered: [PRIMARY, { service: fakeFactorService("totp-app"), role: "second", requirement }, recoveryOffer()],
      }),
    };
  }

  function verifySubmit(services: Partial<AuthRequestServices>): TestAction {
    return createVerifyActions(optionsWith(services)).submit;
  }

  const refusedStepUps = (["unrecognised", "too-many-attempts", "unavailable", "unusable", "expired"] as const).map((reason) => ({
    outcome: `a step-up code the flow refuses as ${reason}`,
    services: { ...secondFactor(["totp-app"], "optional"), signin: fakeAuthSigninFlow({ stepUp: async () => err(reason) }) },
    url: "/auth/verify",
    code: "123456",
    status: 422,
    location: null,
  }));

  const refusedBeforeTheFlow = [
    {
      outcome: "a step-up code the schema refuses",
      services: { ...secondFactor(["totp-app"], "optional"), signin: acceptingStepUp },
      url: "/auth/verify",
      code: "12",
      status: 422,
      location: null,
    },
    {
      outcome: "the enrolment detour, taken before an attempt is spent",
      services: { ...secondFactor([], "mandatory"), signin: acceptingStepUp },
      url: "/auth/verify",
      code: "123456",
      status: 303,
      location: "/auth/enrol/totp",
    },
    {
      outcome: "the detour of a session owing no step-up",
      services: { ...secondFactor([], "optional"), signin: acceptingStepUp },
      url: "/auth/verify?next=%2Fapp",
      code: "123456",
      status: 303,
      location: "/app",
    },
    {
      outcome: "the detour of a session whose factor standing cannot be read",
      services: {
        ...secondFactor(["totp-app"], "optional"),
        factors: { ...fakeFactorRegistry(["totp-app"]), resolve: async () => err(new AuthStoreError("unavailable", "resolve")) },
        signin: acceptingStepUp,
      },
      url: "/auth/verify",
      code: "123456",
      status: 503,
      location: null,
    },
  ];

  for (const { outcome, services, url, code, status, location } of [...refusedStepUps, ...refusedBeforeTheFlow]) {
    for (const [held, stepUpAt] of [
      ["no earlier mark", null],
      ["an earlier mark", EARLIER],
    ] as const) {
      it(`leaves ${held} as it was on ${outcome}`, async () => {
        const seed: Seed = stepUpAt === null ? { userId: "u9" } : { userId: "u9", stepUpAt };
        expect(await marked(verifySubmit(services), "/auth/verify", url, formBody({ code }), seed)).toEqual({
          status,
          location,
          stepUpWrites: [],
          stepUpAt,
        });
      });
    }
  }

  it("replaces an earlier mark with the moment a step-up code verified", async () => {
    const services = { ...secondFactor(["totp-app"], "optional"), signin: acceptingStepUp };
    const result = await marked(verifySubmit(services), "/auth/verify", "/auth/verify", formBody({ code: "123456" }), {
      userId: "u9",
      stepUpAt: EARLIER,
    });
    expect({ status: result.status, stepUpWrites: result.stepUpWrites, stepUpAt: result.stepUpAt }).toEqual({
      status: 303,
      stepUpWrites: [VERIFIED_AT],
      stepUpAt: VERIFIED_AT,
    });
  });

  it("leaves an earlier mark as it was when a step-up code is resent", async () => {
    const action = createVerifyActions(optionsWith({ ...secondFactor(["totp-app"], "optional"), signin: acceptingStepUp })).resend;
    const result = await marked(action, "/auth/verify/resend", "/auth/verify/resend", formBody({}), { userId: "u9", stepUpAt: EARLIER });
    expect({ status: result.status, stepUpWrites: result.stepUpWrites, stepUpAt: result.stepUpAt }).toEqual({
      status: 303,
      stepUpWrites: [],
      stepUpAt: EARLIER,
    });
  });

  for (const { outcome, signin, seed, status, location, stepUpAt } of [
    {
      outcome: "a sign-in code the flow refuses",
      signin: acceptingStepUp,
      seed: { pendingEmail: "grace@example.com", stepUpAt: EARLIER },
      status: 422,
      location: null,
      stepUpAt: EARLIER,
    },
    {
      outcome: "a sign-in code posted with no sign-in started",
      signin: acceptingStepUp,
      seed: { stepUpAt: EARLIER },
      status: 303,
      location: "/auth/signin",
      stepUpAt: EARLIER,
    },
    {
      outcome: "a completed sign-in, which clears a carried-over mark rather than recording one",
      signin: fakeAuthSigninFlow({
        stepUp: acceptingStepUp.stepUp,
        complete: async () => ok({ user: signedIn, kind: "email-otp" as const, resolution: { status: "satisfied" as const } }),
      }),
      seed: { pendingEmail: "grace@example.com", stepUpAt: EARLIER },
      status: 303,
      location: "/app",
      stepUpAt: null,
    },
  ]) {
    it(`records no step-up on ${outcome}`, async () => {
      const services = { ...secondFactor(["totp-app"], "optional"), signin };
      expect(await marked(verifySubmit(services), "/auth/verify", "/auth/verify?next=%2Fapp", formBody({ code: "123456" }), seed)).toEqual({
        status,
        location,
        stepUpWrites: [],
        stepUpAt,
      });
    });
  }

  const FINISH = "/auth/verify/passkey/finish";

  function passkeyFinish(verifies: boolean, offered = true): TestAction {
    const passkey = {
      ...fakeFactorService("passkey"),
      verifyChallenge: async (userId: string, _presented: string, at: number) =>
        verifies ? ok({ kind: "passkey" as const, userId, verifiedAt: at }) : err("unrecognised" as const),
    } as AuthFactorService;
    const factors = createFactorRegistry(fakeFactorStore(offered ? ["passkey"] : []), {
      offered: offered ? [PRIMARY, { service: passkey, role: "second", requirement: "optional" }, recoveryOffer()] : [PRIMARY],
    });
    return createPasskeyStepUpActions(optionsWith({ users: fakeAuthUserStore([signedIn]), factors })).finish;
  }

  const assertion = { credential: { id: "c", response: {} } };

  it("replaces an earlier mark with the moment a passkey assertion verified", async () => {
    const result = await marked(passkeyFinish(true), FINISH, FINISH, jsonBody(assertion), { userId: "u9", stepUpAt: EARLIER });
    expect({ status: result.status, stepUpWrites: result.stepUpWrites, stepUpAt: result.stepUpAt }).toEqual({
      status: 200,
      stepUpWrites: [VERIFIED_AT],
      stepUpAt: VERIFIED_AT,
    });
  });

  for (const { outcome, action, init, seed, status } of [
    {
      outcome: "a passkey assertion the factor refuses",
      action: passkeyFinish(false),
      init: jsonBody(assertion),
      seed: { userId: "u9" },
      status: 401,
    },
    { outcome: "a passkey finish carrying no credential", action: passkeyFinish(true), init: jsonBody({}), seed: { userId: "u9" }, status: 400 },
    {
      outcome: "a passkey finish whose JSON does not parse",
      action: passkeyFinish(true),
      init: { method: "POST", body: '{"credential":', headers: { "content-type": "application/json" } },
      seed: { userId: "u9" },
      status: 400,
    },
    {
      outcome: "a passkey finish a cross-site form posted as text/plain",
      action: passkeyFinish(true),
      init: { method: "POST", body: JSON.stringify(assertion), headers: { "content-type": "text/plain;charset=UTF-8" } },
      seed: { userId: "u9" },
      status: 415,
    },
    {
      outcome: "a passkey finish past the ceremony cap",
      action: passkeyFinish(true),
      init: jsonBody({ credential: { id: "c", padding: "x".repeat(AUTH_CEREMONY_MAX_BYTES) } }),
      seed: { userId: "u9" },
      status: 413,
    },
    {
      outcome: "a passkey finish from a session signed in as nobody",
      action: passkeyFinish(true),
      init: jsonBody(assertion),
      seed: {},
      status: 401,
    },
    {
      outcome: "a passkey finish where the deployment offers no passkey",
      action: passkeyFinish(true, false),
      init: jsonBody(assertion),
      seed: { userId: "u9" },
      status: 401,
    },
  ]) {
    it(`leaves an earlier mark as it was on ${outcome}`, async () => {
      const result = await marked(action, FINISH, FINISH, init, { ...seed, stepUpAt: EARLIER });
      expect({ status: result.status, stepUpWrites: result.stepUpWrites, stepUpAt: result.stepUpAt }).toEqual({
        status,
        stepUpWrites: [],
        stepUpAt: EARLIER,
      });
    });
  }
});

describe("createSignoutActions", () => {
  it("drops the session and returns to the sign-in page", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/signout", createSignoutActions(options).signout);

    const res = await app.request("/auth/signout", formBody({}));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/signin");
  });

  it("sends no Clear-Site-Data by default", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/signout", createSignoutActions(options).signout);

    const res = await app.request("/auth/signout", formBody({}));
    expect(res.headers.has("clear-site-data")).toBe(false);
  });

  it("clears the site's cache, and only its cache, on the navigation when signoutClearsSiteData is set", async () => {
    const options = { ...fakeAuthWebOptions(), signoutClearsSiteData: true };
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/signout", createSignoutActions(options).signout);

    const res = await app.request("/auth/signout", formBody({}));
    expect(res.status).toBe(303);
    expect(res.headers.get("clear-site-data")).toBe('"cache"');
  });

  it("clears the site's cache on an htmx sign-out too", async () => {
    const options = { ...fakeAuthWebOptions(), signoutClearsSiteData: true };
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/signout", createSignoutActions(options).signout);

    const res = await app.request("/auth/signout", {
      method: "POST",
      body: "",
      headers: { "content-type": "application/x-www-form-urlencoded", ...HX_REQUEST },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("hx-redirect")).toBe("/auth/signin");
    expect(res.headers.get("clear-site-data")).toBe('"cache"');
  });

  /** Signs out under `options`, then posts the site-data clear `times` times on the session the sign-out left. */
  async function siteDataAfterSignout(options: AuthWebOptions, times: number): Promise<Response[]> {
    const actions = createSignoutActions(options);
    const app = mounted(actionApp(), "POST", "/auth/signout", actions.signout);
    mapHandler(app, "POST", "/auth/signout/site-data", actions.signoutSiteData);
    let cookie = (await app.request("/auth/signout", formBody({}))).headers.get("set-cookie")?.split(";")[0] ?? "";
    const answers: Response[] = [];
    for (let i = 0; i < times; i++) {
      const res = await app.request("/auth/signout/site-data", { method: "POST", headers: { cookie } });
      cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
      answers.push(res);
    }
    return answers;
  }

  it("clears the site's storage once, on the first site-data post after a sign-out that owes it", async () => {
    const answers = await siteDataAfterSignout({ ...fakeAuthWebOptions(), signoutClearsSiteData: true }, 2);
    expect(answers.map((res) => [res.status, res.headers.get("clear-site-data")])).toEqual([
      [204, '"storage"'],
      [204, null],
    ]);
  });

  it("clears no storage on a site-data post after a sign-out that owes none", async () => {
    const answers = await siteDataAfterSignout(fakeAuthWebOptions(), 1);
    expect(answers.map((res) => [res.status, res.headers.get("clear-site-data")])).toEqual([[204, null]]);
  });

  it("clears no storage on a site-data post from a session that never signed out", async () => {
    const options = { ...fakeAuthWebOptions(), signoutClearsSiteData: true };
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/signout/site-data", createSignoutActions(options).signoutSiteData);

    const res = await app.request("/auth/signout/site-data", { method: "POST" });
    expect([res.status, res.headers.get("clear-site-data")]).toEqual([204, null]);
  });

  it("clears no storage on a site-data post after a sign-in that followed the sign-out", async () => {
    const options = {
      ...optionsWith({
        signin: fakeAuthSigninFlow({
          complete: async () => ok({ user: signedIn, kind: "email-otp" as const, resolution: { status: "satisfied" } }),
        }),
      }),
      signoutClearsSiteData: true,
    };
    const signout = createSignoutActions(options);
    const app = mounted(actionApp(), "POST", "/auth/signout", signout.signout);
    mapHandler(app, "POST", "/auth/signout/site-data", signout.signoutSiteData);
    mapHandler(app, "POST", "/auth/signin", createSigninActions(options).signinSubmit);
    mapHandler(app, "POST", "/auth/verify", createVerifyActions(options).submit);

    let cookie = "";
    const send = async (path: string, init: RequestInit): Promise<Response> => {
      const res = await app.request(path, { ...init, headers: { ...init.headers, cookie } });
      cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
      return res;
    };
    await send("/auth/signout", formBody({}));
    await send("/auth/signin", formBody({ email: "grace@example.com" }));
    const verified = await send("/auth/verify", formBody({ code: "123456" }));
    const res = await send("/auth/signout/site-data", { method: "POST" });

    expect([verified.headers.get("location"), res.status, res.headers.get("clear-site-data")]).toEqual(["/account/passkeys", 204, null]);
  });
});

describe("createPasskeyEnrolActions — the nickname the ceremony carries", () => {
  const RP_ID = "example.com";
  const ORIGIN = "https://example.com";
  const CREDENTIAL_ID = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]) as Uint8Array<ArrayBuffer>;

  let key: PasskeyKeyPair;

  beforeAll(async () => {
    key = await createPasskeyKeyPair(-7);
  });

  /** A writable credential store, so what the ceremony stored can be read back. */
  function writableCredentials() {
    const rows: AuthCredential[] = [];
    const store: CredentialStore = {
      ...fakeAuthCredentialStore(rows),
      listByUser: async (userId) => ok(rows.filter((row) => row.userId === userId)),
      findByCredentialId: async (credentialId) => ok(rows.find((row) => row.credentialId === credentialId) ?? null),
      create: async (input, at) => {
        const row = fakeAuthCredential({ ...input, label: input.label ?? null, transports: input.transports ?? [], createdAt: at, updatedAt: at });
        rows.push(row);
        return ok(row);
      },
    };
    return { store, rows };
  }

  /** The enrol app, its stores, and a `finish` driven through the real registration ceremony. */
  function enrolling() {
    // The ceremony mints the WebAuthn handle on first enrolment, which the read-only fixture refuses.
    let held = signedIn;
    const minting: UserStore = {
      ...fakeAuthUserStore([signedIn]),
      findById: async (id) => ok(id === held.id ? held : null),
      setWebAuthnIdIfAbsent: async (_id, webauthnId, at) => {
        held = { ...held, webauthnId, updatedAt: at };
        return ok(held);
      },
    };
    const credentials = writableCredentials();
    const challenges = new Map<string, AuthChallenge>();
    const enrolments = fakeFactorStore([]);
    const passkey = createPasskeyFactor({
      rpId: RP_ID,
      rpName: "Forge Demo",
      origin: ORIGIN,
      sessionId: "s1",
      users: minting,
      factors: {
        ...enrolments,
        enrol: async (input, at) =>
          ok({
            ...input,
            id: "f1",
            secret: null,
            lastCounter: null,
            failedAttempts: 0,
            lastVerifiedAt: null,
            confirmedAt: at,
            createdAt: at,
            updatedAt: at,
          }),
      },
      credentials: credentials.store,
      challenges: {
        put: async (slot, challenge) => {
          challenges.set(slot, challenge);
          return ok(undefined);
        },
        take: async (slot) => {
          const stored = challenges.get(slot) ?? null;
          challenges.delete(slot);
          return ok(stored);
        },
      },
      subject: () => ({ name: signedIn.email, displayName: signedIn.email }),
    });
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      credentials: credentials.store,
      enrolments,
      factors: createFactorRegistry(fakeFactorStore([]), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          { service: passkey, role: "second", requirement: "optional" },
          recoveryOffer(),
        ],
      }),
    });
    const actions = createPasskeyEnrolActions(options);
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/enrol/passkey/register/begin", actions.begin);
    mapHandler(app, "POST", "/auth/enrol/passkey/register/finish", actions.finish);

    async function finish(nickname?: string) {
      const begun = await app.request("/auth/enrol/passkey/register/begin", jsonBody({}));
      expect(begun.status).toBe(200);
      const challenge = challenges.get("passkey:register:s1")?.challenge;
      if (challenge === undefined) throw new Error("the begin endpoint stored no registration challenge");
      const credential = await fakePasskeyRegistration({ key, rpId: RP_ID, origin: ORIGIN, challenge, credentialId: CREDENTIAL_ID });
      return app.request("/auth/enrol/passkey/register/finish", jsonBody({ credential, nickname }));
    }

    return { credentials, finish };
  }

  it("stores the credential under the exact name the visitor typed", async () => {
    const scene = enrolling();
    expect((await scene.finish("Work laptop")).status).toBe(200);
    expect(scene.credentials.rows.map((row) => row.label)).toEqual(["Work laptop"]);
  });

  it("stores no name rather than an empty one for a blank field, so `Unnamed passkey` keeps meaning it", async () => {
    for (const nickname of [undefined, "   "]) {
      const scene = enrolling();
      expect((await scene.finish(nickname)).status).toBe(200);
      expect(scene.credentials.rows.map((row) => row.label)).toEqual([null]);
    }
  });

  it("stores a hostile name verbatim, leaving the escaping to the view that renders it", async () => {
    const scene = enrolling();
    expect((await scene.finish(HOSTILE_TEXT)).status).toBe(200);
    expect(scene.credentials.rows.map((row) => row.label)).toEqual([HOSTILE_TEXT]);
  });

  it("refuses a nickname past the cap the rename path holds the same field to", async () => {
    const scene = enrolling();
    const res = await scene.finish("n".repeat(65));
    expect(res.status).toBe(400);
    expect(scene.credentials.rows).toEqual([]);
  });

  it("accepts the cap exactly", async () => {
    const scene = enrolling();
    expect((await scene.finish("n".repeat(64))).status).toBe(200);
    expect(scene.credentials.rows.map((row) => row.label)).toEqual(["n".repeat(64)]);
  });
});

describe("where a passkey enrolment's finish lands", () => {
  const FINISH = "/account/passkeys/register/finish";

  const confirmedRow = (kind: AuthFactorKind): AuthFactor => ({
    id: `f-${kind}`,
    userId: "u9",
    kind,
    secret: null,
    lastCounter: null,
    failedAttempts: 0,
    lastVerifiedAt: null,
    confirmedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  });

  /** Options whose offered factors report `held` as confirmed, the recovery-code one counting `remaining` unused codes, and whose settled page is not the passkey list. */
  function standing(held: readonly AuthFactorKind[], remaining: number): AuthWebOptions {
    const listed = (kind: AuthFactorKind) => ({
      ...fakeFactorService(kind),
      listEnrolments: async () => ok(held.includes(kind) ? [confirmedRow(kind)] : []),
    });
    const passkey = { ...listed("passkey"), completeEnrolment: async () => ok(confirmedRow("passkey")) } as AuthFactorService;
    const codes = Object.assign(listed("recovery-code"), { remaining: async () => ok(remaining) }) as AuthFactorService;
    const services = fakeAuthServices({
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore(held), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          { service: listed("totp-app") as AuthFactorService, role: "second", requirement: "optional" },
          { service: passkey, role: "second", requirement: "optional" },
          { service: codes, role: "second", requirement: "optional" },
        ],
      }),
    });
    return fakeAuthWebOptions({ resolveServices: () => services, settledPath: "/app/home" });
  }

  const LANDINGS = [
    {
      label: "sends an account enrolment of the first recoverable factor on to generate recovery codes",
      build: createPasskeyAccountEnrolActions,
      held: [],
      remaining: 0,
      expected: "/account/recovery-codes",
    },
    {
      label: "returns an account enrolment to the passkey list once the account holds unspent codes",
      build: createPasskeyAccountEnrolActions,
      held: ["totp-app", "recovery-code"],
      remaining: 10,
      expected: "/account/passkeys",
    },
    {
      label: "sends an account enrolment on to recovery codes when every code is spent",
      build: createPasskeyAccountEnrolActions,
      held: ["totp-app", "recovery-code"],
      remaining: 0,
      expected: "/account/recovery-codes",
    },
    {
      label: "lands an owed enrolment on the settled page, not the passkey list the account variant returns to",
      build: createPasskeyEnrolActions,
      held: ["totp-app", "recovery-code"],
      remaining: 10,
      expected: "/app/home",
    },
  ] as const;

  for (const { label, build, held, remaining, expected } of LANDINGS) {
    it(label, async () => {
      const app = mounted(actionApp({ userId: "u9" }), "POST", FINISH, build(standing(held, remaining)).finish);
      const res = await app.request(FINISH, jsonBody({ credential: { id: "cred-1" }, nickname: "Laptop" }));
      expect({ status: res.status, body: await res.json() }).toEqual({ status: 200, body: { redirect: expected } });
    });
  }
});

describe("the passkey begin endpoints", () => {
  const offered = {
    challenge: "c",
    rpId: "example.com",
    extensions: { prf: { eval: { first: "-_8" }, evalByCredential: { "cred-a": { first: "AQID" } } }, credProps: true },
  };

  function passkeyServices(): Partial<AuthRequestServices> {
    const passkey = {
      ...fakeFactorService("passkey"),
      createChallenge: async () => ok({ kind: "passkey" as const, expiresAt: 1_000, options: offered }),
      beginEnrolment: async () => ok({ kind: "passkey" as const, expiresAt: 1_000, options: offered }),
    } as AuthFactorService;
    return {
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore([]), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          { service: passkey, role: "second", requirement: "optional" },
          recoveryOffer(),
        ],
      }),
    };
  }

  it("answers the step-up begin with the factor's options verbatim, extensions included", async () => {
    const actions = createPasskeyStepUpActions(optionsWith(passkeyServices()));
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/verify/passkey/begin", actions.begin);

    const res = await app.request("/auth/verify/passkey/begin", jsonBody({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(offered);
  });

  it("answers the enrolment begin with the factor's options verbatim, extensions included", async () => {
    const actions = createPasskeyEnrolActions(optionsWith(passkeyServices()));
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/enrol/passkey/register/begin", actions.begin);

    const res = await app.request("/auth/enrol/passkey/register/begin", jsonBody({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(offered);
  });

  it("answers the account enrolment begin with the factor's options verbatim, extensions included", async () => {
    const actions = createPasskeyAccountEnrolActions(optionsWith(passkeyServices()));
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/account/passkeys/register/begin", actions.begin);

    const res = await app.request("/account/passkeys/register/begin", jsonBody({}));
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 200, body: offered });
  });

  it("refuses the account enrolment begin to a request no guard established an identity on", async () => {
    const actions = createPasskeyAccountEnrolActions(optionsWith(passkeyServices()));
    const app = mounted(actionApp(), "POST", "/account/passkeys/register/begin", actions.begin);

    expect((await app.request("/account/passkeys/register/begin", jsonBody({}))).status).toBe(401);
  });
});

describe("the ceremony endpoints cap what they read", () => {
  const oversized = JSON.stringify({ credential: { id: "c", padding: "x".repeat(AUTH_CEREMONY_MAX_BYTES) } });
  const CEREMONY_PATH = "/auth/enrol/passkey/register/finish";

  function ceremonyApp() {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), factors: fakeFactorRegistry(["passkey"]) });
    return mounted(actionApp({ userId: "u9" }), "POST", CEREMONY_PATH, createPasskeyEnrolActions(options).finish);
  }

  it("answers 413 on a body whose Content-Length already says too much", async () => {
    const res = await ceremonyApp().request(CEREMONY_PATH, { method: "POST", body: oversized, headers: { "content-type": "application/json" } });
    expect(res.status).toBe(413);
  });

  // The streaming count, not `Content-Length`, is what caps a chunked body whose header is absent.
  it("answers 413 on a streamed body that overruns the cap with no Content-Length to declare it", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized));
        controller.close();
      },
    });
    const res = await ceremonyApp().request(CEREMONY_PATH, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
  });

  it("still reads a body inside the cap, so the bound refuses nothing real", async () => {
    const res = await ceremonyApp().request(CEREMONY_PATH, jsonBody({ credential: { id: "c" } }));
    expect(res.status).toBe(400);
  });

  // A `text/plain` form needs no preflight, so a cross-site page can post a JSON-shaped body to this
  // endpoint. Parsing on shape alone reads it; only the declared type tells the two apart.
  it("answers 415 to a JSON-shaped body a cross-site form declared as text/plain", async () => {
    const res = await ceremonyApp().request(CEREMONY_PATH, {
      method: "POST",
      body: JSON.stringify({ credential: { id: "c" } }),
      headers: { "content-type": "text/plain;charset=UTF-8" },
    });

    expect(res.status).toBe(415);
  });

  it("answers 415 to the other two enctypes a form may post without a preflight", async () => {
    const body = JSON.stringify({ credential: { id: "c" } });
    const post = (contentType: string) => ceremonyApp().request(CEREMONY_PATH, { method: "POST", body, headers: { "content-type": contentType } });

    expect((await post("application/x-www-form-urlencoded")).status).toBe(415);
    expect((await post("multipart/form-data; boundary=x")).status).toBe(415);
  });

  it("reads a Content-Type carrying a charset parameter, which is the same media type", async () => {
    const res = await ceremonyApp().request(CEREMONY_PATH, {
      method: "POST",
      body: JSON.stringify({ credential: { id: "c" } }),
      headers: { "content-type": "application/json; charset=utf-8" },
    });

    expect(res.status).toBe(400);
  });

  it("refuses malformed JSON rather than reading it as an absent body", async () => {
    const res = await ceremonyApp().request(CEREMONY_PATH, {
      method: "POST",
      body: '{"credential":',
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "The passkey was not accepted." });
  });
});

describe("createPasskeyManageActions", () => {
  const credential = fakeAuthCredential({ id: "c1", userId: "u9" });
  const options = optionsWith({
    users: fakeAuthUserStore([signedIn]),
    credentials: fakeAuthCredentialStore([credential]),
    factors: fakeFactorRegistry(["passkey"]),
  });

  // The store's own ownership scope, kept here so a rename across accounts is asserted end to end.
  function renaming(rows: AuthCredential[]): CredentialStore {
    return {
      ...fakeAuthCredentialStore(rows),
      relabel: async (id, userId, label, at) => {
        const index = rows.findIndex((row) => row.id === id && row.userId === userId);
        const row = rows[index];
        if (row === undefined) return ok(false);
        rows[index] = { ...row, label, updatedAt: at };
        return ok(true);
      },
    };
  }

  it("renames a credential and re-renders the page the visitor is on", async () => {
    const rows = [fakeAuthCredential({ id: "c1", userId: "u9", label: "Laptop" })];
    const renameOptions = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      credentials: renaming(rows),
      factors: fakeFactorRegistry(["passkey"]),
    });
    const app = mounted(actionApp({ userId: "u9" }), "PATCH", "/account/passkeys/:id", createPasskeyManageActions(renameOptions).passkeyRename);

    const res = await app.request("/account/passkeys/c1", formBody({ label: "Phone" }, "PATCH"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(rows.map((row) => row.label)).toEqual(["Phone"]);
    expect(attrOf(await res.text(), 'name="label"', "value")).toBe("Phone");
  });

  it("clears a name back to nothing rather than writing an empty one", async () => {
    const rows = [fakeAuthCredential({ id: "c1", userId: "u9", label: "Laptop" })];
    const renameOptions = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      credentials: renaming(rows),
      factors: fakeFactorRegistry(["passkey"]),
    });
    const app = mounted(actionApp({ userId: "u9" }), "PATCH", "/account/passkeys/:id", createPasskeyManageActions(renameOptions).passkeyRename);

    await app.request("/account/passkeys/c1", formBody({ label: "   " }, "PATCH"));
    expect(rows.map((row) => row.label)).toEqual([null]);
  });

  it("changes nothing and answers 404 for another account's credential", async () => {
    const rows = [fakeAuthCredential({ id: "c1", userId: "u1", label: "Laptop" })];
    const renameOptions = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      credentials: renaming(rows),
      factors: fakeFactorRegistry(["passkey"]),
    });
    const app = mounted(actionApp({ userId: "u9" }), "PATCH", "/account/passkeys/:id", createPasskeyManageActions(renameOptions).passkeyRename);

    const res = await app.request("/account/passkeys/c1", formBody({ label: "Phone" }, "PATCH"));
    expect(res.status).toBe(404);
    expect(rows.map((row) => row.label)).toEqual(["Laptop"]);
  });

  it("answers 404 for a credential the visitor does not own", async () => {
    const app = mounted(actionApp({ userId: "u9" }), "DELETE", "/account/passkeys/:id", createPasskeyManageActions(options).passkeyRemove);

    const res = await app.request("/account/passkeys/other", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  // The same withdrawal the passkey pages answer 404 for, against a credential this visitor owns.
  const withdrawn = optionsWith({ users: fakeAuthUserStore([signedIn]), credentials: fakeAuthCredentialStore([credential]) });

  it("changes nothing and answers 404 to a rename when the deployment offers no passkey factor", async () => {
    const rows = [fakeAuthCredential({ id: "c1", userId: "u9", label: "Laptop" })];
    const renameOptions = optionsWith({ users: fakeAuthUserStore([signedIn]), credentials: renaming(rows) });
    const app = mounted(actionApp({ userId: "u9" }), "PATCH", "/account/passkeys/:id", createPasskeyManageActions(renameOptions).passkeyRename);

    const res = await app.request("/account/passkeys/c1", formBody({ label: "Phone" }, "PATCH"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
    expect(rows.map((row) => row.label)).toEqual(["Laptop"]);
  });

  it("sends an anonymous rename to sign-in rather than reporting which factors this deployment offers", async () => {
    const app = mounted(actionApp(), "PATCH", "/account/passkeys/:id", createPasskeyManageActions(withdrawn).passkeyRename);

    const res = await app.request("/account/passkeys/c1", formBody({ label: "Phone" }, "PATCH"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/signin");
  });

  it("answers 404 to a removal when the deployment offers no passkey factor", async () => {
    const app = mounted(actionApp({ userId: "u9" }), "DELETE", "/account/passkeys/:id", createPasskeyManageActions(withdrawn).passkeyRemove);

    const res = await app.request("/account/passkeys/c1", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });
});

describe("createTotpManageActions", () => {
  // The stock fake refuses every ceremony; this one gets far enough to show the confirmation form.
  const totpService = {
    ...fakeFactorService("totp-app"),
    beginEnrolment: async () => ok({ kind: "totp-app" as const, expiresAt: 1_000, options: { secret: "JBSWY3DP", uri: "otpauth://totp/x" } }),
  } as AuthFactorService;

  const totpServices: Partial<AuthRequestServices> = {
    users: fakeAuthUserStore([signedIn]),
    factors: createFactorRegistry(fakeFactorStore([]), {
      offered: [
        { service: fakeFactorService("email-otp"), role: "primary" },
        { service: totpService, role: "second", requirement: "optional" },
        recoveryOffer(),
      ],
    }),
  };

  it("re-renders at 422 when the confirmation code is refused", async () => {
    const options = optionsWith(totpServices);
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/account/totp", createTotpManageActions(options).totpEnrol);

    const res = await app.request("/account/totp", formBody({ code: "123456" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("location")).toBeNull();
  });

  it("says a well-formed code that enrolment refused did not match, never that it was the wrong shape", async () => {
    const options = optionsWith(totpServices);
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/account/totp", createTotpManageActions(options).totpEnrol);

    const html = await (await app.request("/account/totp", formBody({ code: "123456" }))).text();
    expect([elementOf(html, "p", 'data-slot="field-error"'), html.includes("not the shape we sent")]).toEqual([
      '<p data-slot="field-error" class="text-sm font-normal text-destructive-text" id="field-code-error">That code did not match. Enter the code your app shows now.</p>',
      false,
    ]);
  });

  it("says a malformed code was the wrong shape, never that it did not match", async () => {
    const options = optionsWith(totpServices);
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/account/totp", createTotpManageActions(options).totpEnrol);

    const html = await (await app.request("/account/totp", formBody({ code: "12ab" }))).text();
    expect([elementOf(html, "p", 'data-slot="field-error"'), html.includes("did not match")]).toEqual([
      '<p data-slot="field-error" class="text-sm font-normal text-destructive-text" id="field-code-error">That code is not the shape we sent. Enter the digits exactly as they appear.</p>',
      false,
    ]);
  });

  it("returns to the authenticator page once every enrolment row is gone", async () => {
    const options = optionsWith(totpServices);
    const app = mounted(actionApp({ userId: "u9" }), "DELETE", "/account/totp", createTotpManageActions(options).totpRemove);

    const res = await app.request("/account/totp", { method: "DELETE" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/totp");
  });
});

describe("createRecoveryCodeActions", () => {
  const NOW = 10_000_000;
  const FRESH_MS = 900_000;
  const ISSUED = ["AAAA-BBBB-CCCC-DDDD-EEEE-FFFF", "GGGG-HHHH-IIII-JJJJ-KKKK-LLLL"];

  const confirmedRow = (kind: AuthFactorKind): AuthFactor => ({
    id: `f-${kind}`,
    userId: "u9",
    kind,
    secret: null,
    lastCounter: null,
    failedAttempts: 0,
    lastVerifiedAt: null,
    confirmedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  });

  function codePages(holds: readonly AuthFactorKind[], guard: { readonly freshStepUpMaxAgeMs?: number | null; readonly mounted?: boolean } = {}) {
    const calls: string[] = [];
    const holding = (kind: "totp-app" | "passkey") =>
      ({ ...fakeFactorService(kind), listEnrolments: async () => ok(holds.includes(kind) ? [confirmedRow(kind)] : []) }) as AuthFactorService;
    const recovery = {
      ...fakeFactorService("recovery-code"),
      beginEnrolment: async (userId: string, at: number) => {
        calls.push(`begin:${userId}`);
        return ok({ kind: "recovery-code" as const, expiresAt: at, options: { codes: ISSUED } });
      },
      completeEnrolment: async (userId: string, presented: string) => {
        calls.push(`complete:${userId}:${presented}`);
        return presented === ISSUED[1] ? ok(confirmedRow("recovery-code")) : err("unrecognised" as const);
      },
    } as AuthFactorService;
    const services = fakeAuthServices({
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore(holds), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          { service: holding("totp-app"), role: "second", requirement: "optional" },
          { service: holding("passkey"), role: "second", requirement: "optional" },
          { service: recovery, role: "second", requirement: "optional" },
        ],
      }),
    });
    const options = fakeAuthWebOptions({ resolveServices: () => services, now: () => NOW });
    const actions = createRecoveryCodeActions(options);
    const freshStepUp = requireFreshStepUp({
      factors: () => ({ resolve: async () => ok({ status: "satisfied" as const }) }),
      enrolmentPaths: authEnrolmentPaths(options.paths.auth),
      stepUpPath: options.paths.auth.verify.show(),
      settledPath: "/account",
      now: () => NOW,
      ...(guard.freshStepUpMaxAgeMs === undefined ? {} : { freshStepUpMaxAgeMs: guard.freshStepUpMaxAgeMs }),
    });
    const app = (seed: Seed) => {
      const guardedApp = actionApp(seed);
      if (seed.userId !== undefined && guard.mounted !== false) guardedApp.use("*", freshStepUp);
      const mountedApp = mounted(guardedApp, "POST", "/account/recovery-codes", actions.recoveryCodesGenerate);
      return mounted(mountedApp, "POST", "/account/recovery-codes/confirm", actions.recoveryCodesConfirm);
    };
    return { calls, app };
  }

  it("shows a freshly staged set once, uncached, to a holder of an authenticator who has just stepped up", async () => {
    const { calls, app } = codePages(["totp-app"]);
    const res = await app({ userId: "u9", stepUpAt: NOW - 1 }).request("/account/recovery-codes", formBody({}));
    const html = await res.text();
    expect({ status: res.status, cache: res.headers.get("cache-control"), codes: textOf(html, "pre", 'data-ref="recovery-codes"'), calls }).toEqual(
      { status: 200, cache: "no-store", codes: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF\nGGGG-HHHH-IIII-JJJJ-KKKK-LLLL", calls: ["begin:u9"] },
    );
  });

  it("issues codes to a passkey holder too, since a lost passkey needs recovering as much as a lost app", async () => {
    const { calls, app } = codePages(["passkey"]);
    const res = await app({ userId: "u9", stepUpAt: NOW - 1 }).request("/account/recovery-codes", formBody({}));
    expect({ status: res.status, calls }).toEqual({ status: 200, calls: ["begin:u9"] });
  });

  it("accepts a step-up one millisecond inside the freshness window", async () => {
    const { calls, app } = codePages(["totp-app"]);
    const res = await app({ userId: "u9", stepUpAt: NOW - FRESH_MS + 1 }).request("/account/recovery-codes", formBody({}));
    expect({ status: res.status, calls }).toEqual({ status: 200, calls: ["begin:u9"] });
  });

  const refusals: readonly {
    label: string;
    holds: readonly AuthFactorKind[];
    seed: Seed;
    expected: { status: number; location: string | null };
  }[] = [
    {
      label: "an account holding no authenticator, whose mailbox alone must not mint a way past a second factor",
      holds: [],
      seed: { userId: "u9", stepUpAt: NOW - 1 },
      expected: { status: 409, location: null },
    },
    {
      label: "an account holding only codes, which recover nothing",
      holds: ["recovery-code"],
      seed: { userId: "u9", stepUpAt: NOW - 1 },
      expected: { status: 409, location: null },
    },
    {
      label: "a session that never stepped up",
      holds: ["totp-app"],
      seed: { userId: "u9" },
      expected: { status: 303, location: "/auth/verify?next=%2Faccount%2Frecovery-codes" },
    },
    {
      label: "a step-up exactly as old as the freshness window",
      holds: ["totp-app"],
      seed: { userId: "u9", stepUpAt: NOW - FRESH_MS },
      expected: { status: 303, location: "/auth/verify?next=%2Faccount%2Frecovery-codes" },
    },
    {
      label: "a step-up dated into the future",
      holds: ["totp-app"],
      seed: { userId: "u9", stepUpAt: NOW + 1 },
      expected: { status: 303, location: "/auth/verify?next=%2Faccount%2Frecovery-codes" },
    },
    { label: "an anonymous request", holds: ["totp-app"], seed: {}, expected: { status: 303, location: "/auth/signin" } },
  ];

  for (const { label, holds, seed, expected } of refusals) {
    it(`refuses both code POSTs to ${label}, staging and confirming nothing`, async () => {
      const { calls, app } = codePages(holds);
      const mountedApp = app(seed);
      const answers = [];
      for (const [path, fields] of [
        ["/account/recovery-codes", {}],
        ["/account/recovery-codes/confirm", { code: ISSUED[1] ?? "" }],
      ] as const) {
        const res = await mountedApp.request(path, formBody(fields));
        answers.push({ status: res.status, location: res.headers.get("location") });
      }
      expect({ answers, calls }).toEqual({ answers: [expected, expected], calls: [] });
    });
  }

  const TO_VERIFY = { status: 303, location: "/auth/verify?next=%2Faccount%2Frecovery-codes" };
  const ADMITTED = {
    answers: [
      { status: 200, location: null },
      { status: 303, location: "/app" },
    ],
    calls: ["begin:u9", `complete:u9:${ISSUED[1]}`],
  };
  const REFUSED = { answers: [TO_VERIFY, TO_VERIFY], calls: [] };
  const MINUTE = 60_000;

  const windows: readonly {
    label: string;
    guard: { readonly freshStepUpMaxAgeMs?: number | null; readonly mounted?: boolean };
    seed: Seed;
    expected: typeof ADMITTED | typeof REFUSED;
  }[] = [
    {
      label: "refuses a 10-minute-old step-up under a configured 60 s window",
      guard: { freshStepUpMaxAgeMs: MINUTE },
      seed: { userId: "u9", stepUpAt: NOW - 10 * MINUTE },
      expected: REFUSED,
    },
    {
      label: "admits a step-up one millisecond inside a configured 60 s window",
      guard: { freshStepUpMaxAgeMs: MINUTE },
      seed: { userId: "u9", stepUpAt: NOW - MINUTE + 1 },
      expected: ADMITTED,
    },
    {
      label: "admits a step-up one millisecond inside the default 15-minute window",
      guard: {},
      seed: { userId: "u9", stepUpAt: NOW - FRESH_MS + 1 },
      expected: ADMITTED,
    },
    {
      label: "refuses a step-up one millisecond outside the default 15-minute window",
      guard: {},
      seed: { userId: "u9", stepUpAt: NOW - FRESH_MS - 1 },
      expected: REFUSED,
    },
    {
      label: "admits a day-old step-up in this session when the window is `null`",
      guard: { freshStepUpMaxAgeMs: null },
      seed: { userId: "u9", stepUpAt: NOW - 24 * 60 * MINUTE },
      expected: ADMITTED,
    },
    {
      label: "refuses a session that never stepped up when the window is `null`",
      guard: { freshStepUpMaxAgeMs: null },
      seed: { userId: "u9" },
      expected: REFUSED,
    },
    {
      label: "refuses even a just-made step-up when `requireFreshStepUp` published no window",
      guard: { mounted: false },
      seed: { userId: "u9", stepUpAt: NOW - 1 },
      expected: REFUSED,
    },
  ];

  for (const { label, guard, seed, expected } of windows) {
    it(`${label}, on both code POSTs`, async () => {
      const { calls, app } = codePages(["totp-app"], guard);
      const mountedApp = app(seed);
      const answers = [];
      for (const [path, fields] of [
        ["/account/recovery-codes", {}],
        ["/account/recovery-codes/confirm?next=%2Fapp", { code: ISSUED[1] ?? "" }],
      ] as const) {
        const res = await mountedApp.request(path, formBody(fields));
        answers.push({ status: res.status, location: res.headers.get("location") });
      }
      expect({ answers, calls }).toEqual(expected);
    });
  }

  it("names why an account without an authenticator is refused codes", async () => {
    const { app } = codePages([]);
    const res = await app({ userId: "u9", stepUpAt: NOW - 1 }).request("/account/recovery-codes", formBody({}));
    expect(await res.text()).toBe("Recovery codes are issued only to an account holding an authenticator app or a passkey.");
  });

  it("confirms the staged set by one of its codes and follows the return-to", async () => {
    const { calls, app } = codePages(["totp-app"]);
    const res = await app({ userId: "u9", stepUpAt: NOW - 1 }).request(
      "/account/recovery-codes/confirm?next=%2Fapp",
      formBody({ code: ISSUED[1] ?? "" }),
    );
    expect({ status: res.status, location: res.headers.get("location"), calls }).toEqual({
      status: 303,
      location: "/app",
      calls: [`complete:u9:${ISSUED[1]}`],
    });
  });

  it("re-renders the confirmation at 422 for a code outside the staged set, showing no code again", async () => {
    const { app } = codePages(["totp-app"]);
    const res = await app({ userId: "u9", stepUpAt: NOW - 1 }).request("/account/recovery-codes/confirm", formBody({ code: "ZZZZ-ZZZZ" }));
    const html = await res.text();
    expect({
      status: res.status,
      error: textOf(html, "p", 'id="field-code-error"'),
      codes: textOf(html, "pre", 'data-ref="recovery-codes"'),
    }).toEqual({ status: 422, error: "That is not one of the new codes. Enter one exactly as it is shown.", codes: "" });
  });

  it("refuses an over-long confirmation at the schema, before the factor spends an attempt on it", async () => {
    const { calls, app } = codePages(["totp-app"]);
    const res = await app({ userId: "u9", stepUpAt: NOW - 1 }).request("/account/recovery-codes/confirm", formBody({ code: "A".repeat(65) }));
    expect({ status: res.status, error: textOf(await res.text(), "p", 'id="field-code-error"'), calls }).toEqual({
      status: 422,
      error: "That is not one of the new codes. Enter one exactly as it is shown.",
      calls: [],
    });
  });
});

describe("createAdminUserActions — resetFactors", () => {
  const target = fakeAuthUser({ id: "u2", email: "member@example.com" });
  const actor = fakeAuthUser({ id: "u9", email: "grace@example.com", isAdmin: true });

  function resetApp(seed: Seed, outcome: "changed" | "not-found" = "changed") {
    const resets: string[] = [];
    const admin = fakeAdminUserStore([target, actor], {
      resetFactors: async (id, at) => {
        resets.push(`${id}@${at}`);
        return ok(outcome);
      },
    });
    const options = optionsWith({ users: fakeAuthUserStore([target, actor]), admin });
    const app = mounted(actionApp(seed), "POST", "/admin/users/:id/factors/reset", createAdminUserActions(options).resetFactors);
    return { resets, app };
  }

  const answerOf = async (res: Response) => ({ status: res.status, location: res.headers.get("location") });

  it("clears another account's factors and returns to its factors panel", async () => {
    const { resets, app } = resetApp({ userId: "u9", admin: true });
    const res = await app.request("/admin/users/u2/factors/reset", formBody({}));
    expect({ answer: await answerOf(res), resets }).toEqual({ answer: { status: 303, location: "/admin/users/u2/factors" }, resets: ["u2@1000"] });
  });

  it("refuses a signed-in non-administrator at 403 without resetting anything", async () => {
    const { resets, app } = resetApp({ userId: "u9", admin: false });
    const res = await app.request("/admin/users/u2/factors/reset", formBody({}));
    expect({ status: res.status, resets }).toEqual({ status: 403, resets: [] });
  });

  it("refuses an administrator resetting their own account at 409, whatever case the id is spelled in", async () => {
    const { resets, app } = resetApp({ userId: "u9", admin: true });
    const answers = [
      (await app.request("/admin/users/u9/factors/reset", formBody({}))).status,
      (await app.request("/admin/users/U9/factors/reset", formBody({}))).status,
    ];
    expect({ answers, resets }).toEqual({ answers: [409, 409], resets: [] });
  });

  it("answers 404 for an account that is not there, before any write", async () => {
    const { resets, app } = resetApp({ userId: "u9", admin: true });
    const res = await app.request("/admin/users/u404/factors/reset", formBody({}));
    expect({ status: res.status, resets }).toEqual({ status: 404, resets: [] });
  });

  it("answers 404 when the account went between the read and the write", async () => {
    const { app } = resetApp({ userId: "u9", admin: true }, "not-found");
    expect((await app.request("/admin/users/u2/factors/reset", formBody({}))).status).toBe(404);
  });

  it("sends an anonymous request to sign-in", async () => {
    const { resets, app } = resetApp({});
    const res = await app.request("/admin/users/u2/factors/reset", formBody({}));
    expect({ answer: await answerOf(res), resets }).toEqual({ answer: { status: 303, location: "/auth/signin" }, resets: [] });
  });
});

describe("createEmailChangeActions", () => {
  // The flow asks the address the account already holds, so the page names that inbox and not the
  // one the visitor typed, which is empty until the old one approves.
  it("re-renders the page at 200 naming the address the confirmation actually went to", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      emailChange: fakeAuthEmailChangeFlow({ request: async () => ok({ expiresAt: 2_000, sentTo: "current@example.com" }) }),
    });
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/account/email-change", createEmailChangeActions(options).emailChangeSubmit);

    const res = await app.request("/account/email-change", formBody({ email: "new@example.com" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("Open the link we sent to current@example.com.");
    expect(html).not.toContain("sent to new@example.com");
  });

  it("re-renders at 422 when the flow refuses the change", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]) });
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/account/email-change", createEmailChangeActions(options).emailChangeSubmit);

    const res = await app.request("/account/email-change", formBody({ email: "new@example.com" }));
    expect(res.status).toBe(422);
  });
});

describe("createAdminUserActions", () => {
  const member = fakeAuthUser({ id: "u2", email: "member@example.com" });

  it("re-renders the account at 200 when the write went through", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserStore([member]) });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u2", formBody({ role: "admin", status: "active" }, "PATCH"));
    expect(res.status).toBe(200);
  });

  it("answers 409 with the account still rendered when the last-admin guard refuses", async () => {
    const admin = fakeAuthUser({ id: "u2", email: "member@example.com", isAdmin: true });
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      admin: fakeAdminUserStore([admin], { setAdmin: async () => ok("last-admin-demote" as const) }),
    });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u2", formBody({ role: "member", status: "active" }, "PATCH"));
    expect(res.status).toBe(409);
  });

  it("answers 404 for an account that is no longer there", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserStore([]) });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u2", formBody({ role: "member", status: "active" }, "PATCH"));
    expect(res.status).toBe(404);
  });

  it("returns to the listing once an account is deleted", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserStore([member]) });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "DELETE", "/admin/users/:id", createAdminUserActions(options).remove);

    const res = await app.request("/admin/users/u2", { method: "DELETE" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/users");
  });

  it("navigates an htmx delete to the listing with HX-Redirect, which fetch cannot follow into the card", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserStore([member]) });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "DELETE", "/admin/users/:id", createAdminUserActions(options).remove);

    const res = await app.request("/admin/users/u2", { method: "DELETE", headers: HX_REQUEST });
    expect({ status: res.status, redirect: res.headers.get("hx-redirect"), location: res.headers.get("location") }).toEqual({
      status: 204,
      redirect: "/admin/users",
      location: null,
    });
  });

  // No admin-service method takes the acting administrator's id, so with two admins the last-admin
  // guard admits one of them locking out their own account.
  it("refuses an administrator deactivating their own account, writing nothing", async () => {
    const self = fakeAuthUser({ id: "u9", email: "grace@example.com", isAdmin: true });
    const admin = fakeAdminUserStore([self]);
    const options = optionsWith({ users: fakeAuthUserStore([self]), admin });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u9", formBody({ role: "admin", status: "deactivated" }, "PATCH"));
    expect(res.status).toBe(409);
    expect((await admin.findById("u9")).ok).toBe(true);
  });

  it("refuses an administrator demoting their own account, writing nothing", async () => {
    const self = fakeAuthUser({ id: "u9", email: "grace@example.com", isAdmin: true });
    let demoteCalls = 0;
    const admin = fakeAdminUserStore([self], {
      setAdmin: async () => {
        demoteCalls += 1;
        return ok("changed" as const);
      },
    });
    const options = optionsWith({ users: fakeAuthUserStore([self]), admin });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u9", formBody({ role: "member", status: "active" }, "PATCH"));
    expect(res.status).toBe(409);
    expect(demoteCalls).toBe(0);
  });

  it("still lets an administrator demote somebody else", async () => {
    const self = fakeAuthUser({ id: "u9", email: "grace@example.com", isAdmin: true });
    const other = fakeAuthUser({ id: "u2", email: "ada@example.com", isAdmin: true });
    const demoted: string[] = [];
    const admin = fakeAdminUserStore([self, other], {
      setAdmin: async (id: string) => {
        demoted.push(id);
        return ok("changed" as const);
      },
    });
    const options = optionsWith({ users: fakeAuthUserStore([self]), admin });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u2", formBody({ role: "member", status: "active" }, "PATCH"));
    expect(res.status).toBe(200);
    expect(demoted).toEqual(["u2"]);
  });

  it("refuses an administrator deleting their own account, which is not even reversible", async () => {
    const self = fakeAuthUser({ id: "u9", email: "grace@example.com", isAdmin: true });
    const options = optionsWith({ users: fakeAuthUserStore([self]), admin: fakeAdminUserStore([self]) });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "DELETE", "/admin/users/:id", createAdminUserActions(options).remove);

    const res = await app.request("/admin/users/u9", { method: "DELETE" });
    expect(res.status).toBe(409);
  });

  it("still lets an administrator reactivate their own account, which locks nobody out", async () => {
    const self = fakeAuthUser({ id: "u9", email: "grace@example.com", isAdmin: true, deactivatedAt: 1 });
    const options = optionsWith({ users: fakeAuthUserStore([self]), admin: fakeAdminUserStore([self]) });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u9", formBody({ role: "admin", status: "active" }, "PATCH"));
    expect(res.status).toBe(200);
  });

  // A UUID is case-insensitive and the store returns a canonical one, so comparing the acting
  // administrator against the raw route parameter lets an uppercased id name the same row past the guard.
  it("refuses a self-delete whose route parameter is the acting administrator's own id uppercased", async () => {
    const self = fakeAuthUser({ id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", email: "grace@example.com", isAdmin: true });
    let removals = 0;
    const admin = fakeAdminUserStore([self], {
      remove: async () => {
        removals += 1;
        return ok("changed" as const);
      },
    });
    const options = optionsWith({ users: fakeAuthUserStore([self]), admin });
    const app = mounted(actionApp({ userId: self.id, admin: true }), "DELETE", "/admin/users/:id", createAdminUserActions(options).remove);

    const res = await app.request(`/admin/users/${self.id.toUpperCase()}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(removals).toBe(0);
  });

  it("answers 409 with the account still rendered, not 503, when an app table still references the account", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      admin: fakeAdminUserStore([member], { remove: async () => ok("referenced" as const) }),
    });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "DELETE", "/admin/users/:id", createAdminUserActions(options).remove);

    const res = await app.request("/admin/users/u2", { method: "DELETE" });
    expect({
      status: res.status,
      location: res.headers.get("location"),
      reason: textOf(await res.text(), "div", 'data-slot="alert-description"'),
    }).toEqual({
      status: 409,
      location: null,
      reason: "This account still owns records in this app — remove or transfer them before deleting it.",
    });
  });
});

// The loader-side `refuseUnguarded` runs after the write commits, so a group that lost its guards
// leaves these two handlers as the only thing between an anonymous request and an account deletion.
describe("createAdminUserActions — the write path refuses an unprivileged request of its own accord", () => {
  const member = fakeAuthUser({ id: "u2", email: "member@example.com" });

  it("redirects an anonymous PATCH to sign-in rather than writing the role it carries", async () => {
    let writes = 0;
    const admin = fakeAdminUserStore([member], {
      setAdmin: async () => {
        writes += 1;
        return ok("changed" as const);
      },
    });
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin });
    const app = mounted(actionApp(), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u2", formBody({ role: "admin", status: "active" }, "PATCH"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/signin");
    expect(writes).toBe(0);
  });

  it("redirects an anonymous DELETE to sign-in rather than deleting the account it names", async () => {
    let removals = 0;
    const admin = fakeAdminUserStore([member], {
      remove: async () => {
        removals += 1;
        return ok("changed" as const);
      },
    });
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin });
    const app = mounted(actionApp(), "DELETE", "/admin/users/:id", createAdminUserActions(options).remove);

    const res = await app.request("/admin/users/u2", { method: "DELETE" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/signin");
    expect(removals).toBe(0);
  });

  it("navigates an anonymous htmx DELETE to sign-in with HX-Redirect, deleting nothing", async () => {
    let removals = 0;
    const admin = fakeAdminUserStore([member], {
      remove: async () => {
        removals += 1;
        return ok("changed" as const);
      },
    });
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin });
    const app = mounted(actionApp(), "DELETE", "/admin/users/:id", createAdminUserActions(options).remove);

    const res = await app.request("/admin/users/u2", { method: "DELETE", headers: HX_REQUEST });
    expect({ status: res.status, redirect: res.headers.get("hx-redirect"), removals }).toEqual({
      status: 204,
      redirect: "/auth/signin",
      removals: 0,
    });
  });

  // Signed in is not administered: `require-admin` is a loader-side guard, so a member posting
  // straight at the write path would otherwise have their role change land before it ever ran.
  it("refuses a signed-in non-administrator's PATCH rather than writing the role it carries", async () => {
    let writes = 0;
    const admin = fakeAdminUserStore([member], {
      setAdmin: async () => {
        writes += 1;
        return ok("changed" as const);
      },
    });
    const options = optionsWith({ users: fakeAuthUserStore([member]), admin });
    const app = mounted(actionApp({ userId: "u2", admin: false }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u2", formBody({ role: "admin", status: "active" }, "PATCH"));
    expect(res.status).toBe(403);
    expect(writes).toBe(0);
  });

  it("refuses a signed-in non-administrator's DELETE rather than deleting the account it names", async () => {
    // The target is seeded, and is not the actor: without it the handler answers `not-found` before
    // it ever reaches the store, and the assertion below would hold with the role check deleted.
    const target = fakeAuthUser({ id: "u3", email: "target@example.com" });
    let removals = 0;
    const admin = fakeAdminUserStore([member, target], {
      remove: async () => {
        removals += 1;
        return ok("changed" as const);
      },
    });
    const options = optionsWith({ users: fakeAuthUserStore([member, target]), admin });
    const app = mounted(actionApp({ userId: "u2", admin: false }), "DELETE", "/admin/users/:id", createAdminUserActions(options).remove);

    const res = await app.request("/admin/users/u3", { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(removals).toBe(0);
  });
});

describe("createAdminElevateActions", () => {
  it("grants the claim while the deployment has no administrator", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserStore([signedIn]) });
    const app = mounted(approved(actionApp({ userId: "u9" })), "POST", "/admin/elevate", createAdminElevateActions(options).submit);

    const res = await app.request("/admin/elevate", formBody({ confirm: "yes" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/users");
  });

  it("refuses the claim at 409 once an administrator exists", async () => {
    const admin = fakeAuthUser({ id: "u1", isAdmin: true });
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserStore([admin]) });
    const app = mounted(approved(actionApp({ userId: "u9" })), "POST", "/admin/elevate", createAdminElevateActions(options).submit);

    const res = await app.request("/admin/elevate", formBody({ confirm: "yes" }));
    expect(res.status).toBe(409);
  });

  it("grants exactly one of two claims racing an empty deployment, because the write decides", async () => {
    let admins = 0;
    const service = fakeAdminUserStore([signedIn], {
      countAdmins: async () => ok(admins),
      claimFirstAdmin: async () => {
        if (admins >= 1) return ok("admin-exists" as const);
        admins += 1;
        return ok("changed" as const);
      },
    });
    // One service across both requests: `optionsWith` builds a fresh one per call, and two services
    // would each hold their own count, which is the race rather than a test of it.
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: service });
    const app = mounted(approved(actionApp({ userId: "u9" })), "POST", "/admin/elevate", createAdminElevateActions(options).submit);

    const statuses = await Promise.all([
      app.request("/admin/elevate", formBody({ confirm: "yes" })),
      app.request("/admin/elevate", formBody({ confirm: "yes" })),
    ]).then((responses) => responses.map((res) => res.status).sort());

    expect(statuses).toEqual([303, 409]);
    expect(admins).toBe(1);
  });

  it("reports a session naming a row that is gone as unavailable, rather than redirecting on it", async () => {
    const service = fakeAdminUserStore([signedIn], { claimFirstAdmin: async () => ok("not-found" as const) });
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: service });
    const app = mounted(approved(actionApp({ userId: "u9" })), "POST", "/admin/elevate", createAdminElevateActions(options).submit);

    expect((await app.request("/admin/elevate", formBody({ confirm: "yes" }))).status).toBe(503);
  });

  it("refuses a claim without the explicit confirmation at 422, without writing", async () => {
    let claims = 0;
    const admin = fakeAdminUserStore([signedIn], {
      claimFirstAdmin: async () => {
        claims += 1;
        return ok("changed" as const);
      },
    });
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin });
    const app = mounted(approved(actionApp({ userId: "u9" })), "POST", "/admin/elevate", createAdminElevateActions(options).submit);

    expect((await app.request("/admin/elevate", formBody({ confirm: "on" }))).status).toBe(422);
    expect(claims).toBe(0);
  });

  it("redirects an anonymous claim to sign-in", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserStore([signedIn]) });
    const app = mounted(approved(actionApp()), "POST", "/admin/elevate", createAdminElevateActions(options).submit);

    const res = await app.request("/admin/elevate", formBody({ confirm: "yes" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/signin");
  });

  function countingClaims() {
    const claimed: string[] = [];
    const admin = fakeAdminUserStore([signedIn], {
      countAdmins: async () => ok(claimed.length),
      claimFirstAdmin: async (id) => {
        claimed.push(id);
        return ok("changed" as const);
      },
    });
    return { claimed, admin, options: optionsWith({ users: fakeAuthUserStore([signedIn]), admin }) };
  }

  const UNADMITTED: readonly { readonly label: string; readonly wire: (app: Forge) => void }[] = [
    { label: "mounted with nothing ahead of it", wire: () => undefined },
    { label: "behind an approved session that no `requireApproval` checked", wire: (app) => app.use("*", approvedSession()) },
  ];

  for (const { label, wire } of UNADMITTED) {
    it(`answers 404 to a signed-in claim on an empty deployment, and claims nothing, ${label}`, async () => {
      const { claimed, admin, options } = countingClaims();
      const app = actionApp({ userId: "u9" });
      wire(app);
      mounted(app, "POST", "/admin/elevate", createAdminElevateActions(options).submit);

      const res = await app.request("/admin/elevate", formBody({ confirm: "yes" }));
      expect({ status: res.status, body: await res.text(), claimed, admins: await admin.countAdmins() }).toEqual({
        status: 404,
        body: "Not Found",
        claimed: [],
        admins: ok(0),
      });
    });
  }

  it("sends a claim to the prompt when `requireApproval` stands ahead of it over an unapproved session, and claims nothing", async () => {
    const { claimed, options } = countingClaims();
    const app = actionApp({ userId: "u9" });
    app.use("*", requireApproval(fakeApproval()));
    mounted(app, "POST", "/admin/elevate", createAdminElevateActions(options).submit);

    const res = await app.request("/admin/elevate", formBody({ confirm: "yes" }));
    expect({ status: res.status, location: res.headers.get("location"), claimed }).toEqual({ status: 303, location: "/approve", claimed: [] });
  });
});

describe("the Turnstile guard on the anonymous forms", () => {
  const HOST = "app.example";
  const KEYS = { siteKey: "site-key", secretKey: "secret-key" };

  let savedFetch: typeof globalThis.fetch | undefined;

  afterEach(() => {
    if (savedFetch !== undefined) globalThis.fetch = savedFetch;
    savedFetch = undefined;
  });

  /** Answers siteverify with `answer`, or rejects as an unreachable network would; hands back every body it was sent. */
  function siteverify(answer: Record<string, unknown> | "unreachable"): unknown[] {
    const sent: unknown[] = [];
    savedFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      if (answer === "unreachable") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(answer));
    }) as typeof globalThis.fetch;
    return sent;
  }

  const solvedFor = (action: string) => ({ success: true, hostname: HOST, action });

  function guarded(services: Partial<AuthRequestServices> = {}, turnstile: Partial<AuthTurnstileOptions> = {}): AuthWebOptions {
    const resolved = fakeAuthServices(services);
    return fakeAuthWebOptions({
      resolveServices: () => resolved,
      turnstile: { keys: () => KEYS, verify: () => ({ expectedHostname: HOST }), ...turnstile },
    });
  }

  /** Mounts `action` behind the session, recording the pending sign-in the session holds once it answers. */
  function sessionApp(route: string, action: TestAction, seed: Seed = {}): { app: Forge; pending: unknown[] } {
    const pending: unknown[] = [];
    const app = actionApp(seed);
    app.use("*", async (context, next) => {
      const response = await next();
      pending.push(sessionCtx.get(context).get(AUTH_PENDING_SIGNIN_SESSION_KEY) ?? null);
      return response;
    });
    return { app: mounted(app, "POST", route, action), pending };
  }

  async function answered(res: Response) {
    const html = await res.text();
    return { status: res.status, location: res.headers.get("location"), html };
  }

  describe("on sign-in", () => {
    function signin(options: AuthWebOptions) {
      return sessionApp("/auth/signin", createSigninActions(options).signinSubmit);
    }

    function recordingSignin(requested: string[]) {
      return fakeAuthSigninFlow({
        request: (email, at) => {
          requested.push(email);
          return { kind: "email-otp", expiresAt: at };
        },
      });
    }

    it("refuses a body with no token at 422 on the address field, blaming neither the address nor the challenge, and asks for nothing", async () => {
      const sent = siteverify(solvedFor("auth-signin"));
      const requested: string[] = [];
      const { app, pending } = signin(guarded({ signin: recordingSignin(requested) }));

      const refused = await answered(await app.request("/auth/signin", formBody({ email: "ada@example.com" })));

      expect({
        status: refused.status,
        error: textOf(refused.html, "p", 'id="field-email-error"'),
        kept: attrOf(refused.html, 'id="field-email"', "value"),
        requested,
        pending,
        sent,
      }).toEqual({
        status: 422,
        error: "Verification failed. Please try again.",
        kept: "ada@example.com",
        requested: [],
        pending: [null],
        sent: [],
      });
    });

    it("keeps the address's own copy for a malformed address behind a solved token", async () => {
      siteverify(solvedFor("auth-signin"));
      const malformed = await answered(
        await signin(guarded()).app.request("/auth/signin", formBody({ email: "not-an-address", "cf-turnstile-response": "solved" })),
      );
      expect({ status: malformed.status, error: textOf(malformed.html, "p", 'id="field-email-error"') }).toEqual({
        status: 422,
        error: "Enter an email address in the form name@example.com.",
      });
    });

    it("admits a solved token, dropping its field before the strict schema reads the body", async () => {
      const sent = siteverify(solvedFor("auth-signin"));
      const requested: string[] = [];
      const { app, pending } = signin(guarded({ signin: recordingSignin(requested) }));

      const res = await app.request(
        "/auth/signin",
        formBody({ _csrf: "csrf-for:/auth/signin", email: "ada@example.com", "cf-turnstile-response": "solved" }),
      );

      expect({ status: res.status, location: res.headers.get("location"), requested, pending, sent }).toEqual({
        status: 303,
        location: "/auth/verify",
        requested: ["ada@example.com"],
        pending: ["ada@example.com"],
        sent: [{ secret: "secret-key", response: "solved" }],
      });
    });

    for (const { refusal, answer } of [
      { refusal: "a token solved for the sign-up form", answer: solvedFor("auth-signup") },
      { refusal: "a token siteverify could not be reached to check", answer: "unreachable" as const },
      { refusal: "a token siteverify rejected", answer: { success: false } },
    ]) {
      it(`refuses ${refusal} at 422 without asking for a code`, async () => {
        siteverify(answer);
        const requested: string[] = [];
        const { app } = signin(guarded({ signin: recordingSignin(requested) }));

        const res = await app.request("/auth/signin", formBody({ email: "ada@example.com", "cf-turnstile-response": "solved" }));
        expect({ status: res.status, requested }).toEqual({ status: 422, requested: [] });
      });
    }

    it("logs a refusal at warn with its reason, which is all that separates it from a mistyped address", async () => {
      siteverify(solvedFor("auth-signup"));
      const { app } = signin(guarded());
      const lines: string[] = [];
      const original = console.log;
      console.log = (line: string) => void lines.push(line);
      try {
        await app.request("/auth/signin", formBody({ email: "ada@example.com", "cf-turnstile-response": "solved" }));
      } finally {
        console.log = original;
      }

      const logged = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((record) => record.message === "Submission refused by a bot guard")
        .map(({ level, message, guard, reason }) => ({ level, message, guard, reason }));
      expect(logged).toEqual([{ level: "warn", message: "Submission refused by a bot guard", guard: "turnstile", reason: "action-mismatch" }]);
    });

    describe("with forge's defaults", () => {
      const TESTING_SECRET = "1x0000000000000000000000000000000AA";
      // Siteverify's fixed answer under a testing secret names its own hostname and carries no action.
      const TESTING_ANSWER = { success: true, hostname: "example.com" };

      function defaulted(requested: string[]) {
        const resolved = fakeAuthServices({ signin: recordingSignin(requested) });
        return signin(fakeAuthWebOptions({ resolveServices: () => resolved, turnstile: {} })).app;
      }

      function postSignin(app: Forge, secret: string, headers: Record<string, string> = {}): Promise<Response> {
        const init = formBody({ _csrf: "csrf-for:/auth/signin", email: "ada@example.com", "cf-turnstile-response": "solved" });
        return app.request(
          `https://${HOST}/auth/signin`,
          { ...init, headers: { ...(init.headers as Record<string, string>), ...headers } },
          { TURNSTILE_SITE_KEY: KEYS.siteKey, TURNSTILE_SECRET_KEY: secret },
        );
      }

      it("verifies under the bindings' secret and the request's remote address, against the request's own hostname", async () => {
        const sent = siteverify(solvedFor("auth-signin"));
        const requested: string[] = [];

        const res = await postSignin(defaulted(requested), KEYS.secretKey, { "CF-Connecting-IP": "203.0.113.7" });

        expect({ status: res.status, location: res.headers.get("location"), requested, sent }).toEqual({
          status: 303,
          location: "/auth/verify",
          requested: ["ada@example.com"],
          sent: [{ secret: "secret-key", response: "solved", remoteip: "203.0.113.7" }],
        });
      });

      it("refuses a testing-secret token solved elsewhere with no action in a build not armed for development, without asking for a code", async () => {
        siteverify(TESTING_ANSWER);
        const requested: string[] = [];

        const res = await answered(await postSignin(defaulted(requested), TESTING_SECRET));

        expect({ status: res.status, error: textOf(res.html, "p", 'id="field-email-error"'), requested }).toEqual({
          status: 422,
          error: "Verification failed. Please try again.",
          requested: [],
        });
      });
    });

    it("leaves the strict schema refusing a token field when the deployment configured no turnstile, and verifies nothing", async () => {
      const sent = siteverify(solvedFor("auth-signin"));
      const { app } = signin(fakeAuthWebOptions());

      const res = await app.request("/auth/signin", formBody({ email: "ada@example.com", "cf-turnstile-response": "solved" }));
      expect({ status: res.status, sent }).toEqual({ status: 422, sent: [] });
    });
  });

  describe("on sign-up", () => {
    function signup(options: AuthWebOptions) {
      return mounted(actionApp(), "POST", "/auth/signup", createSignupActions(options).signupSubmit);
    }

    it("refuses a body with no token at 422 on the address field in the non-specific copy, without starting an account", async () => {
      siteverify(solvedFor("auth-signup"));
      const requested: string[] = [];
      const recording = fakeAuthSignupFlow({
        request: (email, at) => {
          requested.push(email);
          return { kind: "email-otp", expiresAt: at };
        },
      });
      const invalid = await answered(
        await signup(guarded()).request("/auth/signup", formBody({ email: "not-an-address", "cf-turnstile-response": "solved" })),
      );

      const refused = await answered(await signup(guarded({ signup: recording })).request("/auth/signup", formBody({ email: "ada@example.com" })));

      expect({
        refused: { status: refused.status, error: textOf(refused.html, "p", 'id="field-email-error"') },
        invalid: { status: invalid.status, error: textOf(invalid.html, "p", 'id="field-email-error"') },
        requested,
      }).toEqual({
        refused: { status: 422, error: "Verification failed. Please try again." },
        invalid: { status: 422, error: "Enter an email address in the form name@example.com." },
        requested: [],
      });
    });

    it("admits a token solved for the sign-up form and starts the account", async () => {
      const sent = siteverify(solvedFor("auth-signup"));
      const requested: string[] = [];
      const recording = fakeAuthSignupFlow({
        request: (email, at) => {
          requested.push(email);
          return { kind: "email-otp", expiresAt: at };
        },
      });

      const res = await signup(guarded({ signup: recording })).request(
        "/auth/signup",
        formBody({ _csrf: "csrf-for:/auth/signup", email: "ada@example.com", "cf-turnstile-response": "solved" }),
      );

      expect({ status: res.status, location: res.headers.get("location"), requested, sent }).toEqual({
        status: 303,
        location: "/auth/verify",
        requested: ["ada@example.com"],
        sent: [{ secret: "secret-key", response: "solved" }],
      });
    });

    it("guards only the flows named in `flows`", async () => {
      siteverify(solvedFor("auth-signup"));
      const options = guarded({}, { flows: ["signup"] });
      const signinApp = mounted(actionApp(), "POST", "/auth/signin", createSigninActions(options).signinSubmit);

      expect({
        signin: (await signinApp.request("/auth/signin", formBody({ email: "ada@example.com" }))).status,
        signup: (await signup(options).request("/auth/signup", formBody({ email: "ada@example.com" }))).status,
      }).toEqual({ signin: 303, signup: 422 });
    });
  });

  describe("on the verification page", () => {
    const holdingBoth: Partial<AuthRequestServices> = {
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore(["totp-app", "recovery-code"]), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          { service: fakeFactorService("totp-app"), role: "second", requirement: "optional" },
          recoveryOffer(),
        ],
      }),
    };

    function recordingFlow(calls: string[]) {
      return fakeAuthSigninFlow({
        request: (email, at) => {
          calls.push(`request:${email}`);
          return { kind: "email-otp", expiresAt: at };
        },
        complete: async () => {
          calls.push("complete");
          return ok({ user: signedIn, kind: "email-otp" as const, resolution: { status: "satisfied" as const } });
        },
        requestStepUp: async () => {
          calls.push("requestStepUp");
          return err("not-enrolled" as const);
        },
        stepUp: async (userId, kind, _code, at) => {
          calls.push("stepUp");
          return ok({ kind, userId, verifiedAt: at });
        },
      });
    }

    it("refuses a code with no token at 422 in the non-specific copy, keeping a malformed code's own words for a malformed code", async () => {
      siteverify(solvedFor("auth-verify"));
      const calls: string[] = [];
      const submit = (body: Record<string, string>) =>
        mounted(
          actionApp({ pendingEmail: "grace@example.com" }),
          "POST",
          "/auth/verify",
          createVerifyActions(guarded({ signin: recordingFlow(calls) })).submit,
        ).request("/auth/verify", formBody(body));
      const malformed = await answered(await submit({ code: "12", "cf-turnstile-response": "solved" }));

      const refused = await answered(await submit({ code: "123456" }));

      expect({
        refused: { status: refused.status, error: textOf(refused.html, "p", 'id="field-code-error"') },
        malformed: { status: malformed.status, error: textOf(malformed.html, "p", 'id="field-code-error"') },
        calls,
      }).toEqual({
        refused: { status: 422, error: "Verification failed. Please try again." },
        malformed: { status: 422, error: "That code is not the shape we sent. Enter the digits exactly as they appear." },
        calls: [],
      });
    });

    it("refuses a recovery code with no token in the non-specific copy, never a recovery code's words, without stepping up", async () => {
      siteverify(solvedFor("auth-verify"));
      const calls: string[] = [];
      const app = mounted(
        actionApp({ userId: "u9" }),
        "POST",
        "/auth/verify",
        createVerifyActions(guarded({ ...holdingBoth, signin: recordingFlow(calls) })).submit,
      );

      const res = await app.request("/auth/verify?factor=recovery-code", formBody({ code: "ABCD-EFGH" }));
      expect({ status: res.status, error: textOf(await res.text(), "p", 'id="field-code-error"'), calls }).toEqual({
        status: 422,
        error: "Verification failed. Please try again.",
        calls: [],
      });
    });

    it("keeps a recovery code's own words for a malformed recovery code behind a solved token, without stepping up", async () => {
      siteverify(solvedFor("auth-verify"));
      const calls: string[] = [];
      const app = mounted(
        actionApp({ userId: "u9" }),
        "POST",
        "/auth/verify",
        createVerifyActions(guarded({ ...holdingBoth, signin: recordingFlow(calls) })).submit,
      );

      const res = await app.request("/auth/verify?factor=recovery-code", formBody({ code: "A".repeat(65), "cf-turnstile-response": "solved" }));
      expect({ status: res.status, error: textOf(await res.text(), "p", 'id="field-code-error"'), calls }).toEqual({
        status: 422,
        error: "That is not a recovery code. Enter one exactly as you saved it.",
        calls: [],
      });
    });

    it("admits a token solved for the verification form and completes the sign-in", async () => {
      const sent = siteverify(solvedFor("auth-verify"));
      const calls: string[] = [];
      const app = mounted(
        actionApp({ pendingEmail: "grace@example.com" }),
        "POST",
        "/auth/verify",
        createVerifyActions(guarded({ signin: recordingFlow(calls) })).submit,
      );

      const res = await app.request("/auth/verify?next=%2Fapp", formBody({ code: "123456", "cf-turnstile-response": "solved" }));
      expect({ status: res.status, location: res.headers.get("location"), calls, sent }).toEqual({
        status: 303,
        location: "/app",
        calls: ["complete"],
        sent: [{ secret: "secret-key", response: "solved" }],
      });
    });

    it("admits a token solved for the verification form and steps up a signed-in session by app code", async () => {
      const sent = siteverify(solvedFor("auth-verify"));
      const calls: string[] = [];
      const app = mounted(
        actionApp({ userId: "u9" }),
        "POST",
        "/auth/verify",
        createVerifyActions(guarded({ ...holdingBoth, signin: recordingFlow(calls) })).submit,
      );

      const res = await app.request("/auth/verify?factor=totp-app&next=%2Fapp", formBody({ code: "123456", "cf-turnstile-response": "solved" }));
      expect({ status: res.status, location: res.headers.get("location"), calls, sent }).toEqual({
        status: 303,
        location: "/app",
        calls: ["stepUp"],
        sent: [{ secret: "secret-key", response: "solved" }],
      });
    });

    it("answers a refused resend with a 422 re-render rather than the redirect an admitted one gets, issuing no code", async () => {
      const resend = async (body: Record<string, string>) => {
        const calls: string[] = [];
        const options = guarded({ signin: recordingFlow(calls) });
        const app = mounted(actionApp({ pendingEmail: "grace@example.com" }), "POST", "/auth/verify/resend", createVerifyActions(options).resend);
        const res = await app.request("/auth/verify/resend", formBody(body));
        const html = await res.text();
        return {
          status: res.status,
          location: res.headers.get("location"),
          calls,
          refusal: textOf(html, "div", 'data-slot="alert-description"'),
          resentNotice: html.includes('data-ref="verify-resent"'),
        };
      };
      siteverify(solvedFor("auth-resend"));

      const admitted = await resend({ "cf-turnstile-response": "solved" });
      const refused = await resend({});

      expect({ admitted, refused }).toEqual({
        admitted: { status: 303, location: "/auth/verify?resent=1000", calls: ["request:grace@example.com"], refusal: "", resentNotice: false },
        refused: { status: 422, location: null, calls: [], refusal: "Verification failed. Please try again.", resentNotice: false },
      });
    });

    it("warns the operator when a resend body cannot be read at all, and refuses it without issuing a code", async () => {
      const sent = siteverify(solvedFor("auth-resend"));
      const calls: string[] = [];
      const warnings: unknown[] = [];
      const app = actionApp({ pendingEmail: "grace@example.com" });
      app.use("*", (context, next) => {
        requestLog.set(context, { ...nullLogger, warn: (message: string, data?: Record<string, unknown>) => void warnings.push([message, data]) });
        return next();
      });
      mounted(app, "POST", "/auth/verify/resend", createVerifyActions(guarded({ signin: recordingFlow(calls) })).resend);

      // A multipart content type whose body carries no boundary-delimited part, so no form can be parsed out of it.
      const res = await app.request("/auth/verify/resend", {
        method: "POST",
        body: "not a form",
        headers: { "content-type": "multipart/form-data; boundary=x" },
      });

      const refusal = textOf(await res.text(), "div", 'data-slot="alert-description"');
      expect({ status: res.status, location: res.headers.get("location"), refusal, warnings, calls, sent }).toEqual({
        status: 422,
        location: null,
        refusal: "We could not read that. Please check the form and try again.",
        warnings: [["auth.resend.unreadable", undefined]],
        calls: [],
        sent: [],
      });
    });

    it("answers a refused step-up resend with a 422 re-render, asking for no step-up code", async () => {
      siteverify(solvedFor("auth-resend"));
      const calls: string[] = [];
      const options = guarded({ ...holdingBoth, signin: recordingFlow(calls) });
      const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/verify/resend", createVerifyActions(options).resend);

      const res = await app.request("/auth/verify/resend", formBody({}));
      const html = await res.text();
      const refused = {
        status: res.status,
        location: res.headers.get("location"),
        calls: [...calls],
        refusal: textOf(html, "div", 'data-slot="alert-description"'),
        resentNotice: html.includes('data-ref="verify-resent"'),
      };
      const admittedRes = await app.request("/auth/verify/resend", formBody({ "cf-turnstile-response": "solved" }));

      expect({ refused, admitted: { status: admittedRes.status, location: admittedRes.headers.get("location"), calls } }).toEqual({
        refused: { status: 422, location: null, calls: [], refusal: "Verification failed. Please try again.", resentNotice: false },
        admitted: { status: 303, location: "/auth/verify?resent=1000", calls: ["requestStepUp"] },
      });
    });

    it("still sends a resend with no started sign-in back to sign-in", async () => {
      const sent = siteverify(solvedFor("auth-resend"));
      const app = mounted(actionApp(), "POST", "/auth/verify/resend", createVerifyActions(guarded()).resend);

      const res = await app.request("/auth/verify/resend", formBody({}));
      expect({ status: res.status, location: res.headers.get("location"), sent }).toEqual({ status: 303, location: "/auth/signin", sent: [] });
    });
  });

  describe("on the passkey ceremonies", () => {
    it("spends no siteverify call on a step-up begin or finish", async () => {
      const sent = siteverify(solvedFor("auth-verify"));
      const passkey = {
        ...fakeFactorService("passkey"),
        createChallenge: async () => ok({ kind: "passkey" as const, expiresAt: 1_000, options: { challenge: "c" } }),
        verifyChallenge: async (userId: string, _presented: string, at: number) => ok({ kind: "passkey" as const, userId, verifiedAt: at }),
      } as AuthFactorService;
      const options = guarded({
        users: fakeAuthUserStore([signedIn]),
        factors: createFactorRegistry(fakeFactorStore(["passkey"]), {
          offered: [
            { service: fakeFactorService("email-otp"), role: "primary" },
            { service: passkey, role: "second", requirement: "optional" },
            recoveryOffer(),
          ],
        }),
      });
      const actions = createPasskeyStepUpActions(options);
      const app = actionApp({ userId: "u9" });
      mounted(app, "POST", "/auth/verify/passkey/begin", actions.begin);
      mounted(app, "POST", "/auth/verify/passkey/finish", actions.finish);

      const begin = await app.request("/auth/verify/passkey/begin", jsonBody({}));
      const finish = await app.request("/auth/verify/passkey/finish", jsonBody({ credential: { id: "cred-1" } }));

      expect({ begin: begin.status, finish: finish.status, sent }).toEqual({ begin: 200, finish: 200, sent: [] });
    });
  });
});
