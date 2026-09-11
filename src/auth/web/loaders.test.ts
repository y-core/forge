import { describe, expect, it } from "bun:test";

import { createCookie } from "@remix-run/cookie";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../../app/forge-app";
import { getAppContext } from "../../context/types";
import { csrfMinterCtx, importCsrfKey, verifyCsrfToken } from "../../form/csrf";
import { err, ok } from "../../result/result";
import { sessionCtx, sessionMiddleware } from "../../session/session";
import { mintTestCsrfToken } from "../../testing/csrf";
import { mapHandler } from "../../testing/route";
import { createFactorRegistry } from "../factors/registry";
import type { AuthFactorRequirement, AuthFactorService } from "../factors/types";
import type { AuthChallenge, ChallengeStore } from "../types";
import { AUTH_SESSION_KEY, authCtx } from "./identity";
import {
  loadAdminElevate,
  loadAdminUserEdit,
  loadAdminUsers,
  loadEmailChange,
  loadPasskey,
  loadPasskeyEdit,
  loadPasskeyEnrol,
  loadPasskeyList,
  loadSignin,
  loadSignup,
  loadTotpEnrol,
  loadVerify,
} from "./loaders";
import {
  attrOf,
  attrsOf,
  elementsOf,
  fakeAdminUserService,
  fakeAuthCredential,
  fakeAuthCredentialStore,
  fakeAuthIcon,
  fakeAuthServices,
  fakeAuthUser,
  fakeAuthUserStore,
  fakeAuthWebOptions,
  fakeFactorService,
  fakeFactorStore,
  textOf,
  valuesOf,
} from "./test-support";
import type { AuthPageState, AuthRequestServices, AuthWebOptions } from "./types";

const sessionCookie = createCookie("__session", { path: "/" });

const signedIn = fakeAuthUser({ id: "u9", email: "grace@example.com" });

const CSRF_SECRET = "c".repeat(64);

/** The one header htmx sends a row's token in, as `hxAttrs` serialises it. */
interface CsrfHeaders {
  readonly "X-CSRF-Token": string;
}

type Loader = (c: never, options: AuthWebOptions, state?: AuthPageState) => Promise<Response>;

/** Mounts one loader at `pattern` on an app whose guards have run, with a minter the test chooses. */
function loaderApp(load: Loader, options: AuthWebOptions, pattern = "/page", userId?: string, minter = stubMinter, admin = false): Forge {
  const app = new Forge();
  app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
  app.use("*", (context, next) => {
    // The identity as `requireAuth` would have established it: a loader reads `authCtx` and never
    // the session, so seeding the session alone no longer stands in for a guarded route.
    if (userId !== undefined) {
      sessionCtx.get(context).set(AUTH_SESSION_KEY, userId);
      authCtx.set(context, { userId, email: signedIn.email, isAdmin: admin, stepUpAt: null });
    }
    csrfMinterCtx.set(context, minter);
    return next();
  });
  mapHandler(app, "GET", pattern, (context) => load(getAppContext(context) as never, options));
  return app;
}

/** The minter every markup assertion reads, whose tokens name the path they were minted for. */
const stubMinter = (path: string) => Promise.resolve(`csrf-for:${path}`);

/** The real minter, so a token can be put back through `verifyCsrfToken` against the path it must be bound to. */
const realMinter = (path: string) => mintTestCsrfToken(CSRF_SECRET, path);

function optionsWith(overrides: Partial<AuthRequestServices>): AuthWebOptions {
  const services = fakeAuthServices(overrides);
  return fakeAuthWebOptions({ resolveServices: () => services });
}

async function page(app: Forge, path = "/page"): Promise<string> {
  return (await app.request(path)).text();
}

describe("loadSignin", () => {
  it("posts to the sign-in submit path with the token minted for it", async () => {
    const options = fakeAuthWebOptions();
    const html = await page(loaderApp(loadSignin, options));

    expect(attrOf(html, 'data-slot="form"', "action")).toBe("/auth/signin");
    expect(attrOf(html, 'data-slot="form-csrf"', "value")).toBe("csrf-for:/auth/signin");
  });

  it("renders no passkey scope for a deployment that offers none", async () => {
    const options = fakeAuthWebOptions();
    const html = await page(loaderApp(loadSignin, options));

    expect(elementsOf(html, "div", 'data-scope="passkey"')).toEqual([]);
  });

  it("keeps the address and the refusal a failed submission hands back", async () => {
    const options = fakeAuthWebOptions();
    const app = new Forge();
    app.use("*", (context, next) => {
      csrfMinterCtx.set(context, stubMinter);
      return next();
    });
    mapHandler(app, "GET", "/page", (context) =>
      loadSignin(getAppContext(context), options, { email: "ada@example.com", fieldError: "Try again.", status: 422 }),
    );

    const res = await app.request("/page");
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(attrOf(html, 'name="email"', "value")).toBe("ada@example.com");
    expect(textOf(html, "p", 'data-slot="field-error"')).toBe("Try again.");
  });
});

