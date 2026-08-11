/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { buildTheme, DIALS, leverRows, SCALE_ROWS, schemeCss } from "../contracts/theme-contract";
import { fieldId } from "../core/field";
import { CustomiseContent, loadCustomise } from "./customise";

// Minimal icon compatible with CustomiseIcon; renders nothing.
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

/** A loader context carrying only the URL — the whole of this page's input. */
// biome-ignore lint/suspicious/noExplicitAny: only `url` is read
const ctx = (search = "") => ({ url: new URL(`https://example.test/showcase/ui/theme${search}`) }) as any;

const page = (search = "") => render(<CustomiseContent data={loadCustomise(ctx(search))} icon={icon} />);

describe("loadCustomise", () => {
  it("defaults every dial to the shipped scheme", () => {
    const { dials } = loadCustomise(ctx());
    for (const dial of DIALS) expect(dials[dial.field]).toBe(dial.fallback);
    // Gray chroma 0 is the load-bearing default: it makes the generated scale achromatic, which is
    // `theme-neutral.css` exactly. A bare URL therefore shows what forge ships, not a starting
    // point someone picked.
    expect(dials.grayChroma).toBe(0);
  });

  it("reads each dial from its own short parameter", () => {
    const { dials } = loadCustomise(ctx("?gh=256&gc=45&ah=200&ac=120&r=4"));
    expect(dials).toEqual({ grayHue: 256, grayChroma: 45, accentHue: 200, accentChroma: 120, radius: 4 });
  });

  it("clamps to the dial's own range", () => {
    // The URL is this page's only state and a shared link is its one untrusted input, so a
    // hand-edited parameter must not produce a scheme the sliders could not have produced.
    expect(loadCustomise(ctx("?gc=99999")).dials.grayChroma).toBe(100);
    expect(loadCustomise(ctx("?gh=-40")).dials.grayHue).toBe(0);
    expect(loadCustomise(ctx("?r=1000")).dials.radius).toBe(24);
  });

  it("falls back rather than failing on an unparseable value", () => {
    // A truncated or mangled shared URL should render the default, not a 400 — the failure mode of
    // a broken link is meant to be "you get the shipped scheme", not "the page is gone".
    for (const bad of ["?gh=abc", "?gh=", "?gh=NaN", "?gh=Infinity"]) {
      expect(loadCustomise(ctx(bad)).dials.grayHue).toBe(0);
    }
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
    // The bound `Slider` is `ui/controls`', so the binding attributes are forge's rather than
    // hand-stamped here — asserting the value proves the loader reached the control.
    expect(out).toContain('max="360"');
    expect(out).toContain('value="256"');
  });

  it("server-renders each dial's value into its label, beside the slider", async () => {
    const out = await page("?gh=256&gc=45&r=4");
    // `Slider` ships no client controller by decision, so nothing reconciles a thumb with its
    // readout after render. Both are written on the Worker from the same number, and this is what
    // says so.
    expect(out).toContain('data-readout="grayHue"');
    expect(out).toContain("256°");
    expect(out).toContain("4px");
    // A chroma dial carries no unit suffix: it is already in the thousandths the section prose
    // names the shipped ladder in — "0, 12, 20 and 45" — so a bare 45 reads directly against slate
    // rather than needing to be divided first.
    expect(out).toContain(">45</output>");
  });

  it("draws one row per generated scale against a single shared header of step numbers", async () => {
    const out = await page();
    for (const row of SCALE_ROWS) expect(out).toContain(`data-scale-row="${row.id}"`);
    expect(out.split("data-swatch=").length - 1).toBe(SCALE_ROWS.length * 12);
    // Twelve `<th scope='col'>` and no more: the step numbers are printed once for the whole table
    // rather than once per swatch, which is the entire reason this is a table. Nothing else asserts
    // that count, and without it the header could quietly become per-row again.
    expect(out.split('scope="col"').length - 1).toBe(12);
  });

  it("draws no crossed scale/surface row, because the cascade cannot produce one", async () => {
    const out = await page();
    // An earlier version drew all four combinations. `.dark` swaps the scale *and* the surface
    // together, so a light step never lands on a dark page — the crossed rows asked for a judgement
    // about a state that cannot occur.
    expect(SCALE_ROWS).toHaveLength(2);
    expect(out).not.toContain("light-on-dark");
    expect(out).not.toContain("dark-on-light");
  });

  it("asks for no mode on a preview row, because a nested one cannot work", async () => {
    const out = await page();
    // An earlier version put `class="dark"` here and it quietly did nothing. Forge's semantic tokens
    // are declared once on `:root` — `--background: var(--gray-1)` — so they *compute there*, to a
    // literal, and inherit as that literal; a descendant re-declaring `--gray-1` never reaches them.
    // `.dark` works on `<html>` because both declarations compute on the same element, in order.
    //
    // The row is painted from the generated scale instead, which `customise.browser.ts` asserts on
    // real computed style. This is the half that can be checked here: no mode class, and no colour
    // literal that would have been the other way of faking it.
    const dark = out.match(/<tbody data-scale-row="dark"[^>]*>/)?.[0] ?? "";
    expect(dark).toBe('<tbody data-scale-row="dark">');
    expect(out).not.toContain('class="dark"');
  });

  it("draws the box frame on the cells that sit on its edge", async () => {
    const out = await page();
    // The frame cannot live on the `<tbody>`: `border-radius` does not apply to table elements in
    // the collapsing border model, and a row group may not carry a border at all in the separated
    // one. So the four corner cells carry one radius each and the edge cells carry the sides —
    // which is also why the table is `border-separate` rather than `border-collapse`.
    // Scoped to the preview's own table tag: the WCAG table below is an ordinary collapsed one and
    // has no reason to change, so an unscoped `not.toContain("border-collapse")` would be asserting
    // something about a table this test is not about.
    const previewTable = out.slice(out.indexOf('id="preview"')).match(/<table[^>]*>/)?.[0] ?? "";
    expect(previewTable).toContain("border-separate border-spacing-0");
    expect(previewTable).not.toContain("border-collapse");
    for (const corner of ["rounded-tl-md", "rounded-tr-md", "rounded-bl-md", "rounded-br-md"]) {
      // One per box, two boxes.
      expect(out.split(corner).length - 1).toBe(2);
    }
  });

  it("server-renders the hex of every generated step, so the page reads without JavaScript", async () => {
    const out = await page();
    // Colour cannot be server-rendered — `style-src 'self'` with no nonce, and the renderer drops
    // `style` — so the *text* is what carries the scheme to a reader with no script. At the default
    // dials this is `theme-neutral.css`, which is why these are the shipped literals.
    for (const hex of ["#f9f9f9", "#646464", "#202020", "#111111", "#b4b4b4", "#eeeeee"]) {
      expect(out).toContain(hex);
    }
    // Twenty-four, not forty-eight. There are only two generated scales, so a four-row preview
    // printed half its hexes twice and invited a reader to look for a difference the generator
    // cannot make.
    expect(out.split("data-hex=").length - 1).toBe(24);
  });

  it("derives every control id through the field helpers", async () => {
    const out = await page();
    for (const dial of DIALS) {
      expect(out).toContain(`id="${fieldId(dial.field)}"`);
      expect(out).toContain(`for="${fieldId(dial.field)}"`);
    }
    // The literal this page used to write by hand. A `for=` that agrees with an `id=` by coincidence
    // rather than derivation is exactly the failure `forge-ui-form-id-helpers` names: nothing
    // errors, and clicking the label silently stops focusing the control.
    expect(out).not.toContain('id="dial-');
  });

  it("names each control in full while printing its family once", async () => {
    const out = await page();
    // "hue" is drawn twice, and the two controls stay distinguishable by name because the family
    // rides a visually-hidden prefix *inside* the label the control already points at — not an
    // `aria-label`, which would replace the visible text and leave two names to keep in step.
    expect(out).toContain('<span class="sr-only">Accent </span>hue');
    expect(out).toContain('<span class="sr-only">Gray </span>hue');
  });

  it("spans the solo row across the family cell so its slider still aligns", async () => {
    const out = await page();
    // Found by looking at the rendered page rather than by any gate: without the spans, the radius
    // row's label lands in the 4.5rem family track and its slider in the 7rem *label* track — a
    // slider a fifth of the width of every other one. Nothing type-checks, lints or renders wrong;
    // it is only wrong on screen, which is why it is pinned here.
    expect(out).toContain('class="flex items-baseline gap-2 md:col-span-2"');
    const radiusSlider = out.match(/<input[^>]*data-field="radius"[^>]*>/)?.[0] ?? "";
    expect(radiusSlider).toContain("md:col-span-3");
    // The paired rows take the template's tracks one at a time and must not span.
    const hueSlider = out.match(/<input[^>]*data-field="accentHue"[^>]*>/)?.[0] ?? "";
    expect(hueSlider).not.toContain("col-span");
  });

  it("pairs hue with chroma on one row and gives radius its own", async () => {
    // The grouping is a fact about the dials — one family's two free parameters — so it is derived
    // from `Dial.group` rather than from the page's layout.
    expect(leverRows().map((row) => row.map((dial) => dial.field))).toEqual([["accentHue", "accentChroma"], ["grayHue", "grayChroma"], ["radius"]]);
  });

  it("lists every audited pair, marking which are live", async () => {
    const out = await page();
    expect(out.split("data-pair=").length - 1).toBe(16);
    // Four live, twelve fixed — and the twelve are shown rather than hidden, so the table is a
    // statement about the whole audit instead of about the computable part of it.
    expect(out.split('data-live="true"').length - 1).toBe(4);
    expect(out.split('data-live="false"').length - 1).toBe(12);
  });

  it("computes each live ratio and marks it against its own floor", async () => {
    const out = await page();
    expect(out).toContain('data-ratio="--muted-foreground:light"');
    // The pinned value from TOKEN_CONTRACT, recomputed here from a generated scale rather than
    // read from the audit — the two agreeing is the point.
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
    expect(out).toContain(".dark {");
  });

  it("shows a share URL carrying every dial", async () => {
    const out = await page("?gh=256&gc=45");
    expect(out).toContain("data-share-url");
    expect(out).toContain("gh=256");
    expect(out).toContain("gc=45");
  });

  it("carries no style attribute anywhere, which the renderer would drop in any case", async () => {
    const out = await page("?gc=45&gh=256");
    // The constraint that shapes the whole page: forge ships `style-src 'self'` with no
    // `'unsafe-inline'` and no style nonce, so colour reaches the browser through CSSOM or not at
    // all. A `style=` here would be silently stripped and the swatch would render blank.
    expect(out).not.toContain("style=");
    expect(out).not.toContain("<style");
  });
});

