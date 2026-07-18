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
    expect(out).toBe(
      '<nav data-slot="toolbar" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex flex-col items-center gap-0.5 w-full"><div data-slot="toolbar-popover" class="relative flex flex-col items-center w-full"><button type="button" data-slot="toolbar-trigger" command="toggle-popover" commandfor="toolbar-flyout-left-0" class="list-none cursor-pointer outline-none rounded-lg flex items-center justify-center size-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" title="Groups" aria-label="Groups"><svg data-slot="icon" viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><div id="toolbar-flyout-left-0" data-slot="toolbar-flyout" popover="auto" data-placement="left" class="min-w-52 p-2 pb-2.5 rounded-xl border border-border bg-popover text-popover-foreground shadow-md"><div data-slot="toolbar-flyout-title" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-0.5 pb-1.5 px-0.5 flex items-center justify-between gap-2"><span>Groups</span></div><div data-slot="toolbar-flyout-body" class="flex flex-col items-stretch gap-3.5 pt-1 pb-0.5 px-0.5 max-h-[60vh] overflow-y-auto"><div></div></div></div></div></div></nav>',
    );
  });

  it("renders the title as a flex row (label + no action button) without titleAction", async () => {
    const config: ToolbarDefinition = { groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }] };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toBe(
      '<nav data-slot="toolbar" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex flex-col items-center gap-0.5 w-full"><div data-slot="toolbar-popover" class="relative flex flex-col items-center w-full"><button type="button" data-slot="toolbar-trigger" command="toggle-popover" commandfor="toolbar-flyout-left-0" class="list-none cursor-pointer outline-none rounded-lg flex items-center justify-center size-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" title="Layers" aria-label="Layers"><svg data-slot="icon" viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><div id="toolbar-flyout-left-0" data-slot="toolbar-flyout" popover="auto" data-placement="left" class="min-w-52 p-2 pb-2.5 rounded-xl border border-border bg-popover text-popover-foreground shadow-md"><div data-slot="toolbar-flyout-title" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-0.5 pb-1.5 px-0.5 flex items-center justify-between gap-2"><span>Layers</span></div><div data-slot="toolbar-flyout-body" class="flex flex-col items-stretch gap-3.5 pt-1 pb-0.5 px-0.5 max-h-[60vh] overflow-y-auto"><div></div></div></div></div></div></nav>',
    );
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
    expect(out).toBe(
      '<nav data-slot="toolbar" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex flex-col items-center gap-0.5 w-full"><div data-slot="toolbar-popover" class="relative flex flex-col items-center w-full"><button type="button" data-slot="toolbar-trigger" command="toggle-popover" commandfor="toolbar-flyout-left-0" class="list-none cursor-pointer outline-none rounded-lg flex items-center justify-center size-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" title="Groups" aria-label="Groups"><svg data-slot="icon" viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><div id="toolbar-flyout-left-0" data-slot="toolbar-flyout" popover="auto" data-placement="left" class="min-w-52 p-2 pb-2.5 rounded-xl border border-border bg-popover text-popover-foreground shadow-md"><div data-slot="toolbar-flyout-title" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-0.5 pb-1.5 px-0.5 flex items-center justify-between gap-2"><span>Groups</span><button type="button" data-slot="toolbar-title-action" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent size-[34px] p-0" data-ref="groups-add" title="Add item" aria-label="Add item" data-on-click="addItem"><svg data-slot="icon" viewBox="0 0 24 24" class="w-4 h-4" aria-hidden="true"><use href="/sprite.svg#icon-plus"></use></svg></button></div><div data-slot="toolbar-flyout-body" class="flex flex-col items-stretch gap-3.5 pt-1 pb-0.5 px-0.5 max-h-[60vh] overflow-y-auto"><div></div></div></div></div></div></nav>',
    );
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
    expect(out).toBe(
      '<nav data-slot="toolbar" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex flex-col items-center gap-0.5 w-full"><div data-slot="toolbar-popover" class="relative flex flex-col items-center w-full"><button type="button" data-slot="toolbar-trigger" command="toggle-popover" commandfor="toolbar-flyout-left-0" class="list-none cursor-pointer outline-none rounded-lg flex items-center justify-center size-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" title="Groups" aria-label="Groups"><svg data-slot="icon" viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><div id="toolbar-flyout-left-0" data-slot="toolbar-flyout" popover="auto" data-placement="left" class="min-w-52 p-2 pb-2.5 rounded-xl border border-border bg-popover text-popover-foreground shadow-md"><div data-slot="toolbar-flyout-title" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-0.5 pb-1.5 px-0.5 flex items-center justify-between gap-2"><span>Groups</span><button type="button" data-slot="toolbar-title-action" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent size-[34px] p-0" title="Add" aria-label="Add" data-on-click="addItem"><svg data-slot="icon" viewBox="0 0 24 24" class="w-4 h-4" aria-hidden="true"><use href="/sprite.svg#icon-plus"></use></svg></button></div><div data-slot="toolbar-flyout-body" class="flex flex-col items-stretch gap-3.5 pt-1 pb-0.5 px-0.5 max-h-[60vh] overflow-y-auto"><div></div></div></div></div></div></nav>',
    );
  });
});

