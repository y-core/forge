import { describe, expect, it } from "bun:test";

import { authEnrolmentPaths, authEnrolTarget, authPaths, authWithQuery } from "./paths";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";

describe("authPaths", () => {
  it("reads a top-level href back off the route map", () => {
    expect(authPaths(authRoutes("/auth")).signin()).toBe("/auth/signin");
  });

  it("mirrors every nested group as a nested reader", () => {
    const paths = authPaths(authRoutes("/auth"));
    expect(paths.enrol.passkey()).toBe("/auth/enrol/passkey");
    expect(paths.enrol.ceremony.finish()).toBe("/auth/enrol/passkey/register/finish");
  });

  it("substitutes a route parameter", () => {
    expect(authPaths(accountRoutes("/account")).passkey({ id: "cred-1" })).toBe("/account/passkeys/cred-1");
    expect(authPaths(adminRoutes("/admin")).users.edit({ id: "user-1" })).toBe("/admin/users/user-1/edit");
  });

  it("follows the mount point, so remounting moves every link with it", () => {
    expect(authPaths(authRoutes("/login")).signin()).toBe("/login/signin");
    expect(authPaths(adminRoutes("/staff")).elevate.submit()).toBe("/staff/elevate");
  });

  it("appends search parameters a caller supplies", () => {
    expect(authPaths(authRoutes("/auth")).verify.show({}, { searchParams: { token: "abc" } })).toBe("/auth/verify?token=abc");
  });
});

describe("authWithQuery", () => {
  it("starts a query on a bare path, and extends one a path already carries", () => {
    expect([authWithQuery("/auth/verify", "factor", "totp-app"), authWithQuery("/auth/verify?next=%2Fapp", "factor", "totp-app")]).toEqual([
      "/auth/verify?factor=totp-app",
      "/auth/verify?next=%2Fapp&factor=totp-app",
    ]);
  });

  it("encodes the value, so a path cannot be smuggled into the query", () => {
    expect(authWithQuery("/auth/verify", "next", "/account/recovery-codes?x=1")).toBe("/auth/verify?next=%2Faccount%2Frecovery-codes%3Fx%3D1");
  });
});

describe("authEnrolmentPaths", () => {
  it("never names recovery codes as an enrolment page, since they are issued after a step-up", () => {
    expect(Object.keys(authEnrolmentPaths(authPaths(authRoutes("/auth"))).kinds)).not.toContain("recovery-code");
  });
});

describe("authEnrolTarget", () => {
  const cases = [
    {
      label: "goes straight to the page of the one kind owed",
      paths: { kinds: { passkey: "/pk", "totp-app": "/app" } },
      kinds: ["passkey"],
      expected: "/pk",
    },
    {
      label: "goes to the first owed kind's page when two owed kinds each have one, since every owed kind must be enrolled",
      paths: { kinds: { passkey: "/pk", "totp-app": "/app" } },
      kinds: ["totp-app", "passkey"],
      expected: "/app",
    },
    {
      label: "goes straight to the one page when two kinds are owed but only one has a page",
      paths: { kinds: { "totp-app": "/app" } },
      kinds: ["passkey", "totp-app"],
      expected: "/app",
    },
    { label: "names no page when no owed kind has one", paths: { kinds: { "totp-app": "/app" } }, kinds: ["passkey"], expected: undefined },
    { label: "names no page when nothing is owed", paths: { kinds: { passkey: "/pk" } }, kinds: [], expected: undefined },
  ] as const;

  for (const { label, paths, kinds, expected } of cases) {
    it(label, () => {
      expect(authEnrolTarget(paths, kinds)).toBe(expected);
    });
  }
});
