import { beforeAll, describe, expect, it } from "bun:test";

import { createCookie } from "@remix-run/cookie";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../../app/forge-app";
import { csrfMinterCtx } from "../../form/csrf";
import { csrfFieldCtx } from "../../form/csrf-context";
import { ok } from "../../result/result";
import { sessionCtx, sessionMiddleware } from "../../session/session";
import { mapHandler } from "../../testing/route";
import type { TestAction } from "../../testing/types";
import { createPasskeyFactor } from "../factors/passkey";
import { createFactorRegistry } from "../factors/registry";
import type { AuthFactorService } from "../factors/types";
import { createPasskeyKeyPair, fakePasskeyRegistration } from "../passkey/fixture";
import type { PasskeyKeyPair } from "../passkey/types";
import type { AuthChallenge, AuthCredential, ChallengeStore, CredentialStore, UserStore } from "../types";
import {
  createAdminElevateActions,
  createAdminUserActions,
  createEmailChangeActions,
  createPasskeyEnrolActions,
  createPasskeyManageActions,
  AUTH_CEREMONY_MAX_BYTES,
  createPasskeySigninActions,
  createSigninActions,
  createSignoutActions,
  createSignupActions,
  createTotpManageActions,
  createVerifyActions,
} from "./actions";
import { AUTH_PENDING_SIGNIN_SESSION_KEY, AUTH_SESSION_KEY, AUTH_STEP_UP_SESSION_KEY, authCtx } from "./identity";
import {
  attrOf,
  HOSTILE_TEXT,
  fakeAdminUserService,
  fakeAuthCredential,
  fakeAuthCredentialStore,
  fakeAuthEmailChangeFlow,
  fakeAuthServices,
  fakeAuthSigninFlow,
  fakeAuthUser,
  fakeAuthUserStore,
  fakeAuthWebOptions,
  fakeFactorService,
  fakeFactorStore,
} from "./test-support";
import type { AuthRequestServices, AuthWebOptions } from "./types";

const sessionCookie = createCookie("__session", { path: "/" });

interface Seed {
  readonly userId?: string;
  /** The address the seeded identity carries; the pages an action re-renders name it. */
  readonly email?: string;
  /** Whether the seeded identity is an administrator, as `requireAdmin` would have found it. */
  readonly admin?: boolean;
  readonly pendingEmail?: string;
  readonly stepUpWrites?: number[];
}

/** A `Forge` app with a seeded session and a deterministic CSRF minter, but no CSRF verification. */
function actionApp(seed: Seed = {}): Forge {
  const app = new Forge();
  app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
  app.use("*", (context, next) => {
    const session = sessionCtx.get(context);
    // Both, because a mounted route has both: the guards establish the identity every action reads,
    // and the session is what a sign-out clears and a step-up marks.
    if (seed.userId !== undefined) {
      session.set(AUTH_SESSION_KEY, seed.userId);
      authCtx.set(context, { userId: seed.userId, email: seed.email ?? signedIn.email, isAdmin: seed.admin === true, stepUpAt: null });
    }
    if (seed.pendingEmail !== undefined) session.set(AUTH_PENDING_SIGNIN_SESSION_KEY, seed.pendingEmail);
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
    return next();
  });
  return app;
}

function mounted(app: Forge, method: "POST" | "PATCH" | "DELETE", pattern: string, action: TestAction): Forge {
  mapHandler(app, method, pattern, action);
  return app;
}

function formBody(fields: Record<string, string>, method = "POST"): RequestInit {
  return { method, body: new URLSearchParams(fields).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } };
}

