/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { authPaths } from "../paths";
import { authRoutes } from "../routes";
import { attrOf, attrsOf, textOf } from "../test-support";
import { AuthSignout } from "./signout";

const AUTH = authPaths(authRoutes("/auth"));

describe("AuthSignout", () => {
  it("submits the sign-out route as a POST carrying the token", async () => {
    const html = await render(<AuthSignout action={AUTH.signout()} csrfToken='tok' />);

    expect(attrOf(html, 'data-slot="form"', "action")).toBe("/auth/signout");
    expect(attrOf(html, 'data-slot="form"', "method")).toBe("post");
    expect(attrOf(html, 'data-slot="form-csrf"', "value")).toBe("tok");
    expect(attrOf(html, 'data-ref="signout"', "type")).toBe("submit");
  });

  it("names the action in its own words", async () => {
    const html = await render(<AuthSignout action={AUTH.signout()} csrfToken='tok' />);

    expect(textOf(html, "button", 'data-ref="signout"')).toBe("Sign out");
  });

  it("carries the token on the header the app renamed it to", async () => {
    const html = await render(<AuthSignout action={AUTH.signout()} csrfToken='tok' csrfHeader='X-App-Token' />);

    expect(attrOf(html, 'data-slot="form"', "hx-headers")).toBe("{&quot;X-App-Token&quot;:&quot;tok&quot;}");
  });

  it("takes the wording a host gives it instead", async () => {
    const html = await render(<AuthSignout action={AUTH.signout()} csrfToken='tok' label='Leave' />);

    expect(textOf(html, "button", 'data-ref="signout"')).toBe("Leave");
  });

  it("is an item of the menu it is placed in, when it is placed in one", async () => {
    const html = await render(<AuthSignout action={AUTH.signout()} csrfToken='tok' menuitem />);

    expect(attrOf(html, 'data-ref="signout"', "role")).toBe("menuitem");
  });

  // The default is a card footer's control, which announcing as a menu item would misdescribe to a
  // screen reader — so the role is absent rather than empty.
  it("claims no menu role where no host asked for one", async () => {
    const html = await render(<AuthSignout action={AUTH.signout()} csrfToken='tok' />);

    expect(Object.keys(attrsOf(html, 'data-ref="signout"'))).not.toContain("role");
  });

  // Measured against the same render without a class, so the assertion is the host's classes landing
  // last — after the button's own, which is what decides the winner of a conflicting utility.
  it("composes the host's classes onto the button it submits with, not the form", async () => {
    const plain = await render(<AuthSignout action={AUTH.signout()} csrfToken='tok' />);
    const placed = await render(<AuthSignout action={AUTH.signout()} csrfToken='tok' class='w-full' />);

    expect(attrOf(placed, 'data-ref="signout"', "class")).toBe(`${attrOf(plain, 'data-ref="signout"', "class")} w-full`);
    expect(attrOf(placed, 'data-slot="form"', "class")).toBe("");
  });
});
