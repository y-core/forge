/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import type { AdminUserOutcome, AuthUser } from "../../types";
import { authPaths } from "../paths";
import { adminRoutes } from "../routes";
import { attrOf, attrsOf, elementsOf, HOSTILE_TEXT, HOSTILE_TEXT_ESCAPED, tagOf, textOf } from "../test-support";
import { AdminUserEditView } from "./admin-user-edit";
import type { AdminUserEditViewProps } from "./types";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert">;

const ADMIN = authPaths(adminRoutes("/admin"));

const CREATED_AT = 1735689600000;

const DEMOTE_REASON = "This is the last admin who can still sign in — promote another admin before removing this role.";

const DEACTIVATE_REASON = "This is the last admin who can still sign in — promote another admin before deactivating this account.";

const DELETE_REASON = "This is the last admin who can still sign in — promote another admin before deleting this account.";

const NOT_FOUND_REASON = "That account no longer exists, so nothing was changed.";

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    email: "ada@example.com",
    emailKey: "ada@example.com",
    emailVerifiedAt: CREATED_AT,
    isAdmin: true,
    deactivatedAt: null,
    webauthnId: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function account(props: Partial<AdminUserEditViewProps> = {}) {
  return render(<AdminUserEditView user={user()} lastAdmin={false} outcome={null} paths={ADMIN} csrfToken='csrf-1' icon={AppIcon} {...props} />);
}

describe("AdminUserEditView heading", () => {
  it("names the account it is about, escaping the address", async () => {
    expect(textOf(await account({ user: user({ email: HOSTILE_TEXT }) }), "h1", 'data-ref="admin-user-email"')).toBe(HOSTILE_TEXT_ESCAPED);
  });

  it("dates the account and states its role", async () => {
    const html = await account();
    expect(textOf(html, "span", 'data-ref="admin-user-created"')).toBe(
      'Created <time datetime="2025-01-01T00:00:00.000Z" class="tabular-nums">2025-01-01</time>',
    );
    expect(textOf(html, "span", 'data-ref="admin-user-role"')).toBe("Admin");
  });
});

describe("AdminUserEditView controls when nothing is guarded", () => {
  it("leaves all three controls live", async () => {
    const html = await account({ user: user({ isAdmin: false }) });
    expect(attrsOf(html, 'data-ref="admin-role-submit"')["disabled"]).toBe(undefined);
    expect(attrsOf(html, 'data-ref="admin-status-submit"')["disabled"]).toBe(undefined);
    expect(attrsOf(html, 'data-ref="admin-delete-submit"')["disabled"]).toBe(undefined);
  });

  it("states no reason, because nothing is refused", async () => {
    const html = await account({ user: user({ isAdmin: false }) });
    expect(tagOf(html, 'data-ref="admin-role-reason"')).toBe("");
    expect(tagOf(html, 'data-ref="admin-status-reason"')).toBe("");
    expect(tagOf(html, 'data-ref="admin-delete-reason"')).toBe("");
  });

  it("offers the role change in the direction the account is not already in", async () => {
    expect(textOf(await account(), "button", 'data-ref="admin-role-submit"')).toBe("Remove the admin role");
    expect(textOf(await account({ user: user({ isAdmin: false }) }), "button", 'data-ref="admin-role-submit"')).toBe("Grant the admin role");
  });

  it("offers the status change in the direction the account is not already in", async () => {
    expect(textOf(await account(), "button", 'data-ref="admin-status-submit"')).toBe("Deactivate this account");
    expect(textOf(await account({ user: user({ deactivatedAt: CREATED_AT }) }), "button", 'data-ref="admin-status-submit"')).toBe(
      "Reactivate this account",
    );
  });
});

