import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { Navbar, type NavDefinition } from "../chrome/navbar";
import { mount } from "../client/browser-test-helper";
import { createIcon } from "./icon";
import { Menu } from "./menu";
import { Tooltip } from "./tooltip";

declare global {
  interface Window {
    forgeScopeTeardown?: () => void;
  }
}

const CSS = { css: ["./ui/assets/css/forge-ui.css"] };
const CSS_AND_JS = { ...CSS, expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

const FIXTURE_STYLE = `<style>
  body { margin: 0; }
  [data-slot~="menu-trigger"], [data-slot~="tooltip-trigger"] { position: fixed; top: 200px; left: 120px; width: 90px; height: 30px; }
  [data-slot~="menu-popup"], [data-slot~="popover-content"] { width: 160px; }
  [data-slot~="menu-item"], [data-slot~="menu-submenu-trigger"] { display: block; width: 100%; height: 36px; }
</style>`;

interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function boxes<K extends string>(page: Page, ids: Record<K, string>): Promise<Record<K, Box>> {
  return page.evaluate(
    (map: Record<string, string>) => {
      const out: Record<string, Box> = {};
      for (const [name, selector] of Object.entries(map)) {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) throw new Error(`boxes: no element matched ${name} (${selector})`);
        const r = el.getBoundingClientRect();
        out[name] = {
          top: Math.round(r.top),
          left: Math.round(r.left),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      }
      return out;
    },
    ids as Record<string, string>,
  ) as Promise<Record<K, Box>>;
}

function near(actual: number, expected: number, tolerance = 2): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

const GAP = 6;

test.describe("Menu — anchored to its trigger", () => {
  async function simpleMenu(page: Page, options = CSS): Promise<void> {
    const popup = Menu.Popup({
      id: "file-menu",
      children: [Menu.Item({ id: "new", for: "file-menu", children: "New" }), Menu.Item({ id: "open", for: "file-menu", children: "Open" })],
    });
    const html = await render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
    await mount(page, `${FIXTURE_STYLE}${html}`, options);
  }

  test("opens under its trigger rather than centred in the viewport", async ({ page }) => {
    await simpleMenu(page);
    await page.click('[data-slot~="menu-trigger"]');

    const { trigger, popup } = await boxes(page, { trigger: '[data-slot~="menu-trigger"]', popup: "#file-menu" });

    expect(near(popup.top, trigger.bottom + GAP), `popup.top ${popup.top} should be trigger.bottom ${trigger.bottom} + ${GAP}`).toBe(true);
    expect(near(popup.left, trigger.left), `popup.left ${popup.left} should be trigger.left ${trigger.left}`).toBe(true);
  });

  test("declares the anchor name the trigger publishes", async ({ page }) => {
    await simpleMenu(page);

    const declared = await page.evaluate(() => ({
      trigger: getComputedStyle(document.querySelector('[data-slot~="menu-trigger"]') as HTMLElement).getPropertyValue("anchor-name"),
      popup: getComputedStyle(document.querySelector("#file-menu") as HTMLElement).getPropertyValue("position-anchor"),
      scope: getComputedStyle(document.querySelector('[data-slot~="menu"]') as HTMLElement).getPropertyValue("anchor-scope"),
    }));

    expect(declared).toEqual({ trigger: "--forge-menu", popup: "--forge-menu", scope: "--forge-menu" });
  });

  test("side and align move the panel to the named corner", async ({ page }) => {
    const popup = Menu.Popup({ id: "file-menu", side: "top", align: "end", children: [Menu.Item({ id: "new", for: false, children: "New" })] });
    const html = await render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
    await mount(page, `${FIXTURE_STYLE}${html}`, CSS);
    await page.click('[data-slot~="menu-trigger"]');

    const { trigger, popup: box } = await boxes(page, { trigger: '[data-slot~="menu-trigger"]', popup: "#file-menu" });

    expect(near(box.bottom, trigger.top - GAP), `bottom ${box.bottom} vs trigger.top ${trigger.top} - ${GAP}`).toBe(true);
    expect(near(box.right, trigger.right), `right ${box.right} vs trigger.right ${trigger.right}`).toBe(true);
  });

  test("a coordinate-placed menu ignores the anchored rules entirely", async ({ page }) => {
    const html = await render(Menu.Popup({ id: "ctx", coords: true, children: [Menu.Item({ id: "cut", for: false, children: "Cut" })] }));
    await mount(page, `${FIXTURE_STYLE}${html}`, { ...CSS, expose: { forgeAnchor: "./ui/client/popover-anchor" } });

    await page.evaluate(() => {
      (window as unknown as { forgeAnchor: typeof import("../client/popover-anchor") }).forgeAnchor.openPopoverAt(
        document.querySelector("#ctx") as HTMLElement,
        300,
        200,
      );
    });

    const { popup } = await boxes(page, { popup: "#ctx" });
    expect({ top: popup.top, left: popup.left }).toEqual({ top: 200, left: 300 });
  });
});

test.describe("a context menu against the platform's light-dismiss pass", () => {
  async function contextFixture(page: Page, guard: boolean): Promise<void> {
    const html = await render(Menu.Popup({ id: "ctx", coords: true, children: [Menu.Item({ id: "cut", for: false, children: "Cut" })] }));
    const surface = '<div id="surface" style="position:fixed;top:0;left:0;width:400px;height:300px">surface</div>';
    const radius = '<style>[data-slot~="menu-popup"] { border-radius: 0.75rem }</style>';
    await mount(page, `${FIXTURE_STYLE}${radius}${surface}${html}`, { ...CSS, expose: { forgeAnchor: "./ui/client/popover-anchor" } });
    await page.evaluate((guarded: boolean) => {
      const popup = document.querySelector("#ctx") as HTMLElement;
      document.querySelector("#surface")?.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const { clientX, clientY, buttons } = event as MouseEvent;
        (window as unknown as { forgeAnchor: typeof import("../client/popover-anchor") }).forgeAnchor.openPopoverAt(popup, clientX, clientY, {
          afterPointerUp: guarded && buttons !== 0,
        });
      });
    }, guard);
  }

  const isOpen = (page: Page) => page.evaluate(() => document.querySelector("#ctx")?.matches(":popover-open") === true);

  test("stays open past the release of the button that opened it", async ({ page }) => {
    await contextFixture(page, true);
    await page.mouse.click(150, 120, { button: "right" });

    expect(await isOpen(page)).toBe(true);
    const { popup } = await boxes(page, { popup: "#ctx" });
    expect({ top: popup.top, left: popup.left }).toEqual({ top: 120, left: 150 });
  });

  test("without the guard, the same right-click dismisses it immediately", async ({ page }) => {
    await contextFixture(page, false);
    await page.mouse.click(150, 120, { button: "right" });

    expect(await isOpen(page)).toBe(false);
  });

  test("a later click still light-dismisses the guarded menu", async ({ page }) => {
    await contextFixture(page, true);
    await page.mouse.click(150, 120, { button: "right" });
    expect(await isOpen(page)).toBe(true);

    await page.mouse.click(350, 260);
    expect(await isOpen(page)).toBe(false);
  });
});

