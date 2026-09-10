/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { createIcon } from "../../../ui/core/icon";
import type { ForgeIcon } from "../../../ui/core/types";
import { authPaths } from "../paths";
import { adminRoutes } from "../routes";
import { attrOf, attrsOf, tagOf, textOf } from "../test-support";
import { AdminElevateView } from "./admin-elevate";
import type { AdminElevateViewProps } from "./types";

const AppIcon = createIcon("/assets/icons.svg") as ForgeIcon<"alert">;

const ADMIN = authPaths(adminRoutes("/admin"));

const TAKEN_REASON = "This deployment already has an administrator, so the first-admin claim is closed. Ask one of them to grant you the role.";

function elevate(props: Partial<AdminElevateViewProps> = {}) {
  return render(<AdminElevateView adminCount={0} paths={ADMIN} csrfToken='csrf-1' icon={AppIcon} {...props} />);
}

describe("AdminElevateView while the claim is open", () => {
  it("leaves the claim live when no admin could sign in", async () => {
    expect(attrsOf(await elevate(), 'data-ref="elevate-submit"')["disabled"]).toBe(undefined);
  });

  it("says nothing about a closed claim, because it is not closed", async () => {
    const html = await elevate();
    expect(tagOf(html, 'data-ref="elevate-taken"')).toBe("");
    expect(attrOf(html, 'data-ref="elevate-submit"', "aria-describedby")).toBe("");
  });

  it("requires the claim to be explicit rather than a bare GET", async () => {
    const html = await elevate();
    expect(attrOf(html, 'name="confirm"', "value")).toBe("yes");
    expect(attrOf(html, 'data-slot="form"', "method")).toBe("post");
  });
});

// This route is deliberately not admin-gated — it is where the first admin is made, so anyone signed
// in reaches it. The refusal therefore has to be legible on the page rather than left to the write.
describe("AdminElevateView once the claim is taken", () => {
  it("disables the claim once an admin exists", async () => {
    expect(attrsOf(await elevate({ adminCount: 1 }), 'data-ref="elevate-submit"')["disabled"]).toBe("");
  });

  it("states the reason as a warning rather than leaving a dead control unexplained", async () => {
    const html = await elevate({ adminCount: 1 });
    expect(attrsOf(html, 'data-ref="elevate-taken"')["data-tone"]).toBe("warning");
    expect(textOf(html, "div", 'data-slot="alert-title"')).toBe("The claim is closed");
    expect(textOf(html, "div", 'data-slot="alert-description"')).toBe(TAKEN_REASON);
  });

  it("names the reason as the control's description, so it is announced with the control", async () => {
    const html = await elevate({ adminCount: 1 });
    expect(attrOf(html, 'data-ref="elevate-taken"', "id")).toBe("admin-elevate-reason");
    expect(attrOf(html, 'data-ref="elevate-submit"', "aria-describedby")).toBe("admin-elevate-reason");
  });

  it("stays closed however many admins there are, not just at exactly one", async () => {
    expect(attrsOf(await elevate({ adminCount: 7 }), 'data-ref="elevate-submit"')["disabled"]).toBe("");
  });
});

describe("AdminElevateView paths", () => {
  it("reads the submit path off the route map", async () => {
    expect(attrOf(await elevate(), 'data-slot="form"', "action")).toBe("/admin/elevate");
  });

  it("follows the mount point, so no path in the markup is a literal", async () => {
    const html = await elevate({ paths: authPaths(adminRoutes("/staff")) });
    expect(attrOf(html, 'data-slot="form"', "action")).toBe("/staff/elevate");
  });

  it("carries the CSRF token in the header htmx sends and the field a plain post sends", async () => {
    const html = await elevate();
    expect(attrOf(html, 'data-slot="form"', "hx-headers")).toBe("{&quot;X-CSRF-Token&quot;:&quot;csrf-1&quot;}");
    expect(attrOf(html, 'data-slot="form-csrf"', "value")).toBe("csrf-1");
  });
});
