import { describe, expect, it } from "bun:test";

import { attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Join } from "./join";

describe("Join", () => {
  it("renders the whole group exactly, its children nested and a forwarded value escaped", async () => {
    expect(
      await render(
        <Join data-note='a&b'>
          <span>{`R&D's`}</span>
        </Join>,
      ),
    ).toBe(
      '<div data-slot="join" class="inline-flex items-stretch" data-orientation="horizontal" data-note="a&amp;b">' +
        "<span>R&amp;D&#39;s</span></div>",
    );
  });

  it("lays its members along the inline axis unless told otherwise, and says which on the attribute", async () => {
    expect(attrsOf(await render(<Join />))).toEqual({ "data-slot": "join", "data-orientation": "horizontal" });
  });

  it("names the vertical orientation it was given, so a stylesheet collapses the right radii", async () => {
    expect(attrsOf(await render(<Join orientation='vertical' />))).toEqual({ "data-slot": "join", "data-orientation": "vertical" });
  });

  it("turns the group onto the block axis by adding one class, keeping the stretch its members rely on", async () => {
    expect(variantClasses(await render(<Join orientation='vertical' />), await render(<Join />))).toEqual({ added: ["flex-col"], dropped: [] });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Join class='w-40' />)).at(-1)).toBe("w-40");
  });

  it("forwards an unknown prop and composes an inherited slot token after its own", async () => {
    expect(attrsOf(await render(<Join id='toolbar' data-slot='segmented' />))).toEqual({
      "data-slot": "join segmented",
      "data-orientation": "horizontal",
      id: "toolbar",
    });
  });
});
