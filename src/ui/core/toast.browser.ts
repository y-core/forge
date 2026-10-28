import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { compositeOver } from "../../tooling/gate/checks/color";
import { Dock } from "../chrome/dock";
import { compiledCss, mount, paintedHex, renderedClasses } from "../client/browser.fixture";
import { contrastRatio } from "../contracts/theme/color";
import { CRITERION } from "../contracts/theme/contrast-pairs";
import { FlashContainer } from "../server/flash";
import { createIcon } from "./icon";
import { Toast } from "./toast";
import { TONES } from "./utils/tone";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

function readDismissPaint(page: Page, selector: string): Promise<{ outline: string; ring: string; glyph: string; panel: string }> {
  return page.evaluate((target) => {
    const button = document.querySelector(target) as HTMLElement;
    const style = getComputedStyle(button);
    return {
      outline: `${style.outlineStyle} ${style.outlineWidth}`,
      ring: style.outlineColor,
      glyph: getComputedStyle(button.querySelector("span") as HTMLElement).color,
      panel: getComputedStyle(button.parentElement as HTMLElement).backgroundColor,
    };
  }, selector);
}

test.describe("toast scope — the auto-dismiss timer", () => {
  test("removes its root once the duration elapses", async ({ page }) => {
    await mount(page, await render(Toast({ duration: 50, children: "hi" })), EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());

    await expect.poll(() => page.evaluate(() => document.querySelector("[data-scope='toast']") === null)).toBe(true);
  });

  test("a hovered toast outlasts its duration, and leaves once the pointer does", async ({ page }) => {
    await mount(page, `<main style="padding: 40px">${await render(Toast({ id: "held", duration: 1000, children: "hi" }))}</main>`, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
    await page.hover("#held");

    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => document.querySelector("#held") !== null)).toBe(true);

    await page.mouse.move(0, 0);
    await expect.poll(() => page.evaluate(() => document.querySelector("#held") === null)).toBe(true);
  });

  test("a disposed toast scope does not remove its root when the timer would have fired", async ({ page }) => {
    await mount(page, await render(Toast({ duration: 50, children: "hi" })), EXPOSE);

    const present = await page.evaluate(async () => {
      window.forgeResume.resume()();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return document.querySelector("[data-scope='toast']") !== null;
    });

    expect(present).toBe(true);
  });
});

