/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { scalePairs } from "../contracts/contrast-pairs";
import {
  buildTheme,
  CUSTOMISE_SCOPE,
  DIALS,
  leverRows,
  PRESET_FIELD,
  PRESET_PARAM,
  SCALE_ROWS,
  SCHEME_PRESETS,
  STEP_SEGMENTS,
  schemeCss,
} from "../contracts/theme-contract";
import { fieldId } from "../core/field";
import { CustomiseContent, loadCustomise } from "./customise";

// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

// biome-ignore lint/suspicious/noExplicitAny: only `url` is read
const ctx = (search = "") => ({ url: new URL(`https://example.test/showcase/ui/theme${search}`) }) as any;

const page = (search = "") => render(<CustomiseContent data={loadCustomise(ctx(search))} icon={icon} />);

describe("loadCustomise", () => {
  it("defaults every dial to the shipped scheme", () => {
    const { dials } = loadCustomise(ctx());
    for (const dial of DIALS) expect(dials[dial.field]).toBe(dial.fallback);
    expect(dials.grayChroma).toBe(0);
  });

  it("reads each dial from its own short parameter", () => {
    const { dials } = loadCustomise(ctx("?gh=256&gc=45&ah=200&ac=120&r=4"));
    expect(dials).toEqual({ grayHue: 256, grayChroma: 45, accentHue: 200, accentChroma: 120, radius: 4 });
  });

  it("clamps to the dial's own range", () => {
    expect(loadCustomise(ctx("?gc=99999")).dials.grayChroma).toBe(100);
    expect(loadCustomise(ctx("?gh=-40")).dials.grayHue).toBe(0);
    expect(loadCustomise(ctx("?r=1000")).dials.radius).toBe(24);
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
    expect(out).toContain('id="main-content"');
    expect(out).toContain("Theme customiser");
    for (const id of ["levers", "preview", "wcag", "compositions", "output"]) {
      expect(out).toContain(`id="${id}"`);
    }
  });

  it("renders one bound slider per dial, carrying the loaded value", async () => {
    const out = await page("?gh=256&gc=45");
    for (const dial of DIALS) {
      expect(out).toContain(`data-field="${dial.field}"`);
      expect(out).toContain(`data-on-input="bindField"`);
    }
    expect(out).toContain('max="360"');
    expect(out).toContain('value="256"');
  });

  it("server-renders each dial's value into its label, beside the slider", async () => {
    const out = await page("?gh=256&gc=45&r=4");
    expect(out).toContain('data-readout="grayHue"');
    expect(out).toContain("256°");
    expect(out).toContain("4px");
    expect(out).toContain(">45</output>");
  });

  it("offers every shipped scheme in one preset dropdown, named with its character", async () => {
    const out = await page("?ah=200&ac=120&r=4");
    for (const preset of SCHEME_PRESETS) {
      expect(out).toContain(`<option data-slot="select-option" value="${preset.id}"`);
      expect(out).toContain(`${preset.id} (${preset.character})`);
    }
  });

  it("applies a preset on change rather than on a submit, so it carries no form and no button", async () => {
    const out = await page("?ah=200&ac=120&r=4");
    const levers = out.slice(out.indexOf('id="levers"'), out.indexOf('id="preview"'));
    expect(levers).toContain(`data-on-change="bindField" data-field="${PRESET_FIELD}"`);
    expect(levers).not.toContain("<form");
    expect(levers).not.toContain(">Apply<");
    expect(levers).not.toContain('type="hidden"');
  });

  it("puts the picker inside the scope, which is what lets its change reach the painter", async () => {
    const out = await page();
    const scope = out.indexOf(`data-scope="${CUSTOMISE_SCOPE}"`);
    expect(scope).toBeGreaterThan(-1);
    expect(out.indexOf(`data-field="${PRESET_FIELD}"`)).toBeGreaterThan(scope);
  });

  it("always renders the custom option, since the client selects it the moment a lever moves off a preset", async () => {
    const out = await page();
    expect(out).toContain('<option data-slot="select-option" value="" disabled>custom</option>');
  });

  it("selects the preset the current dials are actually on", async () => {
    const picker = (out: string) => {
      const start = out.indexOf('id="field-p"');
      return out.slice(start, out.indexOf("</select>", start));
    };
    const slate = SCHEME_PRESETS.find((preset) => preset.id === "slate");
    const out = picker(await page(`?gh=${slate?.grayHue}&gc=${slate?.grayChroma}`));
    expect(out).toContain(`value="slate" selected`);
    expect(out.split(" selected").length - 1).toBe(1);
    expect(picker(await page()).split(" selected").length - 1).toBe(1);
    const custom = picker(await page("?gh=120&gc=77"));
    expect(custom).toContain('value="" disabled selected');
    expect(custom.split(" selected").length - 1).toBe(1);
  });

  it("draws one row per generated scale against a single shared header of step numbers", async () => {
    const out = await page();
    for (const row of SCALE_ROWS) expect(out).toContain(`data-scale-row="${row.id}"`);
    expect(out.split("data-swatch=").length - 1).toBe(SCALE_ROWS.length * 12);
    expect(out.split('scope="col"').length - 1).toBe(12);
  });

  it("bands the twelve steps under five headers spanning the whole scale", async () => {
    const out = await page();
    expect(STEP_SEGMENTS.reduce((total, segment) => total + segment.span, 0)).toBe(12);
    expect(out.split('scope="colgroup"').length - 1).toBe(STEP_SEGMENTS.length);
    const thead = out.slice(out.indexOf("<thead"), out.indexOf("</thead>"));
    expect([...thead.matchAll(/colspan="(\d+)"/g)].map((match) => match[1])).toEqual(STEP_SEGMENTS.map((segment) => String(segment.span)));
    for (const segment of STEP_SEGMENTS) expect(out).toContain(`>${segment.label}</th>`);
  });

  it("draws no crossed scale/surface row, because the cascade cannot produce one", async () => {
    const out = await page();
    expect(SCALE_ROWS).toHaveLength(2);
    expect(out).not.toContain("light-on-dark");
    expect(out).not.toContain("dark-on-light");
  });

  it("asks for no mode on a preview row, because a nested one cannot work", async () => {
    const out = await page();
    const dark = out.match(/<tbody data-scale-row="dark"[^>]*>/)?.[0] ?? "";
    expect(dark).toBe('<tbody data-scale-row="dark">');
    expect(out).not.toContain('class="dark"');
  });

  it("draws the box frame on the cells that sit on its edge", async () => {
    const out = await page();
    const previewTable = out.slice(out.indexOf('id="preview"')).match(/<table[^>]*>/)?.[0] ?? "";
    expect(previewTable).toContain("border-separate border-spacing-0");
    expect(previewTable).not.toContain("border-collapse");
    for (const corner of ["rounded-tl-md", "rounded-tr-md", "rounded-bl-md", "rounded-br-md"]) {
      expect(out.split(corner).length - 1).toBe(2);
    }
  });

  it("server-renders the hex of every generated step, so the page reads without JavaScript", async () => {
    const out = await page();
    for (const hex of ["#f9f9f9", "#646464", "#202020", "#111111", "#b4b4b4", "#eeeeee"]) {
      expect(out).toContain(hex);
    }
    expect(out.split("data-hex=").length - 1).toBe(24);
  });

  it("derives every control id through the field helpers", async () => {
    const out = await page();
    for (const dial of DIALS) {
      expect(out).toContain(`id="${fieldId(dial.field)}"`);
      expect(out).toContain(`for="${fieldId(dial.field)}"`);
    }
    expect(out).not.toContain('id="dial-');
  });

  it("names each control in full while printing its family once", async () => {
    const out = await page();
    expect(out).toContain('<span class="sr-only">Accent </span>hue');
    expect(out).toContain('<span class="sr-only">Gray </span>hue');
  });

  it("spans the solo row across the family cell so its slider still aligns", async () => {
    const out = await page();
    expect(out).toContain('class="flex items-baseline gap-2 md:col-span-2"');
    const radiusSlider = out.match(/<input[^>]*data-field="radius"[^>]*>/)?.[0] ?? "";
    expect(radiusSlider).toContain("md:col-span-3");
    const hueSlider = out.match(/<input[^>]*data-field="accentHue"[^>]*>/)?.[0] ?? "";
    expect(hueSlider).not.toContain("col-span");
  });

  it("pairs hue with chroma on one row and gives radius its own", async () => {
    expect(leverRows().map((row) => row.map((dial) => dial.field))).toEqual([["accentHue", "accentChroma"], ["grayHue", "grayChroma"], ["radius"]]);
  });

  it("lists only the pairs a generated scheme can be measured on", async () => {
    const out = await page();
    expect(out.split("data-pair=").length - 1).toBe(scalePairs().length);
    expect(scalePairs()).toHaveLength(6);
    expect(out).not.toContain("not generated");
    expect(out).not.toContain("data-live");
    expect(out.split("data-ratio=").length - 1).toBe(scalePairs().length * 2);
  });

  it("computes each live ratio and marks it against its own floor", async () => {
    const out = await page();
    expect(out).toContain('data-ratio="--muted-foreground|--gray-3:light"');
    expect(out).toContain("5.19:1 ✓");
    expect(out).toContain("3.33:1 ✓");
  });

  it("shows no failing pair at the default dials", async () => {
    const out = await page();
    expect(out).not.toContain("✗");
  });

  it("emits a scheme file whose shape is a scheme file", async () => {
    const out = await page("?gh=256&gc=45");
    expect(out).toContain("data-scheme-output");
    expect(out).toContain(":root {");
    expect(out).not.toContain(".dark {");
  });

  it("shows a share URL carrying every dial", async () => {
    const out = await page("?gh=256&gc=45");
    expect(out).toContain("data-share-url");
    expect(out).toContain("gh=256");
    expect(out).toContain("gc=45");
  });

  it("carries no style attribute anywhere, which the renderer would drop in any case", async () => {
    const out = await page("?gc=45&gh=256");
    expect(out).not.toContain("style=");
    expect(out).not.toContain("<style");
  });
});