async function twoSubmenus(page: Page, options: Record<string, unknown> = CSS, extraStyle = ""): Promise<void> {
  const sub = (id: string, label: string) =>
    Menu.Popup({ id, side: "right", children: [Menu.Item({ id: `${id}-row`, for: false, children: label })] });
  const popup = Menu.Popup({
    id: "file-menu",
    children: [
      Menu.SubmenuTrigger({ id: "recent-menu", children: "Recent" }),
      sub("recent-menu", "alpha"),
      Menu.Item({ id: "spacer1", for: false, children: "Spacer" }),
      Menu.Item({ id: "spacer2", for: false, children: "Spacer" }),
      Menu.Item({ id: "spacer3", for: false, children: "Spacer" }),
      Menu.SubmenuTrigger({ id: "export-menu", children: "Export" }),
      sub("export-menu", "beta"),
    ],
  });
  const html = await render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
  await mount(page, `${FIXTURE_STYLE}${extraStyle}${html}`, options);
}

const SELECTORS = {
  panel: "#file-menu",
  triggerA: '[commandfor="recent-menu"]',
  triggerB: '[commandfor="export-menu"]',
  subA: "#recent-menu",
  subB: "#export-menu",
};

test.describe("Menu — submenu anchoring", () => {
  test("without JavaScript, a submenu pins to the panel edge — and not to the other trigger's row", async ({ page }) => {
    await twoSubmenus(page);
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerA);

    const box = await boxes(page, SELECTORS);

    expect(box.triggerA.top, "the fixture must place the two rows apart for this case to mean anything").not.toBe(box.triggerB.top);
    expect(near(box.subA.left, box.panel.right + GAP), `subA.left ${box.subA.left} vs panel.right ${box.panel.right} + ${GAP}`).toBe(true);
    expect(near(box.subA.top, box.panel.top), `subA.top ${box.subA.top} vs panel.top ${box.panel.top}`).toBe(true);
    expect(box.subA.top, "bound to the wrong trigger's row — the row-named failure this design avoids").not.toBe(box.triggerB.top);
  });

  test("with the client bundle, each submenu is row-accurate", async ({ page }) => {
    await twoSubmenus(page, CSS_AND_JS);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerA);

    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subA.top, box.triggerA.top);
      })
      .toBe(true);

    const box = await boxes(page, SELECTORS);
    expect(near(box.subA.left, box.triggerA.right + GAP), `subA.left ${box.subA.left} vs triggerA.right ${box.triggerA.right}`).toBe(true);
  });

  test("the second submenu binds to its own row, not to the first", async ({ page }) => {
    await twoSubmenus(page, CSS_AND_JS);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerB);

    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subB.top, box.triggerB.top);
      })
      .toBe(true);

    const box = await boxes(page, SELECTORS);
    expect(box.subB.top, "bound to the other trigger's row").not.toBe(box.triggerA.top);
  });

  test("re-opening reuses the minted name rather than growing the list", async ({ page }) => {
    await twoSubmenus(page, CSS_AND_JS);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');

    const names: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await page.click(SELECTORS.triggerA);
      names.push(
        await page.evaluate(() => (document.querySelector('[commandfor="recent-menu"]') as HTMLElement).style.getPropertyValue("anchor-name")),
      );
      await page.keyboard.press("Escape");
    }

    expect(new Set(names).size, `anchor-name changed between openings: ${names.join(" | ")}`).toBe(1);
    expect(names.at(-1)?.split(",").length, `the list grew across openings: ${names.join(" | ")}`).toBe(1);
  });
});

