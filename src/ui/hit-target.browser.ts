import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { jsx } from "../render/jsx/jsx-runtime";
import type { JSXNode } from "../render/jsx/types";
import { barrelComponents } from "../testing/coverage/components";
import { render } from "../testing/render";
import { Dock } from "./chrome/dock";
import * as chrome from "./chrome/mod";
import { Navbar } from "./chrome/navbar";
import { ThemeToggle } from "./chrome/theme-toggle";
import { Toolbar as ChromeToolbar } from "./chrome/toolbar";
import type { NavDefinition } from "./chrome/types";
import { mount, withCompiledCss } from "./client/browser.fixture";
import { Accordion } from "./core/accordion";
import { Alert } from "./core/alert";
import { Breadcrumbs } from "./core/breadcrumbs";
import { Button } from "./core/button";
import { Carousel } from "./core/carousel";
import { CheckboxGroup } from "./core/checkbox-group";
import { Collapsible } from "./core/collapsible";
import { Dialog } from "./core/dialog";
import { Drawer } from "./core/drawer";
import { FileInput } from "./core/file-input";
import { Filter } from "./core/filter";
import { createIcon } from "./core/icon";
import { Input } from "./core/input";
import { Link } from "./core/link";
import { Menu } from "./core/menu";
import * as core from "./core/mod";
import { NumberField } from "./core/number-field";
import { OtpInput } from "./core/otp-input";
import { Pagination } from "./core/pagination";
import { Popover } from "./core/popover";
import { RadioGroup } from "./core/radio-group";
import { Select } from "./core/select";
import { Slider } from "./core/slider";
import { Switch } from "./core/switch";
import { Tabs } from "./core/tabs";
import { Textarea } from "./core/textarea";
import { Toast } from "./core/toast";
import { Toggle } from "./core/toggle";
import { ToggleGroup } from "./core/toggle-group";
import { Toolbar } from "./core/toolbar";
import { Tooltip } from "./core/tooltip";

const HIT_TARGET_FLOOR_PX = 28;

const LAYOUT_UNIT_PX = 1 / 64;

const HIT_TARGET_SHAPES = {
  default: "",
  compact: readFileSync(fileURLToPath(new URL("./assets/css/shape-compact.css", import.meta.url)), "utf-8"),
} as const;

const HIT_TARGET_VIEWPORTS = [
  { width: 375, height: 800 },
  { width: 1280, height: 800 },
] as const;

const POINTER_TARGET_SELECTOR =
  "a[href], button, input:not([type='hidden']), select, textarea, summary, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='option'], [role='switch'], [role='checkbox'], [role='radio'], [role='slider']";

interface HitTargetBreach {
  target: string;
  width: number;
  height: number;
}

interface HitTargetReport {
  measured: number;
  breaches: HitTargetBreach[];
}

interface HitTargetParticipant {
  markup: () => JSXNode;
  waivedSlots?: Record<string, string>;
}

type HitTargetEntry = HitTargetParticipant | { noTarget: string };

const icon = createIcon("/sprite.svg", {
  "icon-chevron-down": "0 0 16 16",
  "icon-chevron-left": "0 0 16 16",
  "icon-chevron-right": "0 0 16 16",
  "icon-minus": "0 0 16 16",
  "icon-plus": "0 0 16 16",
  "icon-hamburger": "0 0 22 22",
  "icon-close": "0 0 22 22",
  "icon-panel-open": "0 0 24 24",
  "icon-panel-close": "0 0 24 24",
  "icon-sun": "0 0 24 24",
  "icon-moon": "0 0 24 24",
  "icon-monitor": "0 0 24 24",
  "icon-home": "0 0 24 24",
  "icon-search": "0 0 24 24",
  "icon-select": "0 0 24 24",
  "icon-layers": "0 0 24 24",
});

const NAV_CONFIG: NavDefinition = {
  sections: [
    {
      items: [
        { label: "Home", href: "home" },
        {
          label: "File",
          items: [
            { label: "New", href: "new" },
            { label: "Open", href: "open" },
            {
              label: "Recent",
              items: [
                { label: "alpha", href: "alpha" },
                { label: "beta", href: "beta" },
              ],
            },
            { label: "Quit", href: "quit" },
          ],
        },
      ],
    },
  ],
};

