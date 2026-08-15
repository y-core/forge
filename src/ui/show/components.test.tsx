/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { PAGE_ORDER, SECTIONS, ShowcaseContent, type ShowcasePage } from "./components";
import { sectionBodies } from "./coverage";
import { showcasePaths } from "./route";

// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

const page = (which: ShowcasePage = "index") => render(<ShowcaseContent data={{ paths: showcasePaths("/showcase") }} icon={icon} page={which} />);

const pageOf = (id: string): ShowcasePage => SECTIONS.find((section) => section.id === id)?.page ?? "index";

/** One section's markup, rendered from whichever page the catalog declares it on. */
const bodyOf = async (id: string) => sectionBodies(await page(pageOf(id))).get(id) ?? "";

const openTags = (html: string, slot: string) =>
  [...html.matchAll(new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`, "g"))].map((match) => match[0]);

const attrOf = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

const axesOf = (html: string, slot: string) => openTags(html, slot).map((tag) => [attrOf(tag, "data-side"), attrOf(tag, "data-align")]);

function elementSlice(html: string, openTag: string): string {
  const start = html.indexOf(openTag);
  let depth = 0;
  for (const tag of html.matchAll(/<div\b|<\/div>/g)) {
    const at = tag.index ?? 0;
    if (at < start) continue;
    depth += tag[0] === "</div>" ? -1 : 1;
    if (depth === 0) return html.slice(start, at + "</div>".length);
  }
  return "";
}

/** The leading rail's markup: everything the shell renders before the page's own `<main>`. */
const pagesRail = (html: string) => html.slice(0, html.indexOf('id="main-content"'));

/** The trailing rail's markup, which the shell renders after `<main>` under its own scope name. */
const tocRail = (html: string) => html.slice(html.indexOf('data-scope="show-toc"'));

describe("ShowcaseContent", () => {
  it("renders the shell, the skip target and the page's own prerequisite on every page", async () => {
    for (const which of PAGE_ORDER) {
      const out = await page(which);
      expect(out).toContain('id="main-content"');
      expect(out).toContain("UI Component Showcase");
      expect(out).toContain('id="flash-container"');
    }
  });

  it("splits the two navigations into two rails: the page list leading, that page's own bands trailing", async () => {
    for (const which of PAGE_ORDER) {
      const out = await page(which);
      const groupsIn = (html: string) => html.split('data-slot="navbar-group"').length - 1;
      const bands = new Set(SECTIONS.filter((section) => section.page === which).map((section) => section.group));
      expect({ page: which, pages: groupsIn(pagesRail(out)), toc: groupsIn(tocRail(out)) }).toEqual({ page: which, pages: 1, toc: bands.size });
      expect(out).toContain('aria-label="Showcase pages"');
      expect(out).toContain('aria-label="On this page"');
    }
  });

  it("resolves each rail's own kind of key, so the page rail holds routes and the section rail fragments", async () => {
    const out = await page("interactive");
    const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? "");

    expect(hrefs(pagesRail(out))).toEqual(["/showcase", "/showcase/interactive", "/showcase/runtime", "/showcase/htmx", "/showcase/chrome"]);

    const anchors = hrefs(tocRail(out));
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.filter((href) => !href.startsWith("#"))).toEqual([]);
  });

  it("links every page from the rail, as a route rather than a fragment", async () => {
    const out = await page();
    const hrefs = ["/showcase", "/showcase/interactive", "/showcase/runtime", "/showcase/htmx", "/showcase/chrome"];
    expect(hrefs.filter((href) => !out.includes(`href="${href}"`))).toEqual([]);
  });

  it("links every catalog entry from the rail of the page that serves it, and no other", async () => {
    for (const which of PAGE_ORDER) {
      const out = await page(which);
      const linked = new Set([...tocRail(out).matchAll(/href="#([^"]+)"/g)].map((match) => match[1]));
      expect(SECTIONS.filter((section) => section.page === which && !linked.has(section.id)).map((section) => section.id)).toEqual([]);
      expect([...linked].filter((id) => SECTIONS.some((section) => section.id === id && section.page !== which))).toEqual([]);
    }
  });

  it("sizes each rail on its own flex item, not on the navbar inside it", async () => {
    const out = await page();

    expect(pagesRail(out).match(/<div data-scope="navbar"[^>]*>/)?.[0]).toBe(
      '<div data-scope="navbar" class="w-64 shrink-0 border-e border-border max-md:w-auto has-[[data-slot~=navbar]:not([open])]:w-auto has-[[data-slot~=navbar]:not([open])]:self-start has-[[data-slot~=navbar]:not([open])]:border-e-0">',
    );
    expect(out.match(/<div data-scope="show-toc"[^>]*>/)?.[0]).toBe(
      '<div data-scope="show-toc" class="w-64 shrink-0 border-s border-border max-md:w-auto has-[[data-slot~=navbar]:not([open])]:w-auto has-[[data-slot~=navbar]:not([open])]:self-start has-[[data-slot~=navbar]:not([open])]:border-s-0">',
    );

    for (const id of ["showcase-pages", "showcase-toc"]) {
      const navbarTag = out.match(new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`))?.[0];
      expect(navbarTag).toBeDefined();
      const navbarClasses = navbarTag?.match(/\sclass="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
      expect(navbarClasses.length).toBeGreaterThan(0);
      expect(navbarClasses).not.toContain("w-64");
      expect(navbarClasses).not.toContain("shrink-0");
    }
  });

  it("serves each band from the page its prerequisite names", async () => {
    expect(await page("index")).toContain('id="button"');
    expect(await page("htmx")).toContain('id="htmx-demos"');
    expect(await page("chrome")).toContain('id="theme"');
    expect(await page("runtime")).toContain('data-scope="show-filter"');
  });

  it("orders the lazy band after the resumable island", async () => {
    const out = await page("runtime");
    expect(out.indexOf('id="lazy"')).toBeGreaterThan(out.indexOf('id="resumable"'));
  });

  it("renders a section element for every catalog entry, across every page", async () => {
    const all = (await Promise.all(PAGE_ORDER.map((which) => page(which)))).join("");
    const unrendered = SECTIONS.filter((section) => !all.includes(`id="${section.id}"`)).map((section) => section.id);
    expect(unrendered).toEqual([]);
  });

  it("marks the required label with the marker span, and only that label", async () => {
    const body = await bodyOf("label");
    expect([...body.matchAll(/<span data-slot="label-required"[^>]*>[^<]*<\/span>/g)].map((match) => match[0])).toEqual([
      '<span data-slot="label-required" aria-hidden="true" class="ms-0.5 text-destructive">*</span>',
    ]);
  });

  it("demonstrates every FormField part the coverage manifest names", async () => {
    const body = await bodyOf("form-field");
    const slots = new Set([...body.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1]));
    expect(["field-set", "field-legend", "field-content", "field-title", "field-separator"].filter((slot) => !slots.has(slot))).toEqual([]);
  });

  it("renders both legend variants, the section heading and the inner label", async () => {
    const body = await bodyOf("form-field");
    expect([...body.matchAll(/<legend[^>]*>/g)].map((match) => match[0])).toEqual([
      '<legend data-slot="field-legend" data-variant="legend" class="mb-3 font-medium text-base text-foreground">',
      '<legend data-slot="field-legend" data-variant="label" class="mb-3 font-medium text-sm text-foreground">',
    ]);
  });

  it("places every menu popup on its declared side and alignment, defaulting the context menu", async () => {
    const body = await bodyOf("menu");
    expect(axesOf(body, "menu-popup")).toEqual([
      ["bottom", "start"],
      ["inline-end", "start"],
      ["top", "end"],
      ["bottom", "start"],
    ]);
  });

  it("renders one menu link row, as a menuitem anchor to the section", async () => {
    const body = await bodyOf("menu");
    expect(
      [...body.matchAll(/<a [^>]*data-slot="menu-link-item"[^>]*>/g)].map((match) => [attrOf(match[0], "role"), attrOf(match[0], "href")]),
    ).toEqual([["menuitem", "#menu"]]);
  });

  it("wires the one submenu trigger to a popup nested inside the file menu", async () => {
    const body = await bodyOf("menu");
    expect(openTags(body, "menu-submenu-trigger").map((tag) => attrOf(tag, "commandfor"))).toEqual(["show-file-export"]);

    const filePopup = body.match(/<div id="show-file-menu"[^>]*data-slot="menu-popup"[^>]*>/)?.[0] ?? "";
    const nested = elementSlice(body, filePopup);
    expect([...nested.matchAll(/<div id="([^"]*)"[^>]*data-slot="menu-popup"/g)].map((match) => match[1])).toEqual([
      "show-file-menu",
      "show-file-export",
    ]);
  });

  it("renders the dialog anatomy in trigger, header, body, footer order with a close in each end", async () => {
    const body = await bodyOf("dialog");
    expect([...body.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1])).toEqual([
      "dialog-trigger",
      "dialog",
      "dialog-header",
      "dialog-close",
      "dialog-body",
      "dialog-footer",
      "dialog-close",
      // The open, non-modal one: no trigger, because it is already showing.
      "dialog",
      "dialog-header",
      "dialog-body",
      "dialog-footer",
      "dialog-close",
    ]);
  });

  // `open` is the platform's non-modal spelling and `request-close` the cancelable algorithm — two
  // things `openModal` and a plain `close` cannot express.
  it("renders the second dialog open and non-modal, closing through the cancelable command", async () => {
    const body = await bodyOf("dialog");
    const dialogs = [...body.matchAll(/<dialog[^>]*>/g)].map((match) => match[0]);
    expect(dialogs.map((tag) => /\sopen(?=[\s>])/.test(tag))).toEqual([false, true]);
    expect([...body.matchAll(/command="([^"]*)"/g)].map((match) => match[1])).toEqual(["show-modal", "close", "close", "request-close"]);
  });

  // Positioning is the stylesheet's job, not the demo's: `forge-ui.css` §6 flows a non-modal dialog
  // inline, and a demo carrying its own `static` would hide a regression in that rule.
  it("leaves the non-modal dialog's positioning to the stylesheet", async () => {
    const body = await bodyOf("dialog");
    const open = [...body.matchAll(/<dialog[^>]*>/g)].map((match) => match[0]).find((tag) => /\sopen(?=[\s>])/.test(tag)) ?? "";
    expect((open.match(/\sclass="([^"]*)"/)?.[1] ?? "").split(" ")).toEqual([
      "rounded-xl",
      "border",
      "border-border",
      "bg-popover",
      "text-popover-foreground",
      "shadow-lg",
      "max-w-sm",
    ]);
  });

  it("demonstrates each popover axis, holding the default on the axis it is not varying", async () => {
    const body = await bodyOf("popover");
    expect(axesOf(body, "popover-content")).toEqual([
      ["bottom", "start"],
      ["top", "start"],
      ["bottom", "center"],
      ["bottom", "end"],
    ]);
  });

  it("demonstrates each tooltip side, centring the alignment unless it is the axis varied", async () => {
    const body = await bodyOf("tooltip");
    expect(axesOf(body, "tooltip-content")).toEqual([
      ["top", "center"],
      ["bottom", "start"],
      ["right", "center"],
      ["left", "end"],
      ["top", "center"],
    ]);
  });

  it("renders one toast container per position, every one silenced to aria-live=off", async () => {
    const body = await bodyOf("toast");
    const containers = openTags(body, "toast-container");
    expect(containers.map((tag) => attrOf(tag, "data-position"))).toEqual([
      "top-left",
      "top-center",
      "top-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ]);
    expect(containers.map((tag) => attrOf(tag, "aria-live"))).toEqual(["off", "off", "off", "off", "off", "off"]);
  });

  it("serialises the long duration into data-state, leaving the undurated toast an empty state", async () => {
    const body = await bodyOf("toast");
    expect([...body.matchAll(/data-state="[^"]*"/g)].map((match) => match[0])).toEqual([
      'data-state="{}"',
      'data-state="{&quot;duration&quot;:600000}"',
    ]);
  });

  it("announces from exactly one live region on every page, the flash container", async () => {
    for (const which of PAGE_ORDER) {
      const out = await page(which);
      expect({ page: which, polite: [...out.matchAll(/aria-live="([^"]*)"/g)].filter((match) => match[1] === "polite").length }).toEqual({
        page: which,
        polite: 1,
      });
    }
  });

  it("gives every navigation landmark on every page a label, and no two the same", async () => {
    for (const which of PAGE_ORDER) {
      const labels = [...(await page(which)).matchAll(/<nav\b[^>]*>/g)].map((match) => attrOf(match[0], "aria-label"));
      expect(labels.filter((label) => label === null)).toEqual([]);
      expect(new Set(labels).size).toBe(labels.length);
      expect(labels).toContain("Showcase pages");
      expect(labels).toContain("On this page");
    }

    expect([...(await page("chrome")).matchAll(/<nav\b[^>]*>/g)].map((match) => attrOf(match[0], "aria-label")).sort()).toEqual([
      "Demo navigation",
      "Demo navigation (bottom)",
      "Demo navigation (drawer)",
      "Demo navigation (rail)",
      "Demo navigation (right)",
      "On this page",
      "Panel tools",
      "Panel tools (bottom)",
      "Panel tools (horizontal)",
      "Panel tools (right rail)",
      "Showcase pages",
    ]);
  });

  it("groups the select options under both labelled optgroups", async () => {
    const body = await bodyOf("select");
    expect([...body.matchAll(/<optgroup[^>]*>/g)].map((match) => match[0])).toEqual([
      '<optgroup data-slot="select-optgroup" label="Metric">',
      '<optgroup data-slot="select-optgroup" label="Imperial">',
    ]);
  });

  it("shows every badge variant exactly once, in the order the variant union declares", async () => {
    const body = await bodyOf("badge");
    expect([...body.matchAll(/data-variant="([^"]*)"/g)].map((match) => match[1])).toEqual([
      "default",
      "secondary",
      "outline",
      "destructive",
      "info",
      "success",
      "warning",
    ]);
  });

  it("demonstrates the destructive variant and each icon-only size exactly once", async () => {
    const body = await bodyOf("button");
    const classes = [...body.matchAll(/<button[^>]*>/g)].map((match) => attrOf(match[0], "class")?.split(/\s+/) ?? []);
    const having = (...tokens: string[]) => classes.filter((list) => tokens.every((token) => list.includes(token))).length;
    expect({
      destructive: having("bg-destructive"),
      iconMd: having("size-9", "p-0"),
      iconSm: having("size-8", "p-0"),
      square: having("w-full", "aspect-square", "p-0"),
    }).toEqual({ destructive: 1, iconMd: 1, iconSm: 1, square: 1 });
  });

  it("gives every button with no text an accessible name from aria-label", async () => {
    const body = await bodyOf("button");
    const unnamed = [...body.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
      .filter((match) => (match[2] ?? "").replace(/<[^>]*>/g, "").trim() === "")
      .map((match) => attrOf(`<button${match[1]}>`, "aria-label"));
    expect(unnamed).toEqual(["Close panel", "Open menu", "More options"]);
  });

  it("wraps the square button in the width-bearing parent the hierarchy rule requires", async () => {
    const body = await bodyOf("button");
    expect(body.match(/<div class="w-16">(<[a-z]+)/)?.[1]).toBe("<button");
  });

  it("places the card action in the header grid, after the title and description", async () => {
    const body = await bodyOf("card");
    const action = openTags(body, "card-action");
    expect(action).toEqual(['<div data-slot="card-action" class="col-start-2 row-span-2 row-start-1 self-start justify-self-end">']);

    const header = elementSlice(body, openTags(body, "card-header")[0] ?? "");
    expect([...header.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1])).toEqual([
      "card-header",
      "card-title",
      "card-description",
      "card-action",
      "button",
    ]);
  });

  it("serves the one avatar image from the showcase's own route, with a descriptive alt", async () => {
    const body = await bodyOf("avatar");
    const images = [...body.matchAll(/<img[^>]*>/g)].map((match) => match[0]);
    expect(images).toEqual([
      '<img data-slot="avatar-image" class="aspect-square size-full object-cover" alt="Ada Lovelace" src="/showcase/avatar">',
    ]);
    expect(attrOf(images[0] ?? "", "src")).toBe(showcasePaths("/showcase").avatar);
  });

  it("shows four horizontal progress bars and two vertical ones, each sized on its own axis", async () => {
    const body = await bodyOf("progress");
    const bars = openTags(body, "progress");
    expect(bars.map((tag) => attrOf(tag, "data-orientation"))).toEqual([
      "horizontal",
      "horizontal",
      "horizontal",
      "horizontal",
      "vertical",
      "vertical",
    ]);
    expect(bars.filter((tag) => attrOf(tag, "data-orientation") === "vertical").map((tag) => attrOf(tag, "class"))).toEqual([
      "w-2 h-full rounded-full",
      "w-2 h-full rounded-full",
    ]);
  });

  it("renders both separator orientations, the vertical one stretching to its flex row", async () => {
    const body = await bodyOf("separator");
    const rules = [...body.matchAll(/<hr[^>]*>/g)].map((match) => match[0]);
    expect(rules.map((tag) => attrOf(tag, "aria-orientation"))).toEqual(["horizontal", "vertical"]);
    expect(rules[1]).toBe('<hr data-slot="separator" aria-orientation="vertical" class="self-stretch w-px border-0 bg-border">');
  });

  it("lays the horizontal scroll area's content out as one non-wrapping row", async () => {
    const body = await bodyOf("scroll-area");
    const roots = openTags(body, "scroll-area");
    expect(roots.map((tag) => attrOf(tag, "data-orientation"))).toEqual(["vertical", "horizontal"]);

    const horizontal = elementSlice(body, roots[1] ?? "");
    expect([...horizontal.matchAll(/<div class="([^"]*)">/g)].map((match) => match[1])).toEqual(["flex w-max gap-2"]);
  });

  it("renders both tabs orientations, each widget selecting exactly one of its own tabs", async () => {
    const body = await bodyOf("tabs");
    const roots = openTags(body, "tabs");
    expect(roots.map((tag) => attrOf(tag, "data-orientation"))).toEqual(["horizontal", "vertical"]);
    expect(openTags(body, "tabs-list").map((tag) => attrOf(tag, "aria-orientation"))).toEqual(["horizontal", "vertical"]);

    const panelIds = openTags(body, "tabs-panel").map((tag) => attrOf(tag, "id"));
    expect(panelIds).toEqual(["show-tab-a", "show-tab-b", "show-tab-c", "show-vtab-a", "show-vtab-b"]);
    expect(new Set(panelIds).size).toBe(panelIds.length);

    expect(roots.map((root) => (elementSlice(body, root).match(/aria-selected="true"/g) ?? []).length)).toEqual([1, 1]);
  });

  it("renders both orientations, both selection types, and a disabled group", async () => {
    const body = await bodyOf("toggle-group");
    const groups = openTags(body, "toggle-group");

    expect(groups.map((tag) => attrOf(tag, "data-orientation"))).toEqual(["horizontal", "horizontal", "horizontal", "vertical", "horizontal"]);
    expect(groups.filter((tag) => tag.includes("data-multiple"))).toHaveLength(1);
    expect(body).toContain('type="checkbox"');
    expect(body).toContain('type="radio"');
    expect(body).toContain('class="sr-only" checked disabled');
  });

  it("gives each choice group both orientations, its own field name and unique control ids", async () => {
    for (const section of ["radio-group", "checkbox-group"] as const) {
      const body = await bodyOf(section);
      expect(openTags(body, section).map((tag) => attrOf(tag, "data-orientation"))).toEqual(["horizontal", "vertical"]);

      const inputs = [...body.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
      expect(new Set(inputs.map((tag) => attrOf(tag, "name"))).size).toBe(2);
      const ids = inputs.map((tag) => attrOf(tag, "id"));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("stacks the vertical toolbar and turns its separator across the stack", async () => {
    const body = await bodyOf("toolbar");
    const roots = openTags(body, "toolbar");
    expect(roots.map((tag) => attrOf(tag, "data-orientation"))).toEqual(["horizontal", "vertical"]);
    expect(attrOf(roots[1] ?? "", "class")).toBe("flex items-center gap-1 flex-col");

    const vertical = elementSlice(body, roots[1] ?? "");
    expect(openTags(vertical, "toolbar-separator").map((tag) => attrOf(tag, "aria-orientation"))).toEqual(["horizontal"]);
  });

  it("renders the one asChild toolbar item as an anchor that stays a roving tab stop", async () => {
    const body = await bodyOf("toolbar");
    const items = openTags(body, "toolbar-button");
    expect(items.map((tag) => tag.match(/^<([a-z]+)/)?.[1])).toEqual(["button", "button", "button", "a", "button", "button"]);

    const anchor = items[3] ?? "";
    expect(attrOf(anchor, "href")).toBe("#toolbar");
    expect(anchor.includes('data-toolbar-item=""')).toBe(true);
    expect(attrOf(anchor, "type")).toBeNull();
  });

  it("renders the one asChild tooltip trigger as an anchor described by its own tooltip", async () => {
    const body = await bodyOf("tooltip");
    const triggers = openTags(body, "tooltip-trigger");
    expect(triggers.map((tag) => tag.match(/^<([a-z]+)/)?.[1])).toEqual(["button", "button", "button", "button", "a"]);

    const anchor = triggers[4] ?? "";
    expect(attrOf(anchor, "href")).toBe("#tooltip");
    expect(attrOf(anchor, "type")).toBeNull();
    const contentIds = openTags(body, "tooltip-content").map((tag) => attrOf(tag, "id"));
    expect(contentIds).toEqual(["show-tooltip-save", "show-tooltip-bottom", "show-tooltip-right", "show-tooltip-left", "show-tooltip-link"]);
    expect(attrOf(anchor, "aria-describedby")).toBe(contentIds[4]);
  });

  it("gives no catalog section an id a third-party script publishes on window", () => {
    // The DOM exposes every `id` as a window property, so `id="turnstile"` answers Cloudflare's
    // `window.turnstile` truthiness check with an element and its `api.js` reports a double load.
    const reserved = new Set(["turnstile"]);
    expect(SECTIONS.map((section) => section.id).filter((id) => reserved.has(id))).toEqual([]);
  });

  it("guards each turnstile size with its own form, self-scoping widget and distinct email field", async () => {
    const body = await bodyOf("turnstile-widget");
    expect([...body.matchAll(/data-size="([^"]*)"/g)].map((match) => match[1])).toEqual(["normal", "compact", "flexible"]);

    const forms = [...body.matchAll(/<form([^>]*)>([\s\S]*?)<\/form>/g)];
    // The showcase adds no scope of its own — each widget carries `data-scope="turnstile"`, which is
    // the whole wiring a consuming app needs.
    expect(forms.map((form) => attrOf(`<form${form[1]}>`, "data-scope"))).toEqual([null, null, null]);
    const widgets = forms.map((form) => (form[2] ?? "").match(/<div[^>]*data-ref="turnstile"[^>]*>/)?.[0] ?? "");
    expect(widgets.map((widget) => attrOf(widget, "data-scope"))).toEqual(["turnstile", "turnstile", "turnstile"]);

    const parts = /<input[^>]*type="email"[^>]*>|<div[^>]*data-ref="turnstile"[^>]*>|<button[^>]*type="submit"[^>]*>/g;
    for (const form of forms) {
      expect([...(form[2] ?? "").matchAll(parts)].map((match) => match[0].match(/^<([a-z]+)/)?.[1])).toEqual(["input", "div", "button"]);
    }

    const emails = forms.map((form) => (form[2] ?? "").match(/<input[^>]*type="email"[^>]*>/)?.[0] ?? "").map((tag) => attrOf(tag, "name"));
    expect(emails).toEqual(["turnstile-email", "turnstile-email-compact", "turnstile-email-flexible"]);
  });
});