describe("loadSignup", () => {
  it("posts to the sign-up submit path and links back to sign-in", async () => {
    const options = fakeAuthWebOptions();
    const html = await page(loaderApp(loadSignup, options));

    expect(attrOf(html, 'data-slot="form"', "action")).toBe("/auth/signup");
    expect(valuesOf(html, "href")).toEqual(["/auth/signin"]);
  });

  // Offering a factor and demanding it are different deployments, and the page has to say which:
  // under `optional` nobody is asked to enrol, so promising the step would be a lie a visitor never
  // sees honoured. The role alone cannot tell the two apart, which is why the requirement is read.
  it("promises the enrolment step only where one is actually demanded", async () => {
    const described = async (requirement: AuthFactorRequirement) => {
      const services = fakeAuthServices({
        factors: createFactorRegistry(fakeFactorStore([]), {
          offered: [
            { service: fakeFactorService("email-otp"), role: "primary" },
            { service: fakeFactorService("totp-app"), role: "second", requirement },
          ],
        }),
      });
      const html = await page(loaderApp(loadSignup, fakeAuthWebOptions({ resolveServices: () => services })));
      return textOf(html, "div", 'data-slot="card-description"');
    };

    expect({ mandatory: await described("mandatory"), optional: await described("optional") }).toEqual({
      mandatory: "We email you a six-digit code to confirm the address. You add an authenticator app afterwards.",
      optional: "We email you a six-digit code to confirm the address.",
    });
  });
});

describe("loadVerify", () => {
  it("asks an anonymous visitor for the deployment's primary factor, with a resend affordance", async () => {
    const options = fakeAuthWebOptions();
    const html = await page(loaderApp(loadVerify, options));

    expect(valuesOf(html, "action")).toEqual(["/auth/verify", "/auth/verify/resend"]);
  });

  it("asks a signed-in visitor who owes a step-up for the enrolled second factor", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore(["totp-app"]), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          { service: fakeFactorService("totp-app"), role: "second", requirement: "optional" },
        ],
      }),
    });
    const html = await page(loaderApp(loadVerify, options, "/page", "u9"));

    // The authenticator-app prompt, and no resend: only an emailed code can be sent again.
    expect(valuesOf(html, "action")).toEqual(["/auth/verify"]);
  });
});

describe("loadPasskeyEnrol", () => {
  const challenges: ChallengeStore = { put: async () => ok(undefined), take: async () => ok(null as AuthChallenge | null) };

  it("sends an anonymous request to the sign-in page", async () => {
    const options = fakeAuthWebOptions();
    const res = await loaderApp(loadPasskeyEnrol, options).request("/page");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/signin");
  });

  it("carries both ceremony paths and two different tokens on the scope root", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      passkey: { rpId: "example.com", rpName: "Example", origin: "https://example.com", sessionId: "s1", challenges },
    });
    const html = await page(loaderApp(loadPasskeyEnrol, options, "/page", "u9"));

    expect(attrOf(html, 'data-scope="passkey"', "data-passkey-options-path")).toBe("/auth/enrol/passkey/register/begin");
    expect(attrOf(html, 'data-scope="passkey"', "data-passkey-verify-path")).toBe("/auth/enrol/passkey/register/finish");
    expect(attrOf(html, 'data-scope="passkey"', "data-passkey-options-token")).toBe("csrf-for:/auth/enrol/passkey/register/begin");
    expect(attrOf(html, 'data-scope="passkey"', "data-passkey-verify-token")).toBe("csrf-for:/auth/enrol/passkey/register/finish");
  });

  it("answers 404 for a deployment that offers no passkey at all", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]) });
    const res = await loaderApp(loadPasskeyEnrol, options, "/page", "u9").request("/page");

    expect(res.status).toBe(404);
  });
});

