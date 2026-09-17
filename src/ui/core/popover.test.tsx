/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrOf, attrsOf, classesOf } from "./core.fixture";
import { Popover } from "./popover";

const ALIGNS = ["start", "center", "end"] as const;
const SIDES = ["top", "right", "bottom", "left"] as const;

describe("Popover", () => {
  it("is the containing block its content is positioned against", async () => {
    expect(classesOf(await render(<Popover />))).toEqual(["relative", "inline-block"]);
  });

  it("names itself on the slot attribute and carries nothing else of its own", async () => {
    expect(attrsOf(await render(<Popover />))).toEqual({ "data-slot": "popover" });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Popover class='my-popover' />)).at(-1)).toBe("my-popover");
  });
});

describe("Popover.Trigger", () => {
  it("toggles the content through the native invoker command, and never takes the content's id as its own", async () => {
    expect(attrsOf(await render(<Popover.Trigger for='menu-1'>Open</Popover.Trigger>))).toEqual({
      type: "button",
      "data-slot": "popover-trigger",
      command: "toggle-popover",
      commandfor: "menu-1",
      "aria-controls": "menu-1",
      "aria-expanded": "false",
    });
  });

  it("gives a bare button the pointer and focus affordances a trigger needs", async () => {
    expect(classesOf(await render(<Popover.Trigger for='p' />))).toEqual(["cursor-pointer", "list-none", "focus-ring"]);
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(attrOf(await render(<Popover.Trigger for='p' data-slot='rail-tool' />), "data-slot")).toBe("popover-trigger rail-tool");
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(attrOf(await render(<Popover.Trigger for='p' data-slot='' />), "data-slot")).toBe("popover-trigger");
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(
      classesOf(
        await render(
          <Popover.Trigger for='menu-1' class='my-trigger'>
            Click
          </Popover.Trigger>,
        ),
      ).at(-1),
    ).toBe("my-trigger");
  });
});

describe("Popover.Content", () => {
  it("renders the whole panel exactly, forwarded attributes escaped", async () => {
    expect(
      await render(
        <Popover.Content id='menu-1' role='menu' data-note='a&b'>
          Items
        </Popover.Content>,
      ),
    ).toBe(
      '<div id="menu-1" data-slot="popover-content" data-scope="popover" popover="auto" data-side="bottom" data-align="start"' +
        ' class="z-50 min-w-32 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md" role="menu"' +
        ' data-note="a&amp;b">Items</div>',
    );
  });

  it("is a native popover carrying the scope its controller resumes from, placed bottom-start unless told otherwise", async () => {
    expect(attrsOf(await render(<Popover.Content id='menu-1'>Items</Popover.Content>))).toEqual({
      id: "menu-1",
      "data-slot": "popover-content",
      "data-scope": "popover",
      popover: "auto",
      "data-side": "bottom",
      "data-align": "start",
    });
  });

  it("states the align it was given, which is all that distinguishes one placement from another", async () => {
    for (const align of ALIGNS) {
      expect(attrOf(await render(<Popover.Content id='menu-1' align={align} />), "data-align")).toBe(align);
    }
  });

  it("states the side it was given on every physical axis", async () => {
    for (const side of SIDES) {
      expect(attrOf(await render(<Popover.Content id='menu-1' side={side} />), "data-side")).toBe(side);
    }
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(
      classesOf(
        await render(
          <Popover.Content id='menu-1' class='w-64'>
            Items
          </Popover.Content>,
        ),
      ).at(-1),
    ).toBe("w-64");
  });
});

describe("Popover composition", () => {
  it("nests trigger and content under the root, the trigger's `for` naming the content's own id", async () => {
    const html = await render(
      <Popover>
        <Popover.Trigger for='menu-file'>Open menu</Popover.Trigger>
        <Popover.Content id='menu-file'>
          <div>Item 1</div>
        </Popover.Content>
      </Popover>,
    );

    expect([...html.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1])).toEqual(["popover", "popover-trigger", "popover-content"]);
    expect(attrOf(html, "commandfor", 'data-slot="popover-trigger"')).toBe(attrOf(html, "id", 'data-slot="popover-content"'));
  });
});