describe("Toolbar — native popover flyout", () => {
  it("renders the trigger as a button invoking toggle-popover on the flyout id", async () => {
    const config: ToolbarDefinition = { groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }] };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toBe(
      '<nav data-slot="toolbar" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex flex-col items-center gap-0.5 w-full"><div data-slot="toolbar-popover" class="relative flex flex-col items-center w-full"><button type="button" data-slot="toolbar-trigger" command="toggle-popover" commandfor="toolbar-flyout-left-0" class="list-none cursor-pointer outline-none rounded-lg flex items-center justify-center size-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" title="Layers" aria-label="Layers"><svg data-slot="icon" viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><div id="toolbar-flyout-left-0" data-slot="toolbar-flyout" popover="auto" data-placement="left" class="min-w-52 p-2 pb-2.5 rounded-xl border border-border bg-popover text-popover-foreground shadow-md"><div data-slot="toolbar-flyout-title" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-0.5 pb-1.5 px-0.5 flex items-center justify-between gap-2"><span>Layers</span></div><div data-slot="toolbar-flyout-body" class="flex flex-col items-stretch gap-3.5 pt-1 pb-0.5 px-0.5 max-h-[60vh] overflow-y-auto"><div></div></div></div></div></div></nav>',
    );
  });

  it("renders the flyout as a native popover carrying the linking id and placement", async () => {
    const config: ToolbarDefinition = { groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }] };
    const out = await render(<Toolbar config={config} icon={icon} placement='right' />);
    expect(out).toBe(
      '<nav data-slot="toolbar" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex flex-col items-center gap-0.5 w-full"><div data-slot="toolbar-popover" class="relative flex flex-col items-center w-full"><button type="button" data-slot="toolbar-trigger" command="toggle-popover" commandfor="toolbar-flyout-right-0" class="list-none cursor-pointer outline-none rounded-lg flex items-center justify-center size-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" title="Layers" aria-label="Layers"><svg data-slot="icon" viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><div id="toolbar-flyout-right-0" data-slot="toolbar-flyout" popover="auto" data-placement="right" class="min-w-52 p-2 pb-2.5 rounded-xl border border-border bg-popover text-popover-foreground shadow-md"><div data-slot="toolbar-flyout-title" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-0.5 pb-1.5 px-0.5 flex items-center justify-between gap-2"><span>Layers</span></div><div data-slot="toolbar-flyout-body" class="flex flex-col items-stretch gap-3.5 pt-1 pb-0.5 px-0.5 max-h-[60vh] overflow-y-auto"><div></div></div></div></div></div></nav>',
    );
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
    expect(out).toBe(
      '<nav data-slot="toolbar" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex flex-col items-center gap-0.5 w-full"><div data-slot="toolbar-popover" class="relative flex flex-col items-center w-full"><button type="button" data-slot="toolbar-trigger" command="toggle-popover" commandfor="toolbar-flyout-left-0" class="list-none cursor-pointer outline-none rounded-lg flex items-center justify-center size-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" title="A" aria-label="A"><svg data-slot="icon" viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><use href="/sprite.svg#icon-a"></use></svg></button><div id="toolbar-flyout-left-0" data-slot="toolbar-flyout" popover="auto" data-placement="left" class="min-w-52 p-2 pb-2.5 rounded-xl border border-border bg-popover text-popover-foreground shadow-md"><div data-slot="toolbar-flyout-title" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-0.5 pb-1.5 px-0.5 flex items-center justify-between gap-2"><span>A</span></div><div data-slot="toolbar-flyout-body" class="flex flex-col items-stretch gap-3.5 pt-1 pb-0.5 px-0.5 max-h-[60vh] overflow-y-auto"><div></div></div></div></div><div data-slot="toolbar-popover" class="relative flex flex-col items-center w-full"><button type="button" data-slot="toolbar-trigger" command="toggle-popover" commandfor="toolbar-flyout-left-1" class="list-none cursor-pointer outline-none rounded-lg flex items-center justify-center size-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" title="B" aria-label="B"><svg data-slot="icon" viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><use href="/sprite.svg#icon-b"></use></svg></button><div id="toolbar-flyout-left-1" data-slot="toolbar-flyout" popover="auto" data-placement="left" class="min-w-52 p-2 pb-2.5 rounded-xl border border-border bg-popover text-popover-foreground shadow-md"><div data-slot="toolbar-flyout-title" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-0.5 pb-1.5 px-0.5 flex items-center justify-between gap-2"><span>B</span></div><div data-slot="toolbar-flyout-body" class="flex flex-col items-stretch gap-3.5 pt-1 pb-0.5 px-0.5 max-h-[60vh] overflow-y-auto"><div></div></div></div></div></div></nav>',
    );
  });

  it("namespaces flyout ids by an explicit id prop and stamps that id on the nav", async () => {
    const config: ToolbarDefinition = { groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }] };
    const out = await render(<Toolbar config={config} icon={icon} id='scene-rail' />);
    expect(out).toBe(
      '<nav id="scene-rail" data-slot="toolbar" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex flex-col items-center gap-0.5 w-full"><div data-slot="toolbar-popover" class="relative flex flex-col items-center w-full"><button type="button" data-slot="toolbar-trigger" command="toggle-popover" commandfor="toolbar-flyout-scene-rail-0" class="list-none cursor-pointer outline-none rounded-lg flex items-center justify-center size-9 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" title="Layers" aria-label="Layers"><svg data-slot="icon" viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><div id="toolbar-flyout-scene-rail-0" data-slot="toolbar-flyout" popover="auto" data-placement="left" class="min-w-52 p-2 pb-2.5 rounded-xl border border-border bg-popover text-popover-foreground shadow-md"><div data-slot="toolbar-flyout-title" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-0.5 pb-1.5 px-0.5 flex items-center justify-between gap-2"><span>Layers</span></div><div data-slot="toolbar-flyout-body" class="flex flex-col items-stretch gap-3.5 pt-1 pb-0.5 px-0.5 max-h-[60vh] overflow-y-auto"><div></div></div></div></div></div></nav>',
    );
  });
});

