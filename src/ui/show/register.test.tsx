/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import type { FC } from "../../jsx/types";
import { PAGE_ORDER, SHOWCASE_PAGES } from "./components";
import { registerShowcase, showcaseRoutes } from "./register";

// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

const Layout: FC<{ ctx: { title: string } }> = ({ ctx, children }) => (
  <html lang='en'>
    <body data-ctx={ctx.title}>{children}</body>
  </html>
);

describe("showcaseRoutes", () => {
  it("registers exactly one route per catalog page, plus the theme customiser", () => {
    const { api, ...pages } = showcaseRoutes().ui;
    expect(api).toBeDefined();
    expect(Object.keys(pages).sort()).toEqual([...PAGE_ORDER, "theme"].sort());
  });

  it("derives a href per page from the default base, from the page's own slug", () => {
    const r = showcaseRoutes();
    expect(r.ui.index.href()).toBe("/showcase/ui");
    expect(r.ui.interactive.href()).toBe(`/showcase/ui/${SHOWCASE_PAGES.interactive.slug}`);
    expect(r.ui.runtime.href()).toBe(`/showcase/ui/${SHOWCASE_PAGES.runtime.slug}`);
    expect(r.ui.htmx.href()).toBe(`/showcase/ui/${SHOWCASE_PAGES.htmx.slug}`);
    expect(r.ui.chrome.href()).toBe(`/showcase/ui/${SHOWCASE_PAGES.chrome.slug}`);
    expect(r.ui.theme.href()).toBe("/showcase/ui/theme");
    expect(r.ui.api.preview.href()).toBe("/showcase/ui/api/preview");
    expect(r.ui.api.validate.href()).toBe("/showcase/ui/api/validate");
    expect(r.ui.api.search.href()).toBe("/showcase/ui/api/search");
    expect(r.ui.api.paginate.href()).toBe("/showcase/ui/api/paginate");
    expect(r.ui.api.dependent.href()).toBe("/showcase/ui/api/dependent");
    expect(r.ui.api.toast.href()).toBe("/showcase/ui/api/toast");
    expect(r.ui.api.avatar.href()).toBe("/showcase/ui/api/avatar");
  });

  it("honours a custom base path", () => {
    expect(showcaseRoutes("/demo").ui.index.href()).toBe("/demo");
    expect(showcaseRoutes("/demo").ui.theme.href()).toBe("/demo/theme");
    expect(showcaseRoutes("/demo").ui.api.search.href()).toBe("/demo/api/search");
  });
});

describe("registerShowcase", () => {
  function makeApp() {
    const app = new Forge();
    const routes = showcaseRoutes("/showcase/ui");
    registerShowcase(app, routes.ui, { icon, context: async () => ({ title: "chrome" }), layout: Layout });
    return app;
  }

  it("wires every catalog page in the consumer layout, each headed by its own prerequisite", async () => {
    const app = makeApp();
    for (const key of PAGE_ORDER) {
      const { slug, label, needs } = SHOWCASE_PAGES[key];
      const res = await app.request(slug === "" ? "/showcase/ui" : `/showcase/ui/${slug}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('data-ctx="chrome"');
      expect(body).toContain(`UI Component Showcase — ${label}`);
      expect(body).toContain(needs.replace(/"/g, "&quot;"));
    }
  });

  it("wires the theme customiser in the same layout, defaulting every dial", async () => {
    const res = await makeApp().request("/showcase/ui/theme");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('data-ctx="chrome"');
    expect(body).toContain("Theme customiser");
    expect(body).toContain("#646464");
  });

  it("reads every dial off the query string", async () => {
    const res = await makeApp().request("/showcase/ui/theme?gh=256&gc=45&ah=267&ac=195&r=4");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("#53667e");
    expect(body).toContain("4px");
  });

  it("clamps an out-of-range dial rather than rendering a scheme the sliders could not make", async () => {
    const res = await makeApp().request("/showcase/ui/theme?gc=99999&gh=abc");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(">100</output>");
    expect(body).toContain("0°");
  });

  it("wires each of the seven API sub-routes", async () => {
    const app = makeApp();
    const cases: [string, string][] = [
      ["/showcase/ui/api/preview", "show-preview-button"],
      ["/showcase/ui/api/validate", "show-validate-field"],
      ["/showcase/ui/api/search?q=Button", "show-search-results"],
      ["/showcase/ui/api/paginate?page=1", "show-paginate-table"],
      ["/showcase/ui/api/dependent?category=fruit", "show-dependent-select"],
      ["/showcase/ui/api/toast?type=success", "flash-container"],
      ["/showcase/ui/api/avatar", "<svg"],
    ];
    for (const [path, marker] of cases) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(marker);
    }
  });
});
