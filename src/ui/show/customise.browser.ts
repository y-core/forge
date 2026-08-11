import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { buildTheme, liveRatios } from "../contracts/theme-contract";
import { createIcon } from "../core/icon";
import { CustomiseContent, loadCustomise } from "./customise";

/**
 * The theme customiser, driven.
 *
 * Two properties live here that no unit test can reach, because both are about what a *browser*
 * does with the page rather than what the Worker rendered:
 *
 * 1. **The dials actually repaint.** `customise.test.tsx` proves the page renders the right hex as
 *    text; only a browser can say whether dragging a lever moves a custom property on `<html>` and
 *    whether a real composed surface picks the new value up. That round trip — signal → effect →
 *    CSSOM → `getComputedStyle` — is the whole feature, and every hop of it is invisible to SSR.
 *
 * 2. **The composition band is here at all.** It moved off the showcase catalog, where its
 *    placement case used to live between `#showcase-toc` and `#alert`. A moved band whose test
 *    stayed behind would be a band nobody checks, so the case moved with it and is re-anchored to
 *    this page's neighbours.
 */

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = {
  expose: {
    forgeResume: "./ui/client/resume",
    forgeCoreClient: "./ui/core/client",
    forgeChromeClient: "./ui/chrome/client",
    forgeShowClient: "./ui/show/client",
  },
};

/** The token layer: the scale, then the mapping onto it. Both hops, or nothing resolves. */
const TOKEN_CSS = ["./ui/assets/css/theme-neutral.css", "./ui/assets/css/theme-base.css"];

/**
 * The one Tailwind utility this spec measures, restated as a real rule.
 *
 * The harness runs no Tailwind build, so `class="text-muted-foreground"` styles nothing — a case
 * that reads a computed colour has to supply the rule it reads or it measures the browser's default
 * black. `showcase.browser.ts` restates its layout utilities for the same reason and with the same
 * trade: the dependency stays visible, and if `Card.Description` stopped naming this utility the
 * case below would fail rather than quietly measuring something else.
 *
 * The *token* is not restated. `--muted-foreground: var(--gray-11)` comes from the shipped
 * `theme-base.css` above, which is the hop under test — a hand-written token here would make the
 * case agree with itself.
 */
const UTILITY_STYLE = `<style>
  .text-muted-foreground { color: var(--muted-foreground) }
  table.w-full { width: 100% }
  .table-fixed { table-layout: fixed }
  .border-separate { border-collapse: separate }
  .border-spacing-0 { border-spacing: 0 }
  td.px-1 { padding-left: 0.25rem; padding-right: 0.25rem }
  td.pt-2 { padding-top: 0.5rem }
  td.border-t { border-top: 1px solid var(--border) }
  td.border-b { border-bottom: 1px solid var(--border) }
  td.border-l { border-left: 1px solid var(--border) }
  td.border-r { border-right: 1px solid var(--border) }
  td.rounded-tl-md { border-top-left-radius: 0.375rem }
  td.rounded-tr-md { border-top-right-radius: 0.375rem }
  td.rounded-bl-md { border-bottom-left-radius: 0.375rem }
  td.rounded-br-md { border-bottom-right-radius: 0.375rem }
  .h-10 { height: 2.5rem }
  div.w-full { width: 100% }
</style>`;

const icon = createIcon("/sprite.svg", { "icon-spinner": "0 0 24 24", "icon-chevron-down": "0 0 24 24" });

/** A loader context carrying only the URL, exactly as the route's loader receives it. */
async function mountCustomise(page: Page, search = ""): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: only `url` is read by the loader
  const ctx = { url: new URL(`http://forge.test/showcase/ui/theme${search}`) } as any;
  const html = await render(CustomiseContent({ data: loadCustomise(ctx), icon }));
  await mount(page, UTILITY_STYLE + html, { ...EXPOSE, css: TOKEN_CSS });
  await page.evaluate(() => window.forgeResume.resume());
}