const resolveHref = (key: string): string => `#${key}`;

const HIT_TARGET_PARTICIPANTS: Record<string, HitTargetEntry> = {
  "chrome/Dock": {
    markup: () => [
      Dock({
        label: "Primary",
        hideAbove: "never",
        resolveHref,
        icon,
        items: [
          { label: "Home", href: "home", icon: "home", current: true },
          { label: "Search", href: "search", icon: "search" },
        ],
      }),
      Dock({
        label: "Compact",
        size: "sm",
        hideAbove: "never",
        resolveHref,
        icon,
        items: [
          { label: "Home", href: "home", icon: "home", current: true },
          { label: "Search", href: "search", icon: "search" },
        ],
      }),
    ],
  },
  "chrome/Navbar": {
    markup: () => [
      Navbar({ id: "bar", config: NAV_CONFIG, resolveHref, icon }),
      Navbar({ id: "rail", config: NAV_CONFIG, resolveHref, icon, collapsible: "always", placement: "left" }),
    ],
  },
  "chrome/ThemeToggle": { markup: () => [ThemeToggle({ icon }), ThemeToggle({ icon, size: "sm" })] },
  "chrome/Toolbar": {
    markup: () =>
      ChromeToolbar({
        icon,
        config: {
          label: "Scene tools",
          groups: [
            { items: [{ kind: "action", icon: "select", label: "Select", action: "select" }] },
            {
              items: [
                {
                  kind: "popover",
                  icon: "layers",
                  label: "Layers",
                  content: "Layer list",
                  titleAction: { icon: "plus", label: "Add layer", action: "add-layer" },
                },
              ],
            },
          ],
        },
      }),
  },
  "core/Accordion": {
    markup: () =>
      Accordion({
        children: Accordion.Item({
          children: [Accordion.Trigger({ icon, children: "Shipping" }), Accordion.Content({ children: "Two to four days." })],
        }),
      }),
  },
  "core/Alert": { markup: () => Alert({ dismissible: true, children: Alert.Title({ children: "Saved" }) }) },
  "core/Announcer": { noTarget: "it is a live region for assistive technology, with nothing to press" },
  "core/Avatar": { noTarget: "it is an image or initials, not a control" },
  "core/Badge": { noTarget: "it is a static label" },
  "core/Breadcrumbs": {
    markup: () =>
      Breadcrumbs({
        children: [
          Breadcrumbs.Item({ children: Breadcrumbs.Link({ href: "#home", children: "Home" }) }),
          Breadcrumbs.Separator({ icon }),
          Breadcrumbs.Item({ current: true, children: "Settings" }),
        ],
      }),
  },
  "core/Button": {
    markup: () => [
      Button({ size: "sm", children: "Save" }),
      Button({ size: "sm", shape: "icon", "aria-label": "Close", children: "×" }),
      Button({ children: "Save" }),
    ],
  },
  "core/Card": { noTarget: "it is a surface whose actions are the caller's own controls" },
  "core/Carousel": {
    markup: () => [
      Carousel({
        label: "Gallery",
        children: [Carousel.Item({ id: "slide-1", children: "One" }), Carousel.Item({ id: "slide-2", children: "Two" })],
      }),
      Carousel.Dots({ ids: ["slide-1", "slide-2"] }),
    ],
  },
  "core/CheckboxGroup": {
    markup: () =>
      CheckboxGroup({
        name: "cg",
        children: [CheckboxGroup.Label({ children: "Toppings" }), CheckboxGroup.Item({ name: "cg", value: "a", children: "Olives" })],
      }),
  },
  "core/Collapsible": {
    markup: () => Collapsible({ children: [Collapsible.Trigger({ icon, children: "More" }), Collapsible.Content({ children: "Details." })] }),
  },
  "core/Dialog": {
    markup: () => [
      Dialog.Trigger({ for: "d", children: "Open" }),
      Dialog({
        id: "d",
        titled: true,
        children: [
          Dialog.Header({
            children: [Dialog.Title({ for: "d", children: "Rename" }), Dialog.Close({ for: "d", "aria-label": "Close", children: "×" })],
          }),
          Dialog.Content({ children: "Body." }),
        ],
      }),
    ],
  },
  "core/Drawer": {
    markup: () => [
      Drawer.Trigger({ for: "dr", children: "Open" }),
      Drawer({
        id: "dr",
        titled: true,
        children: [
          Drawer.Header({
            children: [Drawer.Title({ for: "dr", children: "Filters" }), Drawer.Close({ for: "dr", "aria-label": "Close", children: "×" })],
          }),
          Drawer.Content({ children: "Body." }),
        ],
      }),
    ],
  },
  "core/EmptyState": { noTarget: "it is a message whose call to action is the caller's own control" },
  "core/Field": { noTarget: "it lays out a label and the caller's control" },
  "core/FileInput": { markup: () => FileInput({ "aria-label": "Attachment", size: "sm" }) },
  "core/Filter": {
    markup: () =>
      Filter({
        children: [
          Filter.Group({ label: "Status", children: Filter.Item({ name: "status", value: "open", checked: true, children: "Open" }) }),
          Filter.Reset({}),
        ],
      }),
  },
  "core/Form": { noTarget: "it is the form element around the caller's controls" },
  "core/FormField": { noTarget: "it lays out a label and the caller's control" },
  "core/Icon": { noTarget: "it is a decorative glyph" },
  "core/Indicator": { noTarget: "it is a positioned badge on another element" },
  "core/Input": { markup: () => Input({ "aria-label": "Name", size: "sm" }) },
  "core/Join": { noTarget: "it groups the caller's controls" },
  "core/Kbd": { noTarget: "it names a key, it is not one" },
  "core/Label": { noTarget: "it names a control and is measured as part of that control" },
  "core/Link": { markup: () => jsx("p", { children: ["Read ", Link({ href: "#guide", children: "the guide" }), " now."] }) },
  "core/Menu": {
    markup: () =>
      Menu({
        children: [
          Menu.Trigger({ for: "m", children: "Options" }),
          Menu.Popup({
            id: "m",
            triggered: true,
            children: [
              Menu.Item({ for: "m", children: "Rename" }),
              Menu.LinkItem({ href: "#help", children: "Help" }),
              Menu.CheckboxItem({ for: "m", checked: true, children: "Wrap" }),
              Menu.RadioItem({ for: "m", checked: true, children: "Compact" }),
              Menu.SubmenuTrigger({ for: "m-share", children: "Share" }),
              Menu.Popup({ id: "m-share", triggered: true, children: Menu.Item({ for: "m-share", children: "Copy link" }) }),
            ],
          }),
        ],
      }),
  },
  "core/Meter": { noTarget: "it reports a value and takes no input" },
  "core/NumberField": {
    markup: () =>
      NumberField({
        children: [
          NumberField.Decrement({ label: "Decrease", children: icon({ name: "minus" }) }),
          NumberField.Input({ "aria-label": "Quantity" }),
          NumberField.Increment({ label: "Increase", children: icon({ name: "plus" }) }),
        ],
      }),
  },
  "core/OtpInput": {
    markup: () => [
      OtpInput({ "aria-label": "Code", size: "sm" }),
      OtpInput({ "aria-label": "Code", size: "md" }),
      OtpInput({ "aria-label": "Code", size: "lg" }),
    ],
  },
  "core/Pagination": {
    markup: () =>
      Pagination({
        children: [
          Pagination.Previous({ href: "#p1", icon, label: "Previous" }),
          Pagination.Item({ href: "#p1", children: "1" }),
          Pagination.Item({ href: "#p2", current: true, children: "2" }),
          Pagination.Ellipsis({}),
          Pagination.Next({ href: "#p3", icon, label: "Next" }),
        ],
      }),
  },
  "core/Popover": {
    markup: () =>
      Popover({
        children: [
          Popover.Trigger({ for: "share", children: jsx("span", { id: "share-trigger", children: "Share" }) }),
          Popover.Content({ id: "share", labelledby: "share-trigger", children: "Share options" }),
        ],
      }),
  },
  "core/Progress": { noTarget: "it reports a value and takes no input" },
  "core/RadioGroup": {
    markup: () =>
      RadioGroup({
        name: "rg",
        children: [RadioGroup.Label({ children: "Size" }), RadioGroup.Item({ name: "rg", value: "s", children: "Small" })],
      }),
  },
  "core/ScrollArea": { noTarget: "its viewport is a keyboard scroll stop, not a pointer target" },
  "core/Select": { markup: () => Select({ "aria-label": "Choice", icon, size: "sm", children: Select.Option({ value: "a", children: "A" }) }) },
  "core/Separator": { noTarget: "it is a rule between content" },
  "core/Skeleton": { noTarget: "it is a loading placeholder" },
  "core/Slider": { markup: () => [Slider({ "aria-label": "Volume" }), Slider({ "aria-label": "Volume", size: "sm" })] },
  "core/Spinner": { noTarget: "it is a busy glyph" },
  "core/Stack": { noTarget: "it stacks the caller's content" },
  "core/Stat": { noTarget: "it is a figure and its caption" },
  "core/Status": { noTarget: "it is a coloured state dot" },
  "core/Steps": { noTarget: "it is a progress trail with nothing to press" },
  "core/Switch": {
    markup: () => [Switch({ children: "Wi-Fi" }), Switch({ "aria-label": "Bluetooth" }), Switch({ "aria-label": "Airplane mode", size: "sm" })],
  },
  "core/Table": { noTarget: "it lays out data whose actions are the caller's own controls" },
  "core/Tabs": {
    markup: () =>
      Tabs({
        children: [
          Tabs.List({
            label: "Sections",
            children: [Tabs.Tab({ for: "tab-1", selected: true, children: "One" }), Tabs.Tab({ for: "tab-2", children: "Two" })],
          }),
          Tabs.Content({ id: "tab-1", selected: true, children: "First panel." }),
        ],
      }),
  },
  "core/Textarea": { markup: () => Textarea({ "aria-label": "Notes", size: "sm" }) },
  "core/Timeline": { noTarget: "it is a list of past events" },
  "core/Toast": { markup: () => Toast.Container({ children: Toast({ dismissible: true, children: Toast.Title({ children: "Saved" }) }) }) },
  "core/Toggle": { markup: () => [Toggle({ "aria-label": "Bold", children: "B" }), Toggle({ "aria-label": "Bold", size: "sm", children: "B" })] },
  "core/ToggleGroup": {
    markup: () => [
      ToggleGroup({
        label: "Alignment",
        children: [
          ToggleGroup.Item({ name: "align", value: "left", size: "md", children: "Left" }),
          ToggleGroup.Item({ name: "align", value: "right", size: "md", children: "Right" }),
        ],
      }),
      ToggleGroup({
        label: "Density",
        children: [
          ToggleGroup.Item({ name: "density", value: "compact", children: "Compact" }),
          ToggleGroup.Item({ name: "density", value: "roomy", children: "Roomy" }),
        ],
      }),
    ],
  },
  "core/Toolbar": {
    markup: () =>
      Toolbar({
        label: "Format",
        children: [
          Toolbar.Button({ children: "Bold" }),
          Toolbar.Link({ href: "#help", children: "Help" }),
          Toolbar.Input({ "aria-label": "Font size" }),
        ],
      }),
  },
  "core/Tooltip": {
    markup: () =>
      Tooltip({ children: [Tooltip.Trigger({ for: "tt", children: "Bold" }), Tooltip.Content({ id: "tt", children: "Make the selection bold" })] }),
  },
  "core/Turnstile": { noTarget: "the widget is Cloudflare's iframe" },
};

