/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../jsx/types";
import { Dock } from "../chrome/dock";
import { Navbar } from "../chrome/navbar";
import { Toolbar } from "../chrome/toolbar";
import type { DockItem } from "../chrome/types";
import type { NavDefinition } from "../chrome/types";
import type { ToolbarDefinition, ToolbarItem } from "../chrome/types";
import { Badge } from "../core/badge";
import { Button } from "../core/button";
import { Switch } from "../core/switch";
import { Resumable } from "../server/resumable";
import { CatalogNote, CatalogSection } from "./components";
import { SHOW_SCOPES } from "./scope-contract";
import type { ShowIcon } from "./types";

const TOOLBAR_SCOPE_ID = SHOW_SCOPES.toolbar;
const PANEL_REF = "toolbar-panel";

type ChromeAction = "fit" | "toggle" | "reset" | "closeOptions";
type ChromeGlyph = "monitor" | "chevron-down" | "close" | "hamburger";

const RAIL_ACTIONS: ToolbarItem<ChromeAction, ChromeGlyph>[] = [
  { kind: "action", icon: "monitor", label: "Fit panel to content", action: "fit", ref: "fit", active: true },
  { kind: "separator" },
  { kind: "action", icon: "chevron-down", label: "Show or hide the panel", action: "toggle", ref: "toggle" },
  { kind: "action", icon: "close", label: "Reset the panel", action: "reset", ref: "reset", dispatch: "command" },
];

const RAIL_SLOT: ToolbarItem<ChromeAction, ChromeGlyph> = {
  kind: "slot",
  slot: (
    <Badge tone='secondary' appearance='solid'>
      Slot
    </Badge>
  ),
};

const RAIL_POPOVER: ToolbarItem<ChromeAction, ChromeGlyph> = {
  kind: "popover",
  icon: "hamburger",
  label: "Panel options",
  ref: "options",
  content: (
    <>
      <Switch name='show-toolbar-grid'>Snap to grid</Switch>
      <Switch name='show-toolbar-rulers'>Show rulers</Switch>
    </>
  ),
  titleAction: { icon: "close", label: "Close panel options", action: "closeOptions", ref: "close-options" },
};

const RAIL_CONFIG: ToolbarDefinition<ChromeAction, ChromeGlyph> = {
  groups: [{ items: RAIL_ACTIONS }, { items: [RAIL_POPOVER] }, { items: [RAIL_SLOT] }],
};

const TOP_CONFIG: ToolbarDefinition<ChromeAction, ChromeGlyph> = { groups: [{ items: RAIL_ACTIONS }, { items: [RAIL_SLOT] }] };

const ChromeToolbarSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogSection id='chrome-toolbar' title='Chrome Toolbar'>
    <Resumable name={SHOW_SCOPES.toolbar} id={TOOLBAR_SCOPE_ID} class='w-full space-y-4'>
      <CatalogNote>
        The rail is built from a <code>ToolbarDefinition</code>: its items dispatch actions into the enclosing scope, which owns the panel beside
        it. The second rail is the same definition at <code>placement="top"</code>.
      </CatalogNote>
      <div class='flex gap-4 rounded-lg border border-border p-4'>
        <Toolbar
          config={RAIL_CONFIG}
          icon={icon}
          placement='left'
          id='show-toolbar-rail'
          commandTarget={TOOLBAR_SCOPE_ID}
          aria-label='Panel tools'
        />
        <div data-ref={PANEL_REF} class='max-w-xs rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground'>
          The panel the rail drives — fit it to its content, hide it, or reset it.
        </div>
      </div>
      <CatalogNote>
        The <code>Slot</code> badge is a <code>slot</code> item: the seam where caller-supplied markup sits in the rail instead of a button.
      </CatalogNote>
      <Toolbar
        config={TOP_CONFIG}
        icon={icon}
        placement='top'
        id='show-toolbar-top'
        commandTarget={TOOLBAR_SCOPE_ID}
        aria-label='Panel tools (horizontal)'
      />
      <CatalogNote>
        The other two placements complete the set, on the same definition as the first rail. <code>placement</code> decides the axis the items run
        along, the side each separator is drawn across, and the edge a flyout opens away from — which is where the rail publishes it.
      </CatalogNote>
      <div class='flex gap-4 rounded-lg border border-border p-4'>
        <Toolbar
          config={RAIL_CONFIG}
          icon={icon}
          placement='right'
          id='show-toolbar-right'
          commandTarget={TOOLBAR_SCOPE_ID}
          aria-label='Panel tools (right rail)'
        />
      </div>
      <Toolbar
        config={RAIL_CONFIG}
        icon={icon}
        placement='bottom'
        id='show-toolbar-bottom'
        commandTarget={TOOLBAR_SCOPE_ID}
        aria-label='Panel tools (bottom)'
      />
    </Resumable>
  </CatalogSection>
);