/** Move one lever the way a drag does — set the value, then fire the delegated `input` event. */
async function drag(page: Page, dials: readonly (readonly [field: string, value: string])[]): Promise<void> {
  await page.evaluate(
    (moves) => {
      for (const [field, value] of moves) {
        const slider = document.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
        if (slider === null) throw new Error(`no ${field} slider`);
        slider.value = value;
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    dials as [string, string][],
  );
}

/** A custom property as the browser resolves it on `<html>`, trimmed of the whitespace CSSOM keeps. */
function rootProperty(page: Page, property: string): Promise<string> {
  return page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), property);
}

// ─── The live restyle ────────────────────────────────────────────────────────

test.describe("the customiser's levers", () => {
  test("paint the URL's scheme onto the document before anything is touched", async ({ page }) => {
    // The scope is eager precisely so this holds. A lazy scope would resume correctly on the first
    // drag and still show the shipped scheme until then, which for a page reached by a shared link
    // is the wrong first frame.
    await mountCustomise(page, "?gh=256&gc=45");

    const expected = buildTheme({ grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10 });
    expect(await rootProperty(page, "--gray-11")).toBe(expected.gray.light.solid[10]);
    expect(await rootProperty(page, "--gray-1")).toBe(expected.gray.light.solid[0]);
  });

  test("rewrite --gray-11 on the document when a lever moves", async ({ page }) => {
    await mountCustomise(page);

    // Neutral to start: chroma 0, so the generated scale is `theme-neutral.css` exactly.
    expect(await rootProperty(page, "--gray-11")).toBe("#646464");

    await drag(page, [
      ["grayChroma", "45"],
      ["grayHue", "256"],
    ]);

    // The exact value the generator produces for these dials — not "something changed". A mutation
    // check confirms this is load-bearing: perturbing one digit of the expected hex fails the case.
    const expected = buildTheme({ grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10 });
    expect(await rootProperty(page, "--gray-11")).toBe(expected.gray.light.solid[10]);
    expect(expected.gray.light.solid[10]).toBe("#53667e");
  });

  test("repaint a real composed surface, not only the swatches", async ({ page }) => {
    // The claim the swatch grid cannot make. `--muted-foreground` resolves through `--gray-11`, and
    // a Card description inside the composition band draws it — so moving a lever has to change the
    // computed colour of ordinary text two hops away from anything the customiser knows about.
    await mountCustomise(page);

    const descriptionColour = () =>
      page.evaluate(() => {
        const el = document.querySelector("#compositions [data-slot~='card-description']");
        return el === null ? null : getComputedStyle(el).color;
      });

    const before = await descriptionColour();
    expect(before).not.toBeNull();

    await drag(page, [
      ["grayChroma", "45"],
      ["grayHue", "256"],
    ]);

    const after = await descriptionColour();
    expect(after).not.toBe(before);
    // `#53667e` — the generated step 11 — as the browser reports it.
    expect(after).toBe("rgb(83, 102, 126)");
  });

  test("drive --radius directly, since it is a token rather than a scale step", async ({ page }) => {
    await mountCustomise(page);
    expect(await rootProperty(page, "--radius")).toBe("10px");

    await drag(page, [["radius", "2"]]);

    expect(await rootProperty(page, "--radius")).toBe("2px");
  });

  test("keep each readout agreeing with its own slider", async ({ page }) => {
    // `Slider` ships no client controller by decision — `core/slider.tsx` reproduces the browser's
    // range sanitisation on the Worker precisely because nothing reconciles thumb and readout
    // afterwards. On this page the reconciliation is an effect, so it is asserted rather than
    // assumed.
    await mountCustomise(page);

    await drag(page, [["accentHue", "120"]]);

    const readout = await page.evaluate(() => document.querySelector('[data-readout="accentHue"]')?.textContent);
    expect(readout).toBe("120°");
  });

  test("paint both scale rows at once, each with its own scale", async ({ page }) => {
    // Two scales cannot coexist on one `:root`, so each row is painted on its own element — and an
    // element-level declaration is what lets the dark row show dark steps while the page is light.
    await mountCustomise(page);

    const step11 = (row: string) =>
      page.evaluate((id) => {
        const el = document.querySelector<HTMLElement>(`[data-scale-row="${id}"] [data-swatch="10"]`);
        return el === null ? null : getComputedStyle(el).backgroundColor;
      }, row);

    // Step 11 is `#646464` in light and `#b4b4b4` in dark at the default dials.
    expect(await step11("light")).toBe("rgb(100, 100, 100)");
    expect(await step11("dark")).toBe("rgb(180, 180, 180)");
  });

  test("align every swatch with the step number heading it", async ({ page }) => {
    // The one property the whole table choice exists to buy, and the reason this is not a header
    // grid above padded row boxes: those drift by exactly the padding, and `subgrid` does not fix it
    // either. Asserted on real geometry, so a future switch back to divs fails here.
    await mountCustomise(page);

    const drift = await page.evaluate(() => {
      // Scoped to `#preview`: the WCAG table below has a `<thead>` of its own, and an unscoped
      // `thead th` quietly collects its four headers too.
      const heads = [...document.querySelectorAll<HTMLElement>("#preview thead th")];
      const swatches = [...document.querySelectorAll<HTMLElement>('[data-scale-row="light"] [data-swatch]')];
      if (heads.length !== 12 || swatches.length !== 12) return { heads: heads.length, swatches: swatches.length, deltas: null };
      return {
        heads: heads.length,
        swatches: swatches.length,
        deltas: heads.map((head, i) => Math.abs(head.getBoundingClientRect().left - (swatches[i]?.getBoundingClientRect().left ?? 0))),
      };
    });

    // Reported rather than collapsed to null, so a miscount says which side miscounted.
    expect({ heads: drift.heads, swatches: drift.swatches }).toEqual({ heads: 12, swatches: 12 });

    const deltas = drift.deltas ?? [];
    // **Uniformity is the property, not the magnitude.** Every swatch is inset from its heading by
    // `px-1`'s 4px, because the cells share one set of column widths. A column that had drifted
    // would show up as a *varying* inset, which a per-cell bound would miss entirely: twelve columns
    // each 5px off in the same direction is perfect alignment, and twelve off by 0, 3, 6, 9 is not.
    //
    // The permitted variation is exactly 1px, and it is accounted for rather than slack: the two
    // outer columns carry the box's own left and right border, so their swatch starts one pixel
    // further in. Any real drift is far larger — a padding difference is at least 4px, and a
    // proportional one accumulates across twelve columns.
    expect(Math.max(...deltas) - Math.min(...deltas)).toBeLessThanOrEqual(1);
    // And the shared inset is the padding rather than a column width gone wrong.
    for (const delta of deltas) expect(delta).toBeLessThanOrEqual(6);
  });

  test("give each scale its own bordered box, painted in that scale's own mode", async ({ page }) => {
    // The container *is* the label — there is no caption text over these rows — so the two things
    // that carry the meaning are the border and the background. Both are asserted rather than
    // assumed, and the border in particular is not a given: a `<tbody>` may only carry one in the
    // **collapsing** border model, and is silently ignored in the separated one. If someone drops
    // `border-collapse`, the boxes vanish and nothing else on the page changes.
    await mountCustomise(page);

    const box = (id: string) =>
      page.evaluate((rowId) => {
        const scope = `[data-scale-row="${rowId}"]`;
        // The frame is drawn by the cells on the box's edge, because neither border model lets a
        // `<tbody>` be both bordered and rounded. The top-left cell therefore carries the top edge,
        // the left edge and the upper-left radius all at once.
        const corner = document.querySelector<HTMLElement>(`${scope} tr:first-child td:first-child`);
        const hex = document.querySelector<HTMLElement>(`${scope} [data-hex="0"]`);
        if (corner === null || hex === null) return null;
        const style = getComputedStyle(corner);
        return {
          borderTop: style.borderTopWidth,
          borderLeft: style.borderLeftWidth,
          radius: style.borderTopLeftRadius,
          background: style.backgroundColor,
          mutedText: getComputedStyle(hex).color,
        };
      }, id);

    // Each box is painted from its own scale — page is step 1, muted text is step 11 — so it
    // demonstrates the scale using the scale. At the default dials that is `theme-neutral.css`:
    // `#f9f9f9`/`#646464` light and `#111111`/`#b4b4b4` dark. Note the *dark* box's muted text is
    // the dark scale's step 11, which is the thing a nested `.dark` class could never have given it.
    const frame = { borderTop: "1px", borderLeft: "1px", radius: "6px" };
    expect(await box("light")).toEqual({ ...frame, background: "rgb(249, 249, 249)", mutedText: "rgb(100, 100, 100)" });
    expect(await box("dark")).toEqual({ ...frame, background: "rgb(17, 17, 17)", mutedText: "rgb(180, 180, 180)" });
  });

  test("round the box's four outside corners and no interior one", async ({ page }) => {
    // The corners are the reason this table is in the separated border model at all — the collapsing
    // one refuses `border-radius` outright — so they are worth pinning as geometry rather than as a
    // class name. Interior cells must stay square, or the band reads as twelve rounded tiles.
    await mountCustomise(page);

    const radii = await page.evaluate(() => {
      const cell = (selector: string) => {
        const el = document.querySelector<HTMLElement>(selector);
        if (el === null) return null;
        const s = getComputedStyle(el);
        return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].join(" ");
      };
      const scope = '[data-scale-row="light"]';
      return {
        topLeft: cell(`${scope} tr:first-child td:first-child`),
        topRight: cell(`${scope} tr:first-child td:last-child`),
        bottomLeft: cell(`${scope} tr:last-child td:first-child`),
        bottomRight: cell(`${scope} tr:last-child td:last-child`),
        interior: cell(`${scope} tr:first-child td:nth-child(6)`),
      };
    });

    // Each outer cell rounds exactly the one corner that is also the box's corner.
    expect(radii).toEqual({
      topLeft: "6px 0px 0px 0px",
      topRight: "0px 6px 0px 0px",
      bottomRight: "0px 0px 6px 0px",
      bottomLeft: "0px 0px 0px 6px",
      interior: "0px 0px 0px 0px",
    });
  });

  test("rewrite the printed hex, not only the swatch it labels", async ({ page }) => {
    // The defect this replaces: the effect painted `[data-swatch]` and left the hex beside it
    // alone, so after a drag the page printed a claim about a colour it was no longer showing —
    // under a comment asserting the label had to match the paint.
    await mountCustomise(page);

    const printed = () => page.evaluate(() => document.querySelector('[data-scale-row="light"] [data-hex="10"]')?.textContent);
    expect(await printed()).toBe("#646464");

    await drag(page, [
      ["grayChroma", "45"],
      ["grayHue", "256"],
    ]);

    const expected = buildTheme({ grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10 });
    expect(await printed()).toBe(expected.gray.light.solid[10]);
    expect(await printed()).toBe("#53667e");

    // And the label agrees with the paint, which is the property rather than the mechanism.
    const painted = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-scale-row="light"] [data-swatch="10"]');
      return el === null ? null : getComputedStyle(el).backgroundColor;
    });
    expect(painted).toBe("rgb(83, 102, 126)");
  });

  test("recompute the live WCAG cells as the dials move", async ({ page }) => {
    // "WCAG, live" is the page's headline claim — the thing the Radix custom-palette page cannot
    // offer — and it was true for exactly one frame: the cells were rendered on the Worker and never
    // written again.
    await mountCustomise(page);

    const cell = (key: string) => page.evaluate((k) => document.querySelector(`[data-ratio="${k}"]`)?.textContent, key);
    expect(await cell("--muted-foreground:light")).toBe("5.19:1 ✓");

    await drag(page, [
      ["grayChroma", "45"],
      ["grayHue", "256"],
    ]);

    const expected = buildTheme({ grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10 });
    const [light] = liveRatios(expected).filter((entry) => entry.key === "--muted-foreground:light");
    expect(await cell("--muted-foreground:light")).toBe(light?.text);
    // It actually moved. Without this the case would pass against a page that recomputed nothing,
    // on any dial setting that happened to leave the ratio where it was.
    expect(await cell("--muted-foreground:light")).not.toBe("5.19:1 ✓");
    // Both columns are recomputed: neither depends on the mode the page happens to be in.
    expect(await cell("--muted-foreground:dark")).not.toBe(await cell("--muted-foreground:light"));
  });

  test("update the copyable scheme block as the dials move", async ({ page }) => {
    // The output is the artifact, so a stale block would hand someone a scheme that is not the one
    // they are looking at — the single worst failure this page could have.
    await mountCustomise(page);
    expect(await page.evaluate(() => document.querySelector("[data-scheme-output] code")?.textContent)).toContain("--gray-11: #646464;");

    await drag(page, [
      ["grayChroma", "45"],
      ["grayHue", "256"],
    ]);

    const output = await page.evaluate(() => document.querySelector("[data-scheme-output] code")?.textContent);
    expect(output).toContain("--gray-11: #53667e;");
    expect(output).toContain(".dark {");
  });
});

