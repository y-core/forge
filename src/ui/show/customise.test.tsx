/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { scalePairs } from "../contracts/theme/contrast-pairs";
import {
  buildTheme,
  COPY_ACTION,
  COPY_LABEL_ATTR,
  COPY_SCOPE,
  COPY_STATUS_ATTR,
  COPY_TARGET_ATTR,
  COPY_TARGETS,
  CUSTOMISE_SCOPE,
  DIALS,
  leverRows,
  PRESET_ACTION,
  PRESET_PARAM,
  ratioKey,
  SCALE_ROW_ATTR,
  SCALE_ROWS,
  SCHEME_PRESETS,
  STEP_SEGMENTS,
  schemeCss,
} from "../contracts/theme/theme-contract";
import { buttonVariants } from "../core/button";
import { fieldId } from "../core/field";
import { CustomiseContent, loadCustomise } from "./customise";

// oxlint-disable-next-line typescript/no-explicit-any -- test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// oxlint-disable-next-line typescript/no-explicit-any -- test-only stub
const icon = StubIcon as any;

// oxlint-disable-next-line typescript/no-explicit-any -- only `url` is read
const ctx = (search = "") => ({ url: new URL(`https://example.test/showcase/ui/theme${search}`) }) as any;

const page = (search = "") => render(<CustomiseContent data={loadCustomise(ctx(search))} icon={icon} />);

/** Escapes a literal so it can be spliced into a regular expression. */
const rx = (literal: string) => literal.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The opening tag of the first element whose attributes include `selector`. */
const tagOf = (html: string, selector: string) => new RegExp(`<[a-z]+[^>]*\\s${rx(selector)}(?=[\\s>])[^>]*>`).exec(html)?.[0] ?? "";

/** The value `attr` carries on the first element whose attributes include `selector`. */
const attrOf = (html: string, selector: string, attr: string) => new RegExp(`\\s${rx(attr)}="([^"]*)"`).exec(tagOf(html, selector))?.[1] ?? "";

/** Every whole `tag` element whose attributes include `selector`, in document order. */
const elementsOf = (html: string, tag: string, selector: string) =>
  html.match(new RegExp(`<${tag}[^>]*\\s${rx(selector)}(?=[\\s>])[^>]*>[\\s\\S]*?</${tag}>`, "g")) ?? [];

/** The text the first such `tag` element wraps. */
const textOf = (html: string, tag: string, selector: string) =>
  (elementsOf(html, tag, selector)[0] ?? "").replace(new RegExp(`^<${tag}[^>]*>|</${tag}>$`, "g"), "");

/** Every `<option>` of the `<select>` carrying that id, exactly as rendered. */
const optionsOf = (html: string, id: string) => (elementsOf(html, "select", `id="${id}"`)[0] ?? "").match(/<option[^>]*>[\s\S]*?<\/option>/g) ?? [];

/** Every value `attr` takes across `html`, in document order. */
const valuesOf = (html: string, attr: string) => [...html.matchAll(new RegExp(`\\s${rx(attr)}="([^"]*)"`, "g"))].map((match) => match[1] ?? "");

/** Each live ratio cell's text, in the order the WCAG table draws them. */
const ratioTexts = (html: string) => valuesOf(html, "data-ratio").map((key) => textOf(html, "td", `data-ratio="${key}"`));

/** The picker's exact option list when `selectedId` is the preset the dials sit on — `""` for custom. */
const presetOptions = (selectedId: string) => [
  `<option data-slot="select-option" value="" disabled${selectedId === "" ? " selected" : ""}>custom</option>`,
  ...SCHEME_PRESETS.map(
    (preset) =>
      `<option data-slot="select-option" value="${preset.id}"${preset.id === selectedId ? " selected" : ""}>${preset.id} (${preset.character})</option>`,
  ),
];

