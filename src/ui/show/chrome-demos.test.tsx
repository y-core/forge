/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { ShowcaseContent } from "./components";
import { sectionBodies } from "./coverage";
import { showcasePaths } from "./route";

// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

const page = () => render(<ShowcaseContent data={{ paths: showcasePaths("/showcase") }} icon={icon} page='chrome' />);

const bodyOf = async (id: string) => sectionBodies(await page()).get(id) ?? "";

const slotTags = (html: string, slot: string) =>
  [...html.matchAll(new RegExp(`<[a-z]+[^>]*data-slot="[^"]*(?<![-\\w])${slot}(?![-\\w])[^"]*"[^>]*>`, "g"))].map((match) => match[0]);

const attrOf = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

const hasFlag = (tag: string, name: string) => new RegExp(`\\s${name}(?=[\\s>])`).test(tag);

const classTokens = (tag: string) => (attrOf(tag, "class") ?? "").split(/\s+/).filter(Boolean);

/** Each rail's own markup, cut at the next rail's id — the four are siblings in placement order. */
function rails(body: string): Record<"rail" | "top" | "right" | "bottom", string> {
  const at = (id: string) => body.indexOf(`id="show-toolbar-${id}"`);
  const [rail, top, right, bottom] = ["rail", "top", "right", "bottom"].map(at);
  return { rail: body.slice(rail, top), top: body.slice(top, right), right: body.slice(right, bottom), bottom: body.slice(bottom) };
}

/** The three action labels every rail repeats, in the order the definition declares them. */
const RAIL_LABELS = ["Fit panel to content", "Show or hide the panel", "Reset the panel"];

describe("ChromeToolbarSection", () => {
  it("renders all four placements, mirroring each rail's axis into aria-orientation", async () => {
    const body = await bodyOf("chrome-toolbar");
    expect(
      [...body.matchAll(/<[a-z]+[^>]*role="toolbar"[^>]*>/g)].map((match) => [
        attrOf(match[0], "id"),
        attrOf(match[0], "data-orientation"),
        attrOf(match[0], "aria-orientation"),
      ]),
    ).toEqual([
      ["show-toolbar-rail", "vertical", "vertical"],
      ["show-toolbar-top", "horizontal", "horizontal"],
      ["show-toolbar-right", "vertical", "vertical"],
      ["show-toolbar-bottom", "horizontal", "horizontal"],
    ]);
  });

  it("labels every action button with a title and an aria-label carrying the same text", async () => {
    const tags = slotTags(await bodyOf("chrome-toolbar"), "toolbar-action");
    expect(tags.map((tag) => attrOf(tag, "aria-label"))).toEqual([...RAIL_LABELS, ...RAIL_LABELS, ...RAIL_LABELS, ...RAIL_LABELS]);
    expect(tags.map((tag) => attrOf(tag, "title"))).toEqual(tags.map((tag) => attrOf(tag, "aria-label")));
  });

  it("routes the reset item through the invoker command and the others through the scope click channel", async () => {
    const tags = slotTags(await bodyOf("chrome-toolbar"), "toolbar-action");
    const routing = [
      ["fit", null, "fit"],
      ["toggle", null, "toggle"],
      ["reset", "--reset", null],
    ];
    expect(tags.map((tag) => [attrOf(tag, "data-ref"), attrOf(tag, "command"), attrOf(tag, "data-on-click")])).toEqual([
      ...routing,
      ...routing,
      ...routing,
      ...routing,
    ]);
  });

  it("points the vertical rail's reset command at the enclosing resumable scope", async () => {
    const reset = slotTags(rails(await bodyOf("chrome-toolbar")).rail, "toolbar-action").at(-1) ?? "";
    expect([attrOf(reset, "command"), attrOf(reset, "commandfor")]).toEqual(["--reset", "show-toolbar"]);
  });

  it("draws every separator across the rail's own axis, one declared plus one between each group", async () => {
    const { rail, top, right, bottom } = rails(await bodyOf("chrome-toolbar"));
    const orientations = (html: string) => slotTags(html, "toolbar-separator").map((tag) => attrOf(tag, "aria-orientation"));
    expect(orientations(rail)).toEqual(["horizontal", "horizontal", "horizontal"]);
    expect(orientations(top)).toEqual(["vertical", "vertical"]);
    expect(orientations(right)).toEqual(["horizontal", "horizontal", "horizontal"]);
    expect(orientations(bottom)).toEqual(["vertical", "vertical", "vertical"]);
  });

  // The flyout is the one place a rail publishes its placement: the root's classes and its
  // `data-orientation` are shared by the two rails on each axis, so only this tells left from right.
  it("gives each flyout-bearing rail an auto popover carrying that rail's own placement", async () => {
    const body = await bodyOf("chrome-toolbar");
    expect(slotTags(body, "toolbar-flyout").map((tag) => [attrOf(tag, "popover"), attrOf(tag, "data-placement")])).toEqual([
      ["auto", "left"],
      ["auto", "right"],
      ["auto", "bottom"],
    ]);
  });

  it("dispatches the flyout's close through the scope and keeps it out of the roving item set", async () => {
    const title = slotTags(await bodyOf("chrome-toolbar"), "toolbar-title-action");
    const expected = ["closeOptions", "Close panel options", false];
    expect(title.map((tag) => [attrOf(tag, "data-on-click"), attrOf(tag, "aria-label"), hasFlag(tag, "data-toolbar-item")])).toEqual([
      expected,
      expected,
      expected,
    ]);
  });

  it("renders the slot item's badge inside each rail and exactly one panel for them to drive", async () => {
    const { rail, top, right, bottom } = rails(await bodyOf("chrome-toolbar"));
    expect([rail, top, right, bottom].map((html) => slotTags(html, "badge").length)).toEqual([1, 1, 1, 1]);
    expect([...(await bodyOf("chrome-toolbar")).matchAll(/<[a-z]+[^>]*data-ref="toolbar-panel"[^>]*>/g)].length).toBe(1);
  });
});