// ─── The compositions band ───────────────────────────────────────────────────
//
// Moved here from `showcase.browser.ts` with the band itself. The placement case is re-anchored:
// it used to pin the band between `#showcase-toc` and `#alert` on the catalog page, and now pins it
// between the customiser's WCAG table and its output block — the same property, stated against the
// neighbours it actually has.

test.describe("the customiser's compositions band", () => {
  test("sits between the WCAG table and the output, holding its three surfaces", async ({ page }) => {
    await mountCustomise(page);

    const placement = await page.evaluate(() => {
      const wcag = document.getElementById("wcag");
      const band = document.getElementById("compositions");
      const output = document.getElementById("output");
      if (!wcag || !band || !output) return null;
      return {
        afterWcag: wcag.compareDocumentPosition(band) === Node.DOCUMENT_POSITION_FOLLOWING,
        beforeOutput: band.compareDocumentPosition(output) === Node.DOCUMENT_POSITION_FOLLOWING,
        surfaces: [...band.querySelectorAll("section")].map((section) => section.id),
      };
    });

    expect(placement).toEqual({
      afterWcag: true,
      beforeOutput: true,
      surfaces: ["composition-collection", "composition-form", "composition-feedback"],
    });
  });

  test("renders the collection's four states as siblings a reader can tell apart", async ({ page }) => {
    await mountCustomise(page);

    const cards = await page.evaluate(() =>
      [...document.querySelectorAll("#composition-collection [data-slot~='card']")].map((card) => ({
        title: card.querySelector("[data-slot~='card-title']")?.textContent?.trim() ?? "",
        rows: card.querySelectorAll("tbody tr").length,
        skeletons: card.querySelectorAll("[data-slot~='skeleton']").length,
        errors: card.querySelectorAll("[data-slot~='alert'][data-variant='destructive']").length,
      })),
    );

    // Four states shown at once is the point of the surface, so each one is pinned by the thing that
    // makes it that state — rows, an absence, placeholders in the rows' shape, a failure named.
    expect(cards).toEqual([
      { title: "Populated", rows: 5, skeletons: 0, errors: 0 },
      { title: "Empty", rows: 0, skeletons: 0, errors: 0 },
      { title: "Loading", rows: 0, skeletons: 10, errors: 0 },
      { title: "Failed", rows: 0, skeletons: 0, errors: 1 },
    ]);
  });

  test("puts the settings form's controls in the tab order in the order they are written", async ({ page }) => {
    await mountCustomise(page);

    // Start on the last control above the form: tabbing from here proves the form's first control is
    // the next stop and that the honeypot sitting between them stays out of the sequence.
    await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#composition-collection button")].pop()?.focus());

    const reached: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      reached.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (!(el instanceof HTMLElement)) return "nothing focusable";
          return el.getAttribute("name") ?? (el.textContent ?? "").trim();
        }),
      );
    }

    expect(reached).toEqual(["rows-per-page", "row-height", "show-subpath", "Reset", "Save settings"]);
  });
});
