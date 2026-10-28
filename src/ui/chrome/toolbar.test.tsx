/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, elementOf } from "../../testing/markup";
import { render } from "../../testing/render";
import { TOOLBAR_SCOPE } from "../contracts/toolbar-contract";
import { createIcon } from "../core/icon";
import { Toolbar } from "./toolbar";
import type { ToolbarDefinition, ToolbarPlacement } from "./types";

const icon = createIcon("/sprite.svg");

type Glyph = "cursor" | "layers";

// Two rails on one page otherwise announce "toolbar, toolbar"; the name belongs to the config, which
// is the one place a rail is described.
describe("Toolbar — the rail is named from its config", () => {
  it("cannot be configured without a label, and renders the one it is given", async () => {
    // @ts-expect-error — `label` is required on a ToolbarDefinition.
    const unnamed: ToolbarDefinition = { groups: [] };
    void unnamed;

    const config: ToolbarDefinition = { label: "Scene tools", groups: [] };

    expect(attrOf(await render(<Toolbar config={config} icon={icon} />), "aria-label")).toBe("Scene tools");
  });
});

describe("Toolbar — popover title", () => {
  it("renders toolbar-flyout-title with the popover label", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
      groups: [{ items: [{ kind: "popover", icon: "layers", label: "Groups", content: <div /> }] }],
    };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toBe(
      '<div role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex w-full flex-col items-center gap-0.5"><span data-slot="popover toolbar-popover" class="relative flex w-full flex-col items-center"><button type="button" data-slot="popover-trigger toolbar-trigger toolbar-button" command="toggle-popover" commandfor="toolbar-flyout-left-0" aria-controls="toolbar-flyout-left-0" aria-expanded="false" aria-haspopup="dialog" class="cursor-pointer list-none state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" title="Groups" aria-label="Groups" data-toolbar-item=""><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><span id="toolbar-flyout-left-0" role="dialog" aria-labelledby="toolbar-flyout-left-0-title" data-slot="popover-content toolbar-flyout" data-scope="popover" popover="auto" data-side="right" data-align="start" class="z-50 rounded-box border-field border-border bg-popover text-popover-foreground shadow-md min-w-52 p-2 pb-2.5"><div data-slot="toolbar-flyout-title" class="px-0.5 pt-0.5 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between gap-2"><span id="toolbar-flyout-left-0-title">Groups</span></div><div data-slot="toolbar-flyout-body" class="flex max-h-[60vh] flex-col items-stretch gap-3.5 overflow-y-auto px-0.5 pt-1 pb-0.5"><div></div></div></span></span></div></div>',
    );
  });

  it("renders the title as a flex row (label + no action button) without titleAction", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
      groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }],
    };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toBe(
      '<div role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex w-full flex-col items-center gap-0.5"><span data-slot="popover toolbar-popover" class="relative flex w-full flex-col items-center"><button type="button" data-slot="popover-trigger toolbar-trigger toolbar-button" command="toggle-popover" commandfor="toolbar-flyout-left-0" aria-controls="toolbar-flyout-left-0" aria-expanded="false" aria-haspopup="dialog" class="cursor-pointer list-none state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" title="Layers" aria-label="Layers" data-toolbar-item=""><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><span id="toolbar-flyout-left-0" role="dialog" aria-labelledby="toolbar-flyout-left-0-title" data-slot="popover-content toolbar-flyout" data-scope="popover" popover="auto" data-side="right" data-align="start" class="z-50 rounded-box border-field border-border bg-popover text-popover-foreground shadow-md min-w-52 p-2 pb-2.5"><div data-slot="toolbar-flyout-title" class="px-0.5 pt-0.5 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between gap-2"><span id="toolbar-flyout-left-0-title">Layers</span></div><div data-slot="toolbar-flyout-body" class="flex max-h-[60vh] flex-col items-stretch gap-3.5 overflow-y-auto px-0.5 pt-1 pb-0.5"><div></div></div></span></span></div></div>',
    );
  });

  it("renders the title-action button with data-on-click, data-ref, aria-label, and icon when titleAction is set", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
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
      '<div role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex w-full flex-col items-center gap-0.5"><span data-slot="popover toolbar-popover" class="relative flex w-full flex-col items-center"><button type="button" data-slot="popover-trigger toolbar-trigger toolbar-button" command="toggle-popover" commandfor="toolbar-flyout-left-0" aria-controls="toolbar-flyout-left-0" aria-expanded="false" aria-haspopup="dialog" class="cursor-pointer list-none state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" title="Groups" aria-label="Groups" data-toolbar-item=""><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><span id="toolbar-flyout-left-0" role="dialog" aria-labelledby="toolbar-flyout-left-0-title" data-slot="popover-content toolbar-flyout" data-scope="popover" popover="auto" data-side="right" data-align="start" class="z-50 rounded-box border-field border-border bg-popover text-popover-foreground shadow-md min-w-52 p-2 pb-2.5"><div data-slot="toolbar-flyout-title" class="px-0.5 pt-0.5 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between gap-2"><span id="toolbar-flyout-left-0-title">Groups</span><button type="button" data-slot="button toolbar-title-action" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm text-sm px-0 w-control-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" data-ref="groups-add" title="Add item" aria-label="Add item" data-on-click="addItem"><svg data-slot="icon" viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true"><use href="/sprite.svg#icon-plus"></use></svg></button></div><div data-slot="toolbar-flyout-body" class="flex max-h-[60vh] flex-col items-stretch gap-3.5 overflow-y-auto px-0.5 pt-1 pb-0.5"><div></div></div></span></span></div></div>',
    );
  });

  it("omits data-ref on the title-action button when ref is not provided", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
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
      '<div role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex w-full flex-col items-center gap-0.5"><span data-slot="popover toolbar-popover" class="relative flex w-full flex-col items-center"><button type="button" data-slot="popover-trigger toolbar-trigger toolbar-button" command="toggle-popover" commandfor="toolbar-flyout-left-0" aria-controls="toolbar-flyout-left-0" aria-expanded="false" aria-haspopup="dialog" class="cursor-pointer list-none state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" title="Groups" aria-label="Groups" data-toolbar-item=""><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><span id="toolbar-flyout-left-0" role="dialog" aria-labelledby="toolbar-flyout-left-0-title" data-slot="popover-content toolbar-flyout" data-scope="popover" popover="auto" data-side="right" data-align="start" class="z-50 rounded-box border-field border-border bg-popover text-popover-foreground shadow-md min-w-52 p-2 pb-2.5"><div data-slot="toolbar-flyout-title" class="px-0.5 pt-0.5 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between gap-2"><span id="toolbar-flyout-left-0-title">Groups</span><button type="button" data-slot="button toolbar-title-action" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm text-sm px-0 w-control-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" title="Add" aria-label="Add" data-on-click="addItem"><svg data-slot="icon" viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true"><use href="/sprite.svg#icon-plus"></use></svg></button></div><div data-slot="toolbar-flyout-body" class="flex max-h-[60vh] flex-col items-stretch gap-3.5 overflow-y-auto px-0.5 pt-1 pb-0.5"><div></div></div></span></span></div></div>',
    );
  });
});