describe("ChromeNavbarSection", () => {
  it("renders all four placements and pins every demo bar into the page flow, not to the viewport", async () => {
    const bars = slotTags(await bodyOf("chrome-navbar"), "navbar");
    expect(bars.map((tag) => [attrOf(tag, "id"), classTokens(tag).includes("static"), classTokens(tag).includes("sticky")])).toEqual([
      ["show-navbar-top", true, false],
      ["show-navbar-rail", true, false],
      ["show-navbar-drawer", true, false],
      ["show-navbar-bottom", true, false],
      ["show-navbar-right", true, false],
    ]);
  });

  // Navbar carries its placement in the pin classes rather than in a `data-` attribute, which is
  // what the coverage manifest's markers read.
  it("gives each bar the pin classes of its own placement", async () => {
    const bars = slotTags(await bodyOf("chrome-navbar"), "navbar");
    const pinned = (tag: string) => classTokens(tag).filter((token) => /^(?:md:)?(?:top|right|bottom|left)-0$/.test(token));
    expect(bars.map((tag) => [attrOf(tag, "id"), pinned(tag)])).toEqual([
      ["show-navbar-top", ["left-0", "md:top-0"]],
      ["show-navbar-rail", ["top-0", "left-0"]],
      ["show-navbar-drawer", ["left-0", "md:top-0"]],
      ["show-navbar-bottom", ["right-0", "md:bottom-0"]],
      ["show-navbar-right", ["bottom-0", "md:right-0"]],
    ]);
  });

  it("renders no navbar-group wrapper, the demo bars being sectioned instead", async () => {
    expect(slotTags(await bodyOf("chrome-navbar"), "navbar-group")).toEqual([]);
  });

  it("starts the filtered Admin link hidden and leaves the unfiltered Overview link untouched", async () => {
    const links = slotTags(await bodyOf("chrome-navbar"), "navbar-link");
    const perBar = [
      [null, false],
      ["admin", true],
    ];
    expect(links.map((tag) => [attrOf(tag, "data-filter"), hasFlag(tag, "hidden")])).toEqual([
      ...perBar,
      ...perBar,
      ...perBar,
      ...perBar,
      ...perBar,
    ]);
  });

  it("resolves the slot key into the caller's badge, leaving the key itself out of the markup", async () => {
    const body = await bodyOf("chrome-navbar");
    expect([...body.matchAll(/<span data-slot="badge"[^>]*>([^<]*)<\/span>/g)].map((match) => match[1])).toEqual([
      "NavSlot",
      "NavSlot",
      "NavSlot",
      "NavSlot",
      "NavSlot",
    ]);
    expect(body.includes("status")).toBe(false);
  });

  it("namespaces the submenu popup id per bar, so the two copies of one definition never collide", async () => {
    const triggers = slotTags(await bodyOf("chrome-navbar"), "menu-submenu-trigger");
    expect(triggers.map((tag) => attrOf(tag, "commandfor"))).toEqual([
      "navbar-menu-show-navbar-top-1",
      "navbar-menu-show-navbar-rail-1",
      "navbar-menu-show-navbar-drawer-1",
      "navbar-menu-show-navbar-bottom-1",
      "navbar-menu-show-navbar-right-1",
    ]);
  });

  it("offers the three filter tokens as buttons dispatching one shared scope action", async () => {
    const buttons = [...(await bodyOf("chrome-navbar")).matchAll(/<button[^>]*data-on-click="setFilters"[^>]*>/g)].map((match) => match[0]);
    expect(buttons.map((tag) => attrOf(tag, "data-filters"))).toEqual(["", "user", "user admin"]);
  });
});