const NAV_CONFIG: NavDefinition = {
  sections: [
    {
      items: [
        { label: "Overview", href: "chrome-navbar" },
        {
          label: "Sections",
          items: [
            { label: "Chrome Toolbar", href: "chrome-toolbar" },
            { label: "Chrome Navbar", href: "chrome-navbar" },
            {
              label: "More",
              items: [
                { label: "Badge", href: "badge" },
                { label: "Button", href: "button" },
              ],
            },
          ],
        },
        {
          label: "Catalog",
          groups: [
            {
              heading: "Primitives",
              group: [
                { label: "Badge", href: "badge" },
                { label: "Button", href: "button" },
              ],
            },
            {
              heading: "Chrome",
              group: [
                { label: "Dock", href: "chrome-dock" },
                { label: "Toolbar", href: "chrome-toolbar" },
              ],
            },
            { heading: "Overlay", group: [{ label: "Popover", href: "popover" }] },
          ],
        },
        { label: "Admin", href: "chrome-navbar", filters: ["admin"] },
      ],
    },
    { items: [{ slot: "status" }] },
  ],
};

const NAV_FILTERS: { label: string; filters: string }[] = [
  { label: "Signed out", filters: "" },
  { label: "User", filters: "user" },
  { label: "Admin", filters: "user admin" },
];

const navHref = () => "#chrome-navbar";

const ChromeNavbarSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogSection id='chrome-navbar' title='Chrome Navbar'>
    <Resumable name={SHOW_SCOPES.navbar} class='w-full space-y-4'>
      <CatalogNote>
        The bar is built from a <code>NavDefinition</code>: each <code>href</code> is a route-map key resolved through <code>resolveHref</code>, the
        trailing item is a <code>NavSlot</code>, and the Admin link is filtered — it starts hidden until its token is active. All four placements
        are below; <code>class='static'</code> is what keeps a placed bar inline here rather than pinned to the viewport.
      </CatalogNote>
      <div class='flex flex-wrap gap-2'>
        {NAV_FILTERS.map((entry) => (
          <Button key={entry.label} tone='neutral' appearance='outline' size='sm' data-on-click='setFilters' data-filters={entry.filters}>
            {entry.label}
          </Button>
        ))}
      </div>
      <CatalogNote>
        Each button dispatches the <code>navbar:filters</code> document event, which every navbar scope on the page listens for.
      </CatalogNote>
      <div class='w-full rounded-lg border border-dashed border-border'>
        <Navbar
          config={NAV_CONFIG}
          resolveHref={navHref}
          icon={icon}
          collapsible='mobile'
          id='show-navbar-top'
          aria-label='Demo navigation'
          activeFilters={["user"]}
          slots={{ status: <Badge appearance='outline'>NavSlot</Badge> }}
          class='static'
        />
      </div>
      <div class='w-full rounded-lg border border-dashed border-border'>
        <Navbar
          config={NAV_CONFIG}
          resolveHref={navHref}
          icon={icon}
          collapsible='always'
          defaultOpen
          id='show-navbar-rail'
          aria-label='Demo navigation (rail)'
          activeFilters={["user"]}
          slots={{ status: <Badge appearance='outline'>NavSlot</Badge> }}
          class='static max-h-none'
        />
      </div>
      <CatalogNote>
        <code>collapsedAs='drawer'</code> changes only what the collapsed panel does below <code>md</code>: it leaves the flow and slides in from
        the edge <code>placement</code> implies, over a backdrop that closes it. Narrow the window past the breakpoint to see it. The toggle stays a
        hamburger here — the panel pair is for a <code>collapsible='always'</code> rail, which the two rails framing this page are.
      </CatalogNote>
      <div class='w-full rounded-lg border border-dashed border-border'>
        <Navbar
          config={NAV_CONFIG}
          resolveHref={navHref}
          icon={icon}
          collapsible='mobile'
          collapsedAs='drawer'
          id='show-navbar-drawer'
          aria-label='Demo navigation (drawer)'
          activeFilters={["user"]}
          slots={{ status: <Badge appearance='outline'>NavSlot</Badge> }}
          class='static'
        />
      </div>
      <div class='w-full rounded-lg border border-dashed border-border'>
        <Navbar
          config={NAV_CONFIG}
          resolveHref={navHref}
          icon={icon}
          collapsible='mobile'
          placement='bottom'
          id='show-navbar-bottom'
          aria-label='Demo navigation (bottom)'
          activeFilters={["user"]}
          slots={{ status: <Badge appearance='outline'>NavSlot</Badge> }}
          class='static'
        />
      </div>
      <div class='w-full rounded-lg border border-dashed border-border'>
        <Navbar
          config={NAV_CONFIG}
          resolveHref={navHref}
          icon={icon}
          collapsible='mobile'
          placement='right'
          id='show-navbar-right'
          aria-label='Demo navigation (right)'
          activeFilters={["user"]}
          slots={{ status: <Badge appearance='outline'>NavSlot</Badge> }}
          class='static'
        />
      </div>
    </Resumable>
  </CatalogSection>
);

const DOCK_ITEMS: DockItem<"monitor" | "sun" | "moon">[] = [
  { label: "Overview", href: "chrome-dock", icon: "monitor", current: true },
  { label: "Day", href: "theme", icon: "sun" },
  { label: "Night", href: "theme", icon: "moon" },
  { label: "Admin", href: "chrome-navbar", icon: "monitor", filters: ["admin"] },
];

const dockHref = (key: string) => `#${key}`;

const ChromeDockSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogSection id='chrome-dock' title='Chrome Dock'>
    <CatalogNote>
      The phone-width primary navigation: a fixed bottom bar of three to five equal-weight destinations, hidden at <code>md:</code> where the{" "}
      <code>Navbar</code> takes over. <code>class='static'</code> and <code>hideAbove='never'</code> keep it inline here. Filters are server-hidden
      only; the <code>Admin</code> item shows once <code>admin</code> is in <code>activeFilters</code>.
    </CatalogNote>
    <Dock items={DOCK_ITEMS} resolveHref={dockHref} icon={icon} hideAbove='never' label='Demo dock' class='static max-w-md' />
    <Dock
      items={DOCK_ITEMS}
      resolveHref={dockHref}
      icon={icon}
      hideAbove='never'
      size='lg'
      activeFilters={["admin"]}
      label='Demo dock (admin)'
      class='static max-w-md'
    />
  </CatalogSection>
);

/** The chrome band: the configuration-driven Toolbar, Navbar and Dock. @internal */
export const ChromeDemos: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <div class='space-y-10'>
    <ChromeDockSection icon={icon} />
    <ChromeNavbarSection icon={icon} />
    <ChromeToolbarSection icon={icon} />
  </div>
);