// The point of the view: the store refuses these three writes for the last active admin, and an
// administrator who cannot see why a control is dead will go to the database instead.
describe("AdminUserEditView controls guarded by the last-admin rule", () => {
  it("disables all three writes for the last admin who could still sign in", async () => {
    const html = await account({ lastAdmin: true });
    expect(attrsOf(html, 'data-ref="admin-role-submit"')["disabled"]).toBe("");
    expect(attrsOf(html, 'data-ref="admin-status-submit"')["disabled"]).toBe("");
    expect(attrsOf(html, 'data-ref="admin-delete-submit"')["disabled"]).toBe("");
  });

  it("states each refusal in its own words beside the control it disables", async () => {
    const html = await account({ lastAdmin: true });
    expect(textOf(html, "p", 'data-ref="admin-role-reason"')).toBe(DEMOTE_REASON);
    expect(textOf(html, "p", 'data-ref="admin-status-reason"')).toBe(DEACTIVATE_REASON);
    expect(textOf(html, "p", 'data-ref="admin-delete-reason"')).toBe(DELETE_REASON);
  });

  it("names each reason as its control's description, so it is announced with the control", async () => {
    const html = await account({ lastAdmin: true });
    expect(attrOf(html, 'data-ref="admin-role-submit"', "aria-describedby")).toBe("admin-role-reason");
    expect(attrOf(html, 'data-ref="admin-status-submit"', "aria-describedby")).toBe("admin-status-reason");
    expect(attrOf(html, 'data-ref="admin-delete-submit"', "aria-describedby")).toBe("admin-delete-reason");
  });

  it("leaves the role control live for a last admin who is not currently an admin, which the guard permits", async () => {
    const html = await account({ user: user({ isAdmin: false }), lastAdmin: true });
    expect(attrsOf(html, 'data-ref="admin-role-submit"')["disabled"]).toBe(undefined);
    expect(tagOf(html, 'data-ref="admin-role-reason"')).toBe("");
  });

  it("leaves the status control live for a last admin already deactivated, since reactivating strands nobody", async () => {
    const html = await account({ user: user({ deactivatedAt: CREATED_AT }), lastAdmin: true });
    expect(attrsOf(html, 'data-ref="admin-status-submit"')["disabled"]).toBe(undefined);
    expect(tagOf(html, 'data-ref="admin-status-reason"')).toBe("");
  });
});

describe("AdminUserEditView after a write reported back", () => {
  const refusals: readonly (readonly [AdminUserOutcome, string])[] = [
    ["last-admin-demote", DEMOTE_REASON],
    ["last-admin-deactivate", DEACTIVATE_REASON],
    ["last-admin-delete", DELETE_REASON],
    ["not-found", NOT_FOUND_REASON],
  ];

  for (const [outcome, reason] of refusals) {
    it(`explains a ${outcome} refusal in the words that name what was refused`, async () => {
      const html = await account({ outcome });
      expect(textOf(html, "div", 'data-slot="alert-title"')).toBe("That change was refused");
      expect(textOf(html, "div", 'data-slot="alert-description"')).toBe(reason);
    });
  }

  it("marks the refusal as destructive, not as ordinary information", async () => {
    expect(attrsOf(await account({ outcome: "last-admin-demote" }), 'data-ref="admin-refusal"')["data-tone"]).toBe("destructive");
  });

  it("says nothing on a plain page load, when no write has been attempted", async () => {
    expect(tagOf(await account(), 'data-ref="admin-refusal"')).toBe("");
  });

  it("says nothing after a write that succeeded", async () => {
    expect(tagOf(await account({ outcome: "changed" }), 'data-ref="admin-refusal"')).toBe("");
  });

  it("disables the guarded writes after a last-admin refusal, even where the page was not told it was the last admin", async () => {
    const html = await account({ lastAdmin: false, outcome: "last-admin-demote" });
    expect(attrsOf(html, 'data-ref="admin-role-submit"')["disabled"]).toBe("");
    expect(attrsOf(html, 'data-ref="admin-delete-submit"')["disabled"]).toBe("");
  });

  it("leaves the controls live after a not-found refusal, which the last-admin guard did not cause", async () => {
    expect(attrsOf(await account({ outcome: "not-found" }), 'data-ref="admin-role-submit"')["disabled"]).toBe(undefined);
  });
});

describe("AdminUserEditView paths", () => {
  it("sends both updates to the account's own update path and the delete to its remove path", async () => {
    const html = await account();
    expect(elementsOf(html, "form", 'hx-patch="/admin/users/u1"').length).toBe(2);
    expect(attrOf(html, 'hx-delete="/admin/users/u1"', "hx-delete")).toBe("/admin/users/u1");
  });

  it("follows the mount point, so no path in the markup is a literal", async () => {
    const html = await account({ paths: authPaths(adminRoutes("/staff")) });
    expect(elementsOf(html, "form", 'hx-patch="/staff/users/u1"').length).toBe(2);
    expect(attrOf(html, 'hx-delete="/staff/users/u1"', "hx-delete")).toBe("/staff/users/u1");
  });

  it("carries the CSRF token into the header htmx sends every one of the three writes on", async () => {
    const html = await account();
    expect(elementsOf(html, "form", 'hx-headers="{&quot;X-CSRF-Token&quot;:&quot;csrf-1&quot;}"').length).toBe(3);
  });
});
