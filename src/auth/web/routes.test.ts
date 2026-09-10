import { describe, expect, it } from "bun:test";

import { Route } from "@remix-run/fetch-router/routes";
import type { RouteMap } from "@remix-run/fetch-router/routes";

import { createApp } from "../../app/app";
import { routePaths } from "../../router/filter";
import { AUTH_ROUTE_GROUPS, accountRoutes, adminRoutes, authRoutes } from "./routes";
import type { AuthRouteGroup } from "./types";

/** Every nested map in `routeMap`, as key paths prefixed by `prefix`, deepest last. */
function nestedGroups(routeMap: RouteMap, prefix: readonly string[]): string[][] {
  const found: string[][] = [[...prefix]];
  for (const [name, value] of Object.entries(routeMap)) {
    if (value instanceof Route) continue;
    found.push(...nestedGroups(value, [...prefix, name]));
  }
  return found;
}

function builtGroups(): string[][] {
  return [
    ...nestedGroups(authRoutes("/auth"), ["auth"]),
    ...nestedGroups(accountRoutes("/account"), ["account"]),
    ...nestedGroups(adminRoutes("/admin"), ["admin"]),
  ];
}

function groupAt(path: readonly string[]): AuthRouteGroup | undefined {
  return AUTH_ROUTE_GROUPS.find((group) => group.path.join(".") === path.join("."));
}

function sameStack(a: AuthRouteGroup, b: AuthRouteGroup): boolean {
  return a.guards.join(",") === b.guards.join(",");
}

describe("AUTH_ROUTE_GROUPS", () => {
  it("names every group the three builders produce, and no group they do not", () => {
    const built = builtGroups()
      .map((path) => path.join("."))
      .sort();
    const declared = AUTH_ROUTE_GROUPS.map((group) => group.path.join(".")).sort();
    expect(declared).toEqual(built);
  });

  it("nests a group only where its middleware stack or its response medium differs from its parent's", () => {
    for (const group of AUTH_ROUTE_GROUPS) {
      if (group.path.length < 2) continue;
      const parent = groupAt(group.path.slice(0, -1));
      expect(parent).toBeDefined();
      const differs = !sameStack(group, parent as AuthRouteGroup) || group.medium !== (parent as AuthRouteGroup).medium;
      expect({ group: group.path.join("."), differs }).toEqual({ group: group.path.join("."), differs: true });
    }
  });

  it("leaves `admin.elevate` un-admin-gated, because it creates the first admin", () => {
    expect(groupAt(["admin", "users"])?.guards).toEqual(["require-auth", "require-enrolment", "require-admin"]);
    expect(groupAt(["admin", "elevate"])?.guards).toEqual(["require-auth", "require-enrolment", "require-fresh-step-up"]);
  });

  it("admits `auth.enrol` only on an owed enrolment, so the group that makes the factor is not reachable without owing one", () => {
    expect(groupAt(["auth", "enrol"])?.guards).toEqual(["require-auth", "require-pending-enrolment"]);
    expect(groupAt(["auth", "enrol", "ceremony"])?.guards).toEqual(["require-auth", "require-pending-enrolment"]);
    expect(groupAt(["account"])?.guards).toEqual(["require-auth", "require-enrolment", "require-fresh-step-up"]);
  });

  it("orders `require-auth` before every guard that reads the identity it establishes", () => {
    for (const group of AUTH_ROUTE_GROUPS) {
      // `resolve-auth` establishes rather than reads, so a group carrying only it depends on nothing.
      const dependents = group.guards.filter((guard) => guard !== "require-auth" && guard !== "resolve-auth");
      if (dependents.length === 0) continue;
      expect({ group: group.path.join("."), first: group.guards[0] }).toEqual({ group: group.path.join("."), first: "require-auth" });
    }
  });
});

describe("authRoutes", () => {
  it("produces every unauthenticated, passkey and enrolment path", () => {
    expect(routePaths(authRoutes("/auth")).sort()).toEqual(
      [
        "/auth/signin",
        "/auth/signin",
        "/auth/signup",
        "/auth/signup",
        "/auth/verify",
        "/auth/verify",
        "/auth/verify/resend",
        "/auth/verify/passkey/begin",
        "/auth/verify/passkey/finish",
        "/auth/signout",
        "/auth/passkey/authenticate/begin",
        "/auth/passkey/authenticate/finish",
        "/auth/enrol/passkey",
        "/auth/enrol/totp",
        "/auth/enrol/totp",
        "/auth/enrol/passkey/register/begin",
        "/auth/enrol/passkey/register/finish",
      ].sort(),
    );
  });

  it("moves every path with the mount point", () => {
    expect(routePaths(authRoutes("/login")).every((path) => path.startsWith("/login/"))).toBe(true);
  });
});

describe("accountRoutes", () => {
  it("produces every self-service path", () => {
    expect(routePaths(accountRoutes("/account")).sort()).toEqual(
      [
        "/account/passkeys",
        "/account/passkeys/:id",
        "/account/passkeys/:id/edit",
        "/account/passkeys/:id",
        "/account/passkeys/:id",
        "/account/totp",
        "/account/totp",
        "/account/totp",
        "/account/email-change",
        "/account/email-change",
        "/account/factors",
      ].sort(),
    );
  });
});

describe("adminRoutes", () => {
  it("produces every user-management and elevation path", () => {
    expect(routePaths(adminRoutes("/admin")).sort()).toEqual(
      [
        "/admin/users",
        "/admin/users/:id",
        "/admin/users/:id/edit",
        "/admin/users/:id/factors",
        "/admin/users/:id",
        "/admin/users/:id",
        "/admin/elevate",
        "/admin/elevate",
      ].sort(),
    );
  });

  it("registers each group on its own, which is what a per-group middleware stack requires", async () => {
    const app = createApp();
    const routes = adminRoutes("/admin");
    app.map(routes.users, {
      actions: {
        list: () => new Response("users"),
        show: () => new Response("user"),
        edit: () => new Response("edit"),
        factors: () => new Response("factors"),
        update: () => new Response("updated"),
        remove: () => new Response("removed"),
      },
    });
    app.map(routes.elevate, { actions: { show: () => new Response("elevate"), submit: () => new Response("elevated") } });

    expect(await (await app.request("/admin/users")).text()).toBe("users");
    expect(await (await app.request("/admin/elevate")).text()).toBe("elevate");
  });
});