const FADE_STYLE = `<style>
  #export-menu { opacity: 0; transition: opacity 400ms linear, display 400ms allow-discrete, overlay 400ms allow-discrete; }
  #export-menu:popover-open { opacity: 1; }
</style>`;

interface ExitFrame {
  top: number;
  left: number;
  height: number;
  open: boolean;
  opacity: number;
}

test.describe("Menu — a submenu re-opened after its first binding", () => {
  test("an open that resolves no trigger drops the dead name and falls back to the panel binding", async ({ page }) => {
    await twoSubmenus(page, CSS_AND_JS);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerA);

    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subA.top, box.triggerA.top);
      })
      .toBe(true);

    const bound = await page.evaluate(() => (document.querySelector("#recent-menu") as HTMLElement).style.getPropertyValue("position-anchor"));
    expect(bound, "the first open wrote no inline anchor, so there is nothing stale to clear").toBe("--forge-anchor-1");

    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      document.querySelector('[commandfor="recent-menu"]')?.remove();
      (document.querySelector("#recent-menu") as HTMLElement).showPopover();
    });

    const remaining = { panel: SELECTORS.panel, subA: SELECTORS.subA };

    await expect
      .poll(async () => {
        const box = await boxes(page, remaining);
        return near(box.subA.top, box.panel.top) && near(box.subA.left, box.panel.right + GAP);
      })
      .toBe(true);

    const box = await boxes(page, remaining);
    const after = await page.evaluate(() => (document.querySelector("#recent-menu") as HTMLElement).style.getPropertyValue("position-anchor"));

    expect(after, "the dead name survived the open").toBe("");
    expect(near(box.subA.top, box.panel.top), `subA.top ${box.subA.top} vs panel.top ${box.panel.top}`).toBe(true);
    expect(near(box.subA.left, box.panel.right + GAP), `subA.left ${box.subA.left} vs panel.right ${box.panel.right} + ${GAP}`).toBe(true);
  });

  test("a closing submenu stays on its own row for every frame it is still painted", async ({ page }) => {
    await twoSubmenus(page, CSS_AND_JS, FADE_STYLE);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerB);

    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subB.top, box.triggerB.top);
      })
      .toBe(true);

    const before = await boxes(page, SELECTORS);
    expect(before.triggerB.top, "the row and the panel share a top edge — nothing here could drift").not.toBe(before.panel.top);

    const frames = await page.evaluate(
      () =>
        new Promise<ExitFrame[]>((resolve) => {
          const sub = document.querySelector("#export-menu") as HTMLElement;
          const out: ExitFrame[] = [];
          sub.hidePopover();
          const tick = () => {
            const rect = sub.getBoundingClientRect();
            out.push({
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              height: Math.round(rect.height),
              open: sub.matches(":popover-open"),
              opacity: Number(getComputedStyle(sub).opacity),
            });
            if (out.length < 12) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );

    const exiting = frames.filter((frame) => !frame.open && frame.height > 0);
    expect(exiting.length, `no frame caught the panel mid-exit: ${JSON.stringify(frames)}`).toBeGreaterThan(0);
    expect(
      exiting.some((frame) => frame.opacity > 0 && frame.opacity < 1),
      `the exit transition never ran, so no frame could have caught a drift: ${JSON.stringify(exiting)}`,
    ).toBe(true);

    for (const frame of exiting) {
      expect(near(frame.top, before.triggerB.top), `frame at opacity ${frame.opacity}: top ${frame.top} vs row ${before.triggerB.top}`).toBe(true);
      expect(
        near(frame.left, before.triggerB.right + GAP),
        `frame at opacity ${frame.opacity}: left ${frame.left} vs row right ${before.triggerB.right} + ${GAP}`,
      ).toBe(true);
    }
  });

  test("a coordinate open after an anchored one honours the coordinates and keeps no residual anchor", async ({ page }) => {
    const options = { ...CSS_AND_JS, expose: { ...CSS_AND_JS.expose, forgeAnchor: "./ui/client/popover-anchor" } };
    await twoSubmenus(page, options);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerA);

    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subA.top, box.triggerA.top);
      })
      .toBe(true);

    await page.evaluate(() => {
      (window as unknown as { forgeAnchor: typeof import("../client/popover-anchor") }).forgeAnchor.openPopoverAt(
        document.querySelector("#recent-menu") as HTMLElement,
        300,
        220,
      );
    });

    const box = await boxes(page, SELECTORS);
    expect({ top: box.subA.top, left: box.subA.left }).toEqual({ top: 220, left: 300 });

    const reopened = await page.evaluate(() => {
      const el = document.querySelector("#recent-menu") as HTMLElement;
      el.hidePopover();
      el.showPopover();
      const rect = el.getBoundingClientRect();
      return { anchor: el.style.getPropertyValue("position-anchor"), top: Math.round(rect.top), left: Math.round(rect.left) };
    });
    expect(reopened).toEqual({ anchor: "", top: 220, left: 300 });
  });

  test("re-opening from a different row unwinds the previous one, so at most one trigger is retained", async ({ page }) => {
    await twoSubmenus(page, CSS_AND_JS);
    await page.evaluate(() => {
      window.forgeScopeTeardown = window.forgeResume.resume();
    });
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerA);

    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subA.top, box.triggerA.top);
      })
      .toBe(true);

    const rebuilt = await render(Menu.SubmenuTrigger({ id: "recent-menu", children: "Recent again" }));
    await page.keyboard.press("Escape");
    await page.evaluate((html) => {
      document.querySelector('[commandfor="recent-menu"]')?.insertAdjacentHTML("beforebegin", html);
    }, rebuilt);
    await page.locator(SELECTORS.triggerA).first().click();

    const after = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('[commandfor="recent-menu"]')];
      const fresh = rows[0];
      const previous = rows[1];
      return {
        rows: rows.length,
        fresh: fresh?.style.getPropertyValue("anchor-name") ?? "",
        previousInline: previous?.style.getPropertyValue("anchor-name") ?? "",
        previousDeclared: previous ? getComputedStyle(previous).getPropertyValue("anchor-name") : "",
        popup: (document.querySelector("#recent-menu") as HTMLElement).style.getPropertyValue("position-anchor"),
      };
    });

    expect(after).toEqual({ rows: 2, fresh: "--forge-anchor-2", previousInline: "", previousDeclared: "none", popup: "--forge-anchor-2" });

    await page.evaluate(() => window.forgeScopeTeardown?.());
    const disposed = await page.evaluate(() => ({
      rows: [...document.querySelectorAll<HTMLElement>('[commandfor="recent-menu"]')].map((row) => row.style.getPropertyValue("anchor-name")),
      popup: (document.querySelector("#recent-menu") as HTMLElement).style.getPropertyValue("position-anchor"),
    }));
    expect(disposed).toEqual({ rows: ["", ""], popup: "" });
  });
});

