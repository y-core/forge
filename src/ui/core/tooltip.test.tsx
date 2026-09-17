/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrOf, attrsOf, variantClasses } from "./core.fixture";
import { Menu } from "./menu";
import { Tooltip } from "./tooltip";

describe("Tooltip.Content", () => {
  it("renders the whole hint exactly, its own slot token alone and its children escaped", async () => {
    expect(await render(<Tooltip.Content id='tip'>{`R&D's <hint>`}</Tooltip.Content>)).toBe(
      '<div id="tip" role="tooltip" data-slot="tooltip-content" popover="hint" data-side="top" data-align="center" ' +
        'class="z-50 w-max max-w-xs rounded-field bg-foreground px-2 py-1 text-xs text-background shadow-md">R&amp;D&#39;s &lt;hint&gt;</div>',
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(
      attrOf(
        await render(
          <Tooltip.Content id='tip' data-slot='rail-tip-body'>
            Hint
          </Tooltip.Content>,
        ),
        "data-slot",
      ),
    ).toBe("tooltip-content rail-tip-body");
  });
});

describe("Tooltip", () => {
  it("carries the scope the controller resumes on, under its own slot token", async () => {
    expect(attrsOf(await render(<Tooltip>x</Tooltip>))).toEqual({ "data-slot": "tooltip", "data-scope": "tooltip" });
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(attrOf(await render(<Tooltip data-slot='rail-tip'>x</Tooltip>), "data-slot")).toBe("tooltip rail-tip");
  });
});

describe("Tooltip.Trigger", () => {
  it("describes itself by the content id, which is how the controller finds the hint at all", async () => {
    expect(attrsOf(await render(<Tooltip.Trigger for='tip'>Save</Tooltip.Trigger>))).toEqual({
      type: "button",
      "data-slot": "tooltip-trigger",
      "aria-describedby": "tip",
    });
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(
      attrOf(
        await render(
          <Tooltip.Trigger for='tip' data-slot='my-thing'>
            Save
          </Tooltip.Trigger>,
        ),
        "data-slot",
      ),
    ).toBe("tooltip-trigger my-thing");
  });

  it("composes the inherited token on the asChild path too, onto the caller's own element", async () => {
    expect(
      attrsOf(
        await render(
          <Tooltip.Trigger for='tip' asChild data-slot='my-thing'>
            <button type='button'>Save</button>
          </Tooltip.Trigger>,
        ),
      ),
    ).toEqual({ type: "button", "aria-describedby": "tip", "data-slot": "tooltip-trigger my-thing" });
  });
});

describe("Tooltip.Trigger asChild — the three-way token composition", () => {
  it("keeps the child's own token, the trigger's, and the inherited one", async () => {
    expect(
      attrOf(
        await render(
          <Tooltip.Trigger for='tip' asChild data-slot='my-thing'>
            <button type='button' data-slot='inner'>
              Save
            </button>
          </Tooltip.Trigger>,
        ),
        "data-slot",
      ),
    ).toBe("inner tooltip-trigger my-thing");
  });

  it("does the same when the child is an unrendered compound rather than an intrinsic element", async () => {
    const html = await render(
      <Tooltip.Trigger for='tip' asChild data-slot='my-thing'>
        <Menu.Trigger for='file-menu'>File</Menu.Trigger>
      </Tooltip.Trigger>,
    );

    expect(attrsOf(html)).toEqual({
      type: "button",
      "data-slot": "menu-trigger tooltip-trigger my-thing",
      command: "toggle-popover",
      commandfor: "file-menu",
      "aria-haspopup": "menu",
      "aria-controls": "file-menu",
      "aria-expanded": "false",
      "aria-describedby": "tip",
    });
  });

  it("leaves the trigger's own paint untouched, since every class the compound adds repeats or loses to it", async () => {
    expect(
      variantClasses(
        await render(
          <Tooltip.Trigger for='tip' asChild>
            <Menu.Trigger for='file-menu'>File</Menu.Trigger>
          </Tooltip.Trigger>,
        ),
        await render(<Tooltip.Trigger for='tip'>Save</Tooltip.Trigger>),
      ),
    ).toEqual({ added: [], dropped: [] });
  });
});

describe("Tooltip — a non-string inherited token contributes nothing", () => {
  const cases: Array<{ inherited: unknown; label: string }> = [
    { inherited: undefined, label: "undefined" },
    { inherited: "", label: "empty string" },
    { inherited: null, label: "null" },
    { inherited: 42, label: "a number" },
    { inherited: false, label: "false" },
    { inherited: {}, label: "an object" },
  ];

  it("leaves every surface with its own bare token, whatever non-string it was handed", async () => {
    const actual = await Promise.all(
      cases.map(async ({ inherited, label }) => ({
        label,
        root: attrOf(await render(<Tooltip data-slot={inherited}>x</Tooltip>), "data-slot"),
        trigger: attrOf(
          await render(
            <Tooltip.Trigger for='tip' data-slot={inherited}>
              Save
            </Tooltip.Trigger>,
          ),
          "data-slot",
        ),
        asChild: attrOf(
          await render(
            <Tooltip.Trigger for='tip' asChild data-slot={inherited}>
              <button type='button'>Save</button>
            </Tooltip.Trigger>,
          ),
          "data-slot",
        ),
        content: attrOf(
          await render(
            <Tooltip.Content id='tip' data-slot={inherited}>
              Hint
            </Tooltip.Content>,
          ),
          "data-slot",
        ),
      })),
    );

    expect(actual).toEqual(
      cases.map(({ label }) => ({ label, root: "tooltip", trigger: "tooltip-trigger", asChild: "tooltip-trigger", content: "tooltip-content" })),
    );
  });
});