describe("loadCustomise", () => {
  it("defaults every dial to the shipped scheme", () => {
    const { dials } = loadCustomise(ctx());
    for (const dial of DIALS) expect(dials[dial.field]).toBe(dial.fallback);
    expect(dials.grayChroma).toBe(0);
  });

  it("reads each dial from its own short parameter", () => {
    const { dials } = loadCustomise(ctx("?gh=256&gc=45&ah=200&ac=120&r=4&rf=6&rb=8&ch=32"));
    expect(dials).toEqual({
      grayHue: 256,
      grayChroma: 45,
      accentHue: 200,
      accentChroma: 120,
      radius: 4,
      radiusField: 6,
      radiusBox: 8,
      controlH: 32,
    });
  });

  it("clamps to the dial's own range", () => {
    expect(loadCustomise(ctx("?gc=99999")).dials.grayChroma).toBe(100);
    expect(loadCustomise(ctx("?gh=-40")).dials.grayHue).toBe(0);
    expect(loadCustomise(ctx("?r=1000")).dials.radius).toBe(24);
    expect(loadCustomise(ctx("?rb=1000")).dials.radiusBox).toBe(32);
    expect(loadCustomise(ctx("?ch=0")).dials.controlH).toBe(28);
  });

  it("falls back rather than failing on an unparseable value", () => {
    for (const bad of ["?gh=abc", "?gh=", "?gh=NaN", "?gh=Infinity"]) {
      expect(loadCustomise(ctx(bad)).dials.grayHue).toBe(0);
    }
  });

  it("resolves a preset name into the two gray dials that reproduce it", () => {
    for (const preset of SCHEME_PRESETS) {
      const { dials } = loadCustomise(ctx(`?p=${preset.id}`));
      expect([dials.grayHue, dials.grayChroma]).toEqual([preset.grayHue, preset.grayChroma]);
    }
    expect(loadCustomise(ctx("?p=slate&ah=200&r=4")).dials).toMatchObject({ accentHue: 200, radius: 4 });
  });

  it("lets an explicit dial win over the preset beside it", () => {
    const { dials } = loadCustomise(ctx("?p=slate&gh=100"));
    expect(dials.grayHue).toBe(100);
    expect(dials.grayChroma).toBe(SCHEME_PRESETS.find((preset) => preset.id === "slate")?.grayChroma);
  });

  it("ignores a preset name nothing ships", () => {
    expect(loadCustomise(ctx("?p=vermilion")).dials).toEqual(loadCustomise(ctx()).dials);
  });

  it("snaps to the dial's step", () => {
    expect(loadCustomise(ctx("?gh=12.7")).dials.grayHue).toBe(13);
  });
});

