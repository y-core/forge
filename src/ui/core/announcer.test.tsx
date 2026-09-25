import { describe, expect, it } from "bun:test";

import { attrsOf, classesOf } from "../../testing/markup";
import { render } from "../../testing/render";
import { ANNOUNCER_REGION_SLOTS, ANNOUNCER_SCOPE } from "../contracts/announcer-contract";
import { Announcer } from "./announcer";

describe("Announcer", () => {
  it("renders one hidden container holding an empty polite region and an empty assertive region", async () => {
    expect(await render(<Announcer />)).toBe(
      `<div data-slot="announcer" data-scope="${ANNOUNCER_SCOPE}" class="sr-only">` +
        `<div data-slot="${ANNOUNCER_REGION_SLOTS.polite}" aria-live="polite"></div>` +
        `<div data-slot="${ANNOUNCER_REGION_SLOTS.assertive}" aria-live="assertive"></div></div>`,
    );
  });

  it("reads each added message alone, so a message still lingering is never spoken again", async () => {
    const html = await render(<Announcer />);

    expect(attrsOf(html, `data-slot="${ANNOUNCER_REGION_SLOTS.polite}"`)["aria-atomic"]).toBeUndefined();
    expect(attrsOf(html, `data-slot="${ANNOUNCER_REGION_SLOTS.assertive}"`)["aria-atomic"]).toBeUndefined();
  });

  it("forwards an id and a data attribute to the container, and appends a caller class after its own", async () => {
    const html = await render(<Announcer id='sr' data-testid='announcer' class='my-announcer' />);

    expect(attrsOf(html)).toEqual({ "data-slot": "announcer", "data-scope": ANNOUNCER_SCOPE, id: "sr", "data-testid": "announcer" });
    expect(classesOf(html)).toEqual(["sr-only", "my-announcer"]);
  });
});