describe("schemeCss", () => {
  it("declares twelve solid and twelve alpha steps per family, once each", () => {
    const css = schemeCss(buildTheme({ grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10 }), {
      grayHue: 256,
      grayChroma: 45,
      accentHue: 267,
      accentChroma: 195,
      radius: 10,
    });
    for (const family of ["gray", "accent"]) {
      for (let step = 1; step <= 12; step++) {
        expect(css.split(`--${family}-${step}:`).length - 1).toBe(1);
        expect(css.split(`--${family}-a${step}:`).length - 1).toBe(1);
      }
    }
    expect(css.split(":root {").length - 1).toBe(1);
    expect(css).not.toContain(".dark {");
  });

  it("is standalone-complete, carrying the contrast step that pairs with its own accent", () => {
    const dials = { grayHue: 0, grayChroma: 0, accentHue: 267, accentChroma: 195, radius: 10 };
    expect(schemeCss(buildTheme(dials), dials)).toContain("--accent-contrast: light-dark(var(--gray-1), var(--gray-12));");
  });

  it("reproduces theme-neutral.css at the default dials", () => {
    const dials = { grayHue: 0, grayChroma: 0, accentHue: 267, accentChroma: 195, radius: 10 };
    const css = schemeCss(buildTheme(dials), dials);
    expect(css).toContain("--gray-1: light-dark(oklch(98.21% 0 0), oklch(17.76% 0 0));");
    expect(css).toContain("--gray-11: light-dark(oklch(50.32% 0 0), oklch(76.99% 0 0));");
    expect(css).toContain("--gray-12: light-dark(oklch(24.35% 0 0), oklch(94.91% 0 0));");
    expect(css).toContain("--accent-9: oklch(52.00% 0.1950 267.0);");
  });

  it("records the dials it was generated from, so a pasted file can be traced back", () => {
    const dials = { grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10 };
    const css = schemeCss(buildTheme(dials), dials);
    expect(css).toContain("hue 256deg, chroma 0.045");
    expect(css).toContain("hue 267deg, chroma 0.195");
  });
});