describe("CustomiseContent", () => {
  it("renders the page shell and all four regions", async () => {
    const out = await page();
    expect(tagOf(out, 'id="main-content"')).toBe('<main id="main-content" class="mx-auto max-w-4xl min-w-0 flex-1 space-y-6 px-6 py-10 lg:px-10">');
    expect(elementsOf(out, "h1", 'class="text-3xl font-bold text-balance text-foreground"')).toEqual([
      '<h1 class="text-3xl font-bold text-balance text-foreground">Theme customiser</h1>',
    ]);
    expect(["levers", "preview", "wcag", "compositions", "output"].map((id) => tagOf(out, `id="${id}"`))).toEqual([
      '<section id="levers" class="scroll-mt-24 space-y-4">',
      '<section id="preview" class="scroll-mt-24 space-y-4">',
      '<section id="wcag" class="scroll-mt-24 space-y-4">',
      '<section id="compositions" class="scroll-mt-24 space-y-6">',
      '<section id="output" class="scroll-mt-24 space-y-4">',
    ]);
  });

  it("renders one bound slider per dial, carrying the loaded value", async () => {
    const out = await page("?gh=256&gc=45");
    expect(
      DIALS.map((dial) => [attrOf(out, `data-field="${dial.field}"`, "data-slot"), attrOf(out, `data-field="${dial.field}"`, "type")]),
    ).toEqual(DIALS.map(() => ["slider", "range"]));
    expect(attrOf(out, 'data-field="grayHue"', "max")).toBe("360");
    expect(attrOf(out, 'data-field="grayHue"', "value")).toBe("256");
  });

  it("server-renders each dial's value into its label, beside the slider", async () => {
    const out = await page("?gh=256&gc=45&r=4");
    expect(tagOf(out, 'data-readout="grayHue"')).toBe('<output data-readout="grayHue" class="text-xs text-muted-foreground tabular-nums">');
    expect(textOf(out, "output", 'data-readout="grayHue"')).toBe("256°");
    expect(textOf(out, "output", 'data-readout="radius"')).toBe("4px");
    expect(textOf(out, "output", 'data-readout="grayChroma"')).toBe("45");
  });

  it("offers every shipped scheme in one preset dropdown, named with its character", async () => {
    const out = await page("?ah=200&ac=120&r=4");
    expect(optionsOf(out, fieldId(PRESET_PARAM))).toEqual(presetOptions("neutral"));
  });

  it("applies a preset on change rather than on a submit, so it carries no form and no button", async () => {
    const out = await page("?ah=200&ac=120&r=4");
    const levers = out.slice(out.indexOf('id="levers"'), out.indexOf('id="preview"'));
    expect(attrOf(levers, 'data-preset-picker=""', "data-on-change")).toBe(PRESET_ACTION);
    expect([...new Set([...levers.matchAll(/<([a-z0-9]+)[\s>]/g)].map((match) => match[1] ?? ""))].sort()).toEqual([
      "code",
      "div",
      "h2",
      "input",
      "label",
      "option",
      "output",
      "p",
      "section",
      "select",
      "span",
    ]);
    expect(valuesOf(levers, "type")).toEqual(DIALS.map(() => "range"));
  });

  // Which preset the dials name is derived on every read, so seeding it would be a second source of
  // truth — and the repaint keeping it current would be a signal write inside an effect.
  it("seeds the scope with the dials and nothing else", async () => {
    const out = await page("?gh=120&gc=77");
    const start = out.indexOf("data-island-state=");
    const blob = out.slice(out.indexOf('"', start) + 1, out.indexOf('"', out.indexOf('"', start) + 1));
    expect(JSON.parse(blob.replaceAll("&quot;", '"'))).toEqual({
      grayHue: 120,
      grayChroma: 77,
      accentHue: 267,
      accentChroma: 195,
      radius: 10,
      radiusField: 10,
      radiusBox: 16,
      controlH: 40,
    });
  });

  it("puts the picker inside the scope, which is what lets its change reach the painter", async () => {
    const out = await page();
    const scope = out.indexOf(`data-scope="${CUSTOMISE_SCOPE}"`);
    expect(scope).toBeGreaterThan(-1);
    expect(out.indexOf("data-preset-picker")).toBeGreaterThan(scope);
  });

  it("always renders the custom option, since the client selects it the moment a lever moves off a preset", async () => {
    const out = await page();
    expect(optionsOf(out, fieldId(PRESET_PARAM))[0]).toBe('<option data-slot="select-option" value="" disabled>custom</option>');
  });

  it("selects the preset the current dials are actually on", async () => {
    const slate = SCHEME_PRESETS.find((preset) => preset.id === "slate");
    expect(optionsOf(await page(`?gh=${slate?.grayHue}&gc=${slate?.grayChroma}`), fieldId(PRESET_PARAM))).toEqual(presetOptions("slate"));
    expect(optionsOf(await page(), fieldId(PRESET_PARAM))).toEqual(presetOptions("neutral"));
    expect(optionsOf(await page("?gh=120&gc=77"), fieldId(PRESET_PARAM))).toEqual(presetOptions(""));
  });

  it("draws one row per generated scale against a single shared header of step numbers", async () => {
    const out = await page();
    expect(SCALE_ROWS.map((row) => tagOf(out, `data-scale-row="${row.id}"`))).toEqual(
      SCALE_ROWS.map((row) => `<tbody data-scale-row="${row.id}">`),
    );
    expect(out.split("data-swatch=").length - 1).toBe(SCALE_ROWS.length * 12);
    expect(out.split('scope="col"').length - 1).toBe(12);
  });

  it("bands the twelve steps under five headers spanning the whole scale", async () => {
    const out = await page();
    expect(STEP_SEGMENTS.reduce((total, segment) => total + segment.span, 0)).toBe(12);
    expect(out.split('scope="colgroup"').length - 1).toBe(STEP_SEGMENTS.length);
    const thead = out.slice(out.indexOf("<thead"), out.indexOf("</thead>"));
    expect([...thead.matchAll(/colspan="(\d+)"/g)].map((match) => match[1])).toEqual(STEP_SEGMENTS.map((segment) => String(segment.span)));
    expect(elementsOf(out, "th", 'scope="colgroup"')).toEqual(
      STEP_SEGMENTS.map(
        (segment, i) =>
          `<th scope="colgroup" colspan="${segment.span}" class="pb-1 text-center text-xs font-medium text-muted-foreground ${i === 0 ? "" : "border-s border-border"}">${segment.label}</th>`,
      ),
    );
  });

  it("draws no crossed scale/surface row, because the cascade cannot produce one", async () => {
    const out = await page();
    expect(valuesOf(out, SCALE_ROW_ATTR)).toEqual(SCALE_ROWS.map((row) => row.id));
  });

  // Uniform ids, gray included: nothing may recover a row's family by parsing its id.
  it("names every row family-then-mode, with the accent family first to match the levers", async () => {
    expect(SCALE_ROWS.map((row) => row.id)).toEqual(SCALE_ROWS.map((row) => `${row.family}-${row.mode}`));
    expect(SCALE_ROWS.map((row) => row.family)).toEqual(["accent", "accent", "gray", "gray"]);
    expect(new Set(SCALE_ROWS.map((row) => row.id)).size).toBe(SCALE_ROWS.length);
  });

  it("labels each row visibly, since four rows of near-white step 1 are otherwise indistinguishable", async () => {
    const out = await page();
    expect(elementsOf(out, "td", 'colspan="12"')).toEqual(
      SCALE_ROWS.map(
        (row, i) => `<td colspan="12" class="pb-1 text-xs font-medium text-muted-foreground ${i === 0 ? "" : "pt-5"}">${row.label}</td>`,
      ),
    );
    expect(elementsOf(out, "tbody", 'aria-hidden="true"')).toEqual([]);
  });

  it("asks for no mode on a preview row, because a nested one cannot work", async () => {
    const out = await page();
    const dark = out.match(/<tbody data-scale-row="gray-dark"[^>]*>/)?.[0] ?? "";
    expect(dark).toBe('<tbody data-scale-row="gray-dark">');
    expect(valuesOf(out, "class").filter((value) => value === "dark")).toEqual([]);
  });

  it("draws the box frame on the cells that sit on its edge", async () => {
    const out = await page();
    const previewTable = out.slice(out.indexOf('id="preview"')).match(/<table[^>]*>/)?.[0] ?? "";
    expect(previewTable).toBe('<table class="w-full min-w-176 table-fixed border-separate border-spacing-0">');
    for (const corner of ["rounded-ss-md", "rounded-se-md", "rounded-es-md", "rounded-ee-md"]) {
      expect(out.split(corner).length - 1).toBe(SCALE_ROWS.length);
    }
  });

  it("server-renders the hex of every generated step, so the page reads without JavaScript", async () => {
    const out = await page();
    const hexes = (id: string) =>
      [...(elementsOf(out, "tbody", `${SCALE_ROW_ATTR}="${id}"`)[0] ?? "").matchAll(/<td data-hex="\d+"[^>]*>([^<]*)<\/td>/g)].map(
        ([, hex]) => hex,
      );
    expect(hexes("gray-light")).toEqual([
      "#f9f9f9",
      "#fcfcfc",
      "#f0f0f0",
      "#e8e8e8",
      "#e0e0e0",
      "#d9d9d9",
      "#cecece",
      "#bbbbbb",
      "#8d8d8d",
      "#838383",
      "#646464",
      "#202020",
    ]);
    expect(hexes("gray-dark")).toEqual([
      "#111111",
      "#191919",
      "#222222",
      "#2a2a2a",
      "#313131",
      "#3a3a3a",
      "#484848",
      "#606060",
      "#6e6e6e",
      "#7b7b7b",
      "#b4b4b4",
      "#eeeeee",
    ]);
    expect(out.split("data-hex=").length - 1).toBe(SCALE_ROWS.length * 12);
  });

  it("derives every control id through the field helpers", async () => {
    const out = await page();
    expect(DIALS.map((dial) => attrOf(out, `data-field="${dial.field}"`, "id"))).toEqual(DIALS.map((dial) => fieldId(dial.field)));
    expect(DIALS.map((dial) => attrOf(out, `for="${fieldId(dial.field)}"`, "data-slot"))).toEqual(DIALS.map(() => "label"));
    expect(valuesOf(out, "id").filter((value) => value.startsWith("dial-"))).toEqual([]);
  });

  it("names each control in full while printing its family once", async () => {
    const out = await page();
    const labelClass = "flex w-fit items-center gap-2 text-sm leading-snug font-medium text-foreground group-data-[disabled]/field:opacity-50";
    expect(elementsOf(out, "label", `for="${fieldId("accentHue")}"`)).toEqual([
      `<label data-slot="label" for="field-accentHue" class="${labelClass}"><span class="sr-only">Accent </span>hue</label>`,
    ]);
    expect(elementsOf(out, "label", `for="${fieldId("grayHue")}"`)).toEqual([
      `<label data-slot="label" for="field-grayHue" class="${labelClass}"><span class="sr-only">Gray </span>hue</label>`,
    ]);
  });

  it("spans the solo row across the family cell so its slider still aligns", async () => {
    const out = await page();
    expect(/<div class="([^"]*)"><label data-slot="label" for="field-radius"/.exec(out)?.[1]).toBe("flex items-baseline gap-2 md:col-span-2");
    const sliderClass = (field: string) => attrOf(out, `data-field="${field}"`, "class").split(" ");
    const base = [
      "state-disabled",
      "state-busy",
      "state-invalid",
      "w-full",
      "appearance-none",
      "rounded-full",
      "bg-transparent",
      "focus-ring",
      "cursor-pointer",
      "h-control-md",
      "text-sm",
    ];
    expect(sliderClass("radius")).toEqual([...base, "md:col-span-3"]);
    expect(sliderClass("accentHue")).toEqual(base);
  });

  it("pairs hue with chroma on one row, gives radius its own, and rides the three shape dials together", async () => {
    expect(leverRows().map((row) => row.map((dial) => dial.field))).toEqual([
      ["accentHue", "accentChroma"],
      ["grayHue", "grayChroma"],
      ["radius"],
      ["radiusField", "radiusBox", "controlH"],
    ]);
  });

  it("lists only the pairs a generated scheme can be measured on", async () => {
    const out = await page();
    expect(scalePairs()).toHaveLength(9);
    expect(valuesOf(out, "data-pair")).toEqual(scalePairs().map((pair) => pair.token));
    expect(valuesOf(out, "data-ratio")).toEqual(
      scalePairs().flatMap((pair) => (["light", "dark"] as const).map((mode) => ratioKey(pair.token, pair.background.token, mode))),
    );
    expect(valuesOf(out, "data-ratio").map((key) => tagOf(out, `data-ratio="${key}"`))).toEqual(
      valuesOf(out, "data-ratio").map((key) => `<td data-ratio="${key}" class="py-2 pe-4 text-foreground tabular-nums">`),
    );
    expect(ratioTexts(out).filter((text) => !/^\d+\.\d\d:1 [✓✗]$/.test(text))).toEqual([]);
  });

  it("computes each live ratio and marks it against its own floor", async () => {
    const out = await page();
    expect(elementsOf(out, "td", 'data-ratio="--muted-foreground|--gray-3:light"')).toEqual([
      '<td data-ratio="--muted-foreground|--gray-3:light" class="py-2 pe-4 text-foreground tabular-nums">5.19:1 ✓</td>',
    ]);
    expect(textOf(out, "td", 'data-ratio="--input|--gray-3:light"')).toBe("3.33:1 ✓");
  });

  it("shows no failing pair at the default dials", async () => {
    const out = await page();
    expect(ratioTexts(out).map((text) => text.slice(-1))).toEqual(scalePairs().flatMap(() => ["✓", "✓"]));
  });

  it("measures the accent pair too, so the accent dials move a number", async () => {
    const out = await page();
    expect(tagOf(out, 'data-pair="--primary-foreground"')).toBe(
      '<tr data-pair="--primary-foreground" class="border-b border-border last:border-0">',
    );
    expect(valuesOf(out, "data-ratio").filter((key) => key.startsWith("--primary-foreground|"))).toEqual([
      "--primary-foreground|--accent-9:light",
      "--primary-foreground|--accent-9:dark",
    ]);
  });

  // `--accent-contrast` re-points from `--gray-1` to the darker `--gray-12`, so dark reads lower than
  // light at every dial position. This is the tightest the accent dials get, and it now clears 4.5.
  it("keeps both accent cells above the floor in the green band that once broke dark", async () => {
    const out = await page("?ah=144&ac=170");
    expect(ratioTexts(elementsOf(out, "tr", 'data-pair="--primary-foreground"')[0] ?? "")).toEqual(["4.86:1 ✓", "4.65:1 ✓"]);
  });

  it("gives the scale preview a heading, so h1 is followed by h2 with no skip", async () => {
    const out = await page();
    const preview = out.slice(out.indexOf('id="preview"'), out.indexOf('id="wcag"'));
    expect(elementsOf(preview, "h2", 'class="border-b border-border pb-2 text-base font-semibold text-foreground"')).toEqual([
      '<h2 class="border-b border-border pb-2 text-base font-semibold text-foreground">Scales</h2>',
    ]);
    expect(out.indexOf("<h2")).toBeGreaterThan(out.indexOf("<h1"));
  });

  it("emits a scheme file whose shape is a scheme file", async () => {
    const { dials } = loadCustomise(ctx("?gh=256&gc=45"));
    const emitted = textOf(await page("?gh=256&gc=45"), "pre", "data-scheme-output");
    // The waiver's apostrophes arrive as entities, which is what the renderer owes any text node.
    expect(emitted).toBe(`<code>${schemeCss(buildTheme(dials), dials).replaceAll("'", "&#39;")}</code>`);
    expect(emitted.split(":root {").length - 1).toBe(2);
    expect(emitted.split(".dark {").length - 1).toBe(0);
  });

  it("shows a share URL carrying every dial", async () => {
    const out = await page("?gh=256&gc=45");
    expect(elementsOf(out, "code", "data-share-url")).toEqual([
      "<code data-share-url>/showcase/ui/theme?ah=267&amp;ac=195&amp;gh=256&amp;gc=45&amp;r=10&amp;rf=10&amp;rb=16&amp;ch=40</code>",
    ]);
  });

  it("puts a copy control beside each thing it hands you, inside a scope that can hear it", async () => {
    const out = await page();
    const scope = out.indexOf(`data-scope="${COPY_SCOPE}"`);
    expect(scope).toBeGreaterThan(-1);
    const classes = buttonVariants({ tone: "neutral", appearance: "outline", size: "sm" });
    for (const target of COPY_TARGETS) {
      expect(tagOf(out, `${COPY_TARGET_ATTR}="${target.id}"`)).toBe(
        `<button type="button" data-slot="button" class="${classes}" data-on-click="${COPY_ACTION}" ${COPY_TARGET_ATTR}="${target.id}">`,
      );
      expect(tagOf(out, `${COPY_STATUS_ATTR}="${target.id}"`)).toBe(`<span role="status" class="sr-only" ${COPY_STATUS_ATTR}="${target.id}">`);
      expect(out.indexOf(`${COPY_TARGET_ATTR}="${target.id}"`)).toBeGreaterThan(scope);
    }
    expect(elementsOf(out, "span", `${COPY_LABEL_ATTR}=""`)).toEqual(
      COPY_TARGETS.map((target) => `<span ${COPY_LABEL_ATTR}="">${target.label}</span>`),
    );
  });

  // Floor #6 is satisfied by using the primitive at the floor of its own scale, which is what the
  // classes prove — the harness runs no Tailwind build, so a measured box would be 0.
  it("builds each copy control out of Button at the smallest size the scale offers", async () => {
    const out = await page();
    const classes = buttonVariants({ tone: "neutral", appearance: "outline", size: "sm" });
    for (const button of out.match(/<button[^>]*data-copy-target[^>]*>/g) ?? []) {
      expect(button).toContain(`class="${classes}"`);
    }
    expect(out.match(/<button[^>]*data-copy-target[^>]*>/g) ?? []).toHaveLength(COPY_TARGETS.length);
  });

  // Swapping the visible label to "Copied" under a static `aria-label` reading "Copy CSS" is exactly
  // what WCAG 2.5.3 Label in Name forbids; the announcement rides the status span instead.
  it("names each copy control by its own visible text and nothing else", async () => {
    const out = await page();
    for (const button of out.match(/<button[^>]*data-copy-target[^>]*>/g) ?? []) {
      expect(button).not.toContain("aria-label");
    }
  });

  it("carries no style attribute anywhere, which the renderer would drop in any case", async () => {
    const out = await page("?gc=45&gh=256");
    expect(valuesOf(out, "style")).toEqual([]);
    expect([...out.matchAll(/<([a-z]+)/g)].map(([, tag]) => tag).filter((tag) => tag === "style")).toEqual([]);
  });
});