describe("Toolbar — action dispatch", () => {
  it("emits data-on-click for a scope-dispatched action (default)", async () => {
    const config: ToolbarDefinition = {
      groups: [{ items: [{ kind: "action", icon: "cursor", label: "Select", action: "select", data: { "data-tool": "select" } }] }],
    };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toBe(
      '<nav data-slot="toolbar" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex flex-col items-center gap-0.5 w-full"><button type="button" data-slot="toolbar-action" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent size-9 p-0" title="Select" aria-label="Select" data-on-click="select" data-tool="select"><svg data-slot="icon" viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><use href="/sprite.svg#icon-cursor"></use></svg></button></div></nav>',
    );
  });

  it("emits a native --command targeting commandTarget when dispatch is command", async () => {
    const config: ToolbarDefinition = {
      groups: [
        { items: [{ kind: "action", icon: "cursor", label: "Select", action: "select", dispatch: "command", data: { "data-tool": "select" } }] },
      ],
    };
    const out = await render(<Toolbar config={config} icon={icon} commandTarget='#chrome-root' />);
    expect(out).toBe(
      '<nav data-slot="toolbar" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex flex-col items-center gap-0.5 w-full"><button type="button" data-slot="toolbar-action" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent size-9 p-0" title="Select" aria-label="Select" command="--select" commandfor="chrome-root" data-tool="select"><svg data-slot="icon" viewBox="0 0 24 24" class="w-5 h-5" aria-hidden="true"><use href="/sprite.svg#icon-cursor"></use></svg></button></div></nav>',
    );
  });
});