describe("loadPasskeyList", () => {
  it("renders one row per registered credential", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" }), fakeAuthCredential({ id: "c2", userId: "u9" })]),
    });
    const html = await page(loaderApp(loadPasskeyList, options, "/page", "u9"));

    expect(elementsOf(html, "li", 'data-ref="credential"')).toHaveLength(2);
  });

  // The defect this replaced: one page-level token, minted for the first row, 403-ing every other
  // Remove button. Each row now carries a token bound to its own path.
  it("mints one token per row, each verifying against that row's own path", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" }), fakeAuthCredential({ id: "c2", userId: "u9" })]),
    });
    const app = loaderApp(loadPasskeyList, options, "/page", "u9", realMinter);

    const tokens = valuesOf(await page(app), "hx-headers").map(
      (headers) => (JSON.parse(headers.replaceAll("&quot;", '"')) as CsrfHeaders)["X-CSRF-Token"],
    );
    const key = await importCsrfKey(CSRF_SECRET);
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens).size).toBe(2);
    expect(await verifyCsrfToken(key, tokens[0] as string, "/account/passkeys/c1")).toEqual(ok());
    expect(await verifyCsrfToken(key, tokens[1] as string, "/account/passkeys/c2")).toEqual(ok());
  });

  it("refuses with 503 when the credential store is down", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      credentials: { ...fakeAuthCredentialStore([]), listByUser: async () => err(new Error("kv down") as never) },
    });
    const res = await loaderApp(loadPasskeyList, options, "/page", "u9").request("/page");

    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Service Unavailable");
  });
});

describe("loadPasskey", () => {
  it("answers 404 for a credential id nobody owns", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), credentials: fakeAuthCredentialStore([]) });
    const res = await loaderApp(loadPasskey, options, "/page/:id", "u9").request("/page/nope");

    expect(res.status).toBe(404);
  });

  it("renders exactly the one credential it was asked for", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" }), fakeAuthCredential({ id: "c2", userId: "u9" })]),
    });
    const html = await (await loaderApp(loadPasskey, options, "/page/:id", "u9").request("/page/c2")).text();

    expect(elementsOf(html, "li", 'data-ref="credential"')).toHaveLength(1);
  });
});

describe("loadPasskeyEdit", () => {
  const options = optionsWith({
    users: fakeAuthUserStore([signedIn]),
    credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9", label: "Work laptop" })]),
  });

  it("renders the rename form for the one credential, on the path the rename is sent to", async () => {
    const html = await (await loaderApp(loadPasskeyEdit, options, "/page/:id", "u9").request("/page/c1")).text();

    expect(attrOf(html, 'data-slot="form"', "hx-patch")).toBe("/account/passkeys/c1");
    expect(attrOf(html, 'data-slot="form-csrf"', "value")).toBe("csrf-for:/account/passkeys/c1");
    expect(attrOf(html, 'name="label"', "value")).toBe("Work laptop");
  });

  it("answers 404 for a credential the visitor does not own", async () => {
    const res = await loaderApp(loadPasskeyEdit, options, "/page/:id", "u9").request("/page/c2");

    expect(res.status).toBe(404);
  });
});

describe("loadTotpEnrol", () => {
  const enrolling = {
    ...fakeFactorService("totp-app"),
    beginEnrolment: async () => ok({ kind: "totp-app" as const, expiresAt: 1_000, options: { secret: "JBSWY3DP", uri: "otpauth://totp/x" } }),
  } as AuthFactorService;

  it("shows the secret exactly once, alongside the confirmation form", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore([]), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          { service: enrolling, role: "second", requirement: "optional" },
        ],
      }),
    });
    const html = await page(loaderApp(loadTotpEnrol, options, "/page", "u9"));

    expect(textOf(html, "code", 'data-ref="totp-secret"')).toBe("JBSWY3DP");
    expect(attrOf(html, 'data-slot="form"', "action")).toBe("/account/totp");
  });

  it("answers 404 for a deployment that offers no authenticator app", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]) });
    const res = await loaderApp(loadTotpEnrol, options, "/page", "u9").request("/page");

    expect(res.status).toBe(404);
  });
});

describe("loadEmailChange", () => {
  it("names the address in force and posts the change to the account route", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]) });
    const html = await page(loaderApp(loadEmailChange, options, "/page", "u9"));

    expect(attrOf(html, 'data-slot="form"', "action")).toBe("/account/email-change");
    expect(attrOf(html, 'data-slot="form-csrf"', "value")).toBe("csrf-for:/account/email-change");
  });
});

