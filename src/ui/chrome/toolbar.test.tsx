/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { createIcon } from "../core/icon";
import { Toolbar, type ToolbarConfig } from "./toolbar";

const icon = createIcon("/sprite.svg");

describe("Toolbar — popover title", () => {
  it("renders toolbar-flyout-title with the popover label", async () => {
    const config: ToolbarConfig = { groups: [{ items: [{ kind: "popover", icon: "layers", label: "Groups", content: <div /> }] }] };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toContain('data-slot="toolbar-flyout-title"');
    expect(out).toContain("Groups");
  });

  it("renders the title as a flex row (label + no action button) without titleAction", async () => {
    const config: ToolbarConfig = { groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }] };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toContain('data-slot="toolbar-flyout-title"');
    expect(out).not.toContain('data-slot="toolbar-title-action"');
  });

  it("renders the title-action button with data-on-click, data-ref, aria-label, and icon when titleAction is set", async () => {
    const config: ToolbarConfig = {
      groups: [
        {
          items: [
            {
              kind: "popover",
              icon: "layers",
              label: "Groups",
              content: <div />,
              titleAction: { icon: "plus", label: "Add item", action: "addItem", ref: "groups-add" },
            },
          ],
        },
      ],
    };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toContain('data-slot="toolbar-title-action"');
    expect(out).toContain('data-on-click="addItem"');
    expect(out).toContain('data-ref="groups-add"');
    expect(out).toContain('aria-label="Add item"');
    expect(out).toContain('href="/sprite.svg#icon-plus"');
  });

  it("omits data-ref on the title-action button when ref is not provided", async () => {
    const config: ToolbarConfig = {
      groups: [
        {
          items: [
            { kind: "popover", icon: "layers", label: "Groups", content: <div />, titleAction: { icon: "plus", label: "Add", action: "addItem" } },
          ],
        },
      ],
    };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toContain('data-slot="toolbar-title-action"');
    expect(out).not.toContain('data-ref="undefined"');
  });
});