describe("Toolbar — native popover flyout", () => {
  it("renders the trigger as a button invoking toggle-popover on the flyout id", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
      groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }],
    };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toBe(
      '<div role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex w-full flex-col items-center gap-0.5"><span data-slot="popover toolbar-popover" class="relative flex w-full flex-col items-center"><button type="button" data-slot="popover-trigger toolbar-trigger toolbar-button" command="toggle-popover" commandfor="toolbar-flyout-left-0" aria-controls="toolbar-flyout-left-0" aria-expanded="false" aria-haspopup="dialog" class="cursor-pointer list-none state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" title="Layers" aria-label="Layers" data-toolbar-item=""><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><span id="toolbar-flyout-left-0" role="dialog" aria-labelledby="toolbar-flyout-left-0-title" data-slot="popover-content toolbar-flyout" data-scope="popover" popover="auto" data-side="right" data-align="start" class="z-50 rounded-box border-field border-border bg-popover text-popover-foreground shadow-md min-w-52 p-2 pb-2.5"><div data-slot="toolbar-flyout-title" class="px-0.5 pt-0.5 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between gap-2"><span id="toolbar-flyout-left-0-title">Layers</span></div><div data-slot="toolbar-flyout-body" class="flex max-h-[60vh] flex-col items-stretch gap-3.5 overflow-y-auto px-0.5 pt-1 pb-0.5"><div></div></div></span></span></div></div>',
    );
  });

  it("renders the flyout as a native popover carrying the linking id and placement", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
      groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }],
    };
    const out = await render(<Toolbar config={config} icon={icon} placement='right' />);
    expect(out).toBe(
      '<div role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex w-full flex-col items-center gap-0.5"><span data-slot="popover toolbar-popover" class="relative flex w-full flex-col items-center"><button type="button" data-slot="popover-trigger toolbar-trigger toolbar-button" command="toggle-popover" commandfor="toolbar-flyout-right-0" aria-controls="toolbar-flyout-right-0" aria-expanded="false" aria-haspopup="dialog" class="cursor-pointer list-none state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" title="Layers" aria-label="Layers" data-toolbar-item=""><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><span id="toolbar-flyout-right-0" role="dialog" aria-labelledby="toolbar-flyout-right-0-title" data-slot="popover-content toolbar-flyout" data-scope="popover" popover="auto" data-side="left" data-align="start" class="z-50 rounded-box border-field border-border bg-popover text-popover-foreground shadow-md min-w-52 p-2 pb-2.5"><div data-slot="toolbar-flyout-title" class="px-0.5 pt-0.5 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between gap-2"><span id="toolbar-flyout-right-0-title">Layers</span></div><div data-slot="toolbar-flyout-body" class="flex max-h-[60vh] flex-col items-stretch gap-3.5 overflow-y-auto px-0.5 pt-1 pb-0.5"><div></div></div></span></span></div></div>',
    );
  });

  it("mints a distinct id for each popover so triggers and flyouts stay paired", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
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
      '<div role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex w-full flex-col items-center gap-0.5"><span data-slot="popover toolbar-popover" class="relative flex w-full flex-col items-center"><button type="button" data-slot="popover-trigger toolbar-trigger toolbar-button" command="toggle-popover" commandfor="toolbar-flyout-left-0" aria-controls="toolbar-flyout-left-0" aria-expanded="false" aria-haspopup="dialog" class="cursor-pointer list-none state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" title="A" aria-label="A" data-toolbar-item=""><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-a"></use></svg></button><span id="toolbar-flyout-left-0" role="dialog" aria-labelledby="toolbar-flyout-left-0-title" data-slot="popover-content toolbar-flyout" data-scope="popover" popover="auto" data-side="right" data-align="start" class="z-50 rounded-box border-field border-border bg-popover text-popover-foreground shadow-md min-w-52 p-2 pb-2.5"><div data-slot="toolbar-flyout-title" class="px-0.5 pt-0.5 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between gap-2"><span id="toolbar-flyout-left-0-title">A</span></div><div data-slot="toolbar-flyout-body" class="flex max-h-[60vh] flex-col items-stretch gap-3.5 overflow-y-auto px-0.5 pt-1 pb-0.5"><div></div></div></span></span><span data-slot="popover toolbar-popover" class="relative flex w-full flex-col items-center"><button type="button" data-slot="popover-trigger toolbar-trigger toolbar-button" command="toggle-popover" commandfor="toolbar-flyout-left-1" aria-controls="toolbar-flyout-left-1" aria-expanded="false" aria-haspopup="dialog" class="cursor-pointer list-none state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" title="B" aria-label="B" data-toolbar-item=""><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-b"></use></svg></button><span id="toolbar-flyout-left-1" role="dialog" aria-labelledby="toolbar-flyout-left-1-title" data-slot="popover-content toolbar-flyout" data-scope="popover" popover="auto" data-side="right" data-align="start" class="z-50 rounded-box border-field border-border bg-popover text-popover-foreground shadow-md min-w-52 p-2 pb-2.5"><div data-slot="toolbar-flyout-title" class="px-0.5 pt-0.5 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between gap-2"><span id="toolbar-flyout-left-1-title">B</span></div><div data-slot="toolbar-flyout-body" class="flex max-h-[60vh] flex-col items-stretch gap-3.5 overflow-y-auto px-0.5 pt-1 pb-0.5"><div></div></div></span></span></div></div>',
    );
  });

  it("namespaces flyout ids by an explicit id prop and stamps that id on the nav", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
      groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }],
    };
    const out = await render(<Toolbar config={config} icon={icon} id='scene-rail' />);
    expect(out).toBe(
      '<div id="scene-rail" role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex w-full flex-col items-center gap-0.5"><span data-slot="popover toolbar-popover" class="relative flex w-full flex-col items-center"><button type="button" data-slot="popover-trigger toolbar-trigger toolbar-button" command="toggle-popover" commandfor="toolbar-flyout-scene-rail-0" aria-controls="toolbar-flyout-scene-rail-0" aria-expanded="false" aria-haspopup="dialog" class="cursor-pointer list-none state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" title="Layers" aria-label="Layers" data-toolbar-item=""><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-layers"></use></svg></button><span id="toolbar-flyout-scene-rail-0" role="dialog" aria-labelledby="toolbar-flyout-scene-rail-0-title" data-slot="popover-content toolbar-flyout" data-scope="popover" popover="auto" data-side="right" data-align="start" class="z-50 rounded-box border-field border-border bg-popover text-popover-foreground shadow-md min-w-52 p-2 pb-2.5"><div data-slot="toolbar-flyout-title" class="px-0.5 pt-0.5 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between gap-2"><span id="toolbar-flyout-scene-rail-0-title">Layers</span></div><div data-slot="toolbar-flyout-body" class="flex max-h-[60vh] flex-col items-stretch gap-3.5 overflow-y-auto px-0.5 pt-1 pb-0.5"><div></div></div></span></span></div></div>',
    );
  });
});

