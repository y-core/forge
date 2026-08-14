import { expect, test } from "@playwright/test";
import { mount } from "../client/browser-test-helper";

declare global {
  interface Window {
    forgeState: typeof import("./state-attrs");
  }
}

const EXPOSE = { expose: { forgeState: "./ui/contracts/state-attrs" } };

const STYLES = `
  <style>
    [data-open] { --matched: open; }
    [data-closed] { --matched: closed; }
    [data-pressed] { --matched: pressed; }
    [data-orientation="vertical"] { --axis: vertical; }
  </style>
`;

test("a presence selector matches an empty-valued state attribute", async ({ page }) => {
  await mount(page, `${STYLES}<div id="panel" data-open=""></div>`, EXPOSE);

  const value = await page.evaluate(() => {
    const el = document.querySelector("#panel");
    return el ? getComputedStyle(el).getPropertyValue("--matched").trim() : null;
  });

  expect(value).toBe("open");
});

test("applyStateAttrs moves a live element between paired states and the selectors follow", async ({ page }) => {
  await mount(page, `${STYLES}<div id="panel"></div>`, EXPOSE);

  const timeline = await page.evaluate(() => {
    const el = document.querySelector("#panel");
    if (!el) return [];
    const read = () => getComputedStyle(el).getPropertyValue("--matched").trim();
    const seen: string[] = [];
    window.forgeState.applyStateAttrs(el, { open: true });
    seen.push(read());
    window.forgeState.applyStateAttrs(el, { open: false });
    seen.push(read());
    return seen;
  });

  expect(timeline).toEqual(["open", "closed"]);
});

test("applyStateAttrs leaves attributes owned by keys it was not given", async ({ page }) => {
  await mount(page, `${STYLES}<div id="panel"></div>`, EXPOSE);

  const result = await page.evaluate(() => {
    const el = document.querySelector("#panel");
    if (!el) return null;
    window.forgeState.applyStateAttrs(el, { orientation: "vertical", pressed: true });
    window.forgeState.applyStateAttrs(el, { pressed: false });
    return {
      axis: getComputedStyle(el).getPropertyValue("--axis").trim(),
      attributes: [...el.attributes].map((attribute) => attribute.name).sort(),
    };
  });

  expect(result).toEqual({ axis: "vertical", attributes: ["data-orientation", "id"] });
});

test("the SSR builder and the client mutator agree on every declared state", async ({ page }) => {
  await mount(page, '<div id="panel"></div>', EXPOSE);

  const agreement = await page.evaluate(() => {
    const state = {
      open: true,
      pressed: true,
      checked: true,
      disabled: true,
      invalid: true,
      popupOpen: true,
      orientation: "vertical",
      side: "top",
      align: "end",
      transition: "starting",
    } as const;
    const el = document.querySelector("#panel");
    if (!el) return null;
    window.forgeState.applyStateAttrs(el, state);
    const fromDom: Record<string, string> = {};
    for (const attribute of el.attributes) {
      if (attribute.name.startsWith("data-")) fromDom[attribute.name] = attribute.value;
    }
    return { fromDom, fromBuilder: window.forgeState.stateAttrs(state) };
  });

  expect(agreement?.fromDom).toEqual(agreement?.fromBuilder ?? {});
});
