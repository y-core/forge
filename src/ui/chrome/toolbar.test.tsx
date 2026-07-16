/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { createIcon } from "../core/icon";
import { Toolbar, type ToolbarDefinition } from "./toolbar";

const icon = createIcon("/sprite.svg");

describe("Toolbar — popover title", () => {
  it("renders toolbar-flyout-title with the popover label", async () => {
    const config: ToolbarDefinition = { groups: [{ items: [{ kind: "popover", icon: "layers", label: "Groups", content: <div /> }] }] };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toContain('data-slot="toolbar-flyout-title"');
    expect(out).toContain("Groups");
  });

  it("renders the title as a flex row (label + no action button) without titleAction", async () => {
    const config: ToolbarDefinition = { groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }] };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toContain('data-slot="toolbar-flyout-title"');
    expect(out).not.toContain('data-slot="toolbar-title-action"');
  });

  it("renders the title-action button with data-on-click, data-ref, aria-label, and icon when titleAction is set", async () => {
    const config: ToolbarDefinition = {
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
    const config: ToolbarDefinition = {
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

describe("Toolbar — native popover flyout", () => {
  it("renders the trigger as a button invoking toggle-popover on the flyout id", async () => {
    const config: ToolbarDefinition = { groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }] };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toContain('data-slot="toolbar-trigger"');
    expect(out).toContain('command="toggle-popover"');
    expect(out).toContain('commandfor="toolbar-flyout-0"');
    expect(out).not.toContain("<summary");
    expect(out).not.toContain("<details");
  });

  it("renders the flyout as a native popover carrying the linking id and placement", async () => {
    const config: ToolbarDefinition = { groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }] };
    const out = await render(<Toolbar config={config} icon={icon} placement='right' />);
    expect(out).toContain('data-slot="toolbar-flyout"');
    expect(out).toContain('id="toolbar-flyout-0"');
    expect(out).toContain('popover="auto"');
    expect(out).toContain('data-placement="right"');
  });

  it("mints a distinct id for each popover so triggers and flyouts stay paired", async () => {
    const config: ToolbarDefinition = {
      groups: [
        {
          items: [
            { kind: "popover", icon: "a", label: "A", content: <div /> },
            { kind: "popover", icon: "b", label: "B", content: <div /> },
          ],
        },
      ],
    };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toContain('commandfor="toolbar-flyout-0"');
    expect(out).toContain('id="toolbar-flyout-0"');
    expect(out).toContain('commandfor="toolbar-flyout-1"');
    expect(out).toContain('id="toolbar-flyout-1"');
  });
});

describe("Toolbar — action dispatch", () => {
  it("emits data-on-click for a scope-dispatched action (default)", async () => {
    const config: ToolbarDefinition = {
      groups: [{ items: [{ kind: "action", icon: "cursor", label: "Select", action: "select", data: { "data-tool": "select" } }] }],
    };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toContain('data-on-click="select"');
    expect(out).toContain('data-tool="select"');
    expect(out).not.toContain("command=");
  });

  it("emits a native --command targeting commandTarget when dispatch is command", async () => {
    const config: ToolbarDefinition = {
      groups: [
        { items: [{ kind: "action", icon: "cursor", label: "Select", action: "select", dispatch: "command", data: { "data-tool": "select" } }] },
      ],
    };
    const out = await render(<Toolbar config={config} icon={icon} commandTarget='#chrome-root' />);
    expect(out).toContain('command="--select"');
    expect(out).toContain('commandfor="chrome-root"');
    expect(out).toContain('data-tool="select"');
    expect(out).not.toContain('data-on-click="select"');
  });
});
