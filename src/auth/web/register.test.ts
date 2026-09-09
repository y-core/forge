import { describe, expect, it } from "bun:test";

import { createCookie } from "@remix-run/cookie";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../../app/forge-app";
import { getAppContext } from "../../context/types";
import { csrfMinterCtx, csrfProtection, importCsrfKey } from "../../form/csrf";
import { csrfFieldCtx } from "../../form/csrf-context";
import { ok } from "../../result/result";
import { sessionCtx, sessionMiddleware } from "../../session/session";
import { mapHandler } from "../../testing/route";
import { type AuthFactorService, createFactorRegistry } from "../factors/registry";
import {
  PASSKEY_CSRF_HEADER_ATTR,
  PASSKEY_CSRF_HEADER_DEFAULT,
  PASSKEY_MODE_ATTR,
  PASSKEY_OPTIONS_PATH_ATTR,
  PASSKEY_OPTIONS_TOKEN_ATTR,
  PASSKEY_SCOPE,
} from "../passkey-contract";
import type { AuthChallenge, ChallengeStore } from "../types";
import { createSigninActions } from "./actions";
import { AUTH_PENDING_SIGNIN_SESSION_KEY, AUTH_SESSION_KEY, authCtx } from "./identity";
import { loadSignin } from "./loaders";
import type { AuthWebOptions } from "./options";
import { registerAccount, registerAdmin, registerAuth } from "./register";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";
import {
  attrOf,
  attrsOf,
  fakeAuthCredential,
  fakeAuthCredentialStore,
  fakeAuthServices,
  fakeAuthSigninFlow,
  fakeAuthUser,
  fakeAuthUserStore,
  fakeAuthWebOptions,
  fakeFactorService,
  fakeFactorStore,
  valuesOf,
} from "./test-support";

const CSRF_SECRET = "b".repeat(64);

const sessionCookie = createCookie("__session", { path: "/" });

interface AppSeed {
  readonly userId?: string;
  /** Whether the seeded identity is an administrator, as `requireAdmin` would have found it. */
  readonly admin?: boolean;
  readonly pendingEmail?: string;
  /** Every value written under the identity key, in order. */
  readonly identityWrites?: string[];
  /** Mint deterministic tokens instead of `csrfProtection`'s, so two renders can be compared byte for byte. */
  readonly fixedCsrf?: boolean;
  /** The header `csrfProtection` checks the token on, when the app renames it. */
  readonly csrfHeaderName?: string;
}

function authApp(seed: AppSeed = {}): Forge {
  const app = new Forge();
  app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
  app.use("*", (context, next) => {
    const session = sessionCtx.get(context);
    // These files mount the routes without `createAuthGuards`, so the identity the guards would have
    // established is seeded here instead — a page reads `authCtx` and never the session.
    if (seed.userId !== undefined) {
      session.set(AUTH_SESSION_KEY, seed.userId);
      authCtx.set(context, { userId: seed.userId, email: "ada@example.com", isAdmin: seed.admin === true, stepUpAt: null });
    }
    if (seed.pendingEmail !== undefined) session.set(AUTH_PENDING_SIGNIN_SESSION_KEY, seed.pendingEmail);
    const writes = seed.identityWrites;
    if (writes !== undefined) {
      const write = session.set.bind(session);
      session.set = ((key: string, value: unknown) => {
        if (key === AUTH_SESSION_KEY) writes.push(String(value));
        return write(key as never, value as never);
      }) as typeof session.set;
    }
    return next();
  });

  if (seed.fixedCsrf === true) {
    app.use("*", (context, next) => {
      csrfMinterCtx.set(context, (path) => Promise.resolve(`csrf-for:${path}`));
      csrfFieldCtx.set(context, "_csrf");
      return next();
    });
  } else {
    const key = importCsrfKey(CSRF_SECRET);
    app.use(
      "*",
      csrfProtection({ secret: () => key, subject: false, ...(seed.csrfHeaderName === undefined ? {} : { headerName: seed.csrfHeaderName }) }),
    );
  }
  return app;
}

/** One app plus a cookie jar, so a redirect chain keeps the session it was given. */
function client(app: Forge) {
  let cookie = "";
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (cookie !== "") headers.set("cookie", cookie);
    const res = await app.request(path, { ...init, headers });
    const set = res.headers.get("set-cookie");
    if (set !== null) cookie = set.split(";")[0] ?? cookie;
    return res;
  };
}

function formBody(fields: Record<string, string>, method = "POST"): RequestInit {
  return { method, body: new URLSearchParams(fields).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } };
}