describe("Toolbar — flyout name", () => {
  it("is the label alone, because aria-labelledby points at the label span and not the title row", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
      groups: [
        {
          items: [
            {
              kind: "popover",
              icon: "layers",
              label: "Groups",
              content: <div />,
              titleAction: { icon: "plus", label: "Add item", action: "addItem" },
            },
          ],
        },
      ],
    };
    const out = await render(<Toolbar config={config} icon={icon} />);
    const named = attrOf(out, "aria-labelledby", 'role="dialog"');

    expect(named).not.toBe("");
    expect(elementOf(out, "span", `id="${named}"`)).toBe(`<span id="${named}">Groups</span>`);
    expect(out.split(`id="${named}"`)).toHaveLength(2);
  });
});

describe("Toolbar — the flyout is a Popover", () => {
  const SIDES = { left: "right", right: "left", top: "bottom", bottom: "top" } as const;

  for (const [placement, side] of Object.entries(SIDES) as [ToolbarPlacement, string][]) {
    it(`a ${placement} rail opens a popover-content panel on its ${side} side`, async () => {
      const config: ToolbarDefinition = {
        label: "Scene tools",
        groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: <div /> }] }],
      };
      const out = await render(<Toolbar config={config} icon={icon} placement={placement} />);
      const panel = attrsOf(out, 'role="dialog"');

      expect(panel["data-slot"]?.split(" ")).toContain("popover-content");
      expect(panel["data-side"]).toBe(side);
    });
  }
});

