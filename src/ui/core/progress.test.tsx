import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrOf, attrsOf, classesOf, variantClasses } from "./core.fixture";
import { Progress } from "./progress";

describe("Progress", () => {
  it("renders the whole bar exactly, the label and forwarded attributes escaped", async () => {
    expect(await render(<Progress value={50} max={100} label={`R&D's`} id='p1' data-note='a&b' />)).toBe(
      '<progress data-slot="progress" data-orientation="horizontal" aria-label="R&amp;D&#39;s"' +
        ' class="h-2 w-full appearance-none rounded-selector bg-border" value="50" max="100" id="p1" data-note="a&amp;b"></progress>',
    );
  });

  it("is a native progress element that names its orientation, and stays nameless when nobody named it", async () => {
    expect(await render(<Progress />)).toStartWith("<progress ");
    expect(attrsOf(await render(<Progress />))).toEqual({ "data-slot": "progress", "data-orientation": "horizontal" });
  });

  it("names the bar from the label convenience prop, so a caller need not know the ARIA attribute", async () => {
    expect(attrOf(await render(<Progress label='Upload progress' />), "aria-label")).toBe("Upload progress");
  });

  it("lets an explicit aria-label win over the convenience prop, which is the more specific instruction", async () => {
    expect(attrOf(await render(<Progress aria-label='Explicit' label='Ignored' />), "aria-label")).toBe("Explicit");
  });

  it("says it runs vertically on the attribute a stylesheet and a reader both key on", async () => {
    expect(attrsOf(await render(<Progress orientation='vertical' />))).toEqual({ "data-slot": "progress", "data-orientation": "vertical" });
  });

  it("turns the bar on its side and fills it from the bottom, which nothing but the classes says", async () => {
    expect(variantClasses(await render(<Progress orientation='vertical' />), await render(<Progress />))).toEqual({
      added: ["h-full", "w-2", "[direction:rtl]", "[writing-mode:vertical-lr]"],
      dropped: ["h-2", "w-full"],
    });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Progress class='my-progress' />)).at(-1)).toBe("my-progress");
  });
});