test.describe("toast scope — focus rehomed by a dismiss", () => {
  async function mountPair(page: import("@playwright/test").Page): Promise<void> {
    const pair = await render(
      Toast.Container({
        children: [Toast({ id: "a", dismissible: true, children: "A" }), Toast({ id: "b", dismissible: true, duration: 1000, children: "B" })],
      }),
    );
    await mount(page, pair, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
  }

  test("a mouse close leaves the next toast counting down", async ({ page }) => {
    await mountPair(page);

    await page.click("#a [data-slot~='toast-close']");
    await page.mouse.move(0, 0);

    await expect.poll(() => page.evaluate(() => document.querySelector("#b") === null)).toBe(true);
  });

  test("a keyboard close holds the next toast while it keeps focus", async ({ page }) => {
    await mountPair(page);

    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    expect(await page.evaluate(() => document.activeElement?.closest("#b") !== null)).toBe(true);
  });
});

test.describe("Toast — arrival motion", () => {
  async function insertAndRead(page: import("@playwright/test").Page): Promise<{ transitions: string[]; opacity: number }> {
    const html = await render(Toast({ id: "saved", dismissible: true, children: "Saved" }));
    await mount(page, "<main></main>", { css: ["./ui/assets/css/forge-ui.css"], ...EXPOSE });
    await page.evaluate(() => window.forgeResume.resume());
    return page.evaluate((markup) => {
      document.querySelector("main")?.insertAdjacentHTML("beforeend", markup);
      const toast = document.querySelector("#saved") as HTMLElement;
      return {
        transitions: toast.getAnimations().map((animation) => (animation as CSSTransition).transitionProperty),
        opacity: Number(getComputedStyle(toast).opacity),
      };
    }, html);
  }

  test("an inserted toast fades in from below half opacity", async ({ page }) => {
    const frame = await insertAndRead(page);

    expect(frame.transitions).toEqual(["opacity"]);
    expect(frame.opacity).toBeLessThan(0.5);
  });

  test("dismissing marks it dismissing and inert at once and removes it after the fade", async ({ page }) => {
    await insertAndRead(page);
    await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.querySelector("#saved") as HTMLElement).opacity))).toBe(1);

    const atClick = await page.evaluate(() => {
      (document.querySelector("#saved [data-slot~='toast-close']") as HTMLButtonElement).click();
      const toast = document.querySelector("#saved") as HTMLElement | null;
      return { present: toast !== null, dismissing: toast?.hasAttribute("data-dismissing") ?? null, inert: toast?.inert ?? null };
    });

    expect(atClick).toEqual({ present: true, dismissing: true, inert: true });
    await expect.poll(() => page.evaluate(() => document.querySelector("#saved") === null)).toBe(true);
  });

  test.describe("under reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("an inserted toast still fades in", async ({ page }) => {
      const frame = await insertAndRead(page);

      expect(frame.transitions).toEqual(["opacity"]);
      expect(frame.opacity).toBeLessThan(0.5);
    });

    test("dismissing still fades it out before removing it", async ({ page }) => {
      await insertAndRead(page);
      await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.querySelector("#saved") as HTMLElement).opacity))).toBe(1);

      const atClick = await page.evaluate(() => {
        (document.querySelector("#saved [data-slot~='toast-close']") as HTMLButtonElement).click();
        const toast = document.querySelector("#saved") as HTMLElement | null;
        return { dismissing: toast?.hasAttribute("data-dismissing") ?? null, inert: toast?.inert ?? null };
      });

      expect(atClick).toEqual({ dismissing: true, inert: true });
      await expect.poll(() => page.evaluate(() => document.querySelector("#saved") === null)).toBe(true);
    });
  });
});

