import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { createIcon } from "../core/icon";
import { Navbar } from "./navbar";
import { DARK_CLASS, THEME_ATTR, THEME_STORAGE_KEY } from "./theme";
import { ThemeToggle } from "./theme-toggle";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeChromeClient: "./ui/chrome/client" } };

const icon = createIcon("/sprite.svg", { "icon-sun": "0 0 24 24", "icon-moon": "0 0 24 24", "icon-monitor": "0 0 24 24" });
const navIcon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16", "icon-hamburger": "0 0 22 22", "icon-close": "0 0 22 22" });

/** The FOUC script's job, done inline: the preference is on `<html>` before anything resumes. */
async function seed(page: Page, pref: string): Promise<void> {
  await page.evaluate(
    ([attr, key, value]) => {
      document.documentElement.setAttribute(attr as string, value as string);
      localStorage.setItem(key as string, value as string);
    },
    [THEME_ATTR, THEME_STORAGE_KEY, pref] as const,
  );
}

async function mountTheme(page: Page, pref?: string): Promise<void> {
  await mount(page, await render(ThemeToggle({ icon })), EXPOSE);
  if (pref) await seed(page, pref);
  await page.evaluate(() => window.forgeResume.resume());
}

function themeState(page: Page): Promise<{ pref: string | null; dark: boolean; stored: string | null }> {
  return page.evaluate(
    ([attr, key, cls]) => ({
      pref: document.documentElement.getAttribute(attr as string),
      dark: document.documentElement.classList.contains(cls as string),
      stored: localStorage.getItem(key as string),
    }),
    [THEME_ATTR, THEME_STORAGE_KEY, DARK_CLASS] as const,
  );
}

test.describe("theme scope — the cycle", () => {
  test("a click advances light to dark to system and back to light", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await mountTheme(page, "light");

    await page.click("[data-on-click='cycleTheme']");
    expect(await themeState(page)).toEqual({ pref: "dark", dark: true, stored: "dark" });

    await page.click("[data-on-click='cycleTheme']");
    expect(await themeState(page)).toEqual({ pref: "system", dark: false, stored: "system" });

    await page.click("[data-on-click='cycleTheme']");
    expect(await themeState(page)).toEqual({ pref: "light", dark: false, stored: "light" });
  });

  test("the preference is persisted on every step, not only at teardown", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await mountTheme(page, "light");

    await page.click("[data-on-click='cycleTheme']");

    expect((await themeState(page)).stored).toBe("dark");
  });
});

test.describe("theme scope — the system preference", () => {
  test("system resolves to dark when the browser prefers dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await mountTheme(page, "system");

    expect(await themeState(page)).toEqual({ pref: "system", dark: true, stored: "system" });
  });

  test("an explicit preference overrides the browser's", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await mountTheme(page, "light");

    expect((await themeState(page)).dark).toBe(false);
  });

  test("a live colour-scheme change re-resolves the system preference", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await mountTheme(page, "system");
    expect((await themeState(page)).dark).toBe(false);

    await page.emulateMedia({ colorScheme: "dark" });

    await expect.poll(async () => (await themeState(page)).dark).toBe(true);
  });

  test("teardown stops the scope tracking the colour scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await mount(page, await render(ThemeToggle({ icon })), EXPOSE);
    await seed(page, "system");
    await page.evaluate(() => {
      window.forgeResume.resume()();
    });

    await page.emulateMedia({ colorScheme: "dark" });

    expect((await themeState(page)).dark).toBe(false);
  });
});

test.describe("theme toggle — the accessible name follows the theme", () => {
  /** The rendered name, which is exactly what a screen reader would announce. */
  function buttonName(page: Page): Promise<string | undefined> {
    return page.evaluate(() => document.querySelector<HTMLElement>("[data-on-click='cycleTheme']")?.innerText.trim());
  }

  for (const pref of ["light", "dark", "system"] as const) {
    test(`announces the ${pref} theme with no JavaScript beyond the attribute`, async ({ page }) => {
      await mount(page, await render(ThemeToggle({ icon })), EXPOSE);
      await seed(page, pref);

      const labels = await page.evaluate(() => [...document.querySelectorAll(".sr-only")].map((el) => el.textContent));

      expect(labels).toContain(`Switch theme — currently ${pref}`);
      expect(await buttonName(page)).toBeDefined();
    });
  }

  test("carries no static aria-label that could disagree with the active theme", async ({ page }) => {
    await mount(page, await render(ThemeToggle({ icon })), EXPOSE);

    expect(await page.evaluate(() => document.querySelector("[data-on-click='cycleTheme']")?.hasAttribute("aria-label"))).toBe(false);
  });
});

test.describe("navbar scope — auth filters", () => {
  const CONFIG = {
    sections: [
      {
        items: [
          { label: "Public", href: "pub" },
          { label: "Account", href: "acct", filters: ["user"] },
          { label: "Admin", href: "admin", filters: ["admin"] },
        ],
      },
    ],
  };

  async function mountNavbar(page: Page, activeFilters: string[]): Promise<void> {
    const html = await render(Navbar({ config: CONFIG, resolveHref: (k: string) => `/${k}`, icon: navIcon, activeFilters }));
    await mount(page, html, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
  }

  /** Which filtered links are visible, by label. */
  function visible(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-filter]")].filter((el) => !el.hidden).map((el) => el.textContent ?? ""),
    );
  }

  test("seeds hidden from the server-rendered active set", async ({ page }) => {
    await mountNavbar(page, ["user"]);

    expect(await visible(page)).toEqual(["Account"]);
  });

  test("a navbar:filters event re-syncs hidden on the real elements", async ({ page }) => {
    await mountNavbar(page, ["user"]);

    await page.evaluate(() => document.dispatchEvent(new CustomEvent("navbar:filters", { detail: ["admin"] })));

    expect(await visible(page)).toEqual(["Admin"]);
  });

  test("an empty token set hides every filtered item and leaves unfiltered ones alone", async ({ page }) => {
    await mountNavbar(page, ["user", "admin"]);

    await page.evaluate(() => document.dispatchEvent(new CustomEvent("navbar:filters", { detail: [] })));

    expect(await visible(page)).toEqual([]);
    expect(await page.evaluate(() => document.querySelector<HTMLElement>("[href='/pub']")?.hidden)).toBe(false);
  });

  test("a detail that is not an array is ignored rather than clearing the set", async ({ page }) => {
    await mountNavbar(page, ["user"]);

    await page.evaluate(() => document.dispatchEvent(new CustomEvent("navbar:filters", { detail: "user" })));

    expect(await visible(page)).toEqual(["Account"]);
  });

  test("teardown removes the navbar:filters listener", async ({ page }) => {
    const html = await render(Navbar({ config: CONFIG, resolveHref: (k: string) => `/${k}`, icon: navIcon, activeFilters: ["user"] }));
    await mount(page, html, EXPOSE);
    await page.evaluate(() => {
      window.forgeResume.resume()();
    });

    await page.evaluate(() => document.dispatchEvent(new CustomEvent("navbar:filters", { detail: ["admin"] })));

    expect(await visible(page)).toEqual(["Account"]);
  });
});
