/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import type { AuthUser } from "../../types";
import { authPaths } from "../paths";
import { adminRoutes } from "../routes";
import { attrOf, elementsOf, HOSTILE_TEXT, HOSTILE_TEXT_ESCAPED, tagOf, textOf } from "../test-support";
import { AdminUsersView } from "./admin-users";
import type { AdminUsersViewProps } from "./types";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"chevron-right">;

const ADMIN = authPaths(adminRoutes("/admin"));

const CREATED_AT = 1735689600000;

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    email: "ada@example.com",
    emailKey: "ada@example.com",
    emailVerifiedAt: CREATED_AT,
    isAdmin: false,
    deactivatedAt: null,
    sessionsInvalidBefore: null,
    webauthnId: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function users(props: Partial<AdminUsersViewProps> = {}) {
  return render(<AdminUsersView users={[user()]} query='' nextCursor={null} paths={ADMIN} icon={AppIcon} {...props} />);
}

describe("AdminUsersView listing", () => {
  it("renders one row per account", async () => {
    const html = await users({ users: [user(), user({ id: "u2", email: "bob@example.com" })] });
    expect(elementsOf(html, "tr", 'data-ref="admin-user-row"').length).toBe(2);
  });

  it("escapes an address, which is visitor-supplied text like any other", async () => {
    const html = await users({ users: [user({ email: HOSTILE_TEXT })] });
    expect(textOf(html, "td", 'data-ref="admin-user-email"')).toBe(HOSTILE_TEXT_ESCAPED);
  });

  it("names the role rather than leaving it to a colour", async () => {
    expect(textOf(await users(), "span", 'data-ref="admin-user-role"')).toBe("Member");
    expect(textOf(await users({ users: [user({ isAdmin: true })] }), "span", 'data-ref="admin-user-role"')).toBe("Admin");
  });

  it("names the status rather than leaving it to a colour", async () => {
    expect(textOf(await users(), "span", 'data-ref="admin-user-status"')).toBe("Active");
    expect(textOf(await users({ users: [user({ deactivatedAt: CREATED_AT })] }), "span", 'data-ref="admin-user-status"')).toBe("Deactivated");
  });

  it("dates a verified address and badges an unverified one, which is the exception being scanned for", async () => {
    expect(textOf(await users({ users: [user({ emailVerifiedAt: CREATED_AT })] }), "time", 'data-ref="admin-user-verified"')).toBe("2025-01-01");
    expect(textOf(await users({ users: [user({ emailVerifiedAt: null })] }), "span", 'data-ref="admin-user-verified"')).toBe("Unverified");
  });

  it("dates each account from its stored millisecond, machine-readable beside the text", async () => {
    expect(textOf(await users(), "time", 'datetime="2025-01-01T00:00:00.000Z"')).toBe("2025-01-01");
  });

  it("links each row to that account's own page", async () => {
    expect(attrOf(await users(), 'data-ref="admin-user-manage"', "href")).toBe("/admin/users/u1/edit");
  });
});

// Two emptinesses, and telling them apart is the point: "nobody has signed up" and "your search
// matched nothing" need different words and only one of them offers a way back.
describe("AdminUsersView when there is nothing to list", () => {
  it("says the deployment is new when the listing is unfiltered", async () => {
    const html = await users({ users: [] });
    expect(textOf(html, "h2", 'data-slot="empty-state-title"')).toBe("No accounts yet");
    expect(textOf(html, "p", 'data-slot="empty-state-description"')).toBe("An account appears here the first time someone signs up.");
  });

  it("says the search matched nothing when there was a search", async () => {
    const html = await users({ users: [], query: "zz" });
    expect(textOf(html, "h2", 'data-slot="empty-state-title"')).toBe("No account matches that search");
    expect(textOf(html, "p", 'data-slot="empty-state-description"')).toBe("Search matches a whole address or the start of one.");
  });

  it("offers the way back to the unfiltered listing", async () => {
    expect(attrOf(await users({ users: [], query: "zz" }), 'data-ref="admin-user-clear"', "href")).toBe("/admin/users");
  });

  it("draws the designed empty state instead of an empty table", async () => {
    const html = await users({ users: [] });
    expect(tagOf(html, 'data-slot="table"')).toBe("");
  });
});

describe("AdminUsersView search and paging", () => {
  it("posts the search back to the listing itself, as a GET so the result is linkable", async () => {
    const html = await users();
    expect(attrOf(html, 'data-ref="admin-user-search"', "action")).toBe("/admin/users");
    expect(attrOf(html, 'data-ref="admin-user-search"', "method")).toBe("get");
  });

  it("keeps the term in the field, so a refined search starts from the last one", async () => {
    expect(attrOf(await users({ query: "ada" }), 'data-slot="input"', "value")).toBe("ada");
  });

  it("offers no next page when the cursor says this is the last one", async () => {
    expect(tagOf(await users(), 'data-ref="admin-user-next"')).toBe("");
  });

  it("carries the cursor forward on an unfiltered listing", async () => {
    expect(attrOf(await users({ nextCursor: "u9" }), 'data-ref="admin-user-next"', "href")).toBe("/admin/users?after=u9");
  });

  it("carries the search term forward with the cursor, so paging does not drop the filter", async () => {
    const html = await users({ nextCursor: "u9", query: "ada" });
    expect(attrOf(html, 'data-ref="admin-user-next"', "href")).toBe("/admin/users?q=ada&amp;after=u9");
  });
});

describe("AdminUsersView paths", () => {
  it("follows the mount point, so no path in the markup is a literal", async () => {
    const html = await users({ nextCursor: "u9", paths: authPaths(adminRoutes("/staff")) });
    expect(attrOf(html, 'data-ref="admin-user-manage"', "href")).toBe("/staff/users/u1/edit");
    expect(attrOf(html, 'data-ref="admin-user-next"', "href")).toBe("/staff/users?after=u9");
    expect(attrOf(html, 'data-ref="admin-user-search"', "action")).toBe("/staff/users");
  });
});