test.describe("FlashContainer — taps reach what lies beneath it", () => {
  async function mountOver(page: Page, html: string): Promise<void> {
    await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style>${html}`, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
  }

  function probe(page: Page, selector: string): Promise<{ underContainer: boolean; hitsTarget: boolean; x: number; y: number }> {
    return page.evaluate((target) => {
      const element = document.querySelector(target) as HTMLElement;
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const strip = (document.querySelector("#flash-container") as HTMLElement).getBoundingClientRect();
      return {
        underContainer: x > strip.left && x < strip.right && y > strip.top && y < strip.bottom,
        hitsTarget: document.elementFromPoint(x, y)?.closest(target) === element,
        x,
        y,
      };
    }, selector);
  }

  test("an empty container over a footer Save button lets the button take the hit and the click", async ({ page }) => {
    const footer =
      '<footer style="position: fixed; inset-inline: 0; bottom: 0; display: flex; justify-content: flex-end"><button id="save" type="button" style="margin: 0 40px 20px 0; height: 24px">Save</button></footer>';
    await mountOver(page, `${footer}${await render(FlashContainer({}))}`);
    await page.evaluate(() => document.querySelector("#save")?.addEventListener("click", () => document.body.setAttribute("data-saved", "")));

    const at = await probe(page, "#save");
    await page.mouse.click(at.x, at.y);

    expect({
      underContainer: at.underContainer,
      hitsTarget: at.hitsTarget,
      saved: await page.evaluate(() => document.body.hasAttribute("data-saved")),
    }).toEqual({ underContainer: true, hitsTarget: true, saved: true });
  });

  test.describe("at phone width", () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test("an empty container over the Dock lets a tap on Search navigate", async ({ page }) => {
      const icon = createIcon("/sprite.svg", { "icon-home": "0 0 24 24", "icon-search": "0 0 24 24" });
      const dock = await render(
        Dock({
          items: [
            { label: "Home", href: "home", icon: "home", current: true },
            { label: "Search", href: "search", icon: "search" },
          ],
          resolveHref: (key: string) => `/route/${key}`,
          icon,
        }),
      );
      await mountOver(page, `${dock}${await render(FlashContainer({}))}`);

      const at = await probe(page, "[data-slot~='dock-item'][href='/route/search']");
      expect({ underContainer: at.underContainer, hitsTarget: at.hitsTarget }).toEqual({ underContainer: true, hitsTarget: true });

      await page.mouse.click(at.x, at.y);
      await expect.poll(() => new URL(page.url()).pathname).toBe("/route/search");
    });
  });

  test("a flash toast's dismiss button still takes the hit, and its click dismisses the toast", async ({ page }) => {
    await mountOver(page, await render(FlashContainer({ messages: [{ type: "success", text: "Saved" }] })));

    const at = await probe(page, "[data-slot~='toast-close']");
    expect(at.hitsTarget).toBe(true);

    await page.mouse.click(at.x, at.y);
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-scope='toast']") === null)).toBe(true);
  });
});

for (const dark of [false, true]) {
  test(`every soft tone's close glyph paints at full opacity and clears the 1.4.3 floor in ${dark ? "dark" : "light"}`, async ({ page }) => {
    const html = (
      await Promise.all(TONES.map((tone) => render(Toast({ id: tone, tone, appearance: "soft", dismissible: true, children: "Saved" }))))
    ).join("");
    await mount(page, `<style>${await compiledCss([...renderedClasses(html), "bg-background"])}</style><main class="bg-background">${html}</main>`);
    if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));

    const failing: string[] = [];
    for (const tone of TONES) {
      const read = await page.evaluate((id) => {
        const panel = document.getElementById(id) as HTMLElement;
        const button = panel.querySelector("[data-slot~='toast-close']") as HTMLElement;
        const glyph = button.querySelector("span") as HTMLElement;
        return { opacity: getComputedStyle(button).opacity, fg: getComputedStyle(glyph).color, bg: getComputedStyle(panel).backgroundColor };
      }, tone);
      const fg = await paintedHex(page, read.fg);
      const bg = await paintedHex(page, read.bg);
      const ratio = Number(contrastRatio(fg, bg).toFixed(2));
      if (read.opacity !== "1" || ratio < CRITERION["1.4.3"].floor) failing.push(`${tone} opacity=${read.opacity} ${fg} on ${bg} = ${ratio}`);
    }

    expect(failing).toEqual([]);
  });
}

for (const dark of [false, true]) {
  test(`every solid and soft tone's close button outlines itself on hover in a colour clearing the 1.4.11 floor, its glyph still clearing 1.4.3, in ${dark ? "dark" : "light"}`, async ({
    page,
  }) => {
    const panels = TONES.flatMap((tone) => (["solid", "soft"] as const).map((appearance) => ({ id: `${appearance}-${tone}`, tone, appearance })));
    const html = (await Promise.all(panels.map((panel) => render(Toast({ ...panel, dismissible: true, children: "Saved" }))))).join("");
    await mount(page, `<style>${await compiledCss([...renderedClasses(html), "bg-background"])}</style><main class="bg-background">${html}</main>`);
    if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));

    const failing: string[] = [];
    for (const { id } of panels) {
      const button = `#${id} [data-slot~='toast-close']`;
      const rest = await readDismissPaint(page, button);
      await page.hover(button);
      const hovered = await readDismissPaint(page, button);
      const panel = await paintedHex(page, hovered.panel);
      const ring = Number(contrastRatio(await paintedHex(page, hovered.ring), panel).toFixed(2));
      const glyph = Number(contrastRatio(await paintedHex(page, hovered.glyph), panel).toFixed(2));
      const shown = hovered.outline !== rest.outline && !hovered.outline.startsWith("none");
      if (!shown || ring < CRITERION["1.4.11"].floor || glyph < CRITERION["1.4.3"].floor)
        failing.push(`${id} ${rest.outline} -> ${hovered.outline}: ring ${ring}, glyph ${glyph}`);
    }

    expect(failing).toEqual([]);
  });
}