describe("loadAdminUsers", () => {
  const roster = [fakeAuthUser({ id: "u1", email: "ada@example.com" }), fakeAuthUser({ id: "u2", email: "bob@example.com" })];

  it("lists every account with no cursor while the page is not full", async () => {
    const options = optionsWith({ admin: fakeAdminUserService(roster) });
    const html = await page(loaderApp(loadAdminUsers, options, "/page", "u9", stubMinter, true));

    expect(elementsOf(html, "tr", 'data-ref="admin-user-row"')).toHaveLength(2);
    expect(elementsOf(html, "nav", 'aria-label="User pages"')).toEqual([]);
  });

  it("filters the listing by the search term the query string carries", async () => {
    const options = optionsWith({ admin: fakeAdminUserService(roster) });
    const html = await page(loaderApp(loadAdminUsers, options, "/page", "u9", stubMinter, true), "/page?q=bob");

    expect(elementsOf(html, "tr", 'data-ref="admin-user-row"')).toHaveLength(1);
  });

  it("refuses with 503 when the administrative store is down", async () => {
    const options = optionsWith({ admin: fakeAdminUserService(roster, { list: async () => err(new Error("db down") as never) }) });
    const res = await loaderApp(loadAdminUsers, options, "/page", "u9", stubMinter, true).request("/page");

    expect(res.status).toBe(503);
  });
});

describe("loadAdminUserEdit", () => {
  it("marks the last admin who could still sign in", async () => {
    const only = fakeAuthUser({ id: "u2", email: "root@example.com", isAdmin: true });
    const options = optionsWith({ admin: fakeAdminUserService([only]) });
    const html = await (await loaderApp(loadAdminUserEdit, options, "/page/:id", "u9", stubMinter, true).request("/page/u2")).text();

    expect(textOf(html, "p", 'data-ref="admin-role-reason"')).toBe(
      "This is the last admin who can still sign in — promote another admin before removing this role.",
    );
  });

  it("answers 404 for an account that is not there", async () => {
    const options = optionsWith({ admin: fakeAdminUserService([]) });
    const res = await loaderApp(loadAdminUserEdit, options, "/page/:id", "u9", stubMinter, true).request("/page/u2");

    expect(res.status).toBe(404);
  });
});

describe("loadAdminElevate", () => {
  it("leaves the claim open while the deployment has no administrator", async () => {
    const options = optionsWith({ admin: fakeAdminUserService([fakeAuthUser()]) });
    const html = await page(loaderApp(loadAdminElevate, options, "/page", "u9"));

    expect(elementsOf(html, "div", 'data-ref="elevate-taken"')).toEqual([]);
    expect(Object.hasOwn(attrsOf(html, 'data-ref="elevate-submit"'), "disabled")).toBe(false);
  });

  it("closes the claim once an administrator exists", async () => {
    const options = optionsWith({ admin: fakeAdminUserService([fakeAuthUser({ isAdmin: true })]) });
    const html = await page(loaderApp(loadAdminElevate, options, "/page", "u9"));

    expect(elementsOf(html, "div", 'data-ref="elevate-taken"')).toHaveLength(1);
  });
});

describe("the icon a page draws from", () => {
  it("renders forge's own markup with a consumer-supplied sprite component", async () => {
    const options = fakeAuthWebOptions({ icon: fakeAuthIcon });
    const html = await page(loaderApp(loadSignup, options));

    expect(elementsOf(html, "svg", 'data-slot="icon"')).toEqual([]);
  });
});

