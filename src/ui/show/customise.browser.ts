import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { buildTheme, liveRatios } from "../contracts/theme-contract";
import { createIcon } from "../core/icon";
import { CustomiseContent, loadCustomise } from "./customise";

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

// The harness runs no Tailwind build, so a case reading a computed colour must supply the rule it
// reads. The tokens are not restated: resolving them through the shipped sheets is the hop under test.
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

test.describe("the customiser's levers", () => {
  test("paint the URL's scheme onto the document before anything is touched", async ({ page }) => {
    await mountCustomise(page, "?gh=256&gc=45");

    const expected = buildTheme({ grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10 });
    expect(await rootProperty(page, "--gray-11")).toBe(expected.gray.light.solid[10]);
    expect(await rootProperty(page, "--gray-1")).toBe(expected.gray.light.solid[0]);
  });

  test("rewrite --gray-11 on the document when a lever moves", async ({ page }) => {
    await mountCustomise(page);

    expect(await rootProperty(page, "--gray-11")).toBe("#646464");

    await drag(page, [
      ["grayChroma", "45"],
      ["grayHue", "256"],
    ]);

    const expected = buildTheme({ grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10 });
    expect(await rootProperty(page, "--gray-11")).toBe(expected.gray.light.solid[10]);
    expect(expected.gray.light.solid[10]).toBe("#53667e");
  });

  test("repaint a real composed surface, not only the swatches", async ({ page }) => {
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
    expect(after).toBe("rgb(83, 102, 126)");
  });

  test("drive --radius directly, since it is a token rather than a scale step", async ({ page }) => {
    await mountCustomise(page);
    expect(await rootProperty(page, "--radius")).toBe("10px");

    await drag(page, [["radius", "2"]]);

    expect(await rootProperty(page, "--radius")).toBe("2px");
  });

  test("keep each readout agreeing with its own slider", async ({ page }) => {
    await mountCustomise(page);

    await drag(page, [["accentHue", "120"]]);

    const readout = await page.evaluate(() => document.querySelector('[data-readout="accentHue"]')?.textContent);
    expect(readout).toBe("120°");
  });

  test("paint both scale rows at once, each with its own scale", async ({ page }) => {
    await mountCustomise(page);

    const step11 = (row: string) =>
      page.evaluate((id) => {
        const el = document.querySelector<HTMLElement>(`[data-scale-row="${id}"] [data-swatch="10"]`);
        return el === null ? null : getComputedStyle(el).backgroundColor;
      }, row);

    expect(await step11("light")).toBe("rgb(100, 100, 100)");
    expect(await step11("dark")).toBe("rgb(180, 180, 180)");
  });

  test("align every swatch with the step number heading it", async ({ page }) => {
    await mountCustomise(page);

    const drift = await page.evaluate(() => {
      const heads = [...document.querySelectorAll<HTMLElement>("#preview thead tr:last-child th")];
      const swatches = [...document.querySelectorAll<HTMLElement>('[data-scale-row="light"] [data-swatch]')];
      if (heads.length !== 12 || swatches.length !== 12) return { heads: heads.length, swatches: swatches.length, deltas: null };
      return {
        heads: heads.length,
        swatches: swatches.length,
        deltas: heads.map((head, i) => Math.abs(head.getBoundingClientRect().left - (swatches[i]?.getBoundingClientRect().left ?? 0))),
      };
    });

    expect({ heads: drift.heads, swatches: drift.swatches }).toEqual({ heads: 12, swatches: 12 });

    const deltas = drift.deltas ?? [];
    expect(Math.max(...deltas) - Math.min(...deltas)).toBeLessThanOrEqual(1);
    for (const delta of deltas) expect(delta).toBeLessThanOrEqual(6);
  });

  test("give each scale its own bordered box, painted in that scale's own mode", async ({ page }) => {
    await mountCustomise(page);

    const box = (id: string) =>
      page.evaluate((rowId) => {
        const scope = `[data-scale-row="${rowId}"]`;
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

    const frame = { borderTop: "1px", borderLeft: "1px", radius: "6px" };
    expect(await box("light")).toEqual({ ...frame, background: "rgb(249, 249, 249)", mutedText: "rgb(100, 100, 100)" });
    expect(await box("dark")).toEqual({ ...frame, background: "rgb(17, 17, 17)", mutedText: "rgb(180, 180, 180)" });
  });

  test("round the box's four outside corners and no interior one", async ({ page }) => {
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

    expect(radii).toEqual({
      topLeft: "6px 0px 0px 0px",
      topRight: "0px 6px 0px 0px",
      bottomRight: "0px 0px 6px 0px",
      bottomLeft: "0px 0px 0px 6px",
      interior: "0px 0px 0px 0px",
    });
  });

  test("rewrite the printed hex, not only the swatch it labels", async ({ page }) => {
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

    const painted = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-scale-row="light"] [data-swatch="10"]');
      return el === null ? null : getComputedStyle(el).backgroundColor;
    });
    expect(painted).toBe("rgb(83, 102, 126)");
  });

  test("recompute the live WCAG cells as the dials move", async ({ page }) => {
    await mountCustomise(page);

    const cell = (key: string) => page.evaluate((k) => document.querySelector(`[data-ratio="${k}"]`)?.textContent, key);
    expect(await cell("--muted-foreground|--gray-3:light")).toBe("5.19:1 ✓");

    await drag(page, [
      ["grayChroma", "45"],
      ["grayHue", "256"],
    ]);

    const expected = buildTheme({ grayHue: 256, grayChroma: 45, accentHue: 267, accentChroma: 195, radius: 10 });
    const [light] = liveRatios(expected).filter((entry) => entry.key === "--muted-foreground|--gray-3:light");
    expect(await cell("--muted-foreground|--gray-3:light")).toBe(light?.text);
    expect(await cell("--muted-foreground|--gray-3:light")).not.toBe("5.19:1 ✓");
    expect(await cell("--muted-foreground|--gray-3:dark")).not.toBe(await cell("--muted-foreground|--gray-3:light"));
  });

  test("update the copyable scheme block as the dials move", async ({ page }) => {
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

    expect(cards).toEqual([
      { title: "Populated", rows: 5, skeletons: 0, errors: 0 },
      { title: "Empty", rows: 0, skeletons: 0, errors: 0 },
      { title: "Loading", rows: 0, skeletons: 10, errors: 0 },
      { title: "Failed", rows: 0, skeletons: 0, errors: 1 },
    ]);
  });

  test("puts the settings form's controls in the tab order in the order they are written", async ({ page }) => {
    await mountCustomise(page);

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
