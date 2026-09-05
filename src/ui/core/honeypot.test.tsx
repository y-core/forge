import { describe, expect, it } from "bun:test";

import { HONEYPOT_FIELD_DEFAULT } from "../../form/constants";
import { isHoneypotFilled } from "../../form/honeypot";
import { render } from "../../testing/render";
import { Honeypot } from "./honeypot";

describe("Honeypot component", () => {
  it("names the decoy after the constant the form parser inspects", async () => {
    expect(await render(<Honeypot />)).toBe(
      `<div aria-hidden="true" class="pointer-events-none absolute -left-[9999px] opacity-0"><input type="text" name="${HONEYPOT_FIELD_DEFAULT}" tabindex="-1" autocomplete="new-password"></div>`,
    );
  });

  it("renders the wrapper markup that hides it from humans, verbatim", async () => {
    expect(await render(<Honeypot />)).toBe(
      '<div aria-hidden="true" class="pointer-events-none absolute -left-[9999px] opacity-0"><input type="text" name="__hp_c7" tabindex="-1" autocomplete="new-password"></div>',
    );
  });

  it("an explicit field name overrides the default", async () => {
    expect(await render(<Honeypot field='website' />)).toBe(
      '<div aria-hidden="true" class="pointer-events-none absolute -left-[9999px] opacity-0"><input type="text" name="website" tabindex="-1" autocomplete="new-password"></div>',
    );
  });

  it("the default it renders is the one isHoneypotFilled reads with no argument", async () => {
    const html = await render(<Honeypot />);
    expect(html).toBe(
      `<div aria-hidden="true" class="pointer-events-none absolute -left-[9999px] opacity-0"><input type="text" name="${HONEYPOT_FIELD_DEFAULT}" tabindex="-1" autocomplete="new-password"></div>`,
    );

    const filled = new FormData();
    filled.set(HONEYPOT_FIELD_DEFAULT, "bot was here");
    expect(isHoneypotFilled(filled)).toBe(true);

    expect(isHoneypotFilled(new FormData())).toBe(false);
  });
});
