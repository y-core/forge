import { describe, expect, it } from "bun:test";
import { HONEYPOT_FIELD_DEFAULT } from "../../form/constants";
import { isHoneypotFilled } from "../../form/honeypot";
import { render } from "../../jsx/render-test-helper";
import { Honeypot } from "./honeypot";

describe("Honeypot component", () => {
  /**
   * The name is interpolated from `form/constants.ts` rather than written as a literal. Renaming the
   * constant is then a failing test instead of a silently disabled honeypot: the component and the
   * parser that inspects the submission have to keep naming the same field.
   */
  it("names the decoy after the constant the form parser inspects", async () => {
    expect(await render(<Honeypot />)).toBe(
      `<div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="${HONEYPOT_FIELD_DEFAULT}" tabindex="-1" autocomplete="off"></div>`,
    );
  });

  it("renders the wrapper markup that hides it from humans, verbatim", async () => {
    // `aria-hidden` keeps it off the accessibility tree, `tabindex=-1` off the tab order, and the
    // off-canvas position off the screen — a bot filling every field it parses still trips it.
    expect(await render(<Honeypot />)).toBe(
      '<div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="__surname" tabindex="-1" autocomplete="off"></div>',
    );
  });

  it("an explicit field name overrides the default", async () => {
    expect(await render(<Honeypot field='website' />)).toBe(
      '<div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>',
    );
  });

  it("the default it renders is the one isHoneypotFilled reads with no argument", async () => {
    // The two halves of the pattern agree only if the component's default and the checker's default
    // are the same constant — asserted end to end rather than by inspecting either in isolation.
    const html = await render(<Honeypot />);
    expect(html).toContain(`name="${HONEYPOT_FIELD_DEFAULT}"`);

    const filled = new FormData();
    filled.set(HONEYPOT_FIELD_DEFAULT, "bot was here");
    expect(isHoneypotFilled(filled)).toBe(true);

    expect(isHoneypotFilled(new FormData())).toBe(false);
  });
});