test.describe("Menu — a composed trigger anchors both of its compounds", () => {
  test("a tooltip wrapping a menu trigger keeps both anchor names", async ({ page }) => {
    const trigger = Tooltip.Trigger({ id: "file", for: "file-tip", asChild: true, children: Menu.Trigger({ id: "file-menu", children: "File" }) });
    const popup = Menu.Popup({ id: "file-menu", children: [Menu.Item({ id: "new", for: false, children: "New" })] });
    const html = await render(
      Menu({ children: [Tooltip({ children: [trigger, Tooltip.Content({ id: "file-tip", children: "Open the File menu" })] }), popup] }),
    );
    await mount(page, `${FIXTURE_STYLE}${html}`, CSS_AND_JS);
    await page.evaluate(() => window.forgeResume.resume());

    const slot = await page.evaluate(() => document.querySelector("#file")?.getAttribute("data-slot"));
    expect(slot?.split(" ").sort()).toEqual(["menu-trigger", "tooltip-trigger"]);

    await page.hover("#file");
    await expect.poll(() => page.evaluate(() => document.querySelector("#file-tip")?.matches(":popover-open"))).toBe(true);

    const tipBox = await boxes(page, { trigger: "#file", tip: "#file-tip" });
    expect(near(tipBox.tip.bottom, tipBox.trigger.top - GAP), "the tooltip is centred — it lost its anchor to the menu rule").toBe(true);
    expect(near(tipBox.tip.left + tipBox.tip.width / 2, tipBox.trigger.left + tipBox.trigger.width / 2)).toBe(true);

    await page.click("#file");
    const menuBox = await boxes(page, { trigger: "#file", popup: "#file-menu" });
    expect(near(menuBox.popup.top, menuBox.trigger.bottom + GAP), "the menu lost its anchor to the tooltip rule").toBe(true);
    expect(near(menuBox.popup.left, menuBox.trigger.left)).toBe(true);
  });
});