describe("registerAuth mounted against the pieces on a custom route", () => {
  it("renders byte-identical markup for a page a consumer mounted itself", async () => {
    const options = fakeAuthWebOptions();

    const registered = authApp({ fixedCsrf: true });
    registerAuth(registered, authRoutes("/auth"), options);

    const custom = authApp({ fixedCsrf: true });
    mapHandler(custom, "GET", "/mine/enter", (context) => loadSignin(getAppContext(context), options));
    const actions = createSigninActions(options);
    mapHandler(custom, "POST", "/mine/enter", actions.signinSubmit);

    const fromForge = await (await registered.request("/auth/signin")).text();
    const fromConsumer = await (await custom.request("/mine/enter")).text();

    expect(fromConsumer).toBe(fromForge);
    expect(attrOf(fromForge, 'data-slot="form-csrf"', "value")).toBe("csrf-for:/auth/signin");
  });

  it("carries the same submit outcome through the consumer's own route", async () => {
    const options = fakeAuthWebOptions();
    const custom = authApp({ fixedCsrf: true });
    mapHandler(custom, "POST", "/mine/enter", createSigninActions(options).signinSubmit);

    const res = await custom.request("/mine/enter", formBody({ email: "ada@example.com", _csrf: "csrf-for:/auth/signin" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });
});

describe("register* independence", () => {
  it("mounts the account routes with neither of the other two registered", async () => {
    const options = fakeAuthWebOptions();
    const app = authApp({ userId: "u1", fixedCsrf: true });
    registerAccount(app, accountRoutes("/account"), options);

    const fetch = client(app);
    expect((await fetch("/account/passkeys")).status).toBe(200);
    expect((await fetch("/auth/signin")).status).toBe(404);
    expect((await fetch("/admin/users")).status).toBe(404);
  });

  it("mounts the admin routes with neither of the other two registered", async () => {
    const options = fakeAuthWebOptions();
    const app = authApp({ userId: "u1", admin: true, fixedCsrf: true });
    registerAdmin(app, adminRoutes("/admin"), options);

    const fetch = client(app);
    expect((await fetch("/admin/users")).status).toBe(200);
    expect((await fetch("/admin/elevate")).status).toBe(200);
    expect((await fetch("/account/passkeys")).status).toBe(404);
  });

  it("mounts the auth routes with neither of the other two registered", async () => {
    const options = fakeAuthWebOptions();
    const app = authApp({ fixedCsrf: true });
    registerAuth(app, authRoutes("/auth"), options);

    const fetch = client(app);
    expect((await fetch("/auth/signin")).status).toBe(200);
    expect((await fetch("/auth/signup")).status).toBe(200);
    expect((await fetch("/account/passkeys")).status).toBe(404);
  });
});

describe("csrfProtection over the registered routes", () => {
  it("refuses a submission carrying no token with the exact refusal", async () => {
    const options = fakeAuthWebOptions();
    const app = authApp();
    registerAuth(app, authRoutes("/auth"), options);

    const res = await app.request("/auth/signin", formBody({ email: "ada@example.com" }));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("accepts a submission carrying the token the page rendered", async () => {
    const options = fakeAuthWebOptions();
    const app = authApp();
    registerAuth(app, authRoutes("/auth"), options);

    const fetch = client(app);
    const token = attrOf(await (await fetch("/auth/signin")).text(), 'data-slot="form-csrf"', "value");
    const res = await fetch("/auth/signin", formBody({ email: "ada@example.com", _csrf: token }));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/auth/verify");
  });
});

// The assertion that would have caught the original defect: a page-level token was minted for the
// first row, so every other Remove button posted a token bound to another row's path and got a 403.
describe("csrfProtection over a passkey list of more than one row", () => {
  it("accepts the second row's own token on the second row's remove path", async () => {
    const services = fakeAuthServices({
      credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u1" }), fakeAuthCredential({ id: "c2", userId: "u1" })]),
    });
    const app = authApp({ userId: "u1" });
    registerAccount(app, accountRoutes("/account"), fakeAuthWebOptions({ resolveServices: () => services }));

    const fetch = client(app);
    const headers = valuesOf(await (await fetch("/account/passkeys")).text(), "hx-headers");
    expect(headers).toHaveLength(2);
    const second = JSON.parse((headers[1] as string).replaceAll("&quot;", '"')) as Record<string, string>;

    const res = await fetch("/account/passkeys/c2", { method: "DELETE", headers: second });
    expect(res.status).toBe(200);
  });
});

// The defect this covers: `Form` wrote the literal `"X-CSRF-Token"` into every `hx-headers`, and an
// `hx-delete` row sends no body, so under a renamed header the Remove button had no token at all.
describe("the CSRF header a renamed deployment writes into an hx-delete row", () => {
  const HEADER = "X-App-Csrf";

  function listApp() {
    const services = fakeAuthServices({ credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u1" })]) });
    const app = authApp({ userId: "u1", csrfHeaderName: HEADER });
    registerAccount(app, accountRoutes("/account"), fakeAuthWebOptions({ resolveServices: () => services }));
    return app;
  }

  it("renders the row's token under the app's own header name", async () => {
    const html = await (await client(listApp())("/account/passkeys")).text();
    const headers = JSON.parse((valuesOf(html, "hx-headers")[0] as string).replaceAll("&quot;", '"')) as Record<string, string>;

    expect(Object.keys(headers)).toEqual([HEADER]);
  });

  it("accepts that row's remove with no body, which is the only carrier it has", async () => {
    const fetch = client(listApp());
    const html = await (await fetch("/account/passkeys")).text();
    const headers = JSON.parse((valuesOf(html, "hx-headers")[0] as string).replaceAll("&quot;", '"')) as Record<string, string>;

    const res = await fetch("/account/passkeys/c1", { method: "DELETE", headers });
    expect(res.status).toBe(200);
  });
});

describe("the session identity a verification writes", () => {
  const signedIn = fakeAuthUser({ id: "u9", email: "grace@example.com" });

  function verifyOptions(passes: boolean): AuthWebOptions {
    const services = fakeAuthServices({
      signin: fakeAuthSigninFlow(
        passes ? { complete: async () => ok({ user: signedIn, kind: "email-otp" as const, resolution: { status: "satisfied" as const } }) } : {},
      ),
    });
    return fakeAuthWebOptions({ resolveServices: () => services });
  }

  it("writes the identity exactly once on a passing verification", async () => {
    const identityWrites: string[] = [];
    const app = authApp({ pendingEmail: "grace@example.com", identityWrites, fixedCsrf: true });
    registerAuth(app, authRoutes("/auth"), verifyOptions(true));

    const res = await app.request("/auth/verify", formBody({ code: "123456", _csrf: "x" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/passkeys");
    expect(identityWrites).toEqual(["u9"]);
  });

  it("writes no identity at all on a refused verification", async () => {
    const identityWrites: string[] = [];
    const app = authApp({ pendingEmail: "grace@example.com", identityWrites, fixedCsrf: true });
    registerAuth(app, authRoutes("/auth"), verifyOptions(false));

    const res = await app.request("/auth/verify", formBody({ code: "123456", _csrf: "x" }));
    expect(res.status).toBe(422);
    expect(identityWrites).toEqual([]);
  });
});

// The defect this covers: the controller sent `csrfProtection`'s default header against an app that
// had renamed it, so both halves of every ceremony 403-ed with nothing on the page to explain it.
describe("the CSRF header name a renamed deployment stamps on the passkey scope", () => {
  const signedIn = fakeAuthUser({ id: "u9", email: "grace@example.com" });
  const HEADER = "X-App-Csrf";

  function passkeyOptions(): AuthWebOptions {
    const challenges: ChallengeStore = { put: async () => ok(undefined), take: async () => ok(null as AuthChallenge | null) };
    const passkey = fakeFactorService("passkey") as AuthFactorService & { beginEnrolment: unknown };
    const services = fakeAuthServices({
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore([]), {
        offered: [{ ...passkey, beginEnrolment: async () => ok({ options: { rpId: "example.com" } }) } as AuthFactorService],
        policy: { mode: "single" },
      }),
      passkey: { rpId: "example.com", rpName: "Example", origin: "https://example.com", sessionId: "s1", challenges },
    });
    return fakeAuthWebOptions({ resolveServices: () => services });
  }

  it("renders the app's own header name on the enrolment scope root", async () => {
    const app = authApp({ userId: "u9", csrfHeaderName: HEADER });
    registerAuth(app, authRoutes("/auth"), passkeyOptions());

    const html = await (await client(app)("/auth/enrol/passkey")).text();
    const attrs = attrsOf(html, `data-scope="${PASSKEY_SCOPE}"`);

    expect(attrs[PASSKEY_CSRF_HEADER_ATTR]).toBe(HEADER);
    expect(attrs[PASSKEY_MODE_ATTR]).toBe("registration");
  });

  it("accepts the ceremony token on the header the page named", async () => {
    const app = authApp({ userId: "u9", csrfHeaderName: HEADER });
    registerAuth(app, authRoutes("/auth"), passkeyOptions());

    const fetch = client(app);
    const attrs = attrsOf(await (await fetch("/auth/enrol/passkey")).text(), `data-scope="${PASSKEY_SCOPE}"`);
    const res = await fetch(attrs[PASSKEY_OPTIONS_PATH_ATTR] as string, {
      method: "POST",
      headers: { [HEADER]: attrs[PASSKEY_OPTIONS_TOKEN_ATTR] as string, "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(200);
  });

  it("still refuses that same token on the default header name", async () => {
    const app = authApp({ userId: "u9", csrfHeaderName: HEADER });
    registerAuth(app, authRoutes("/auth"), passkeyOptions());

    const fetch = client(app);
    const attrs = attrsOf(await (await fetch("/auth/enrol/passkey")).text(), `data-scope="${PASSKEY_SCOPE}"`);
    const res = await fetch(attrs[PASSKEY_OPTIONS_PATH_ATTR] as string, {
      method: "POST",
      headers: { [PASSKEY_CSRF_HEADER_DEFAULT]: attrs[PASSKEY_OPTIONS_TOKEN_ATTR] as string, "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(403);
  });
});