describe("schemeCss", () => {
  it("declares twelve solid and twelve alpha steps per family per mode", () => {
    const css = schemeCss(buildTheme({ grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10 }), {
      grayHue: 256,
      grayChroma: 45,
      accentHue: 267,
      accentChroma: 195,
      radius: 10,
    });
    for (const family of ["gray", "accent"]) {
      for (let step = 1; step <= 12; step++) {
        expect(css).toContain(`--${family}-${step}:`);
        expect(css).toContain(`--${family}-a${step}:`);
      }
    }
    // 48 declarations per block, two blocks.
    expect(css.split(":root {").length - 1).toBe(1);
    expect(css.split(".dark {").length - 1).toBe(1);
  });

  it("reproduces theme-neutral.css at the default dials", () => {
    // The output is the artifact, so the strongest available check is that the default output *is*
    // the file forge ships. Every solid step below is a literal from `theme-neutral.css`.
    const dials = { grayHue: 0, grayChroma: 0, accentHue: 267, accentChroma: 195, radius: 10 };
    const css = schemeCss(buildTheme(dials), dials);
    expect(css).toContain("--gray-1: #f9f9f9;");
    expect(css).toContain("--gray-11: #646464;");
    expect(css).toContain("--gray-12: #202020;");
    expect(css).toContain("--gray-1: #111111;");
    expect(css).toContain("--gray-11: #b4b4b4;");
  });

  it("records the dials it was generated from, so a pasted file can be traced back", () => {
    const dials = { grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10 };
    const css = schemeCss(buildTheme(dials), dials);
    expect(css).toContain("hue 256deg, chroma 0.045");
    expect(css).toContain("hue 267deg, chroma 0.195");
  });
});