async function mountMarkup(page: Page, markup: JSXNode, shapeCss: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const html = await render(markup);
  await mount(page, await withCompiledCss(`<style>${shapeCss}</style>${html}`));
}

function revealOverlays(page: Page): Promise<void> {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("[popover]")) {
      try {
        el.showPopover();
      } catch {
        continue;
      }
    }
    for (const details of document.querySelectorAll("details")) details.open = true;
    for (const dialog of document.querySelectorAll("dialog")) if (!dialog.open) dialog.show();
  });
}

function measureHitTargets(page: Page): Promise<HitTargetReport> {
  return page.evaluate(
    ({ selector, floor, unit }) => {
      const breaches: HitTargetBreach[] = [];
      let measured = 0;
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        if (el.getClientRects().length === 0) continue;
        measured += 1;
        const parent = el.parentElement;
        const inSentence =
          getComputedStyle(el).display === "inline" &&
          parent !== null &&
          [...parent.childNodes].some((node) => node !== el && node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
        if (inSentence) continue;
        const labels = "labels" in el ? [...((el as HTMLInputElement).labels ?? [])] : [];
        const box = [el, ...labels]
          .map((candidate) => candidate.getBoundingClientRect())
          .reduce((largest, rect) => (rect.width * rect.height > largest.width * largest.height ? rect : largest));
        if (box.width < floor - unit || box.height < floor - unit) {
          breaches.push({
            target: el.getAttribute("data-slot")?.split(" ")[0] ?? el.tagName.toLowerCase(),
            width: Math.round(box.width * 10) / 10,
            height: Math.round(box.height * 10) / 10,
          });
        }
      }
      return { measured, breaches };
    },
    { selector: POINTER_TARGET_SELECTOR, floor: HIT_TARGET_FLOOR_PX, unit: LAYOUT_UNIT_PX },
  );
}

