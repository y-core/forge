import { describe, expect, it } from "bun:test";

import { uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { AuthStoreError } from "../errors";
import { normalizeEmail } from "../stores/email";
import type { AdminUserOutcome, AdminUserStore, AuthUser, AuthUserPage } from "../types";
import { createAdminUserService, isLastAdminRefusal } from "./service";

const AT = 1_700_000_000_000;

function userRow(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: uuidv7(),
    email: "person@example.com",
    emailKey: "person@example.com",
    emailVerifiedAt: 1_600_000_000_000,
    webauthnId: null,
    isAdmin: false,
    deactivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** Models the adapter's guarded statements: guard and write are one step, with no `await` between them. */
function fakeAdminUsers(seed: readonly AuthUser[]) {
  const rows = [...seed];
  const batches: string[][] = [];

  const activeAdmins = () => rows.filter((row) => row.isAdmin && row.deactivatedAt === null).length;
  const indexOf = (id: string) => rows.findIndex((row) => row.id === id);

  function guardedWrite(id: string, guard: boolean, refusal: AdminUserOutcome, write: (row: AuthUser) => AuthUser): AdminUserOutcome {
    const index = indexOf(id);
    const row = rows[index];
    if (index < 0 || !row) return "not-found";
    if (guard && !(row.isAdmin === false || row.deactivatedAt !== null || activeAdmins() > 1)) return refusal;
    rows[index] = write(row);
    return "changed";
  }

  const store: AdminUserStore = {
    findById: (id) => Promise.resolve(ok(rows.find((row) => row.id === id) ?? null)),
    list: (page: AuthUserPage = {}) => Promise.resolve(ok(rows.slice(0, page.limit ?? rows.length))),
    search: (query) => Promise.resolve(ok(rows.filter((row) => row.emailKey.includes(normalizeEmail(query))))),
    countAdmins: () => Promise.resolve(ok(activeAdmins())),
    setAdmin: (id, isAdmin, at) =>
      Promise.resolve(ok(guardedWrite(id, !isAdmin, "last-admin-demote", (row) => ({ ...row, isAdmin, updatedAt: at })))),
    setDeactivated: (id, deactivated, at) =>
      Promise.resolve(
        ok(guardedWrite(id, deactivated, "last-admin-deactivate", (row) => ({ ...row, deactivatedAt: deactivated ? at : null, updatedAt: at }))),
      ),
    remove: (id) => {
      const index = indexOf(id);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok("not-found" as const));
      if (!(row.isAdmin === false || row.deactivatedAt !== null || activeAdmins() > 1)) return Promise.resolve(ok("last-admin-delete" as const));
      batches.push(["auth_credentials", "auth_factors", "auth_identity_links", "auth_users"]);
      rows.splice(index, 1);
      return Promise.resolve(ok("changed" as const));
    },
  };
  return { store, rows, batches };
}

function service(seed: readonly AuthUser[]) {
  const users = fakeAdminUsers(seed);
  return { users, admin: createAdminUserService({ users: users.store }) };
}

describe("createAdminUserService — reads", () => {
  it("lists, views and searches through the store the sign-in path is not given", async () => {
    const alice = userRow({ email: "Alice@Example.com", emailKey: "alice@example.com", isAdmin: true });
    const bob = userRow({ email: "bob@example.com", emailKey: "bob@example.com" });
    const built = service([alice, bob]);

    expect((await built.admin.list()).ok).toBe(true);
    expect(await built.admin.view(alice.id)).toEqual({ ok: true, data: alice });
    const found = await built.admin.search("ALICE@example.com");
    expect(found.ok && found.data.map((row) => row.emailKey)).toEqual(["alice@example.com"]);
  });

  it("reports a user it does not hold as ok(null), never as an error", async () => {
    expect(await service([]).admin.view(uuidv7())).toEqual({ ok: true, data: null });
  });

  it("passes a store outage through as the AuthStoreError it was", async () => {
    const built = service([]);
    built.users.store.list = () => Promise.resolve(err(new AuthStoreError("unavailable", "adminUsers.list")));
    const listed = await built.admin.list();
    expect(listed.ok).toBe(false);
    expect(listed.ok === false && listed.error).toBeInstanceOf(AuthStoreError);
  });
});

describe("createAdminUserService — named writes", () => {
  it("elevates and demotes without a caller ever passing a boolean", async () => {
    const alice = userRow({ isAdmin: true });
    const bob = userRow({ emailKey: "bob@example.com" });
    const built = service([alice, bob]);

    expect(await built.admin.elevate(bob.id, AT)).toEqual({ ok: true, data: "changed" });
    expect(built.users.rows[1]?.isAdmin).toBe(true);
    expect(await built.admin.demote(bob.id, AT)).toEqual({ ok: true, data: "changed" });
    expect(built.users.rows[1]?.isAdmin).toBe(false);
  });

  it("deactivates and reactivates, stamping and clearing the column", async () => {
    const alice = userRow({ isAdmin: true });
    const bob = userRow({ emailKey: "bob@example.com" });
    const built = service([alice, bob]);

    expect(await built.admin.deactivate(bob.id, AT)).toEqual({ ok: true, data: "changed" });
    expect(built.users.rows[1]?.deactivatedAt).toBe(AT);
    expect(await built.admin.reactivate(bob.id, AT)).toEqual({ ok: true, data: "changed" });
    expect(built.users.rows[1]?.deactivatedAt).toBeNull();
  });

  it("reports a missing id from every write, rather than claiming a change", async () => {
    const built = service([]);
    const absent = uuidv7();
    const outcomes = [
      await built.admin.elevate(absent, AT),
      await built.admin.demote(absent, AT),
      await built.admin.deactivate(absent, AT),
      await built.admin.reactivate(absent, AT),
      await built.admin.remove(absent),
    ];
    expect(outcomes.map((outcome) => outcome.ok && outcome.data)).toEqual(["not-found", "not-found", "not-found", "not-found", "not-found"]);
  });

  it("removes the children before the user, in one batch", async () => {
    const alice = userRow({ isAdmin: true });
    const bob = userRow({ emailKey: "bob@example.com" });
    const built = service([alice, bob]);
    expect(await built.admin.remove(bob.id)).toEqual({ ok: true, data: "changed" });
    expect(built.users.batches).toEqual([["auth_credentials", "auth_factors", "auth_identity_links", "auth_users"]]);
  });
});

describe("createAdminUserService — the last-admin guard", () => {
  it("refuses to demote, deactivate or delete the only admin who could still sign in, each under its own reason", async () => {
    const attempts: readonly { write: "demote" | "deactivate" | "remove"; reason: AdminUserOutcome }[] = [
      { write: "demote", reason: "last-admin-demote" },
      { write: "deactivate", reason: "last-admin-deactivate" },
      { write: "remove", reason: "last-admin-delete" },
    ];
    for (const attempt of attempts) {
      const only = userRow({ isAdmin: true });
      const built = service([only]);
      const outcome =
        attempt.write === "remove"
          ? await built.admin.remove(only.id)
          : attempt.write === "demote"
            ? await built.admin.demote(only.id, AT)
            : await built.admin.deactivate(only.id, AT);
      expect(`${attempt.write}: ${outcome.ok && outcome.data}`).toBe(`${attempt.write}: ${attempt.reason}`);
      expect(built.users.rows).toHaveLength(1);
      expect(built.users.rows[0]).toEqual(only);
    }
  });

  it("counts only admins who could still sign in, so deactivate-then-demote cannot strand a deployment", async () => {
    const alice = userRow({ isAdmin: true });
    const bob = userRow({ emailKey: "bob@example.com", isAdmin: true });
    const built = service([alice, bob]);

    expect(await built.admin.deactivate(bob.id, AT)).toEqual({ ok: true, data: "changed" });
    // Two admin rows remain, but only one of them can sign in — which is the count the guard uses.
    expect(await built.admin.demote(alice.id, AT)).toEqual({ ok: true, data: "last-admin-demote" });
  });

  it("lets an operator clean up a deactivated admin, who is not one the deployment could be recovered with", async () => {
    for (const write of ["demote", "remove"] as const) {
      const alice = userRow({ isAdmin: true });
      const bob = userRow({ emailKey: "bob@example.com", isAdmin: true, deactivatedAt: AT });
      const built = service([alice, bob]);
      const outcome = write === "remove" ? await built.admin.remove(bob.id) : await built.admin.demote(bob.id, AT);
      expect(`${write}: ${outcome.ok && outcome.data}`).toBe(`${write}: changed`);
    }
  });

  it("still refuses the last admin who could sign in, even with deactivated admins beside them", async () => {
    const alice = userRow({ isAdmin: true });
    const bob = userRow({ emailKey: "bob@example.com", isAdmin: true, deactivatedAt: AT });
    const built = service([alice, bob]);
    expect(await built.admin.demote(alice.id, AT)).toEqual({ ok: true, data: "last-admin-demote" });
    expect(await built.admin.remove(alice.id)).toEqual({ ok: true, data: "last-admin-delete" });
  });

  it("elevates and reactivates without the guard, because neither can leave a deployment with none", async () => {
    const only = userRow({ isAdmin: true });
    const built = service([only]);
    expect(await built.admin.elevate(only.id, AT)).toEqual({ ok: true, data: "changed" });
    expect(await built.admin.reactivate(only.id, AT)).toEqual({ ok: true, data: "changed" });
  });

  // The falsifiable criterion for this unit.
  it("lets exactly one of two concurrent demotions of the last-but-one admin through", async () => {
    const alice = userRow({ isAdmin: true });
    const bob = userRow({ emailKey: "bob@example.com", isAdmin: true });
    const built = service([alice, bob]);

    const [first, second] = await Promise.all([built.admin.demote(alice.id, AT), built.admin.demote(bob.id, AT)]);
    const outcomes = [first, second].map((outcome) => outcome.ok && outcome.data);
    expect(outcomes.filter((outcome) => outcome === "changed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "last-admin-demote")).toHaveLength(1);
    expect(built.users.rows.filter((row) => row.isAdmin && row.deactivatedAt === null)).toHaveLength(1);
  });
});

describe("isLastAdminRefusal", () => {
  it("names the three guard refusals and nothing else, so a view need not repeat the list", () => {
    const rows: readonly [AdminUserOutcome, boolean][] = [
      ["last-admin-demote", true],
      ["last-admin-deactivate", true],
      ["last-admin-delete", true],
      ["not-found", false],
      ["changed", false],
    ];
    for (const [outcome, expected] of rows) expect(`${outcome}: ${isLastAdminRefusal(outcome)}`).toBe(`${outcome}: ${expected}`);
  });
});