describe("schemeCss", () => {
  // Position is the assertion: `validate-modern-css` reports the missing layer at line 1, and a
  // waiver suppresses only its own line or the one above, so line 2 would not suppress.
  it("opens with the platform-layer waiver, so a pasted scheme passes validate-modern-css unedited", () => {
    const dials = { grayHue: 0, grayChroma: 0, accentHue: 267, accentChroma: 195, radius: 10, radiusField: 10, radiusBox: 16, controlH: 40 };
    const css = schemeCss(buildTheme(dials), dials);
    expect(css.split("\n")[0]).toBe(
      "/* modern-css-allow: forge-ui-platform-layer — an unlayered rule beats every layered one, so layering forge's sheets while the consuming app's own rules stay unlayered would invert the order forge relies on; the layer belongs to the app that owns the whole cascade. */",
    );
  });

  it("declares twelve solid steps per family, once each", () => {
    const dials = { grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10, radiusField: 10, radiusBox: 16, controlH: 40 };
    const css = schemeCss(buildTheme(dials), dials);
    for (const family of ["gray", "accent"]) {
      for (let step = 1; step <= 12; step++) {
        expect(css.split(`--${family}-${step}:`).length - 1).toBe(1);
      }
    }
    expect(css.split(":root {").length - 1).toBe(2);
    expect(css).not.toContain(".dark {");
  });

  it("is standalone-complete, carrying the contrast step that pairs with its own accent", () => {
    const dials = { grayHue: 0, grayChroma: 0, accentHue: 267, accentChroma: 195, radius: 10, radiusField: 10, radiusBox: 16, controlH: 40 };
    expect(schemeCss(buildTheme(dials), dials)).toContain("--accent-contrast: light-dark(var(--gray-1), var(--gray-12));");
  });

  it("reproduces theme-neutral.css at the default dials", () => {
    const dials = { grayHue: 0, grayChroma: 0, accentHue: 267, accentChroma: 195, radius: 10, radiusField: 10, radiusBox: 16, controlH: 40 };
    const css = schemeCss(buildTheme(dials), dials);
    expect(css).toContain("--gray-1: light-dark(oklch(98.21% 0 0), oklch(17.76% 0 0));");
    expect(css).toContain("--gray-11: light-dark(oklch(50.32% 0 0), oklch(76.99% 0 0));");
    expect(css).toContain("--gray-12: light-dark(oklch(24.35% 0 0), oklch(94.91% 0 0));");
    expect(css).toContain("--accent-9: light-dark(oklch(52.00% 0.1950 267.0), oklch(50.75% 0.1950 267.0));");
  });

  it("records the dials it was generated from, so a pasted file can be traced back", () => {
    const dials = { grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10, radiusField: 10, radiusBox: 16, controlH: 40 };
    const css = schemeCss(buildTheme(dials), dials);
    expect(css).toContain("hue 256deg, chroma 0.045");
    expect(css).toContain("hue 267deg, chroma 0.195");
  });
});

describe("shape emission", () => {
  const dials = { grayHue: 0, grayChroma: 0, accentHue: 267, accentChroma: 195, radius: 10, radiusField: 6, radiusBox: 8, controlH: 48 };

  it("follows the scheme with a shape block a reader can save as its own file", () => {
    const css = schemeCss(buildTheme(dials), dials);
    expect(css).toContain("/* Shape — save as shape-custom.css beside the scheme, or fold into it */");
    expect(css.slice(css.indexOf("/* Shape"))).toContain(
      "  --radius-field: 6px;\n  --radius-box: 8px;\n  --control-h-sm: 40px;\n  --control-h-md: 48px;\n  --control-h-lg: 56px;\n",
    );
  });

  it("leaves --radius where it was, so the shape block declares only what the new dials drive", () => {
    const css = schemeCss(buildTheme(dials), dials);
    expect(css).not.toContain("  --radius:");
    expect(css).not.toContain("--radius-selector");
    expect(css).not.toContain("--border-width");
  });
});