async function sweep(page: Page, markup: JSXNode, shapeCss: string = HIT_TARGET_SHAPES.default): Promise<HitTargetReport> {
  await mountMarkup(page, markup, shapeCss);
  await revealOverlays(page);
  return measureHitTargets(page);
}

const participantsWithMarkup = Object.entries(HIT_TARGET_PARTICIPANTS).flatMap(([key, entry]) =>
  "markup" in entry ? [{ key, participant: entry }] : [],
);

test.describe("forge-ui-hit-target — every pointer target clears the 28px Floor", { tag: "@cross-engine" }, () => {
  test("the participant table names every component the core and chrome barrels publish", () => {
    expect(Object.keys(HIT_TARGET_PARTICIPANTS).sort()).toEqual(barrelComponents({ chrome, core }).map((component) => component.key));
  });

  test("a 24px icon button is reported at its own size, and the same button at its default size passes", async ({ page }) => {
    const shrunk = await sweep(page, Button({ size: "sm", shape: "icon", class: "size-6", "aria-label": "Close", children: "×" }));
    expect(shrunk.breaches).toEqual([{ target: "button", width: 24, height: 24 }]);

    const standard = await sweep(page, Button({ size: "sm", shape: "icon", "aria-label": "Close", children: "×" }));
    expect(standard).toEqual({ measured: 1, breaches: [] });
  });

  test("the Button sm box is 28px tall under shape-compact and 32px under the default shape", async ({ page }) => {
    const heights: Record<string, number | undefined> = {};
    for (const [shape, css] of Object.entries(HIT_TARGET_SHAPES)) {
      await mountMarkup(page, Button({ size: "sm", children: "Save" }), css);
      heights[shape] = (await page.locator("button").boundingBox())?.height;
    }
    expect(heights).toEqual({ default: 32, compact: 28 });
  });

  test("the Breadcrumbs.Link box is 28px tall under shape-compact and 32px under the default shape", async ({ page }) => {
    const heights: Record<string, number | undefined> = {};
    for (const [shape, css] of Object.entries(HIT_TARGET_SHAPES)) {
      await mountMarkup(
        page,
        Breadcrumbs({ children: Breadcrumbs.Item({ children: Breadcrumbs.Link({ href: "#home", children: "Home" }) }) }),
        css,
      );
      heights[shape] = (await page.locator("[data-slot~='breadcrumbs-link']").boundingBox())?.height;
    }
    expect(heights).toEqual({ default: 32, compact: 28 });
  });

  test("the OtpInput sm editor is 28px tall under shape-compact and 32px under the default shape", async ({ page }) => {
    const heights: Record<string, number | undefined> = {};
    for (const [shape, css] of Object.entries(HIT_TARGET_SHAPES)) {
      await mountMarkup(page, OtpInput({ "aria-label": "Code", size: "sm" }), css);
      heights[shape] = (await page.locator("[data-slot~='otp-input']").boundingBox())?.height;
    }
    expect(heights).toEqual({ default: 32, compact: 28 });
  });

  test("a checkbox item, a radio item, a labelled Switch and a bare md and sm Switch are the sm control size under both shapes", async ({
    page,
  }) => {
    const heights: Record<string, Record<string, number | undefined>> = {};
    const bareWidths: Record<string, number[]> = {};
    for (const [shape, css] of Object.entries(HIT_TARGET_SHAPES)) {
      await mountMarkup(
        page,
        [
          CheckboxGroup.Item({ name: "cg", value: "a", children: "Olives" }),
          RadioGroup.Item({ name: "rg", value: "s", children: "Small" }),
          Switch({ children: "Wi-Fi" }),
          Switch({ "aria-label": "Bluetooth" }),
          Switch({ "aria-label": "Airplane mode", size: "sm" }),
        ],
        css,
      );
      const checkbox = await page.locator("[data-slot~='checkbox-group-item']").boundingBox();
      const radio = await page.locator("[data-slot~='radio-group-item']").boundingBox();
      const switches = await page.locator("label[data-slot~='switch']").evaluateAll((labels) =>
        labels.map((label) => {
          const rect = label.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      );
      heights[shape] = {
        checkbox: checkbox?.height,
        radio: radio?.height,
        labelledSwitch: switches[0]?.height,
        bareSwitch: switches[1]?.height,
        bareSmSwitch: switches[2]?.height,
      };
      bareWidths[shape] = switches.slice(1).map((box) => box.width);
    }
    expect(heights).toEqual({
      default: { checkbox: 32, radio: 32, labelledSwitch: 32, bareSwitch: 32, bareSmSwitch: 32 },
      compact: { checkbox: 28, radio: 28, labelledSwitch: 28, bareSwitch: 28, bareSmSwitch: 28 },
    });
    expect(bareWidths.default).toHaveLength(2);
    expect(bareWidths.compact).toHaveLength(2);
    for (const width of bareWidths.default ?? []) expect(width).toBeGreaterThanOrEqual(32);
    for (const width of bareWidths.compact ?? []) expect(width).toBeGreaterThanOrEqual(28);
  });

  test("a visually hidden checkbox is measured by its label's box, and reported when it has none", async ({ page }) => {
    const labelled = await sweep(
      page,
      jsx("label", { class: "inline-flex size-10", children: jsx("input", { type: "checkbox", class: "sr-only", "aria-label": "Agree" }) }),
    );
    expect(labelled).toEqual({ measured: 1, breaches: [] });

    const bare = await sweep(page, jsx("input", { type: "checkbox", class: "sr-only", "aria-label": "Agree" }));
    expect(bare.breaches).toEqual([{ target: "input", width: 1, height: 1 }]);
  });

  test("a link inside a sentence is exempt, and the same link standing alone is not", async ({ page }) => {
    const inSentence = await sweep(page, jsx("p", { children: ["Read ", Link({ href: "#guide", children: "the guide" }), " now."] }));
    expect(inSentence).toEqual({ measured: 1, breaches: [] });

    const alone = await sweep(page, jsx("ul", { children: jsx("li", { children: Link({ href: "#guide", children: "the guide" }) }) }));
    expect(alone.breaches.map((breach) => breach.target)).toEqual(["link"]);
  });

  for (const { key, participant } of participantsWithMarkup) {
    test(`${key} — no unwaived pointer target is under 28px in either shape at either viewport, and no waiver is stale`, async ({ page }) => {
      const waived = participant.waivedSlots ?? {};
      const breached = new Set<string>();
      const unwaived: string[] = [];
      let measured = 0;
      for (const [shape, css] of Object.entries(HIT_TARGET_SHAPES)) {
        for (const viewport of HIT_TARGET_VIEWPORTS) {
          await page.setViewportSize(viewport);
          const report = await sweep(page, participant.markup(), css);
          measured += report.measured;
          for (const breach of report.breaches) {
            breached.add(breach.target);
            if (!(breach.target in waived)) unwaived.push(`${breach.target} ${breach.width}×${breach.height} @${viewport.width} ${shape}`);
          }
        }
      }
      expect(measured).toBeGreaterThan(0);
      expect(unwaived).toEqual([]);
      expect(Object.keys(waived).filter((slot) => !breached.has(slot))).toEqual([]);
    });
  }
});