for (const dark of [false, true]) {
  test(`hovering the panel leaves its background as at rest, and its dismiss glyph clears the 1.4.3 floor there, in ${dark ? "dark" : "light"}`, async ({
    page,
  }) => {
    const panels = TONES.flatMap((tone) => (["solid", "soft"] as const).map((appearance) => ({ id: `${appearance}-${tone}`, tone, appearance })));
    const html = (await Promise.all(panels.map((panel) => render(Toast({ ...panel, dismissible: true, children: "Saved" }))))).join("");
    await mount(page, `<style>${await compiledCss([...renderedClasses(html), "bg-background"])}</style><main class="bg-background">${html}</main>`);
    if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));

    const failing: string[] = [];
    for (const { id } of panels) {
      const button = `#${id} [data-slot~='toast-close']`;
      const rest = await readDismissPaint(page, button);
      await page.hover(`#${id}`, { position: { x: 4, y: 4 } });
      const hovered = await readDismissPaint(page, button);
      const glyph = await paintedHex(page, hovered.glyph);
      const panel = await paintedHex(page, hovered.panel);
      const ratio = Number(contrastRatio(glyph, panel).toFixed(2));
      if (hovered.panel !== rest.panel || ratio < CRITERION["1.4.3"].floor)
        failing.push(`${id} ${rest.panel} -> ${hovered.panel}: ${glyph} on ${panel} = ${ratio}`);
    }

    expect(failing).toEqual([]);
  });
}

for (const dark of [false, true]) {
  test(`every soft tone's description paints at full opacity and clears the 1.4.3 floor in ${dark ? "dark" : "light"}`, async ({ page }) => {
    const html = (
      await Promise.all(
        TONES.map((tone) =>
          render(Toast({ id: tone, tone, appearance: "soft", children: Toast.Description({ children: "Your changes were saved." }) })),
        ),
      )
    ).join("");
    await mount(page, `<style>${await compiledCss([...renderedClasses(html), "bg-background"])}</style><main class="bg-background">${html}</main>`);
    if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));

    const failing: string[] = [];
    for (const tone of TONES) {
      const read = await page.evaluate((id) => {
        const panel = document.getElementById(id) as HTMLElement;
        const description = panel.querySelector("[data-slot~='toast-description']") as HTMLElement;
        const style = getComputedStyle(description);
        let effective = 1;
        for (let node: HTMLElement | null = description; node !== null && node !== panel; node = node.parentElement) {
          effective *= Number(getComputedStyle(node).opacity);
        }
        return { opacity: style.opacity, effective, fg: style.color, bg: getComputedStyle(panel).backgroundColor };
      }, tone);
      const bg = await paintedHex(page, read.bg);
      const fg = compositeOver(await paintedHex(page, read.fg), bg, read.effective);
      const ratio = Number(contrastRatio(fg, bg).toFixed(2));
      if (read.opacity !== "1" || ratio < CRITERION["1.4.3"].floor) failing.push(`${tone} opacity=${read.opacity} ${fg} on ${bg} = ${ratio}`);
    }

    expect(failing).toEqual([]);
  });
}

test.describe("Toast — the close target", { tag: "@cross-engine" }, () => {
  test("the close button is at least 32px each way, and the padding keeps the content clear of it", async ({ page }) => {
    const html = await render(Toast({ id: "saved", dismissible: true, children: "Saved" }));
    await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style><main>${html}</main>`);

    const button = page.locator("#saved [data-slot~='toast-close']");
    const box = await button.boundingBox();
    expect({ wide: (box?.width ?? 0) >= 32, tall: (box?.height ?? 0) >= 32 }).toEqual({ wide: true, tall: true });

    const edges = await page.evaluate(() => {
      const panel = document.querySelector("#saved") as HTMLElement;
      const style = getComputedStyle(panel);
      const contentEnd =
        panel.getBoundingClientRect().right - Number.parseFloat(style.borderInlineEndWidth) - Number.parseFloat(style.paddingInlineEnd);
      return { contentEnd, buttonStart: (panel.querySelector("[data-slot~='toast-close']") as HTMLElement).getBoundingClientRect().left };
    });
    expect(edges.contentEnd).toBeLessThanOrEqual(edges.buttonStart);
  });
});
