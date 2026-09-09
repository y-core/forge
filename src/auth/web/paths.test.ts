import { describe, expect, it } from "bun:test";

import { authPaths } from "./paths";
import { accountRoutes, adminRoutes, authRoutes } from "./routes";

describe("authPaths", () => {
  it("reads a top-level href back off the route map", () => {
    expect(authPaths(authRoutes("/auth")).signin()).toBe("/auth/signin");
  });

  it("mirrors every nested group as a nested reader", () => {
    const paths = authPaths(authRoutes("/auth"));
    expect(paths.passkey.authenticateBegin()).toBe("/auth/passkey/authenticate/begin");
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
    expect(authPaths(authRoutes("/auth")).verify.show({}, { token: "abc" })).toBe("/auth/verify?token=abc");
  });
});