const NAV_ICON = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16", "icon-hamburger": "0 0 22 22", "icon-close": "0 0 22 22" });

const NAV_CONFIG: NavDefinition = {
  sections: [{ items: [{ label: "File", items: [{ label: "Recent", items: [{ label: "Yesterday", href: "yesterday" }] }] }] }],
};

function renderNavbar(): Promise<string> {
  return render(Navbar({ config: NAV_CONFIG, resolveHref: (key: string) => `/${key}`, icon: NAV_ICON, id: "geo" }));
}

const CENTRED_TRIGGER = `<style>[data-slot~="menu-trigger"] { left: 595px; }</style>`;

const NO_FALLBACK_STYLE = `<style>[data-slot~="menu-popup"] { position-try-fallbacks: none; }</style>`;

function inDirection(dir: "ltr" | "rtl", html: string, extraStyle = ""): string {
  return `${FIXTURE_STYLE}${CENTRED_TRIGGER}${extraStyle}<div dir="${dir}">${html}</div>`;
}

const NAV = {
  trigger: '[data-slot~="menu-trigger"]',
  panel: "#navbar-menu-geo-0",
  row: '[data-slot~="menu-submenu-trigger"]',
  sub: "#navbar-menu-geo-1",
};

function revealBar(page: Page): Promise<void> {
  return page.evaluate(() => {
    (document.querySelector("details") as HTMLDetailsElement).open = true;
  });
}

