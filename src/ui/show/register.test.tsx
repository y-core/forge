/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import type { FC } from "../../jsx/types";
import { registerShowcase, showcaseRoutes } from "./register";

// Minimal icon compatible with ShowcaseIcon; renders nothing.
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
  it("derives the index href and six API hrefs from the default base", () => {
    const r = showcaseRoutes();
    expect(r.ui.index.href()).toBe("/showcase/ui");
    expect(r.ui.api.preview.href()).toBe("/showcase/ui/api/preview");
    expect(r.ui.api.validate.href()).toBe("/showcase/ui/api/validate");
    expect(r.ui.api.search.href()).toBe("/showcase/ui/api/search");
    expect(r.ui.api.paginate.href()).toBe("/showcase/ui/api/paginate");
    expect(r.ui.api.dependent.href()).toBe("/showcase/ui/api/dependent");
    expect(r.ui.api.toast.href()).toBe("/showcase/ui/api/toast");
  });

  it("honours a custom base path", () => {
    expect(showcaseRoutes("/demo").ui.index.href()).toBe("/demo");
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

  it("wires the index route wrapped in the consumer layout", async () => {
    const res = await makeApp().request("/showcase/ui");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('data-ctx="chrome"');
    expect(body).toContain("UI Component Showcase");
  });

  it("wires each of the six HTMX API sub-routes", async () => {
    const app = makeApp();
    const cases: [string, string][] = [
      ["/showcase/ui/api/preview", "show-preview-button"],
      ["/showcase/ui/api/validate", "show-validate-field"],
      ["/showcase/ui/api/search?q=Button", "show-search-results"],
      ["/showcase/ui/api/paginate?page=1", "show-paginate-table"],
      ["/showcase/ui/api/dependent?category=fruit", "show-dependent-select"],
      ["/showcase/ui/api/toast?type=success", "flash-container"],
    ];
    for (const [path, marker] of cases) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(marker);
    }
  });
});