function jsonBody(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } };
}

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

  it("accepts the body a browser posts, CSRF field and all", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp(), "POST", "/auth/signin", createSigninActions(options).signinSubmit);

    const res = await app.request("/auth/signin", formBody({ _csrf: "csrf-for:/auth/signin", email: "ada@example.com" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
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
    const options = completing({ status: "enrolment-required", kinds: ["passkey"] });
    const app = mounted(actionApp({ pendingEmail: "grace@example.com" }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify", formBody({ code: "123456" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/enrol/passkey");
  });

  it("redirects an owed step-up back to the verification page", async () => {
    const options = completing({ status: "step-up-required", kinds: ["totp-app"] });
    const app = mounted(actionApp({ pendingEmail: "grace@example.com" }), "POST", "/auth/verify", createVerifyActions(options).submit);

    const res = await app.request("/auth/verify", formBody({ code: "123456" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });

  // The defect this closes: the schema was a fixed six digits, so `createEmailOtpFactor({ digits: 8 })`
  // — a supported, construction-validated configuration — made the page answer 422 to every correct code.
  it("parses the code at the width the presented factor asks for, not at a constant", async () => {
    const wide = { ...fakeFactorService("email-otp"), codeDigits: 8 };
    const options = optionsWith({
      signin: fakeAuthSigninFlow({ complete: async () => ok({ user: signedIn, kind: "email-otp" as const, resolution: { status: "satisfied" } }) }),
      factors: createFactorRegistry(fakeFactorStore([]), { offered: [wide], policy: { mode: "single" } }),
    });
    const app = mounted(actionApp({ pendingEmail: "grace@example.com" }), "POST", "/auth/verify", createVerifyActions(options).submit);

    expect((await app.request("/auth/verify", formBody({ code: "12345678" }))).status).toBe(303);
    // And the six-digit code the old schema was the only one to accept is now the wrong shape.
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
      offered: [fakeFactorService("email-otp"), fakeFactorService("totp-app")],
      policy: { mode: "second-factor", required: "when-enrolled" },
    }),
  };

  // The dead end this detour exists to close: a signed-in session that never finished enrolling was
  // shown the code field, because the demand fell back to the primary factor when `resolve` said
  // `enrolment-required`. `signin.stepUp` excludes the primary factor, so a correct freshly emailed
  // code came back as "That did not match" every time, with no way through the page.
  it("sends a signed-in session owing an enrolment to the page that can clear it, rather than asking for a code", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore([]), {
        offered: [fakeFactorService("email-otp"), fakeFactorService("totp-app")],
        policy: { mode: "second-factor", required: "always" },
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

  it("asks for another code and comes back to the verification page", async () => {
    const options = optionsWith(stepUpServices);
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/verify/resend", createVerifyActions(options).resend);

    const res = await app.request("/auth/verify/resend", formBody({}));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify?resent");
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

describe("createSignoutActions", () => {
  it("drops the session and returns to the sign-in page", async () => {
    const options = fakeAuthWebOptions();
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/auth/signout", createSignoutActions(options).signout);

    const res = await app.request("/auth/signout", formBody({}));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/signin");
  });
});

describe("createPasskeySigninActions", () => {
  const challenges: ChallengeStore = {
    put: async () => ok(undefined),
    take: async (): Promise<ReturnType<ChallengeStore["take"]> extends Promise<infer r> ? r : never> => ok(null as AuthChallenge | null),
  };

  it("refuses the ceremony outright when the deployment offers no passkey", async () => {
    const options = optionsWith({});
    const app = mounted(actionApp(), "POST", "/auth/passkey/authenticate/begin", createPasskeySigninActions(options).authenticateBegin);

    const res = await app.request("/auth/passkey/authenticate/begin", jsonBody({ mode: "authentication" }));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });

  it("answers a discoverable ceremony with options carrying no allow-list", async () => {
    const options = optionsWith({
      passkey: { rpId: "example.com", rpName: "Example", origin: "https://example.com", sessionId: "s1", challenges },
    });
    const app = mounted(actionApp(), "POST", "/auth/passkey/authenticate/begin", createPasskeySigninActions(options).authenticateBegin);

    const res = await app.request("/auth/passkey/authenticate/begin", jsonBody({ mode: "authentication" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body = (await res.json()) as { rpId: string; allowCredentials: unknown[] };
    expect(body.rpId).toBe("example.com");
    expect(body.allowCredentials).toEqual([]);
  });

  // Forge was at par with better-auth on the default and the stronger posture was simply unreachable:
  // the discoverable sign-in ran at `preferred` with no way for a deployment to raise it.
  it("carries the configured user-verification posture into the ceremony options, and defaults to `preferred`", async () => {
    async function posture(userVerification?: "discouraged" | "preferred" | "required") {
      const options = optionsWith({
        passkey: {
          rpId: "example.com",
          rpName: "Example",
          origin: "https://example.com",
          sessionId: "s1",
          challenges,
          ...(userVerification === undefined ? {} : { userVerification }),
        },
      });
      const app = mounted(actionApp(), "POST", "/auth/passkey/authenticate/begin", createPasskeySigninActions(options).authenticateBegin);
      const res = await app.request("/auth/passkey/authenticate/begin", jsonBody({ mode: "authentication" }));
      return ((await res.json()) as { userVerification: string }).userVerification;
    }

    expect(await posture()).toBe("preferred");
    expect(await posture("required")).toBe("required");
  });

  it("refuses a finish whose body is not an assertion", async () => {
    const options = optionsWith({
      passkey: { rpId: "example.com", rpName: "Example", origin: "https://example.com", sessionId: "s1", challenges },
    });
    const app = mounted(actionApp(), "POST", "/auth/passkey/authenticate/finish", createPasskeySigninActions(options).authenticateFinish);

    const res = await app.request("/auth/passkey/authenticate/finish", jsonBody({ credential: { id: "c" } }));
    expect(res.status).toBe(400);
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
      role: "step-up",
      users: minting,
      factors: {
        ...enrolments,
        enrol: async (input, at) =>
          ok({ ...input, id: "f1", secret: null, lastCounter: null, failedAttempts: 0, confirmedAt: at, createdAt: at, updatedAt: at }),
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
        offered: [fakeFactorService("email-otp"), passkey],
        primary: "email-otp",
        policy: { mode: "single" },
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

  // The defect this closes: the enrolment name reached `credentials.create` on a trim alone, while
  // the rename path ran the same field through a 64-character cap.
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

// Three JSON endpoints read `request.json()` with no bound at all, so a client could hand a Worker
// as much body as it cared to allocate.
describe("the ceremony endpoints cap what they read", () => {
  const oversized = JSON.stringify({ credential: { id: "c", padding: "x".repeat(AUTH_CEREMONY_MAX_BYTES) } });

  function ceremonyApp() {
    const challenges: ChallengeStore = { put: async () => ok(undefined), take: async () => ok(null) };
    const options = optionsWith({
      passkey: { rpId: "example.com", rpName: "Example", origin: "https://example.com", sessionId: "s1", challenges },
    });
    return mounted(actionApp(), "POST", "/auth/passkey/authenticate/finish", createPasskeySigninActions(options).authenticateFinish);
  }

  it("answers 413 on a body whose Content-Length already says too much", async () => {
    const res = await ceremonyApp().request("/auth/passkey/authenticate/finish", {
      method: "POST",
      body: oversized,
      headers: { "content-type": "application/json" },
    });
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
    const res = await ceremonyApp().request("/auth/passkey/authenticate/finish", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
  });

  it("still reads a body inside the cap, so the bound refuses nothing real", async () => {
    const res = await ceremonyApp().request("/auth/passkey/authenticate/finish", jsonBody({ credential: { id: "c" } }));
    expect(res.status).toBe(400);
  });

  // Bounded and shaped before it reaches `findByCredentialId`: an id of any length and any alphabet
  // otherwise arrives at the index as a bind parameter on every unauthenticated POST.
  it("refuses an assertion id that is not bounded base64url, before any store is asked", async () => {
    for (const id of ["", "n".repeat(1401), "not base64url!"]) {
      const res = await ceremonyApp().request(
        "/auth/passkey/authenticate/finish",
        jsonBody({ credential: { id, response: { clientDataJSON: "e30", authenticatorData: "e30", signature: "e30" } } }),
      );
      expect(`${id.slice(0, 12)}: ${res.status}`).toBe(`${id.slice(0, 12)}: 400`);
    }
  });
});

describe("createPasskeyManageActions", () => {
  const credential = fakeAuthCredential({ id: "c1", userId: "u9" });
  const options = optionsWith({ users: fakeAuthUserStore([signedIn]), credentials: fakeAuthCredentialStore([credential]) });

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
    const renameOptions = optionsWith({ users: fakeAuthUserStore([signedIn]), credentials: renaming(rows) });
    const app = mounted(actionApp({ userId: "u9" }), "PATCH", "/account/passkeys/:id", createPasskeyManageActions(renameOptions).passkeyRename);

    const res = await app.request("/account/passkeys/c1", formBody({ label: "Phone" }, "PATCH"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(rows.map((row) => row.label)).toEqual(["Phone"]);
    expect(attrOf(await res.text(), 'name="label"', "value")).toBe("Phone");
  });

  it("clears a name back to nothing rather than writing an empty one", async () => {
    const rows = [fakeAuthCredential({ id: "c1", userId: "u9", label: "Laptop" })];
    const renameOptions = optionsWith({ users: fakeAuthUserStore([signedIn]), credentials: renaming(rows) });
    const app = mounted(actionApp({ userId: "u9" }), "PATCH", "/account/passkeys/:id", createPasskeyManageActions(renameOptions).passkeyRename);

    await app.request("/account/passkeys/c1", formBody({ label: "   " }, "PATCH"));
    expect(rows.map((row) => row.label)).toEqual([null]);
  });

  it("changes nothing and answers 404 for another account's credential", async () => {
    const rows = [fakeAuthCredential({ id: "c1", userId: "u1", label: "Laptop" })];
    const renameOptions = optionsWith({ users: fakeAuthUserStore([signedIn]), credentials: renaming(rows) });
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
      offered: [fakeFactorService("email-otp"), totpService],
      policy: { mode: "second-factor", required: "when-enrolled" },
    }),
  };

  it("re-renders at 422 when the confirmation code is refused", async () => {
    const options = optionsWith(totpServices);
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/account/totp", createTotpManageActions(options).totpEnrol);

    const res = await app.request("/account/totp", formBody({ code: "123456" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("location")).toBeNull();
  });

  it("returns to the authenticator page once every enrolment row is gone", async () => {
    const options = optionsWith(totpServices);
    const app = mounted(actionApp({ userId: "u9" }), "DELETE", "/account/totp", createTotpManageActions(options).totpRemove);

    const res = await app.request("/account/totp", { method: "DELETE" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/totp");
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
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserService([member]) });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u2", formBody({ role: "admin", status: "active" }, "PATCH"));
    expect(res.status).toBe(200);
  });

  it("answers 409 with the account still rendered when the last-admin guard refuses", async () => {
    const admin = fakeAuthUser({ id: "u2", email: "member@example.com", isAdmin: true });
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      admin: fakeAdminUserService([admin], { demote: async () => ok("last-admin-demote" as const) }),
    });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u2", formBody({ role: "member", status: "active" }, "PATCH"));
    expect(res.status).toBe(409);
  });

  it("answers 404 for an account that is no longer there", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserService([]) });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u2", formBody({ role: "member", status: "active" }, "PATCH"));
    expect(res.status).toBe(404);
  });

  it("returns to the listing once an account is deleted", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserService([member]) });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "DELETE", "/admin/users/:id", createAdminUserActions(options).remove);

    const res = await app.request("/admin/users/u2", { method: "DELETE" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/users");
  });

  // The defect this closes: no admin-service method takes the acting administrator's id, so with two
  // admins in a deployment the last-admin guard admitted an administrator locking out their own
  // account. Unlike that guard this needs no in-statement race protection: the actor is fixed here.
  it("refuses an administrator deactivating their own account, writing nothing", async () => {
    const self = fakeAuthUser({ id: "u9", email: "grace@example.com", isAdmin: true });
    const admin = fakeAdminUserService([self]);
    const options = optionsWith({ users: fakeAuthUserStore([self]), admin });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u9", formBody({ role: "admin", status: "deactivated" }, "PATCH"));
    expect(res.status).toBe(409);
    expect((await admin.view("u9")).ok).toBe(true);
  });

  it("refuses an administrator deleting their own account, which is not even reversible", async () => {
    const self = fakeAuthUser({ id: "u9", email: "grace@example.com", isAdmin: true });
    const options = optionsWith({ users: fakeAuthUserStore([self]), admin: fakeAdminUserService([self]) });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "DELETE", "/admin/users/:id", createAdminUserActions(options).remove);

    const res = await app.request("/admin/users/u9", { method: "DELETE" });
    expect(res.status).toBe(409);
  });

  it("still lets an administrator reactivate their own account, which locks nobody out", async () => {
    const self = fakeAuthUser({ id: "u9", email: "grace@example.com", isAdmin: true, deactivatedAt: 1 });
    const options = optionsWith({ users: fakeAuthUserStore([self]), admin: fakeAdminUserService([self]) });
    const app = mounted(actionApp({ userId: "u9", admin: true }), "PATCH", "/admin/users/:id", createAdminUserActions(options).update);

    const res = await app.request("/admin/users/u9", formBody({ role: "admin", status: "active" }, "PATCH"));
    expect(res.status).toBe(200);
  });
});

describe("createAdminElevateActions", () => {
  it("grants the claim while the deployment has no administrator", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserService([signedIn]) });
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/admin/elevate", createAdminElevateActions(options).submit);

    const res = await app.request("/admin/elevate", formBody({ confirm: "yes" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/users");
  });

  it("refuses the claim at 409 once an administrator exists", async () => {
    const admin = fakeAuthUser({ id: "u1", isAdmin: true });
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), admin: fakeAdminUserService([admin]) });
    const app = mounted(actionApp({ userId: "u9" }), "POST", "/admin/elevate", createAdminElevateActions(options).submit);

    const res = await app.request("/admin/elevate", formBody({ confirm: "yes" }));
    expect(res.status).toBe(409);
  });
});