function expectOnInlineEnd(dir: "ltr" | "rtl", sub: Box, anchor: Box): void {
  if (dir === "ltr") {
    expect(near(sub.left, anchor.right + GAP), `ltr: sub.left ${sub.left} vs anchor.right ${anchor.right} + ${GAP}`).toBe(true);
    return;
  }
  expect(near(sub.right, anchor.left - GAP), `rtl: sub.right ${sub.right} vs anchor.left ${anchor.left} - ${GAP}`).toBe(true);
}

test.describe("Menu — a logical side is resolved by CSS, not by the server", () => {
  test("one SSR string mounted under both directions reads data-side=inline-end in each", async ({ page }) => {
    const html = await renderNavbar();
    const observed: Record<string, { side: string | null; direction: string }> = {};

    for (const dir of ["ltr", "rtl"] as const) {
      await mount(page, inDirection(dir, html), CSS);
      observed[dir] = await page.evaluate(() => {
        const el = document.querySelector("#navbar-menu-geo-1") as HTMLElement;
        return { side: el.getAttribute("data-side"), direction: getComputedStyle(el).direction };
      });
    }

    expect(observed).toEqual({ ltr: { side: "inline-end", direction: "ltr" }, rtl: { side: "inline-end", direction: "rtl" } });
  });
});

test.describe("Menu — inline-end mirrors with the subtree direction, in CSS alone", () => {
  async function openNested(page: Page, dir: "ltr" | "rtl", html: string, extraStyle = ""): Promise<Record<keyof typeof NAV, Box>> {
    await mount(page, inDirection(dir, html, extraStyle), CSS);
    await revealBar(page);
    await page.click(NAV.trigger);
    await page.click(NAV.row);
    return boxes(page, NAV);
  }

  for (const dir of ["ltr", "rtl"] as const) {
    test(`dir=${dir}: the submenu opens on the panel's inline-end edge`, async ({ page }) => {
      const html = await renderNavbar();
      const box = await openNested(page, dir, html);

      expectOnInlineEnd(dir, box.sub, box.panel);
      expect(near(box.sub.top, box.panel.top), `${dir}: sub.top ${box.sub.top} vs panel.top ${box.panel.top}`).toBe(true);

      const control = await openNested(page, dir, html, NO_FALLBACK_STYLE);
      expect(control, `${dir}: a position-try fallback was supplying the placement`).toEqual(box);
    });
  }
});

test.describe("Menu — the key that opens a submenu and the edge it opens on agree", () => {
  const CSS_AND_CHROME_JS = { ...CSS_AND_JS, expose: { ...CSS_AND_JS.expose, forgeChromeClient: "./ui/chrome/client" } };

  const TOWARD = [
    { dir: "ltr", toward: "ArrowRight" },
    { dir: "rtl", toward: "ArrowLeft" },
  ] as const;

  for (const { dir, toward } of TOWARD) {
    test(`dir=${dir}: ${toward} opens the submenu, and the panel appears on that same edge`, async ({ page }) => {
      await mount(page, inDirection(dir, await renderNavbar()), CSS_AND_CHROME_JS);
      await revealBar(page);
      await page.evaluate(() => window.forgeResume.resume());
      await page.click(NAV.trigger);
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []))
        .toContain("menu-submenu-trigger");

      await page.keyboard.press(toward);

      await expect.poll(() => page.evaluate(() => document.querySelector("#navbar-menu-geo-1")?.matches(":popover-open") ?? false)).toBe(true);

      const box = await boxes(page, NAV);
      expectOnInlineEnd(dir, box.sub, box.row);
      expect(near(box.sub.top, box.row.top), `${dir}: sub.top ${box.sub.top} vs row.top ${box.row.top}`).toBe(true);
    });
  }
});