describe("Toolbar — action dispatch", () => {
  it("emits data-on-click for a scope-dispatched action (default)", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
      groups: [{ items: [{ kind: "action", icon: "cursor", label: "Select", action: "select", data: { "data-tool": "select" } }] }],
    };
    const out = await render(<Toolbar config={config} icon={icon} />);
    expect(out).toBe(
      '<div role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex w-full flex-col items-center gap-0.5"><button type="button" data-slot="toolbar-button toolbar-action" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" data-toolbar-item="" title="Select" aria-label="Select" data-on-click="select" data-tool="select"><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-cursor"></use></svg></button></div></div>',
    );
  });

  it("emits a native --command targeting commandTarget when dispatch is command", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
      groups: [
        { items: [{ kind: "action", icon: "cursor", label: "Select", action: "select", dispatch: "command", data: { "data-tool": "select" } }] },
      ],
    };
    const out = await render(<Toolbar config={config} icon={icon} commandTarget='#chrome-root' />);
    expect(out).toBe(
      '<div role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex w-full flex-col items-center gap-0.5"><button type="button" data-slot="toolbar-button toolbar-action" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" data-toolbar-item="" title="Select" aria-label="Select" command="--select" commandfor="chrome-root" data-tool="select"><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-cursor"></use></svg></button></div></div>',
    );
  });
  it("keeps its composed data-slot when its data carries one, and still spreads the rest", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
      groups: [{ items: [{ kind: "action", icon: "cursor", label: "Select", action: "select", data: { "data-slot": "x", "data-tool": "t" } }] }],
    };
    const out = await render(<Toolbar config={config} icon={icon} />);

    expect(attrOf(out, "data-slot", 'data-tool="t"')).toBe("toolbar-button toolbar-action x");
  });

  // An invoker with no target is not an invoker: `commandfor=""` referenced no element either, but
  // it put a relationship in the markup that a reader and a validator both have to chase.
  it("emits neither half of the invoker pair when commandTarget is omitted", async () => {
    const config: ToolbarDefinition = {
      label: "Scene tools",
      groups: [{ items: [{ kind: "action", icon: "cursor", label: "Select", action: "select", dispatch: "command" }] }],
    };

    const out = await render(<Toolbar config={config} icon={icon} />);

    expect(out).not.toContain("commandfor");
    expect(out).not.toContain("command=");
  });
});

