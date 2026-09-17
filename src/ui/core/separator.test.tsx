import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrsOf, classesOf, variantClasses } from "./core.fixture";
import { Separator } from "./separator";

describe("Separator", () => {
  it("renders the whole rule exactly, forwarded attributes escaped", async () => {
    expect(await render(<Separator id='sep1' data-testid='sep' data-note='a&b' />)).toBe(
      '<hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border" id="sep1" data-testid="sep" data-note="a&amp;b">',
    );
  });

  it("announces its orientation, so a screen reader is not left to infer it from a border", async () => {
    expect(attrsOf(await render(<Separator />))).toEqual({ "data-slot": "separator", "aria-orientation": "horizontal" });
  });

  it("announces the vertical orientation when it is asked for one", async () => {
    expect(attrsOf(await render(<Separator orientation='vertical' />))).toEqual({ "data-slot": "separator", "aria-orientation": "vertical" });
  });

  it("turns the rule on its side rather than drawing a second one across it", async () => {
    expect(variantClasses(await render(<Separator orientation='vertical' />), await render(<Separator />))).toEqual({
      added: ["h-auto", "w-px", "self-stretch"],
      dropped: ["h-px", "w-full"],
    });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Separator class='my-sep' />)).at(-1)).toBe("my-sep");
  });
});