// Two of the nine mint sites used to be checked this way and seven were not, so a token minted for
// the wrong path rendered, submitted and 403-ed with every unit still green.
describe("every token a page renders is bound to the path its own control submits to", () => {
  const challenges: ChallengeStore = { put: async () => ok(undefined), take: async () => ok(null as AuthChallenge | null) };

  const ceremony = { rpId: "example.com", rpName: "Example", origin: "https://example.com", sessionId: "s1", challenges };

  async function boundTo(html: string, selector: string, attr: string, expected: string): Promise<void> {
    const key = await importCsrfKey(CSRF_SECRET);
    expect(await verifyCsrfToken(key, attrOf(html, selector, attr), expected)).toEqual(ok());
  }

  /** The token an htmx form carries in its `hx-headers` payload. */
  function headerToken(html: string, selector: string): string {
    const headers = attrOf(html, selector, "hx-headers").replaceAll("&quot;", '"');
    return headers === "" ? "" : (JSON.parse(headers) as CsrfHeaders)["X-CSRF-Token"];
  }

  it("binds the sign-in form's token to the sign-in submit path", async () => {
    const html = await page(loaderApp(loadSignin, fakeAuthWebOptions(), "/page", undefined, realMinter));
    await boundTo(html, 'data-slot="form-csrf"', "value", "/auth/signin");
  });

  it("binds the sign-up form's token to the sign-up submit path", async () => {
    const html = await page(loaderApp(loadSignup, fakeAuthWebOptions(), "/page", undefined, realMinter));
    await boundTo(html, 'data-slot="form-csrf"', "value", "/auth/signup");
  });

  it("binds the verification form's token to the verification submit path", async () => {
    const html = await page(loaderApp(loadVerify, fakeAuthWebOptions(), "/page", undefined, realMinter));
    await boundTo(html, 'data-slot="form-csrf"', "value", "/auth/verify");
  });

  it("binds the two sign-in ceremony tokens to their own two endpoints", async () => {
    const options = optionsWith({
      passkey: ceremony,
      factors: createFactorRegistry(fakeFactorStore([]), { offered: [{ service: fakeFactorService("passkey"), role: "primary" }] }),
    });
    const html = await page(loaderApp(loadSignin, options, "/page", undefined, realMinter));

    await boundTo(html, 'data-scope="passkey"', "data-passkey-options-token", "/auth/passkey/authenticate/begin");
    await boundTo(html, 'data-scope="passkey"', "data-passkey-verify-token", "/auth/passkey/authenticate/finish");
  });

  it("binds the two enrolment ceremony tokens to their own two endpoints", async () => {
    const options = optionsWith({ users: fakeAuthUserStore([signedIn]), passkey: ceremony });
    const html = await page(loaderApp(loadPasskeyEnrol, options, "/page", "u9", realMinter));

    await boundTo(html, 'data-scope="passkey"', "data-passkey-options-token", "/auth/enrol/passkey/register/begin");
    await boundTo(html, 'data-scope="passkey"', "data-passkey-verify-token", "/auth/enrol/passkey/register/finish");
  });

  it("binds the rename form's token to the credential's own path", async () => {
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      credentials: fakeAuthCredentialStore([fakeAuthCredential({ id: "c1", userId: "u9" })]),
    });
    const html = await (await loaderApp(loadPasskeyEdit, options, "/page/:id", "u9", realMinter).request("/page/c1")).text();

    await boundTo(html, 'data-slot="form-csrf"', "value", "/account/passkeys/c1");
  });

  it("binds the authenticator-app form's token to the authenticator-app path", async () => {
    const enrolling = {
      ...fakeFactorService("totp-app"),
      beginEnrolment: async () => ok({ kind: "totp-app" as const, expiresAt: 1_000, options: { secret: "JBSWY3DP", uri: "otpauth://totp/x" } }),
    } as AuthFactorService;
    const options = optionsWith({
      users: fakeAuthUserStore([signedIn]),
      factors: createFactorRegistry(fakeFactorStore([]), {
        offered: [
          { service: fakeFactorService("email-otp"), role: "primary" },
          { service: enrolling, role: "second", requirement: "optional" },
        ],
      }),
    });
    const html = await page(loaderApp(loadTotpEnrol, options, "/page", "u9", realMinter));

    await boundTo(html, 'data-slot="form-csrf"', "value", "/account/totp");
  });

  it("binds the administrative account form's token to that account's update path", async () => {
    const options = optionsWith({ admin: fakeAdminUserService([fakeAuthUser({ id: "u2" })]) });
    const html = await (await loaderApp(loadAdminUserEdit, options, "/page/:id", "u9", realMinter, true).request("/page/u2")).text();

    const key = await importCsrfKey(CSRF_SECRET);
    expect(await verifyCsrfToken(key, headerToken(html, "hx-patch"), "/admin/users/u2")).toEqual(ok());
  });

  it("binds the elevation form's token to the elevation submit path", async () => {
    const options = optionsWith({ admin: fakeAdminUserService([fakeAuthUser()]) });
    const html = await page(loaderApp(loadAdminElevate, options, "/page", "u9", realMinter));

    await boundTo(html, 'data-slot="form-csrf"', "value", "/admin/elevate");
  });
});