describe("Toolbar — the pressed axis is tri-state", () => {
  const withActive = (active: boolean | undefined): ToolbarDefinition => ({
    label: "Scene tools",
    groups: [{ items: [{ kind: "action", icon: "cursor", label: "Select", action: "select", ...(active === undefined ? {} : { active }) }] }],
  });

  const buttonAttrs = (html: string): string[] =>
    [...(/<button\s([^>]*)>/.exec(html)?.[1] ?? "").matchAll(/(?:^|\s)([\w:-]+)=/g)].map((m) => m[1] as string);

  const pressedAttrs = (html: string): string[] =>
    [...(/<button\s([^>]*)>/.exec(html)?.[1] ?? "").matchAll(/(?:^|\s)((?:aria|data)-pressed="[^"]*")/g)].map((m) => m[1] as string);

  // `{...(active ? { pressed: true } : {})}` collapsed `false` onto `undefined`, so an unpressed
  // toggle announced itself as a plain action button. The core primitive was already tri-state.
  it("announces an unpressed toggle, rather than dropping it to a plain button", async () => {
    const out = await render(<Toolbar config={withActive(false)} icon={icon} />);

    expect(pressedAttrs(out)).toEqual(['aria-pressed="false"']);
  });

  it("announces a pressed toggle on both mechanisms", async () => {
    const out = await render(<Toolbar config={withActive(true)} icon={icon} />);

    expect(pressedAttrs(out)).toEqual(['aria-pressed="true"', 'data-pressed=""']);
  });

  it("marks an active tool by its pressed state alone, with no `active` class", async () => {
    const active = classesOf(await render(<Toolbar config={withActive(true)} icon={icon} />), "aria-pressed");

    expect(active).not.toContain("active");
    expect(active).toEqual(classesOf(await render(<Toolbar config={withActive(false)} icon={icon} />), "aria-pressed"));
  });

  it("says nothing at all when the item declares no pressed axis", async () => {
    const out = await render(<Toolbar config={withActive(undefined)} icon={icon} />);

    expect(pressedAttrs(out)).toEqual([]);
    expect(buttonAttrs(out)).toEqual(["type", "data-slot", "class", "data-toolbar-item", "title", "aria-label", "data-on-click"]);
  });
});

describe("Toolbar — glyph typing", () => {
  const narrowIcon = createIcon("/sprite.svg", { "icon-cursor": "0 0 24 24", "icon-layers": "0 0 24 24" });

  it("accepts a sheet narrowed to the definition's glyphs, uncast", async () => {
    const config: ToolbarDefinition<"select", Glyph> = {
      label: "Scene tools",
      groups: [{ items: [{ kind: "action", icon: "cursor", label: "Select", action: "select" }] }],
    };
    const out = await render(<Toolbar config={config} icon={narrowIcon} />);
    expect(out).toBe(
      '<div role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="group flex flex-col items-center"><div data-slot="toolbar-group" class="flex w-full flex-col items-center gap-0.5"><button type="button" data-slot="toolbar-button toolbar-action" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" data-toolbar-item="" title="Select" aria-label="Select" data-on-click="select"><svg data-slot="icon" viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true"><use href="/sprite.svg#icon-cursor"></use></svg></button></div></div>',
    );
  });

  it("rejects an action glyph absent from the definition's glyph union", () => {
    const config: ToolbarDefinition<"select", Glyph> = {
      label: "Scene tools",
      groups: [
        {
          items: [
            {
              kind: "action",
              // @ts-expect-error — "typo" is not a glyph in the sheet
              icon: "typo",
              label: "Select",
              action: "select",
            },
          ],
        },
      ],
    };
    expect(config.groups[0]?.items[0]).toEqual({ kind: "action", icon: "typo", label: "Select", action: "select" });
  });

  it("rejects a title-action glyph absent from the definition's glyph union", () => {
    const config: ToolbarDefinition<"select", Glyph> = {
      label: "Scene tools",
      groups: [
        {
          items: [
            {
              kind: "popover",
              icon: "layers",
              label: "Groups",
              content: null,
              titleAction: {
                // @ts-expect-error — "typo" is not a glyph in the sheet
                icon: "typo",
                label: "Add",
                action: "select",
              },
            },
          ],
        },
      ],
    };
    expect(config.groups[0]?.items[0]).toHaveProperty("titleAction.icon", "typo");
  });
});

describe("Toolbar — attribute precedence", () => {
  it("lets a caller's explicit data-orientation beat the one computed from placement", async () => {
    const out = await render(<Toolbar config={{ label: "Scene tools", groups: [] }} icon={icon} data-orientation='caller-wins' />);
    expect(out).toBe(
      `<div role="toolbar" aria-label="Scene tools" data-slot="toolbar" data-scope="${TOOLBAR_SCOPE}" data-orientation="caller-wins" aria-orientation="vertical" class="group flex flex-col items-center"></div>`,
    );
  });
});
