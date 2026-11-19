import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";

import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../../app/forge-app";
import type { AppContext } from "../../context/types";
import { importKeyRing } from "../../crypto/keyring/ring";
import { bytesToHex } from "../../crypto/primitives/bytes";
import { sha256 } from "../../crypto/primitives/digest";
import { createCsrfToken, csrfMinterCtx, csrfProtection } from "../../form/csrf";
import { csrfFieldCtx } from "../../form/csrf-context";
import { parseFormData } from "../../form/parse-form-data";
import type { CsrfFailure, CsrfProtectionOptions } from "../../form/types";
import { requestLog } from "../../logging/request-logger";
import { err, ok } from "../../result/result";
import { sessionCtx, sessionMiddleware } from "../../session/session";
import { createTestContext, nullLogger } from "../../testing/context";
import { mapHandler } from "../../testing/route";
import type { TestAction } from "../../testing/types";
import { AUTH_OTP_MAX_ATTEMPTS, AUTH_SESSION_MAX_MS } from "../config";
import { AuthStoreError } from "../errors";
import { createEmailOtpFactor } from "../factors/email-otp";
import { createPasskeyFactor } from "../factors/passkey";
import { createFactorRegistry } from "../factors/registry";
import type { AuthSecondFactorKind, AuthSecondFactorRequirement, AuthSecondFactorService, RecoveryCodeFactorService } from "../factors/types";
import type { AuthFactorReason, TotpReplaceableFactorService } from "../factors/types";
import { createEmailChangeFlow } from "../flows/email-change";
import { createSigninFlow } from "../flows/signin";
import type { AuthSigninFlow } from "../flows/types";
import { importAuthKeyRing } from "../keys/ring";
import { createPasskeyKeyPair, fakePasskeyRegistration } from "../passkey/passkey.fixture";
import type { PasskeyKeyPair } from "../passkey/types";
import type {
  AdminUserOutcome,
  AdminUserStore,
  AuthChallenge,
  AuthCredential,
  AuthFactor,
  AuthFactorKind,
  AuthMessage,
  AuthSessionStore,
  AuthUser,
  CredentialStore,
  OtpState,
  OtpStateStore,
  UserStore,
} from "../types";
import {
  authCsrfRefusal,
  createAdminElevateActions,
  createAdminUserActions,
  createEmailChangeActions,
  createPasskeyAccountEnrolActions,
  createPasskeyEnrolActions,
  createPasskeyManageActions,
  createPasskeyStepUpActions,
  createRecoveryCodeActions,
  createSessionActions,
  AUTH_CEREMONY_MAX_BYTES,
  createSigninActions,
  createSignoutActions,
  createSignupActions,
  createTotpEnrolActions,
  createTotpManageActions,
  createVerifyActions,
} from "./actions";
import { requireApproval, requireFreshStepUp, resolveAuth } from "./guards";
import {
  AUTH_PENDING_SIGNIN_SESSION_KEY,
  AUTH_SESSION_TOKEN_KEY,
  authCtx,
  establishAuthSession,
  markAuthStepUp,
  resolveAuthIdentity,
} from "./identity";
import { authEnrolmentPaths, authPaths } from "./paths";
import { authRoutes } from "./routes";
import type { AuthAdminGuardOptions, AuthRequestServices, AuthTurnstileOptions, AuthWebOptions } from "./types";
import {
  approvedSession,
  attrOf,
  demoteAuthIdentity,
  elementOf,
  HOSTILE_TEXT,
  fakeAdminGuardChain,
  fakeAdminUserStore,
  fakeApproval,
  fakeAuthCredential,
  fakeAuthCredentialStore,
  fakeAuthEmailChangeFlow,
  fakeAuthServices,
  fakeAuthSessionStore,
  fakeAuthSigninFlow,
  fakeAuthSignupFlow,
  fakeAuthUser,
  fakeAuthUserStore,
  fakeAuthWebOptions,
  fakeFactorRegistry,
  fakeFactorService,
  fakeFactorStore,
  fakeSecurityNotices,
  fakeRecoveryCodeService,
  fakeSecondFactorOffering,
  fakeSessionCookie,
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

const SEEDED_SESSION_ID = "0190f3a0-0000-7000-8000-000000000001";

/** The session rows every `optionsWith` service set and every seeded `actionApp` session share. */
const actionSessions = fakeAuthSessionStore([]);

async function actionRowStepUp(token: unknown): Promise<number | null> {
  if (typeof token !== "string") return null;
  return actionSessions.rows.get(bytesToHex(await sha256(token)))?.stepUpAt ?? null;
}

/** A `Forge` app with a seeded session and a deterministic CSRF minter, but no CSRF verification. */
function actionApp(seed: Seed = {}): Forge {
  const app = new Forge();
  app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
  app.use("*", async (context, next) => {
    const session = sessionCtx.get(context);
    if (seed.userId !== undefined) {
      const now = Date.now();
      await establishAuthSession(session, actionSessions, seed.userId, now, now, { kind: "email-otp" });
      if (seed.stepUpAt !== undefined) await markAuthStepUp(session, actionSessions, seed.stepUpAt, seed.stepUpAt, "email-otp");
      authCtx.set(context, {
        userId: seed.userId,
        email: seed.email ?? signedIn.email,
        isAdmin: seed.admin === true,
        sessionId: SEEDED_SESSION_ID,
        stepUpAt: seed.stepUpAt ?? null,
        stepUpKind: seed.stepUpAt === undefined ? null : "email-otp",
      });
    }
    if (seed.pendingEmail !== undefined) session.set(AUTH_PENDING_SIGNIN_SESSION_KEY, seed.pendingEmail);
    const marks = seed.stepUpWrites;
    const rotate = actionSessions.rotate;
    if (marks !== undefined) {
      actionSessions.rotate = (replaces, tokenHash, stepUp) => {
        if (stepUp !== undefined) marks.push(stepUp.at);
        return rotate(replaces, tokenHash, stepUp);
      };
    }
    csrfMinterCtx.set(context, (path) => Promise.resolve(`csrf-for:${path}`));
    csrfFieldCtx.set(context, "_csrf");
    try {
      const response = await next();
      seed.stepUpAfter?.push(await actionRowStepUp(session.get(AUTH_SESSION_TOKEN_KEY)));
      return response;
    } finally {
      actionSessions.rotate = rotate;
    }
  });
  return app;
}

function mounted(app: Forge, method: "POST" | "PATCH" | "DELETE", pattern: string, action: TestAction): Forge {
  mapHandler(app, method, pattern, action);
  return app;
}

/** `app` behind the admin stack `createAuthGuards` wires from `onForbidden`, which admits the seeded administrator before a demotion lands. */
function demotedBehindAdminChain(app: Forge, onForbidden: AuthAdminGuardOptions["onForbidden"]): Forge {
  app.use("*", ...fakeAdminGuardChain(onForbidden), demoteAuthIdentity);
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
  const services = fakeAuthServices({ sessions: actionSessions, ...overrides });
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
      factors: createFactorRegistry(fakeFactorStore([]), { primary: wide }),
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
    factors: createFactorRegistry(fakeFactorStore(["totp-app", "recovery-code"]), {
      primary: fakeFactorService("email-otp"),
      second: fakeSecondFactorOffering([fakeFactorService("totp-app")]),
    }),
  };

  it("sends a signed-in session owing an enrolment to the first owed kind's page, rather than asking for a code", async () => {
    const landing = async (mandatory: readonly AuthSecondFactorKind[]) => {
      const options = optionsWith({ users: fakeAuthUserStore([signedIn]), factors: fakeFactorRegistry(["passkey", "totp-app"], mandatory) });
      const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/verify", createVerifyActions(options).submit);
      const res = await app.request("/auth/verify", formBody({ code: "123456" }));
      return { status: res.status, location: res.headers.get("location") };
    };
    expect({ app: await landing(["totp-app"]), both: await landing(["passkey", "totp-app"]) }).toEqual({
      app: { status: 303, location: "/auth/enrol/totp" },
      both: { status: 303, location: "/auth/enrol/passkey" },
    });
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
        primary: fakeFactorService("email-otp"),
        second: fakeSecondFactorOffering([fakeFactorService("totp-app")]),
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
      primary: fakeFactorService("email-otp"),
      second: fakeSecondFactorOffering([fakeFactorService("totp-app")]),
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
  const PRIMARY = fakeFactorService("email-otp");

  async function marked(action: TestAction, route: string, url: string, init: RequestInit, seed: Seed = {}) {
    const stepUpWrites: number[] = [];
    const stepUpAfter: unknown[] = [];
    const app = mounted(actionApp({ ...seed, stepUpWrites, stepUpAfter }), "POST", route, action);
    const res = await app.request(url, init);
    return { status: res.status, location: res.headers.get("location"), stepUpWrites, stepUpAt: stepUpAfter[0] };
  }

  const acceptingStepUp = fakeAuthSigninFlow({ stepUp: async (userId, kind, _code, at) => ok({ kind, userId, verifiedAt: at }) });

  function secondFactor(enrolled: readonly AuthFactorKind[], requirement: AuthSecondFactorRequirement): Partial<AuthRequestServices> {
    return {
      users: fakeAuthUserStore([signedIn]),
      factors: fakeFactorRegistry(["totp-app"], requirement === "mandatory" ? ["totp-app"] : [], fakeFactorStore(enrolled)),
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

  it("records the moment a user holding no second factor re-proved with the primary factor", async () => {
    const stepped: AuthFactorKind[] = [];
    const signin = fakeAuthSigninFlow({ stepUp: async (userId, kind, _code, at) => (stepped.push(kind), ok({ kind, userId, verifiedAt: at })) });
    const services = { ...secondFactor([], "optional"), signin };
    const result = await marked(verifySubmit(services), "/auth/verify", "/auth/verify?next=%2Fapp", formBody({ code: "123456" }), {
      userId: "u9",
      stepUpAt: EARLIER,
    });
    expect({ ...result, stepped }).toEqual({
      status: 303,
      location: "/app",
      stepUpWrites: [VERIFIED_AT],
      stepUpAt: VERIFIED_AT,
      stepped: ["email-otp"],
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
      seed: { pendingEmail: "grace@example.com" },
      status: 422,
      location: null,
      stepUpAt: null,
    },
    {
      outcome: "a sign-in code posted with no sign-in started",
      signin: acceptingStepUp,
      seed: {},
      status: 303,
      location: "/auth/signin",
      stepUpAt: null,
    },
    {
      outcome: "a completed sign-in that still owes a second factor, which clears a carried-over mark rather than recording one",
      signin: fakeAuthSigninFlow({
        stepUp: acceptingStepUp.stepUp,
        complete: async () =>
          ok({ user: signedIn, kind: "email-otp" as const, resolution: { status: "step-up-required" as const, kinds: ["totp-app" as const] } }),
      }),
      seed: { pendingEmail: "grace@example.com", stepUpAt: EARLIER },
      status: 303,
      location: "/auth/verify?next=%2Fapp",
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

  it("records the sign-in code as the step-up of a user holding no second factor", async () => {
    const signin = fakeAuthSigninFlow({
      complete: async () => ok({ user: signedIn, kind: "email-otp" as const, resolution: { status: "satisfied" as const } }),
    });
    const services = { ...secondFactor([], "optional"), signin };
    expect(
      await marked(verifySubmit(services), "/auth/verify", "/auth/verify?next=%2Fapp", formBody({ code: "123456" }), {
        pendingEmail: "grace@example.com",
      }),
    ).toEqual({ status: 303, location: "/app", stepUpWrites: [], stepUpAt: VERIFIED_AT });
  });

  const FINISH = "/auth/verify/passkey/finish";

  function passkeyFinish(verifies: boolean, offered = true): TestAction {
    const passkey = {
      ...fakeFactorService("passkey"),
      verifyChallenge: async (userId: string, _presented: string, at: number) =>
        verifies ? ok({ kind: "passkey" as const, userId, verifiedAt: at }) : err("unrecognised" as const),
    } as AuthSecondFactorService;
    const factors = createFactorRegistry(
      fakeFactorStore(offered ? ["passkey"] : []),
      offered ? { primary: PRIMARY, second: fakeSecondFactorOffering([passkey]) } : { primary: PRIMARY },
    );
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
        stepUpAt: "userId" in seed ? EARLIER : null,
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

describe("authCsrfRefusal", () => {
  const CSRF_SECRET = "8b7680f6f106e5235091e5cdcc23ed1f2bd06cd47e14022ec96f670b87a7157d";
  const MINTED_AT = 1_790_000_000_000;
  const MINUTE = 60_000;
  const AUTH = authPaths(authRoutes("/auth"));

  let restore: (() => void)[] = [];
  afterEach(() => {
    for (const undo of restore) undo();
    restore = [];
  });

  /** An app whose sign-out and sign-in POSTs sit behind `csrfProtection`, recording every handler that ran. */
  function guarded(base: string, options: Partial<CsrfProtectionOptions> = {}) {
    const ran: string[] = [];
    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => importKeyRing([CSRF_SECRET]), subject: false, ...options }));
    for (const path of [`${base}/signout`, `${base}/signin`]) {
      mapHandler(app, "ANY", path, (c) => {
        ran.push(`${c.method} ${path}`);
        return new Response("ran");
      });
    }
    return { app, ran };
  }

  function refusing(base = "/auth", options: Partial<CsrfProtectionOptions> = {}) {
    return guarded(base, { onForbidden: authCsrfRefusal(authPaths(authRoutes(base))), ...options });
  }

  /** A token for `path` minted at `MINTED_AT`, with the clock then moved `ageMs` past it. */
  async function agedToken(path: string, ageMs: number): Promise<string> {
    const clock = spyOn(Date, "now").mockReturnValue(MINTED_AT);
    restore.push(() => clock.mockRestore());
    const token = await createCsrfToken(await importKeyRing([CSRF_SECRET]), path);
    clock.mockReturnValue(MINTED_AT + ageMs);
    return token;
  }

  function post(fields: Record<string, string>, headers: Record<string, string> = {}, method = "POST"): RequestInit {
    return { method, body: new URLSearchParams(fields).toString(), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } };
  }

  async function answerOf(res: Response) {
    return { status: res.status, location: res.headers.get("location"), hxRedirect: res.headers.get("hx-redirect"), body: await res.text() };
  }

  it("sends a sign-out whose token aged 61 minutes to the confirm page without running the sign-out", async () => {
    const { app, ran } = refusing();
    const token = await agedToken("/auth/signout", 61 * MINUTE);

    const res = await app.request("/auth/signout", post({ _csrf: token }));
    expect({ answer: await answerOf(res), ran }).toEqual({
      answer: { status: 303, location: "/auth/signout", hxRedirect: null, body: "" },
      ran: [],
    });
  });

  it("admits a sign-out whose token aged 59 minutes to the sign-out handler", async () => {
    const { app, ran } = refusing();
    const token = await agedToken("/auth/signout", 59 * MINUTE);

    const res = await app.request("/auth/signout", post({ _csrf: token }));
    expect({ status: res.status, ran }).toEqual({ status: 200, ran: ["POST /auth/signout"] });
  });

  it("answers an htmx sign-out refused for its token with a 204 carrying HX-Redirect to the confirm page", async () => {
    const { app, ran } = refusing();
    const token = await agedToken("/auth/signout", 61 * MINUTE);

    const res = await app.request("/auth/signout", post({ _csrf: token }, HX_REQUEST));
    expect({ answer: await answerOf(res), ran }).toEqual({
      answer: { status: 204, location: null, hxRedirect: "/auth/signout", body: "" },
      ran: [],
    });
  });

  it("sends a tokenless sign-out POST to the confirm page", async () => {
    const { app, ran } = refusing();

    const res = await app.request("/auth/signout", post({}));
    expect({ status: res.status, location: res.headers.get("location"), ran }).toEqual({ status: 303, location: "/auth/signout", ran: [] });
  });

  it("refuses a sign-out at 403 when no session subject is there to bind a fresh token to", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    restore.push(() => warn.mockRestore());
    const { app, ran } = refusing("/auth", { subject: () => undefined });

    const res = await app.request("/auth/signout", post({}));
    expect({ answer: await answerOf(res), ran }).toEqual({ answer: { status: 403, location: null, hxRedirect: null, body: "Forbidden" }, ran: [] });
  });

  it("answers a refusal on any other path exactly as the guard's own default does", async () => {
    const token = await agedToken("/auth/signin", 61 * MINUTE);
    const recovering = refusing();
    const plain = guarded("/auth");

    const recovered = await recovering.app.request("/auth/signin", post({ _csrf: token }));
    const fallback = await plain.app.request("/auth/signin", post({ _csrf: token }));
    expect({ recovered: { ...(await answerOf(recovered)), type: recovered.headers.get("content-type") }, ran: recovering.ran }).toEqual({
      recovered: { ...(await answerOf(fallback)), type: fallback.headers.get("content-type") },
      ran: [],
    });
    expect(fallback.status).toBe(403);
  });

  it("redirects a sign-out POST refused for every reason a token can fail", async () => {
    const refusal = authCsrfRefusal(AUTH);
    const reasons: Record<CsrfFailure, true> = {
      expired: true,
      "future-timestamp": true,
      "invalid-format": true,
      "invalid-signature": true,
      "missing-token": true,
      "path-mismatch": true,
      "subject-mismatch": true,
      "unknown-key": true,
    };

    const answers = Object.keys(reasons).map((reason) => {
      const res = refusal(createTestContext(new Request("http://localhost/auth/signout", { method: "POST" })), reason as CsrfFailure);
      return { reason, status: res.status, location: res.headers.get("location") };
    });
    expect(answers).toEqual(Object.keys(reasons).map((reason) => ({ reason, status: 303, location: "/auth/signout" })));
  });

  it("refuses at 403 a DELETE to the sign-out path that the guard refused", async () => {
    const { app, ran } = refusing();

    const res = await app.request("/auth/signout", post({}, {}, "DELETE"));
    expect({ status: res.status, body: await res.text(), ran }).toEqual({ status: 403, body: "Forbidden", ran: [] });
  });

  it("follows the auth routes to a /login mount point and no longer recognises /auth/signout", async () => {
    const login = refusing("/login");
    const loginToken = await agedToken("/login/signout", 61 * MINUTE);
    const atLogin = await login.app.request("/login/signout", post({ _csrf: loginToken }));

    const authAnswer = authCsrfRefusal(authPaths(authRoutes("/login")))(
      createTestContext(new Request("http://localhost/auth/signout", { method: "POST" })),
      "expired",
    );

    expect({
      atLogin: { status: atLogin.status, location: atLogin.headers.get("location"), ran: login.ran },
      atAuth: { status: authAnswer.status, body: await authAnswer.text() },
    }).toEqual({ atLogin: { status: 303, location: "/login/signout", ran: [] }, atAuth: { status: 403, body: "Forbidden" } });
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
      factors: createFactorRegistry(fakeFactorStore([]), { primary: fakeFactorService("email-otp"), second: fakeSecondFactorOffering([passkey]) }),
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
    const passkey = { ...listed("passkey"), completeEnrolment: async () => ok(confirmedRow("passkey")) } as AuthSecondFactorService;
    const codes = Object.assign(listed("recovery-code"), { remaining: async () => ok(remaining) }) as RecoveryCodeFactorService;
    const services = fakeAuthServices({
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore(held), {
        primary: fakeFactorService("email-otp"),
        second: fakeSecondFactorOffering([listed("totp-app") as AuthSecondFactorService, passkey], [], codes),
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
    } as AuthSecondFactorService;
    return {
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore([]), { primary: fakeFactorService("email-otp"), second: fakeSecondFactorOffering([passkey]) }),
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

describe("createTotpEnrolActions", () => {
  it("sends a confirmed enrolment on to the step-up the policy now owes, not to the account page", async () => {
    const confirmed: AuthFactor = {
      id: "f-totp-app",
      userId: "u9",
      kind: "totp-app",
      secret: null,
      lastCounter: null,
      failedAttempts: 0,
      lastVerifiedAt: null,
      confirmedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const totp = { ...fakeFactorService("totp-app"), completeEnrolment: async () => ok(confirmed) } as AuthSecondFactorService;
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore(["totp-app"]), {
        primary: fakeFactorService("email-otp"),
        second: fakeSecondFactorOffering([totp], ["totp-app"]),
      }),
    });
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/enrol/totp", createTotpEnrolActions(options).totpEnrol);

    const res = await app.request("/auth/enrol/totp", formBody({ code: "123456" }));
    expect({ status: res.status, location: res.headers.get("location") }).toEqual({ status: 303, location: "/auth/verify" });
  });
  it("answers 503 when the factor demand cannot be read after the enrolment confirms, rather than guessing a page", async () => {
    const confirmed: AuthFactor = {
      id: "f-totp-app",
      userId: "u9",
      kind: "totp-app",
      secret: null,
      lastCounter: null,
      failedAttempts: 0,
      lastVerifiedAt: null,
      confirmedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const totp = { ...fakeFactorService("totp-app"), completeEnrolment: async () => ok(confirmed) } as AuthSecondFactorService;
    const factors = createFactorRegistry(fakeFactorStore(["totp-app"]), {
      primary: fakeFactorService("email-otp"),
      second: fakeSecondFactorOffering([totp], ["totp-app"]),
    });
    const down = { ...factors, resolve: async () => err(new AuthStoreError("unavailable", "factors.resolve")) };
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), factors: down });
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/enrol/totp", createTotpEnrolActions(options).totpEnrol);

    const res = await app.request("/auth/enrol/totp", formBody({ code: "123456" }));
    expect({ status: res.status, location: res.headers.get("location") }).toEqual({ status: 503, location: null });
  });
});

describe("createTotpManageActions", () => {
  const totpService = {
    ...fakeFactorService("totp-app"),
    beginEnrolment: async () => ok({ kind: "totp-app" as const, expiresAt: 1_000, options: { secret: "JBSWY3DP", uri: "otpauth://totp/x" } }),
  } as AuthSecondFactorService;

  const totpServices: Partial<AuthRequestServices> = {
    users: fakeAuthUserStore([signedIn]),
    factors: createFactorRegistry(fakeFactorStore([]), {
      primary: fakeFactorService("email-otp"),
      second: fakeSecondFactorOffering([totpService]),
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

describe("createTotpManageActions — replacing the authenticator app", () => {
  const NOW = 10_000_000;
  const FRESH_MS = 900_000;
  const PENDING = { secret: "KRSXG5CT", uri: "otpauth://totp/replace" };
  const REPLACED: AuthFactor = {
    id: "f-totp-app",
    userId: "u9",
    kind: "totp-app",
    secret: null,
    lastCounter: 41,
    failedAttempts: 0,
    lastVerifiedAt: NOW,
    confirmedAt: 1,
    createdAt: 1,
    updatedAt: NOW,
  };
  const TO_VERIFY = "/auth/verify?next=%2Faccount%2Ftotp%2Freplace";

  /** The confirm POST over a replaceable factor that answers `answer`, behind the guard `guard` describes. */
  function replacePost(
    answer: Awaited<ReturnType<TotpReplaceableFactorService["completeReplacement"]>>,
    guard: { readonly freshStepUpMaxAgeMs?: number | null; readonly mounted?: boolean } = {},
  ) {
    const calls: string[] = [];
    const totp = {
      ...fakeFactorService("totp-app"),
      beginReplacement: async () => ok({ kind: "totp-app" as const, expiresAt: NOW, options: PENDING }),
      completeReplacement: async (userId: string, presented: string) => {
        calls.push(`complete:${userId}:${presented}`);
        return answer;
      },
    } as TotpReplaceableFactorService;
    const store = fakeFactorStore(["totp-app"]);
    const notices = fakeSecurityNotices();
    const services = fakeAuthServices({
      sessions: actionSessions,
      notices,
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(store, { primary: fakeFactorService("email-otp"), second: fakeSecondFactorOffering([totp]) }),
      enrolments: store,
    });
    const options = fakeAuthWebOptions({ resolveServices: () => services, now: () => NOW });
    const freshStepUp = requireFreshStepUp({
      factors: () => ({ resolve: async () => ok({ status: "satisfied" as const }) }),
      enrolmentPaths: authEnrolmentPaths(options.paths.auth),
      stepUpPath: options.paths.auth.verify.show(),
      settledPath: "/account",
      now: () => NOW,
      ...(guard.freshStepUpMaxAgeMs === undefined ? {} : { freshStepUpMaxAgeMs: guard.freshStepUpMaxAgeMs }),
    });
    const request = async (seed: Seed, code = "123456") => {
      const app = actionApp(seed);
      if (guard.mounted !== false) app.use("*", freshStepUp);
      mounted(app, "POST", "/account/totp/replace", createTotpManageActions(options).totpReplaceConfirm);
      return app.request("/account/totp/replace", formBody({ code }));
    };
    return { calls, notices, request };
  }

  const fresh: Seed = { userId: "u9", stepUpAt: NOW - 1 };
  const answerOf = (res: Response) => ({ status: res.status, location: res.headers.get("location") });

  it("returns to the authenticator page on a correct code, telling the holder once", async () => {
    const { notices, request } = replacePost(ok(REPLACED));
    expect({ answer: answerOf(await request(fresh)), sent: notices.sent }).toEqual({
      answer: { status: 303, location: "/account/totp" },
      sent: [{ to: "grace@example.com", notice: { type: "factor-replaced", factorKind: "totp-app", at: NOW } }],
    });
  });

  it("re-renders at 422 on a wrong code, with the same pending secret still shown and nothing sent", async () => {
    const { notices, request } = replacePost(err("unrecognised"));
    const res = await request(fresh);
    const html = await res.text();
    expect({
      status: res.status,
      secret: textOf(html, "code", 'data-ref="totp-secret"'),
      error: textOf(html, "p", 'data-slot="field-error"'),
      sent: notices.sent,
    }).toEqual({ status: 422, secret: PENDING.secret, error: "That code did not match. Enter the code your app shows now.", sent: [] });
  });

  // The reload mints another secret here, so "did not match" would send the user back to an app holding the dropped one.
  it("tells the user to add the new secret, never that the code did not match, once the pending one was spent or lapsed", async () => {
    const reasons: AuthFactorReason[] = ["too-many-attempts", "expired"];
    const answers = [];
    for (const reason of reasons) {
      const res = await replacePost(err(reason)).request(fresh);
      answers.push({ status: res.status, error: textOf(await res.text(), "p", 'data-slot="field-error"') });
    }
    const restarted = {
      status: 422,
      error: "That setup expired. Remove the entry you just added to your app, then add the new secret below and enter its code.",
    };
    expect(answers).toEqual([restarted, restarted]);
  });

  it("lands on the authenticator page flagged removed, sending nothing, when the row went before the commit", async () => {
    const { notices, request } = replacePost(err("not-enrolled"));
    expect({ answer: answerOf(await request(fresh)), sent: notices.sent }).toEqual({
      answer: { status: 303, location: "/account/totp?removed=1" },
      sent: [],
    });
  });

  it("answers 503 when the store behind the commit is down", async () => {
    const { notices, request } = replacePost(err("unavailable"));
    expect({ status: (await request(fresh)).status, sent: notices.sent }).toEqual({ status: 503, sent: [] });
  });

  // The guard can be opted out of, and then only the action stands between a cookie and a new secret.
  it("sends a stale step-up to verify, returning to the replacement, wherever the guard does not refuse it first", async () => {
    const answers = [];
    const calls = [];
    for (const [guard, seed] of [
      [{ freshStepUpMaxAgeMs: null }, { userId: "u9" }],
      [{ mounted: false }, fresh],
    ] as const) {
      const post = replacePost(ok(REPLACED), guard);
      answers.push(answerOf(await post.request(seed)));
      calls.push(...post.calls);
    }
    expect({ answers, calls }).toEqual({
      answers: [
        { status: 303, location: TO_VERIFY },
        { status: 303, location: TO_VERIFY },
      ],
      calls: [],
    });
  });

  it("is refused by the guard itself for a step-up outside the default window", async () => {
    const { calls, request } = replacePost(ok(REPLACED));
    const res = await request({ userId: "u9", stepUpAt: NOW - FRESH_MS - 1 });
    expect({ status: res.status, location: res.headers.get("location"), calls }).toEqual({ status: 303, location: "/auth/verify", calls: [] });
  });
});

describe("removing a mandatory second factor", () => {
  const PASSKEY_REFUSAL = "Your account requires a passkey. Add another before you remove this one.";
  const TOTP_REFUSAL = "Your account requires an authenticator app, so it can&#39;t be removed. Replace it instead.";

  /** Removes `u9`'s one passkey with `mandatory` mandatory, from a store that refuses it whenever the floor names a passkey, as the D1 guard does for a last passkey. */
  async function removeOnlyPasskey(mandatory: readonly AuthSecondFactorKind[]) {
    const held = new Set(["c1"]);
    const floors: unknown[] = [];
    const credentials: CredentialStore = {
      ...fakeAuthCredentialStore([]),
      listByUser: async () => ok([...held].map((id) => fakeAuthCredential({ id, userId: "u9" }))),
      removeForUser: async (id, _userId, _at, _origin, floor) => {
        floors.push(floor);
        if (!held.has(id)) return ok("not-found" as const);
        if (floor.includes("passkey")) return ok("second-factor-required" as const);
        held.delete(id);
        return ok("changed" as const);
      },
    };
    const enrolments = fakeFactorStore(["passkey"]);
    const notices = fakeSecurityNotices();
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      credentials,
      enrolments,
      factors: fakeFactorRegistry(["passkey", "totp-app"], mandatory, enrolments),
      notices,
    });
    const app = mounted(actionApp({ userId: "u9" }), "DELETE", "/account/passkeys/:id", createPasskeyManageActions(options).passkeyRemove);
    const res = await app.request("/account/passkeys/c1", { method: "DELETE" });
    const html = await res.text();
    return {
      status: res.status,
      held: [...held],
      floors,
      notices: notices.sent.length,
      error: textOf(html, "div", 'data-slot="alert-description"'),
    };
  }

  /** Removes `u9`'s confirmed authenticator app with `mandatory` mandatory, from a store that refuses it whenever the floor names the app. */
  async function removeOnlyApp(mandatory: readonly AuthSecondFactorKind[]) {
    const store = fakeFactorStore(["totp-app"]);
    let kept = true;
    const floors: unknown[] = [];
    const listed = async (userId: string) => (kept ? store.listByUser(userId) : ok([]));
    const totp = { ...fakeFactorService("totp-app"), listEnrolments: listed } as AuthSecondFactorService;
    const notices = fakeSecurityNotices();
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      enrolments: {
        ...store,
        listByUser: listed,
        remove: async (_id, _userId, _at, _origin, floor) => {
          floors.push(floor);
          if (floor.includes("totp-app")) return ok("second-factor-required" as const);
          kept = false;
          return ok("changed" as const);
        },
      },
      factors: createFactorRegistry(store, {
        primary: fakeFactorService("email-otp"),
        second: fakeSecondFactorOffering([totp, "passkey"], mandatory),
      }),
      notices,
    });
    const app = mounted(actionApp({ userId: "u9" }), "DELETE", "/account/totp", createTotpManageActions(options).totpRemove);
    const res = await app.request("/account/totp", { method: "DELETE" });
    const html = await res.text();
    return {
      status: res.status,
      location: res.headers.get("location"),
      kept,
      floors,
      notices: notices.sent.length,
      error: textOf(html, "div", 'data-slot="alert-description"'),
    };
  }

  it("refuses the last passkey where passkeys are mandatory with a 409 re-render naming why, keeping the row and sending no notice", async () => {
    expect(await removeOnlyPasskey(["passkey"])).toEqual({ status: 409, held: ["c1"], floors: [["passkey"]], notices: 0, error: PASSKEY_REFUSAL });
  });

  it("removes the last passkey where only the authenticator app is mandatory, passing the store that floor", async () => {
    expect(await removeOnlyPasskey(["totp-app"])).toEqual({ status: 200, held: [], floors: [["totp-app"]], notices: 1, error: "" });
  });

  it("removes the last passkey where nothing is mandatory, passing the store an empty floor", async () => {
    expect(await removeOnlyPasskey([])).toEqual({ status: 200, held: [], floors: [[]], notices: 1, error: "" });
  });

  it("refuses a mandatory authenticator app with a 409 re-render naming why, keeping the row and sending no notice", async () => {
    expect(await removeOnlyApp(["totp-app"])).toEqual({
      status: 409,
      location: null,
      kept: true,
      floors: [["totp-app"]],
      notices: 0,
      error: TOTP_REFUSAL,
    });
  });

  it("removes an optional authenticator app, whether or not a passkey is mandatory beside it", async () => {
    expect([await removeOnlyApp([]), await removeOnlyApp(["passkey"])]).toEqual([
      { status: 303, location: "/account/totp", kept: false, floors: [[]], notices: 1, error: "" },
      { status: 303, location: "/account/totp", kept: false, floors: [["passkey"]], notices: 1, error: "" },
    ]);
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

  function codePages(
    holds: readonly AuthFactorKind[],
    guard: { readonly freshStepUpMaxAgeMs?: number | null; readonly mounted?: boolean } = {},
    returnParam?: string,
  ) {
    const calls: string[] = [];
    const store = fakeFactorStore(holds);
    const recovery = {
      ...fakeRecoveryCodeService(),
      beginEnrolment: async (userId: string, at: number) => {
        calls.push(`begin:${userId}`);
        return ok({ kind: "recovery-code" as const, expiresAt: at, options: { codes: ISSUED } });
      },
      completeEnrolment: async (userId: string, presented: string) => {
        calls.push(`complete:${userId}:${presented}`);
        return presented === ISSUED[1] ? ok(confirmedRow("recovery-code")) : err("unrecognised" as const);
      },
    };
    const notices = fakeSecurityNotices();
    const services = fakeAuthServices({
      notices,
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(store, {
        primary: fakeFactorService("email-otp"),
        second: fakeSecondFactorOffering([fakeFactorService("totp-app"), fakeFactorService("passkey")], [], recovery),
      }),
      enrolments: store,
    });
    const options = fakeAuthWebOptions({ resolveServices: () => services, now: () => NOW, ...(returnParam === undefined ? {} : { returnParam }) });
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
    return { calls, app, notices };
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

  const GUARD_REFUSAL = { status: 303, location: "/auth/verify" };

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
    { label: "a session that never stepped up", holds: ["totp-app"], seed: { userId: "u9" }, expected: GUARD_REFUSAL },
    {
      label: "a step-up exactly as old as the freshness window",
      holds: ["totp-app"],
      seed: { userId: "u9", stepUpAt: NOW - FRESH_MS },
      expected: GUARD_REFUSAL,
    },
    { label: "a step-up dated into the future", holds: ["totp-app"], seed: { userId: "u9", stepUpAt: NOW + 1 }, expected: GUARD_REFUSAL },
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
  const GUARD_REFUSED = { answers: [GUARD_REFUSAL, GUARD_REFUSAL], calls: [] };
  const MINUTE = 60_000;

  const windows: readonly {
    label: string;
    guard: { readonly freshStepUpMaxAgeMs?: number | null; readonly mounted?: boolean };
    seed: Seed;
    expected: typeof ADMITTED | typeof REFUSED | typeof GUARD_REFUSED;
  }[] = [
    {
      label: "refuses a 10-minute-old step-up under a configured 60 s window",
      guard: { freshStepUpMaxAgeMs: MINUTE },
      seed: { userId: "u9", stepUpAt: NOW - 10 * MINUTE },
      expected: GUARD_REFUSED,
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
      expected: GUARD_REFUSED,
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

  it("carries the return-to onto verify under the parameter the mount renamed it to, on both code POSTs", async () => {
    const { calls, app } = codePages(["totp-app"], { mounted: false }, "back");
    const mountedApp = app({ userId: "u9", stepUpAt: NOW - 1 });
    const answers = [];
    for (const [path, fields] of [
      ["/account/recovery-codes", {}],
      ["/account/recovery-codes/confirm", { code: ISSUED[1] ?? "" }],
    ] as const) {
      const res = await mountedApp.request(path, formBody(fields));
      answers.push({ status: res.status, location: res.headers.get("location") });
    }
    const toVerify = { status: 303, location: "/auth/verify?back=%2Faccount%2Frecovery-codes" };
    expect({ answers, calls }).toEqual({ answers: [toVerify, toVerify], calls: [] });
  });

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

  it("tells the account holder a new set was issued once it is confirmed, and nothing when the code is refused", async () => {
    const accepted = codePages(["totp-app"]);
    await accepted.app({ userId: "u9", stepUpAt: NOW - 1 }).request("/account/recovery-codes/confirm", formBody({ code: ISSUED[1] ?? "" }));
    const refused = codePages(["totp-app"]);
    await refused.app({ userId: "u9", stepUpAt: NOW - 1 }).request("/account/recovery-codes/confirm", formBody({ code: ISSUED[0] ?? "" }));
    expect({ accepted: accepted.notices.sent, refused: refused.notices.sent }).toEqual({
      accepted: [{ to: signedIn.email, notice: { type: "recovery-codes-issued", factorKind: "recovery-code", at: NOW } }],
      refused: [],
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

  function resetApp(seed: Seed, outcome: "changed" | "not-found" = "changed", app: Forge = actionApp(seed)) {
    const resets: string[] = [];
    const actors: string[] = [];
    const notices = fakeSecurityNotices();
    const admin = fakeAdminUserStore([target, actor], {
      resetFactors: async (id, at, adminId) => {
        resets.push(`${id}@${at}`);
        actors.push(adminId);
        return ok(outcome);
      },
    });
    const options = optionsWith({ users: fakeAuthUserStore([target, actor]), admin, notices });
    return { resets, actors, notices, app: mounted(app, "POST", "/admin/users/:id/factors/reset", createAdminUserActions(options).resetFactors) };
  }

  const answerOf = async (res: Response) => ({ status: res.status, location: res.headers.get("location") });

  it("clears another account's factors and returns to its factors panel", async () => {
    const { resets, app } = resetApp({ userId: "u9", admin: true });
    const res = await app.request("/admin/users/u2/factors/reset", formBody({}));
    expect({ answer: await answerOf(res), resets }).toEqual({ answer: { status: 303, location: "/admin/users/u2/factors" }, resets: ["u2@1000"] });
  });

  it("records the acting administrator on the reset and tells the account's own address, and tells nobody of a reset that found no account", async () => {
    const done = resetApp({ userId: "u9", admin: true });
    await done.app.request("/admin/users/u2/factors/reset", formBody({}));
    const gone = resetApp({ userId: "u9", admin: true }, "not-found");
    await gone.app.request("/admin/users/u2/factors/reset", formBody({}));
    expect({ actors: done.actors, sent: done.notices.sent, gone: gone.notices.sent }).toEqual({
      actors: ["u9"],
      sent: [{ to: "member@example.com", notice: { type: "factors-reset", factorKind: null, at: 1_000 } }],
      gone: [],
    });
  });

  it("refuses a signed-in non-administrator with a plain-text 403 without resetting anything", async () => {
    const { resets, app } = resetApp({ userId: "u9", admin: false });
    const res = await app.request("/admin/users/u2/factors/reset", formBody({}));
    expect({ status: res.status, body: await res.text(), resets }).toEqual({ status: 403, body: "Forbidden", resets: [] });
  });

  it("refuses a non-administrator through the `onForbidden` given only to `createAuthGuards`, without resetting anything", async () => {
    const onForbidden = (c: AppContext) => new Response(`admin only: ${c.url.pathname}`, { status: 403 });
    const seed = { userId: "u9", admin: true };
    const { resets, app } = resetApp(seed, "changed", demotedBehindAdminChain(actionApp(seed), onForbidden));
    const res = await app.request("/admin/users/u2/factors/reset", formBody({}));
    expect({ status: res.status, body: await res.text(), resets }).toEqual({
      status: 403,
      body: "admin only: /admin/users/u2/factors/reset",
      resets: [],
    });
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

  it("refuses a second request inside the cooldown with the form and its notice, and mails nothing for it", async () => {
    const sent: AuthMessage[] = [];
    const deferred: Promise<unknown>[] = [];
    const claims = new Map<string, number>();
    const users: UserStore = {
      ...fakeAuthUserStore([signedIn]),
      claimEmailChange: async (id, at, cooldownMs) => {
        const last = claims.get(id);
        if (last !== undefined && last > at - cooldownMs) return ok(false);
        claims.set(id, at);
        return ok(true);
      },
    };
    const emailChange = createEmailChangeFlow({
      keys: await importAuthKeyRing(["0ebb4b947b8932ef8a3c1f23c024a2cdf4abcd964cc1d3d064e2c068e432f1cf"]),
      users,
      nonces: { markConsumed: async () => ok(true) },
      notifier: { send: async (message) => (sent.push(message), ok()) },
      defer: (work) => void deferred.push(work),
      confirmUrl: (token) => `https://app.example/account/email-change/confirm?token=${token}`,
    });
    const options = optionsWith({ users, emailChange });
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/account/email-change", createEmailChangeActions(options).emailChangeSubmit);

    const first = await app.request("/account/email-change", formBody({ email: "new@example.com" }));
    const second = await app.request("/account/email-change", formBody({ email: "other@example.com" }));
    await Promise.all(deferred);
    const html = await second.text();

    expect({
      first: first.status,
      second: second.status,
      title: textOf(html, "div", 'data-slot="alert-title"'),
      notice: textOf(html, "div", 'data-slot="alert-description"'),
      typed: attrOf(html, 'name="email"', "value"),
      mailed: sent.map((message) => message.to),
    }).toEqual({
      first: 200,
      second: 422,
      title: "We could not use that address",
      notice: "A change of address was requested recently. Try again in a few minutes.",
      typed: "other@example.com",
      mailed: ["grace@example.com"],
    });
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
    expect({ status: res.status, body: await res.text(), writes }).toEqual({ status: 403, body: "Forbidden", writes: 0 });
  });

  it("answers a non-administrator's PATCH through the `onForbidden` given only to `createAuthGuards`, writing nothing", async () => {
    let writes = 0;
    const admin = fakeAdminUserStore([member], {
      setAdmin: async () => {
        writes += 1;
        return ok("changed" as const);
      },
    });
    const onForbidden = (c: AppContext) => new Response(`admin only: ${c.url.pathname}`, { status: 403 });
    const options = optionsWith({ users: fakeAuthUserStore([member]), admin });
    const guarded = demotedBehindAdminChain(actionApp({ userId: "u2", admin: true }), onForbidden);
    const app = mounted(guarded, "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u2", formBody({ role: "admin", status: "active" }, "PATCH"));
    expect({ status: res.status, body: await res.text(), writes }).toEqual({ status: 403, body: "admin only: /admin/users/u2", writes: 0 });
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
    expect({ status: res.status, body: await res.text(), removals }).toEqual({ status: 403, body: "Forbidden", removals: 0 });
  });

  it("answers a non-administrator's DELETE through what an async `onForbidden` given only to `createAuthGuards` resolves to, deleting nothing", async () => {
    const target = fakeAuthUser({ id: "u3", email: "target@example.com" });
    let removals = 0;
    const admin = fakeAdminUserStore([member, target], {
      remove: async () => {
        removals += 1;
        return ok("changed" as const);
      },
    });
    const onForbidden = async (c: AppContext) => new Response(`admin only: ${c.url.pathname}`, { status: 403 });
    const options = optionsWith({ users: fakeAuthUserStore([member, target]), admin });
    const guarded = demotedBehindAdminChain(actionApp({ userId: "u2", admin: true }), onForbidden);
    const app = mounted(guarded, "DELETE", "/admin/users/:id", createAdminUserActions(options).remove);

    const res = await app.request("/admin/users/u3", { method: "DELETE" });
    expect({ status: res.status, body: await res.text(), removals }).toEqual({ status: 403, body: "admin only: /admin/users/u3", removals: 0 });
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
        primary: fakeFactorService("email-otp"),
        second: fakeSecondFactorOffering([fakeFactorService("totp-app")]),
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
      } as AuthSecondFactorService;
      const options = guarded({
        users: fakeAuthUserStore([signedIn]),
        factors: createFactorRegistry(fakeFactorStore(["passkey"]), {
          primary: fakeFactorService("email-otp"),
          second: fakeSecondFactorOffering([passkey]),
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

describe("the auth-session row each action acts on", () => {
  const CLOCK = 1_000;
  const OTHER = "u2";
  const assertion = { credential: { id: "c", response: {} } };
  const down = (operation: string) => async () => err(new AuthStoreError("unavailable", operation));

  /** The row store every request of one test resolves and writes through, with any of its writes made to fail. */
  function rowStore(failing: readonly ("create" | "remove" | "revoke" | "revokeOthers" | "rotate")[] = []) {
    const inner = fakeAuthSessionStore([signedIn, fakeAuthUser({ id: OTHER, email: "other@example.com" })]);
    const sessions: AuthSessionStore = {
      create: failing.includes("create") ? down("sessions.create") : inner.create,
      resolve: inner.resolve,
      rotate: failing.includes("rotate") ? down("sessions.rotate") : inner.rotate,
      remove: failing.includes("remove") ? down("sessions.remove") : inner.remove,
      listByUser: inner.listByUser,
      revoke: failing.includes("revoke") ? down("sessions.revoke") : inner.revoke,
      revokeOthers: failing.includes("revokeOthers") ? down("sessions.revokeOthers") : inner.revokeOthers,
    };
    return { sessions, inner, rows: inner.rows };
  }

  /** `action` mounted behind a real `resolveAuth` over `sessions`, with a seeding route and a route naming who the request resolved as. */
  function rowApp(
    sessions: AuthSessionStore,
    services: Partial<AuthRequestServices>,
    method: "POST" | "DELETE",
    pattern: string,
    action: (options: AuthWebOptions) => TestAction,
  ): Forge {
    const resolved = fakeAuthServices({ ...services, sessions });
    const options = fakeAuthWebOptions({ resolveServices: () => resolved, now: () => CLOCK });
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
    app.use("*", resolveAuth({ sessions: () => sessions, now: () => CLOCK }));
    app.use("*", (context, next) => {
      csrfMinterCtx.set(context, (path) => Promise.resolve(`csrf-for:${path}`));
      csrfFieldCtx.set(context, "_csrf");
      return next();
    });
    mapHandler(app, "POST", "/seed", async (context) => {
      const session = sessionCtx.get(context);
      const pending = context.url.searchParams.get("pending");
      if (pending !== null) session.set(AUTH_PENDING_SIGNIN_SESSION_KEY, pending);
      else await establishAuthSession(session, sessions, "u9", CLOCK, CLOCK, { kind: "email-otp" });
      return new Response("seeded");
    });
    mapHandler(app, "GET", "/whoami", (context) => new Response(authCtx.getOptional(context)?.userId ?? "anonymous"));
    mapHandler(app, method, pattern, action(options));
    return app;
  }

  const pairOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .find((header) => header.startsWith("__session="))
      ?.split(";")[0] ?? null;

  async function stored(pair: string | null): Promise<{ id: string; data: Record<string, unknown> }> {
    const decoded = JSON.parse((await fakeSessionCookie.parse(pair ?? "")) ?? "null") as { i: string; d: [Record<string, unknown>] } | null;
    return { id: decoded?.i ?? "", data: decoded?.d[0] ?? {} };
  }

  const keyOf = async (token: unknown) => bytesToHex(await sha256(String(token)));

  /** A row for `userId` created out of band, as another browser's sign-in would have. */
  async function elsewhere(inner: AuthSessionStore, userId = "u9"): Promise<string> {
    const scratch = createCookieSessionStorage();
    const session = await scratch.read(null);
    await establishAuthSession(session, inner, userId, CLOCK, CLOCK, { kind: "email-otp" });
    return keyOf(session.get(AUTH_SESSION_TOKEN_KEY));
  }

  async function whoami(app: Forge, cookie: string | null): Promise<string> {
    return (await app.request("/whoami", { headers: { cookie: cookie ?? "" } })).text();
  }

  const answerOf = async (res: Response) => ({ status: res.status, body: await res.text() });

  describe("signing in", () => {
    const completing = {
      signin: fakeAuthSigninFlow({
        complete: async () => ok({ user: signedIn, kind: "email-otp" as const, resolution: { status: "satisfied" as const } }),
      }),
    };
    const verify = (options: AuthWebOptions) => createVerifyActions(options).submit;

    it("creates exactly one row for the user, keyed by the SHA-256 of the token the response's session carries, which then resolves", async () => {
      const { sessions, rows } = rowStore();
      const app = rowApp(sessions, completing, "POST", "/auth/verify", verify);
      const pending = pairOf(await app.request("/seed?pending=grace%40example.com", { method: "POST" }));

      const res = await app.request("/auth/verify", {
        ...formBody({ code: "123456" }),
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: pending ?? "" },
      });
      const token = (await stored(pairOf(res))).data[AUTH_SESSION_TOKEN_KEY];

      const held = [...rows].map(([key, { id: _id, ...row }]) => [key, row]);
      expect({ status: res.status, rows: held, who: await whoami(app, pairOf(res)) }).toEqual({
        status: 303,
        rows: [
          [
            await keyOf(token),
            {
              userId: "u9",
              signedInAt: CLOCK,
              expiresAt: CLOCK + AUTH_SESSION_MAX_MS,
              lastSeenAt: CLOCK,
              stepUpAt: CLOCK,
              stepUpKind: "email-otp",
              device: null,
            },
          ],
        ],
        who: "u9",
      });
    });

    it("labels the row with the coarse browser and platform the sign-in came from, never the user agent itself", async () => {
      const { sessions, rows } = rowStore();
      const app = rowApp(sessions, completing, "POST", "/auth/verify", verify);
      const pending = pairOf(await app.request("/seed?pending=grace%40example.com", { method: "POST" }));
      const agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0";

      await app.request("/auth/verify", {
        ...formBody({ code: "123456" }),
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: pending ?? "", "user-agent": agent },
      });

      expect([...rows.values()].map((row) => [row.device, JSON.stringify(row).includes("Gecko")])).toEqual([["Firefox on macOS", false]]);
    });

    it("tells nobody of a sign-in that lands", async () => {
      const { sessions, rows } = rowStore();
      const notices = fakeSecurityNotices();
      const app = rowApp(sessions, { ...completing, notices }, "POST", "/auth/verify", verify);
      const pending = pairOf(await app.request("/seed?pending=grace%40example.com", { method: "POST" }));

      const res = await app.request("/auth/verify", {
        ...formBody({ code: "123456" }),
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: pending ?? "" },
      });

      expect({ status: res.status, rows: rows.size, sent: notices.sent }).toEqual({ status: 303, rows: 1, sent: [] });
    });

    it("answers 503 when the row cannot be created, creating none and leaving the visitor's session holding no token", async () => {
      const { sessions, rows } = rowStore(["create"]);
      const app = rowApp(sessions, completing, "POST", "/auth/verify", verify);
      const pending = pairOf(await app.request("/seed?pending=grace%40example.com", { method: "POST" }));

      const res = await app.request("/auth/verify", {
        ...formBody({ code: "123456" }),
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: pending ?? "" },
      });
      const held = await stored(pairOf(res) ?? pending);

      expect({
        answer: await answerOf(res),
        rows: rows.size,
        token: held.data[AUTH_SESSION_TOKEN_KEY],
        pending: held.data[AUTH_PENDING_SIGNIN_SESSION_KEY],
      }).toEqual({ answer: { status: 503, body: "Service Unavailable" }, rows: 0, token: undefined, pending: "grace@example.com" });
    });
  });

  describe("signing out", () => {
    const signout = (options: AuthWebOptions) => createSignoutActions(options).signout;

    it("deletes the row and rotates the session, so the cookie held before it, replayed, resolves anonymous", async () => {
      const { sessions, rows } = rowStore();
      const app = rowApp(sessions, {}, "POST", "/auth/signout", signout);
      const held = pairOf(await app.request("/seed", { method: "POST" }));
      const before = await whoami(app, held);

      const res = await app.request("/auth/signout", { method: "POST", headers: { cookie: held ?? "" } });

      expect({
        before,
        status: res.status,
        location: res.headers.get("location"),
        rows: rows.size,
        rotated: (await stored(pairOf(res))).id !== (await stored(held)).id,
        replayed: await whoami(app, held),
      }).toEqual({ before: "u9", status: 303, location: "/auth/signin", rows: 0, rotated: true, replayed: "anonymous" });
    });

    it("answers 503 when the row cannot be deleted, keeping the row and the session as they were so the visitor can retry", async () => {
      const { sessions, rows } = rowStore(["remove"]);
      const app = rowApp(sessions, {}, "POST", "/auth/signout", signout);
      const held = pairOf(await app.request("/seed", { method: "POST" }));

      const res = await app.request("/auth/signout", { method: "POST", headers: { cookie: held ?? "" } });

      expect({ answer: await answerOf(res), cookie: pairOf(res), rows: rows.size, still: await whoami(app, held) }).toEqual({
        answer: { status: 503, body: "Service Unavailable" },
        cookie: null,
        rows: 1,
        still: "u9",
      });
    });
  });

  describe("removing a factor signs every other session out", () => {
    /** A credential store holding one passkey for `u9`, whose removal revokes over `inner`'s rows in one all-or-nothing step, as the D1 batch does. */
    function passkeyStore(inner: ReturnType<typeof rowStore>["inner"], failing: { revoke: boolean }) {
      const held = new Set(["c1"]);
      const credentials: CredentialStore = {
        ...fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" })]),
        listByUser: async (userId) => ok(held.has("c1") && userId === "u9" ? [fakeAuthCredential({ id: "c1", userId: "u9" })] : []),
        removeForUser: async (id, userId, _at, origin) => {
          if (failing.revoke) return err(new AuthStoreError("unavailable", "credentials.removeForUser"));
          if (!held.has(id) || userId !== "u9" || origin.keep === null) return ok("not-found" as const);
          held.delete(id);
          await inner.revokeOthers(userId, CLOCK, origin);
          return ok("changed" as const);
        },
      };
      return { credentials, held };
    }
    const passkeyServices = (credentials: CredentialStore): Partial<AuthRequestServices> => ({
      users: fakeAuthUserStore([signedIn]),
      credentials,
      factors: fakeFactorRegistry(["passkey"]),
    });
    /** An enrolment store whose removal of the confirmed `totp-app` row revokes over `inner`'s rows in one all-or-nothing step, as the D1 batch does. */
    function totpServices(inner: ReturnType<typeof rowStore>["inner"], failing = false): Partial<AuthRequestServices> {
      const enrolled = fakeFactorStore(["totp-app"]);
      const totp = {
        ...fakeFactorService("totp-app"),
        listEnrolments: async (userId: string) => enrolled.listByUser(userId),
      } as AuthSecondFactorService;
      return {
        users: fakeAuthUserStore([signedIn]),
        enrolments: {
          ...enrolled,
          remove: async (_id, userId, at, origin) => {
            if (failing) return err(new AuthStoreError("unavailable", "factors.remove"));
            await inner.revokeOthers(userId, at, origin);
            return ok("changed" as const);
          },
        },
        factors: createFactorRegistry(enrolled, { primary: fakeFactorService("email-otp"), second: fakeSecondFactorOffering([totp]) }),
      };
    }
    const passkeyRemove = (options: AuthWebOptions) => createPasskeyManageActions(options).passkeyRemove;

    it("deletes every other row the user holds on removing a passkey, spares the acting one and another user's, and keeps the visitor signed in", async () => {
      const { sessions, inner, rows } = rowStore();
      const { credentials, held } = passkeyStore(inner, { revoke: false });
      const app = rowApp(sessions, passkeyServices(credentials), "DELETE", "/account/passkeys/:id", passkeyRemove);
      const cookie = pairOf(await app.request("/seed", { method: "POST" }));
      await elsewhere(inner);
      await elsewhere(inner);
      const others = await elsewhere(inner, OTHER);

      const res = await app.request("/account/passkeys/c1", { method: "DELETE", headers: { cookie: cookie ?? "" } });

      expect({ status: res.status, held: [...held], rows: [...rows.keys()].sort(), still: await whoami(app, cookie) }).toEqual({
        status: 200,
        held: [],
        rows: [await keyOf((await stored(cookie)).data[AUTH_SESSION_TOKEN_KEY]), others].sort(),
        still: "u9",
      });
    });

    it("answers 404 for a passkey another user holds, asking the store as the visitor and signing out no session of either user", async () => {
      const { sessions, inner, rows } = rowStore();
      const asked: string[][] = [];
      const credentials: CredentialStore = {
        ...fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" }), fakeAuthCredential({ id: "c2", userId: OTHER })]),
        removeForUser: async (id, userId, _at, origin) => {
          asked.push([id, userId, bytesToHex(origin.keep ?? new Uint8Array())]);
          return ok("not-found" as const);
        },
      };
      const app = rowApp(sessions, passkeyServices(credentials), "DELETE", "/account/passkeys/:id", passkeyRemove);
      const cookie = pairOf(await app.request("/seed", { method: "POST" }));
      const acting = await keyOf((await stored(cookie)).data[AUTH_SESSION_TOKEN_KEY]);
      const before = [acting, await elsewhere(inner), await elsewhere(inner, OTHER)].sort();

      const res = await app.request("/account/passkeys/c2", { method: "DELETE", headers: { cookie: cookie ?? "" } });

      expect({ answer: await answerOf(res), asked, rows: [...rows.keys()].sort() }).toEqual({
        answer: { status: 404, body: "Not Found" },
        asked: [["c2", "u9", acting]],
        rows: before,
      });
    });

    it("keeps the passkey and every session when the revoke fails, and a retry then removes both", async () => {
      const { sessions, inner, rows } = rowStore();
      const failing = { revoke: true };
      const { credentials, held } = passkeyStore(inner, failing);
      const app = rowApp(sessions, passkeyServices(credentials), "DELETE", "/account/passkeys/:id", passkeyRemove);
      const cookie = pairOf(await app.request("/seed", { method: "POST" }));
      const acting = await keyOf((await stored(cookie)).data[AUTH_SESSION_TOKEN_KEY]);
      const other = await elsewhere(inner);

      const refused = await app.request("/account/passkeys/c1", { method: "DELETE", headers: { cookie: cookie ?? "" } });
      const afterRefusal = { answer: await answerOf(refused), held: [...held], rows: [...rows.keys()].sort() };
      failing.revoke = false;
      const retried = await app.request("/account/passkeys/c1", { method: "DELETE", headers: { cookie: cookie ?? "" } });

      expect({ afterRefusal, retried: { status: retried.status, held: [...held], rows: [...rows.keys()] } }).toEqual({
        afterRefusal: { answer: { status: 503, body: "Service Unavailable" }, held: ["c1"], rows: [acting, other].sort() },
        retried: { status: 200, held: [], rows: [acting] },
      });
    });

    it("deletes every other row the user holds on removing the authenticator app, spares the acting one and another user's, and keeps the visitor signed in", async () => {
      const { sessions, inner, rows } = rowStore();
      const app = rowApp(sessions, totpServices(inner), "DELETE", "/account/totp", (options) => createTotpManageActions(options).totpRemove);
      const held = pairOf(await app.request("/seed", { method: "POST" }));
      await elsewhere(inner);
      await elsewhere(inner);
      const others = await elsewhere(inner, OTHER);

      const res = await app.request("/account/totp", { method: "DELETE", headers: { cookie: held ?? "" } });

      expect({
        answer: { status: res.status, location: res.headers.get("location") },
        rows: [...rows.keys()].sort(),
        still: await whoami(app, held),
      }).toEqual({
        answer: { status: 303, location: "/account/totp" },
        rows: [await keyOf((await stored(held)).data[AUTH_SESSION_TOKEN_KEY]), others].sort(),
        still: "u9",
      });
    });

    it("answers 503 on removing the authenticator app when its removal batch fails, signing no session out", async () => {
      const { sessions, inner, rows } = rowStore();
      const app = rowApp(sessions, totpServices(inner, true), "DELETE", "/account/totp", (options) => createTotpManageActions(options).totpRemove);
      const held = pairOf(await app.request("/seed", { method: "POST" }));
      await elsewhere(inner);

      const res = await app.request("/account/totp", { method: "DELETE", headers: { cookie: held ?? "" } });

      expect({ answer: await answerOf(res), rows: rows.size }).toEqual({ answer: { status: 503, body: "Service Unavailable" }, rows: 2 });
    });
  });

  describe("the session list's sign-outs", () => {
    const services: Partial<AuthRequestServices> = { users: fakeAuthUserStore([signedIn]) };
    const revoke = (options: AuthWebOptions) => createSessionActions(options).sessionRevoke;
    const revokeOthers = (options: AuthWebOptions) => createSessionActions(options).sessionsRevokeOthers;
    const posted = (fields: Record<string, string>, cookie: string | null): RequestInit => ({
      ...formBody(fields),
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie ?? "" },
    });

    it("signs out everywhere else, leaving only the acting session and another user's, and keeps the visitor signed in", async () => {
      const { sessions, inner, rows } = rowStore();
      const app = rowApp(sessions, services, "POST", "/account/sessions/revoke-others", revokeOthers);
      const cookie = pairOf(await app.request("/seed", { method: "POST" }));
      await elsewhere(inner);
      await elsewhere(inner);
      const others = await elsewhere(inner, OTHER);

      const res = await app.request("/account/sessions/revoke-others", posted({}, cookie));

      expect({
        answer: { status: res.status, location: res.headers.get("location") },
        rows: [...rows.keys()].sort(),
        still: await whoami(app, cookie),
      }).toEqual({
        answer: { status: 303, location: "/account/sessions" },
        rows: [await keyOf((await stored(cookie)).data[AUTH_SESSION_TOKEN_KEY]), others].sort(),
        still: "u9",
      });
    });

    it("signs out the one session the form names, and nothing else", async () => {
      const { sessions, inner, rows } = rowStore();
      const app = rowApp(sessions, services, "POST", "/account/sessions/revoke", revoke);
      const cookie = pairOf(await app.request("/seed", { method: "POST" }));
      const doomed = await elsewhere(inner);
      const spared = await elsewhere(inner);

      const res = await app.request("/account/sessions/revoke", posted({ session: rows.get(doomed)?.id ?? "" }, cookie));

      expect({ status: res.status, rows: [...rows.keys()].sort() }).toEqual({
        status: 303,
        rows: [await keyOf((await stored(cookie)).data[AUTH_SESSION_TOKEN_KEY]), spared].sort(),
      });
    });

    it("answers 404 for the acting session's own id and for another user's, signing nothing out", async () => {
      const { sessions, inner, rows } = rowStore();
      const app = rowApp(sessions, services, "POST", "/account/sessions/revoke", revoke);
      const cookie = pairOf(await app.request("/seed", { method: "POST" }));
      const acting = await keyOf((await stored(cookie)).data[AUTH_SESSION_TOKEN_KEY]);
      const theirs = await elsewhere(inner, OTHER);

      const own = await app.request("/account/sessions/revoke", posted({ session: rows.get(acting)?.id ?? "" }, cookie));
      const other = await app.request("/account/sessions/revoke", posted({ session: rows.get(theirs)?.id ?? "" }, cookie));

      expect({ statuses: [own.status, other.status], rows: rows.size }).toEqual({ statuses: [404, 404], rows: 2 });
    });

    it("refuses a session field that is not a UUID with 422, asking the store nothing", async () => {
      const { sessions, inner, rows } = rowStore(["revoke"]);
      const app = rowApp(sessions, services, "POST", "/account/sessions/revoke", revoke);
      const cookie = pairOf(await app.request("/seed", { method: "POST" }));
      await elsewhere(inner);

      const res = await app.request("/account/sessions/revoke", posted({ session: "not-a-session" }, cookie));

      expect({ status: res.status, rows: rows.size }).toEqual({ status: 422, rows: 2 });
    });

    it("tells nobody of signing one session out or every other one", async () => {
      const { sessions, inner, rows } = rowStore();
      const notices = fakeSecurityNotices();
      const one = rowApp(sessions, { ...services, notices }, "POST", "/account/sessions/revoke", revoke);
      const all = rowApp(sessions, { ...services, notices }, "POST", "/account/sessions/revoke-others", revokeOthers);
      const cookie = pairOf(await one.request("/seed", { method: "POST" }));
      const doomed = await elsewhere(inner);
      await elsewhere(inner);

      const statuses = [
        (await one.request("/account/sessions/revoke", posted({ session: rows.get(doomed)?.id ?? "" }, cookie))).status,
        (await all.request("/account/sessions/revoke-others", posted({}, cookie))).status,
      ];

      expect({ statuses, left: rows.size, sent: notices.sent }).toEqual({ statuses: [303, 303], left: 1, sent: [] });
    });

    it("answers 503 when either store write fails", async () => {
      const { sessions } = rowStore(["revoke", "revokeOthers"]);
      const one = rowApp(sessions, services, "POST", "/account/sessions/revoke", revoke);
      const all = rowApp(sessions, services, "POST", "/account/sessions/revoke-others", revokeOthers);
      const cookie = pairOf(await one.request("/seed", { method: "POST" }));

      const answers = [
        await answerOf(await one.request("/account/sessions/revoke", posted({ session: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, cookie))),
        await answerOf(await all.request("/account/sessions/revoke-others", posted({}, cookie))),
      ];

      expect(answers).toEqual([
        { status: 503, body: "Service Unavailable" },
        { status: 503, body: "Service Unavailable" },
      ]);
    });
  });

  describe("a step-up lands on the row", () => {
    const stepUpServices: Partial<AuthRequestServices> = {
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore(["totp-app"]), {
        primary: fakeFactorService("email-otp"),
        second: fakeSecondFactorOffering([fakeFactorService("totp-app")]),
      }),
      signin: fakeAuthSigninFlow({ stepUp: async () => ok({ kind: "totp-app" as const, userId: "u9", verifiedAt: CLOCK }) }),
    };
    const passkey = {
      ...fakeFactorService("passkey"),
      verifyChallenge: async (userId: string, _presented: string, at: number) => ok({ kind: "passkey" as const, userId, verifiedAt: at }),
    } as AuthSecondFactorService;
    const passkeyServices: Partial<AuthRequestServices> = {
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore(["passkey"]), {
        primary: fakeFactorService("email-otp"),
        second: fakeSecondFactorOffering([passkey]),
      }),
    };
    const steps = [
      {
        via: "a verified code",
        services: stepUpServices,
        pattern: "/auth/verify",
        init: formBody({ code: "123456" }),
        action: (options: AuthWebOptions) => createVerifyActions(options).submit,
        status: 303,
        refusal: { status: 503, body: "Service Unavailable" },
      },
      {
        via: "a verified passkey assertion",
        services: passkeyServices,
        pattern: "/auth/verify/passkey/finish",
        init: jsonBody(assertion),
        action: (options: AuthWebOptions) => createPasskeyStepUpActions(options).finish,
        status: 200,
        refusal: { status: 503, body: JSON.stringify({ error: "The passkey service is unavailable." }) },
      },
    ] as const;

    for (const { via, services, pattern, init, action, status, refusal } of steps) {
      it(`moves the row onto a new token carrying the step-up on ${via}, so the token held before it no longer resolves`, async () => {
        const { sessions, rows } = rowStore();
        const app = rowApp(sessions, services, "POST", pattern, action);
        const held = pairOf(await app.request("/seed", { method: "POST" }));
        const before = (await stored(held)).data[AUTH_SESSION_TOKEN_KEY];

        const res = await app.request(pattern, { ...init, headers: { ...(init.headers as Record<string, string>), cookie: held ?? "" } });
        const after = (await stored(pairOf(res))).data[AUTH_SESSION_TOKEN_KEY];

        expect({
          status: res.status,
          rotated: typeof after === "string" && after !== before,
          rows: [...rows].map(([key, row]) => [key, row.stepUpAt]),
          previous: await sessions.resolve(await sha256(String(before)), CLOCK),
        }).toEqual({ status, rotated: true, rows: [[await keyOf(after), CLOCK]], previous: ok(null) });
      });

      it(`answers ${via} with 503 when the row cannot take the step-up`, async () => {
        const { sessions, rows } = rowStore(["rotate"]);
        const app = rowApp(sessions, services, "POST", pattern, action);
        const held = pairOf(await app.request("/seed", { method: "POST" }));

        const res = await app.request(pattern, { ...init, headers: { ...(init.headers as Record<string, string>), cookie: held ?? "" } });

        expect({ answer: await answerOf(res), stepUps: [...rows.values()].map((row) => row.stepUpAt) }).toEqual({
          answer: refusal,
          stepUps: [null],
        });
      });
    }

    const kindCases = [
      ...(["email-otp", "totp-app", "recovery-code"] as const).map((kind) => ({
        kind,
        services: { ...stepUpServices, signin: fakeAuthSigninFlow({ stepUp: async () => ok({ kind, userId: "u9", verifiedAt: CLOCK }) }) },
        pattern: "/auth/verify",
        url: "/auth/verify?factor=totp-app",
        init: formBody({ code: "123456" }),
        action: (options: AuthWebOptions) => createVerifyActions(options).submit,
        status: 303,
      })),
      {
        kind: "passkey" as const,
        services: passkeyServices,
        pattern: "/auth/verify/passkey/finish",
        url: "/auth/verify/passkey/finish",
        init: jsonBody(assertion),
        action: (options: AuthWebOptions) => createPasskeyStepUpActions(options).finish,
        status: 200,
      },
    ];

    for (const { kind, services, pattern, url, init, action, status } of kindCases) {
      it(`records ${kind} as the kind a step-up by ${kind} verified with, whatever kind the URL asked for`, async () => {
        const { sessions } = rowStore();
        const app = rowApp(sessions, services, "POST", pattern, action);
        const held = pairOf(await app.request("/seed", { method: "POST" }));

        const res = await app.request(url, { ...init, headers: { ...(init.headers as Record<string, string>), cookie: held ?? "" } });
        const after = await createCookieSessionStorage().read(null);
        after.set(AUTH_SESSION_TOKEN_KEY, (await stored(pairOf(res))).data[AUTH_SESSION_TOKEN_KEY]);
        const resolved = await resolveAuthIdentity(after, sessions, CLOCK);
        const identity = resolved.ok ? resolved.data : null;

        expect({ status: res.status, stepUpAt: identity?.stepUpAt, stepUpKind: identity?.stepUpKind }).toEqual({
          status,
          stepUpAt: CLOCK,
          stepUpKind: kind,
        });
      });
    }
  });

  describe("a single-factor re-proof through the resend action", () => {
    /** A real sign-in flow over an emailed-code primary on a settable clock, behind `resolveAuth`, with a cookie jar and one guarded mutation. */
    async function reproofScene() {
      let clock = CLOCK;
      const now = () => clock;
      const sent: AuthMessage[] = [];
      const codes = new Map<string, OtpState & { readonly binding: string }>();
      const live = (userId: string, at: number, binding: Uint8Array) => {
        const held = codes.get(userId);
        return held !== undefined && held.expiresAt > at && held.binding === bytesToHex(binding) ? held : undefined;
      };
      const state: OtpStateStore = {
        issue: async (userId, code, cooldownMs, binding) => {
          const held = codes.get(userId);
          if (held !== undefined && held.issuedAt > code.issuedAt - cooldownMs) return ok(false);
          codes.set(userId, { ...code, attempts: held?.attempts ?? 0, binding: bytesToHex(binding) });
          return ok(true);
        },
        countAttempt: async (userId, maxAttempts, at, _windowMs, binding) => {
          const held = live(userId, at, binding);
          if (held === undefined || held.attempts >= maxAttempts) return ok(null);
          const spent = { ...held, attempts: held.attempts + 1 };
          codes.set(userId, spent);
          return ok(spent);
        },
        read: async (userId, at, binding) => ok(live(userId, at, binding) ?? null),
        discard: async () => ok(),
        clear: async (userId) => (codes.delete(userId), ok()),
      };
      const consumed = new Set<string>();
      const nonces = {
        markConsumed: async (key: string) => {
          if (consumed.has(key)) return ok(false);
          consumed.add(key);
          return ok(true);
        },
      };
      const keys = await importAuthKeyRing(["17bd3b2b6521b7cfde60fad521de43d2860704680c51641152e6e05aa786d162"]);
      const notifier = { send: async (message: AuthMessage) => (sent.push(message), ok()) };
      const emailOtp = createEmailOtpFactor({ keys, state, nonces, notifier, address: async () => ok(signedIn.email) });
      const users = fakeAuthUserStore([signedIn]);
      const factors = createFactorRegistry(fakeFactorStore([]), { primary: emailOtp });
      const sessions = fakeAuthSessionStore([signedIn]);
      const signin = createSigninFlow({ keys, users, state, nonces, factors, defer: () => undefined });
      const services = fakeAuthServices({ users, factors, signin, sessions });
      const options = fakeAuthWebOptions({ resolveServices: () => services, now });

      const app = new Forge();
      app.use("*", sessionMiddleware(createCookieSessionStorage(), fakeSessionCookie));
      app.use("*", resolveAuth({ sessions: () => sessions, now }));
      app.use("*", (context, next) => {
        csrfMinterCtx.set(context, (path) => Promise.resolve(`csrf-for:${path}`));
        csrfFieldCtx.set(context, "_csrf");
        return next();
      });
      mapHandler(app, "POST", "/seed", async (context) => {
        await establishAuthSession(sessionCtx.get(context), sessions, "u9", clock, clock, { kind: "email-otp" });
        return new Response("seeded");
      });
      const verify = createVerifyActions(options);
      mapHandler(app, "POST", "/auth/verify/resend", verify.resend);
      mapHandler(app, "POST", "/auth/verify", verify.submit);
      const fresh = requireFreshStepUp({
        factors: () => factors,
        enrolmentPaths: { kinds: {} },
        stepUpPath: "/auth/verify",
        settledPath: "/account",
        now,
      });
      mapHandler(app, "POST", "/account/email", { middleware: [fresh], handler: () => new Response("changed") });

      const browser = async () => {
        let cookie = "";
        const send = async (path: string, init: RequestInit = { method: "POST" }) => {
          const res = await app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), cookie } });
          cookie = pairOf(res) ?? cookie;
          return res;
        };
        await send("/seed");
        return send;
      };
      return { send: await browser(), browser, sent, advance: (ms: number) => void (clock += ms) };
    }

    const lastCode = (sent: readonly AuthMessage[]) => {
      const last = sent.at(-1);
      return last?.kind === "otp" ? last.code : "";
    };

    it("mails exactly one code, and presenting it lets a guarded mutation through that was refused before", async () => {
      const { send, sent } = await reproofScene();
      const before = await send("/account/email");
      const resent = await send("/auth/verify/resend");
      const mailed = sent.length;
      const verified = await send("/auth/verify", {
        method: "POST",
        body: new URLSearchParams({ code: lastCode(sent) }).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      const after = await send("/account/email");

      expect({
        before: { status: before.status, location: before.headers.get("location") },
        resent: resent.status,
        mailed,
        to: sent.map((message) => message.to),
        verified: verified.status,
        after: { status: after.status, body: await after.text() },
      }).toEqual({
        before: { status: 303, location: "/auth/verify" },
        resent: 303,
        mailed: 1,
        to: [signedIn.email],
        verified: 303,
        after: { status: 200, body: "changed" },
      });
    });

    it("refuses the code in another browser of the same account, which leaves the asking browser its whole budget", async () => {
      const { send, browser, sent } = await reproofScene();
      const other = await browser();
      const submit = (from: typeof send, code: string) =>
        from("/auth/verify", {
          method: "POST",
          body: new URLSearchParams({ code }).toString(),
          headers: { "content-type": "application/x-www-form-urlencoded" },
        });
      await send("/auth/verify/resend");
      const code = lastCode(sent);
      const wrong = code === "000000" ? "111111" : "000000";

      const foreign: number[] = [];
      for (let ordinal = 0; ordinal <= AUTH_OTP_MAX_ATTEMPTS; ordinal++) foreign.push((await submit(other, code)).status);
      const own: number[] = [];
      for (let ordinal = 1; ordinal < AUTH_OTP_MAX_ATTEMPTS; ordinal++) own.push((await submit(send, wrong)).status);
      const right = await submit(send, code);
      const after = await send("/account/email");

      expect({ foreign, own, right: right.status, after: after.status, otherAfter: (await other("/account/email")).status }).toEqual({
        foreign: Array.from({ length: AUTH_OTP_MAX_ATTEMPTS + 1 }, () => 422),
        own: Array.from({ length: AUTH_OTP_MAX_ATTEMPTS - 1 }, () => 422),
        right: 303,
        after: 200,
        otherAfter: 303,
      });
    });

    it("mails again once the default minute's cooldown has run, and not the millisecond before", async () => {
      const { send, sent, advance } = await reproofScene();
      const counts: number[] = [];
      for (const wait of [0, 59_999, 1]) {
        advance(wait);
        await send("/auth/verify/resend");
        counts.push(sent.length);
      }
      expect(counts).toEqual([1, 1, 2]);
    });
  });

  describe("an admin claim moves the row onto a new token", () => {
    const claim = (options: AuthWebOptions): TestAction => ({
      middleware: [approvedSession(), requireApproval(fakeApproval())],
      handler: createAdminElevateActions(options).submit,
    });

    /** An admin store whose claim and rotation land together or not at all, as the D1 batch does, over `users` and `inner`'s rows. */
    function claimingStore(users: AuthUser[], inner: AuthSessionStore, failing: { rotation: boolean }): AdminUserStore {
      return fakeAdminUserStore(users, {
        claimFirstAdmin: async (id, _at, rotation) => {
          if (failing.rotation) return err(new AuthStoreError("unavailable", "adminUsers.claimFirstAdmin"));
          const index = users.findIndex((user) => user.id === id);
          const user = users[index];
          if (user === undefined) return ok("not-found" as const);
          users[index] = { ...user, isAdmin: true };
          if (rotation !== undefined) await inner.rotate(rotation.replaces, rotation.tokenHash);
          return ok("changed" as const);
        },
      });
    }

    async function claimScene(failing: { rotation: boolean }) {
      const users = [signedIn];
      const inner = fakeAuthSessionStore(users);
      const app = rowApp(
        inner,
        { users: fakeAuthUserStore([signedIn]), admin: claimingStore(users, inner, failing) },
        "POST",
        "/admin/elevate",
        claim,
      );
      const held = pairOf(await app.request("/seed", { method: "POST" }));
      const before = (await stored(held)).data[AUTH_SESSION_TOKEN_KEY];
      const res = await app.request("/admin/elevate", {
        ...formBody({ confirm: "yes" }),
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: held ?? "" },
      });
      return { users, inner, res, before };
    }

    it("retires the token held before the claim and sets a cookie carrying a different one that resolves", async () => {
      const { inner, res, before } = await claimScene({ rotation: false });
      const after = (await stored(pairOf(res))).data[AUTH_SESSION_TOKEN_KEY];
      const resolved = await inner.resolve(await sha256(String(after)), CLOCK);

      expect({
        answer: { status: res.status, location: res.headers.get("location") },
        rotated: typeof after === "string" && after !== before,
        previous: await inner.resolve(await sha256(String(before)), CLOCK),
        elevated: resolved.ok && resolved.data?.user.isAdmin,
      }).toEqual({ answer: { status: 303, location: "/admin/users" }, rotated: true, previous: ok(null), elevated: true });
    });

    it("lands no claim when the rotation fails, so the token held before it still resolves to an unelevated session", async () => {
      const { users, inner, res, before } = await claimScene({ rotation: true });
      const resolved = await inner.resolve(await sha256(String(before)), CLOCK);

      expect({
        answer: await answerOf(res),
        admin: users.map((user) => user.isAdmin),
        previous: resolved.ok && resolved.data ? { userId: resolved.data.user.id, isAdmin: resolved.data.user.isAdmin } : null,
      }).toEqual({ answer: { status: 503, body: "Service Unavailable" }, admin: [false], previous: { userId: "u9", isAdmin: false } });
    });

    it("leaves the session on the token it held when the claim arrives second, so a refused claim signs nobody out", async () => {
      const users = [signedIn];
      const inner = fakeAuthSessionStore(users);
      const admin = fakeAdminUserStore(users, { claimFirstAdmin: async () => ok("admin-exists" as const) });
      const app = rowApp(inner, { users: fakeAuthUserStore([signedIn]), admin }, "POST", "/admin/elevate", claim);
      const held = pairOf(await app.request("/seed", { method: "POST" }));
      const before = (await stored(held)).data[AUTH_SESSION_TOKEN_KEY];

      const res = await app.request("/admin/elevate", {
        ...formBody({ confirm: "yes" }),
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: held ?? "" },
      });
      const after = (await stored(pairOf(res) ?? held)).data[AUTH_SESSION_TOKEN_KEY];
      const resolved = await inner.resolve(await sha256(String(before)), CLOCK);

      expect({ status: res.status, token: after === before, previous: resolved.ok && resolved.data?.user.id }).toEqual({
        status: 409,
        token: true,
        previous: "u9",
      });
    });
  });
});

describe("the security notice each account-changing action sends", () => {
  const member = fakeAuthUser({ id: "u2", email: "member@example.com" });
  const confirmed = (kind: AuthFactorKind): AuthFactor => ({
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
  const offering = (service: AuthSecondFactorService) =>
    createFactorRegistry(fakeFactorStore([service.kind]), { primary: fakeFactorService("email-otp"), second: fakeSecondFactorOffering([service]) });

  function adminUpdate(target: AuthUser, outcome: AdminUserOutcome = "changed") {
    const notices = fakeSecurityNotices();
    const actors: string[] = [];
    const recorded = async (_id: string, _flag: boolean, _at: number, adminId: string) => (actors.push(adminId), ok(outcome));
    const admin = fakeAdminUserStore([target], { setAdmin: recorded, setDeactivated: recorded });
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin, notices });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);
    return { app, notices, actors };
  }

  for (const { name, target, form, type } of [
    { name: "a grant", target: member, form: { role: "admin", status: "active" }, type: "admin-granted" },
    { name: "a revocation", target: { ...member, isAdmin: true }, form: { role: "member", status: "active" }, type: "admin-revoked" },
    { name: "a deactivation", target: member, form: { role: "member", status: "deactivated" }, type: "account-deactivated" },
    { name: "a reactivation", target: { ...member, deactivatedAt: 1 }, form: { role: "member", status: "active" }, type: "account-reactivated" },
  ] as const) {
    it(`records the acting administrator on ${name} and tells the account's own address`, async () => {
      const { app, notices, actors } = adminUpdate(target);
      await app.request("/admin/users/u2", formBody(form, "PATCH"));
      expect({ actors, sent: notices.sent }).toEqual({
        actors: ["u9"],
        sent: [{ to: "member@example.com", notice: { type, factorKind: null, at: 1_000 } }],
      });
    });
  }

  it("tells nobody of a role or status write that found the account already so, still answering it as done", async () => {
    const deactivated = adminUpdate(member, "unchanged");
    const deactivate = await deactivated.app.request("/admin/users/u2", formBody({ role: "member", status: "deactivated" }, "PATCH"));
    const granted = adminUpdate(member, "unchanged");
    const grant = await granted.app.request("/admin/users/u2", formBody({ role: "admin", status: "active" }, "PATCH"));
    expect({ statuses: [deactivate.status, grant.status], sent: [...deactivated.notices.sent, ...granted.notices.sent] }).toEqual({
      statuses: [200, 200],
      sent: [],
    });
  });

  it("tells nobody of a role or status change the last-admin guard refused", async () => {
    const demoted = adminUpdate({ ...member, isAdmin: true }, "last-admin-demote");
    await demoted.app.request("/admin/users/u2", formBody({ role: "member", status: "active" }, "PATCH"));
    const deactivated = adminUpdate(member, "last-admin-deactivate");
    await deactivated.app.request("/admin/users/u2", formBody({ role: "member", status: "deactivated" }, "PATCH"));
    expect([demoted.notices.sent, deactivated.notices.sent]).toEqual([[], []]);
  });

  it("tells the claimant's own address of a landed first-admin claim, and nobody of a refused one", async () => {
    const claimed = fakeSecurityNotices();
    const claimOptions = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserStore([signedIn]), notices: claimed });
    await mounted(approved(actionApp({ userId: "u9" })), "POST", "/admin/elevate", createAdminElevateActions(claimOptions).submit).request(
      "/admin/elevate",
      formBody({ confirm: "yes" }),
    );
    const refused = fakeSecurityNotices();
    const existing = fakeAuthUser({ id: "u1", isAdmin: true });
    const refusedOptions = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserStore([existing]), notices: refused });
    await mounted(approved(actionApp({ userId: "u9" })), "POST", "/admin/elevate", createAdminElevateActions(refusedOptions).submit).request(
      "/admin/elevate",
      formBody({ confirm: "yes" }),
    );
    expect({ claimed: claimed.sent, refused: refused.sent }).toEqual({
      claimed: [{ to: "grace@example.com", notice: { type: "admin-granted", factorKind: null, at: 1_000 } }],
      refused: [],
    });
  });

  it("tells the holder a passkey was removed, and nobody when the passkey was not theirs", async () => {
    const notices = fakeSecurityNotices();
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      factors: fakeFactorRegistry(["passkey"]),
      credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" })]),
      notices,
    });
    const app = mounted(actionApp({ userId: "u9" }), "DELETE", "/account/passkeys/:id", createPasskeyManageActions(options).passkeyRemove);
    const statuses = [
      (await app.request("/account/passkeys/c1", { method: "DELETE" })).status,
      (await app.request("/account/passkeys/c9", { method: "DELETE" })).status,
    ];
    expect({ statuses, sent: notices.sent }).toEqual({
      statuses: [200, 404],
      sent: [{ to: "grace@example.com", notice: { type: "factor-removed", factorKind: "passkey", at: 1_000 } }],
    });
  });

  it("tells the holder a passkey was added once the ceremony finishes, and nobody when it is refused", async () => {
    const sentFor = async (completed: boolean) => {
      const notices = fakeSecurityNotices();
      const passkey = {
        ...fakeFactorService("passkey"),
        completeEnrolment: async () => (completed ? ok(confirmed("passkey")) : err("unrecognised" as const)),
      } as AuthSecondFactorService;
      const options = optionsWith({ users: fakeAuthUserStore([signedIn]), factors: offering(passkey), notices });
      const app = mounted(
        actionApp({ userId: "u9" }),
        "POST",
        "/account/passkeys/register/finish",
        createPasskeyAccountEnrolActions(options).finish,
      );
      await app.request("/account/passkeys/register/finish", jsonBody({ credential: { id: "c1" } }));
      return notices.sent;
    };
    expect({ finished: await sentFor(true), refused: await sentFor(false) }).toEqual({
      finished: [{ to: "grace@example.com", notice: { type: "factor-added", factorKind: "passkey", at: 1_000 } }],
      refused: [],
    });
  });

  it("tells the holder an authenticator app was added, from either enrolment page, and nobody when the code is refused", async () => {
    const sentFor = async (completed: boolean, actions: typeof createTotpEnrolActions | typeof createTotpManageActions) => {
      const notices = fakeSecurityNotices();
      const totp = {
        ...fakeFactorService("totp-app"),
        completeEnrolment: async () => (completed ? ok(confirmed("totp-app")) : err("unrecognised" as const)),
      } as AuthSecondFactorService;
      const options = optionsWith({ users: fakeAuthUserStore([signedIn]), factors: offering(totp), notices });
      const app = mounted(actionApp({ userId: "u9" }), "POST", "/totp", actions(options).totpEnrol);
      await app.request("/totp", formBody({ code: "123456" }));
      return notices.sent;
    };
    const added = [{ to: "grace@example.com", notice: { type: "factor-added", factorKind: "totp-app", at: 1_000 } }];
    expect([
      await sentFor(true, createTotpEnrolActions),
      await sentFor(true, createTotpManageActions),
      await sentFor(false, createTotpEnrolActions),
    ]).toEqual([added, added, []]);
  });

  it("tells the holder an authenticator app was removed, and nobody when there was none or only an unfinished one", async () => {
    const sentFor = async (held: readonly AuthFactor[]) => {
      const notices = fakeSecurityNotices();
      const totp = { ...fakeFactorService("totp-app"), listEnrolments: async () => ok(held) } as AuthSecondFactorService;
      const options = optionsWith({ users: fakeAuthUserStore([signedIn]), factors: offering(totp), notices });
      const app = mounted(actionApp({ userId: "u9" }), "DELETE", "/account/totp", createTotpManageActions(options).totpRemove);
      await app.request("/account/totp", { method: "DELETE" });
      return notices.sent;
    };
    expect({
      removed: await sentFor([confirmed("totp-app")]),
      unfinished: await sentFor([{ ...confirmed("totp-app"), confirmedAt: null }]),
      none: await sentFor([]),
    }).toEqual({
      removed: [{ to: "grace@example.com", notice: { type: "factor-removed", factorKind: "totp-app", at: 1_000 } }],
      unfinished: [],
      none: [],
    });
  });

  it("tells the holder a recovery code was spent on a step-up, and nobody for another factor's step-up or a refused code", async () => {
    const sentFor = async (stepUp: AuthSigninFlow["stepUp"]) => {
      const notices = fakeSecurityNotices();
      const options = optionsWith({
        users: fakeAuthUserStore([signedIn]),
        factors: offering(fakeFactorService("totp-app")),
        signin: fakeAuthSigninFlow({ stepUp }),
        notices,
      });
      const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/verify", createVerifyActions(options).submit);
      await app.request("/auth/verify", formBody({ code: "123456" }));
      return notices.sent;
    };
    expect({
      recovery: await sentFor(async (userId, _kind, _code, at) => ok({ kind: "recovery-code" as const, userId, verifiedAt: at })),
      totp: await sentFor(async (userId, kind, _code, at) => ok({ kind, userId, verifiedAt: at })),
      refused: await sentFor(async () => err("unrecognised" as const)),
    }).toEqual({
      recovery: [{ to: "grace@example.com", notice: { type: "recovery-code-used", factorKind: "recovery-code", at: 1_000 } }],
      totp: [],
      refused: [],
    });
  });
});

describe("every onward redirect a confirmed factor earns answers 503 when the factor demand goes unreadable after it", () => {
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

  /** A registry over `held` offering `kind`, whose demand stops reading from the moment the factor accepts what it was handed. */
  function goingDown(kind: "totp-app" | "passkey", held: readonly AuthFactorKind[]) {
    let down = false;
    const accepting = {
      ...fakeFactorService(kind),
      verifyChallenge: async (userId: string, _presented: string, at: number) => {
        down = true;
        return ok({ kind, userId, verifiedAt: at });
      },
      completeEnrolment: async () => {
        down = true;
        return ok(confirmedRow(kind));
      },
    } as AuthSecondFactorService;
    const registry = createFactorRegistry(fakeFactorStore(held), {
      primary: fakeFactorService("email-otp"),
      second: fakeSecondFactorOffering([accepting], [kind]),
    });
    const factors = {
      ...registry,
      resolve: (...args: Parameters<typeof registry.resolve>) =>
        down ? Promise.resolve(err(new AuthStoreError("unavailable", "factors.resolve"))) : registry.resolve(...args),
    };
    const signin = fakeAuthSigninFlow({
      stepUp: async (userId, stepped, _code, at) => {
        down = true;
        return ok({ kind: stepped, userId, verifiedAt: at });
      },
    });
    return optionsWith({ users: fakeAuthUserStore([signedIn]), factors, signin });
  }

  const PLAIN = { status: 503, body: "Service Unavailable" };
  const CEREMONY = { status: 503, body: JSON.stringify({ error: "The passkey service is unavailable." }) };

  const callers = [
    {
      label: "a step-up by passkey",
      route: "/auth/verify/passkey/finish",
      action: () => createPasskeyStepUpActions(goingDown("passkey", ["passkey", "recovery-code"])).finish,
      init: jsonBody({ credential: { id: "c", response: {} } }),
      expected: CEREMONY,
    },
    {
      label: "an owed passkey enrolment",
      route: "/auth/enrol/passkey/register/finish",
      action: () => createPasskeyEnrolActions(goingDown("passkey", [])).finish,
      init: jsonBody({ credential: { id: "cred-1" }, nickname: "Laptop" }),
      expected: CEREMONY,
    },
    {
      label: "a passkey enrolment from the account pages",
      route: "/account/passkeys/register/finish",
      action: () => createPasskeyAccountEnrolActions(goingDown("passkey", [])).finish,
      init: jsonBody({ credential: { id: "cred-1" }, nickname: "Laptop" }),
      expected: CEREMONY,
    },
    {
      label: "an owed authenticator-app enrolment",
      route: "/auth/enrol/totp",
      action: () => createTotpEnrolActions(goingDown("totp-app", [])).totpEnrol,
      init: formBody({ code: "123456" }),
      expected: PLAIN,
    },
    {
      label: "an authenticator-app enrolment from the account pages",
      route: "/account/totp",
      action: () => createTotpManageActions(goingDown("totp-app", [])).totpEnrol,
      init: formBody({ code: "123456" }),
      expected: PLAIN,
    },
  ] as const;

  for (const { label, route, action, init, expected } of callers) {
    it(`answers ${label} with 503 and no redirect`, async () => {
      const res = await mounted(actionApp({ userId: "u9" }), "POST", route, action()).request(route, init);
      expect({ answer: { status: res.status, body: await res.text() }, location: res.headers.get("location") }).toEqual({
        answer: expected,
        location: null,
      });
    });
  }
});

// The onward target reuses the resolution the demand already read, so the read left to fail is the code count.
describe("the verify POST's onward redirect after a step-up by code", () => {
  /** Options holding a confirmed authenticator app and recovery codes counted by `remaining`, with every read of the demand tallied in `reads`. */
  function steppingUp(remaining: RecoveryCodeFactorService["remaining"]) {
    const reads: string[] = [];
    const codes = Object.assign(fakeFactorService("recovery-code"), { remaining }) as RecoveryCodeFactorService;
    const registry = createFactorRegistry(fakeFactorStore(["totp-app", "recovery-code"]), {
      primary: fakeFactorService("email-otp"),
      second: fakeSecondFactorOffering(["totp-app"], ["totp-app"], codes),
    });
    const factors = {
      ...registry,
      resolve: (...args: Parameters<typeof registry.resolve>) => {
        reads.push(args[0]);
        return registry.resolve(...args);
      },
    };
    const signin = fakeAuthSigninFlow({ stepUp: async (userId, kind, _code, at) => ok({ kind, userId, verifiedAt: at }) });
    return { reads, options: optionsWith({ users: fakeAuthUserStore([signedIn]), factors, signin }) };
  }

  const answerTo = async (options: AuthWebOptions) => {
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/verify", createVerifyActions(options).submit);
    const res = await app.request("/auth/verify", formBody({ code: "123456" }));
    return { status: res.status, location: res.headers.get("location"), body: await res.text() };
  };

  it("answers 503 and no redirect when the recovery codes it would weigh cannot be counted", async () => {
    const { options } = steppingUp(async () => err(new AuthStoreError("unavailable", "codes.remaining")));
    expect(await answerTo(options)).toEqual({ status: 503, location: null, body: "Service Unavailable" });
  });

  it("redirects onward when the codes are counted, having read the factor demand once", async () => {
    const { reads, options } = steppingUp(async () => ok(10));
    const answer = await answerTo(options);
    expect({ status: answer.status, location: answer.location, reads }).toEqual({ status: 303, location: "/account/passkeys", reads: ["u9"] });
  });
});
