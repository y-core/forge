/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import type { PageShell } from "../../app/types";
import { TURNSTILE_FIELD_DEFAULT } from "../../form/constants";
import { escapeHtml } from "../../http/escape";
import { attrOf, attrsOf } from "../core/core.fixture";
import { PAGE_ORDER, SHOWCASE_PAGES } from "./components";
import { registerShowcase, showcaseRoutes } from "./register";

// oxlint-disable-next-line typescript/no-explicit-any -- test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// oxlint-disable-next-line typescript/no-explicit-any -- test-only stub
const icon = StubIcon as any;

/** The app's own shell, recording the slot it was handed so every page render is held to it. */
const appShell: PageShell = (_c, content, slot) => (
  <html lang='en'>
    <body data-mount={slot.mount} data-page={slot.page} data-title={slot.meta.title} data-robots={slot.meta.robots}>
      {content}
    </body>
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
    expect(r.ui.turnstile.href()).toBe("/showcase/ui/turnstile");
    expect(r.ui.api.turnstileVerify.href()).toBe("/showcase/ui/api/turnstile-verify");
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
    app.setShell(appShell);
    const routes = showcaseRoutes("/showcase/ui");
    registerShowcase(app, routes.ui, { icon });
    return app;
  }

  it("wires every catalog page through the app's shell, each headed by its own prerequisite", async () => {
    const app = makeApp();
    for (const key of PAGE_ORDER) {
      const { slug, label, needs } = SHOWCASE_PAGES[key];
      const res = await app.request(slug === "" ? "/showcase/ui" : `/showcase/ui/${slug}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      const shell = attrsOf(body, `data-page="${key}"`);
      expect(shell["data-mount"]).toBe("showcase");
      expect(shell["data-title"]).toBe(label);
      expect(shell["data-robots"]).toBe("noindex");
      expect(body).toContain(`UI Component Showcase — ${label}`);
      // Escaped with forge's own escaper rather than a pattern of this test's: a page that emitted a
      // raw quote here would pass a hand-rolled comparison that made the same mistake.
      expect(body).toContain(escapeHtml(needs));
    }
  });

  it("wires the theme customiser through the same shell, defaulting every dial", async () => {
    const res = await makeApp().request("/showcase/ui/theme");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(attrsOf(body, 'data-page="theme"')).toMatchObject({ "data-mount": "showcase", "data-title": "Theme", "data-robots": "noindex" });
    expect(body).toContain("Theme customiser");
    expect(body).toContain("#646464");
  });

  it("reads every dial off the query string", async () => {
    const res = await makeApp().request("/showcase/ui/theme?gh=256&gc=45&ah=267&ac=195&r=4");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(attrOf(body, "value", 'name="grayHue"')).toBe("256");
    expect(attrOf(body, "value", 'name="grayChroma"')).toBe("45");
    expect(attrOf(body, "value", 'name="accentHue"')).toBe("267");
    expect(attrOf(body, "value", 'name="accentChroma"')).toBe("195");
    expect(attrOf(body, "value", 'name="radius"')).toBe("4");
  });

  it("clamps an out-of-range dial rather than rendering a scheme the sliders could not make", async () => {
    const res = await makeApp().request("/showcase/ui/theme?gc=99999&gh=abc");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(attrOf(body, "value", 'name="grayChroma"')).toBe("100");
    expect(attrOf(body, "value", 'name="grayHue"')).toBe("0");
  });

  it("answers the verify endpoint without a secret by saying so, rather than claiming a verification", async () => {
    const res = await makeApp().request("/showcase/ui/api/turnstile-verify", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-origin" },
      body: new FormData(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("No secret key is configured");
  });

  // The widget always posts its token, and with no secret configured nothing drops it before the
  // schema sees it: a strict object that had not declared it answered 422 and never reached `handle`.
  it("reaches the unconfigured verdict for the body the page really posts, token field and all", async () => {
    const body = new FormData();
    body.set(TURNSTILE_FIELD_DEFAULT, "a-widget-token");
    const res = await makeApp().request("/showcase/ui/api/turnstile-verify", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-origin" },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("No secret key is configured");
  });

  it("names the turnstile guard and its reason once a secret is configured", async () => {
    const app = new Forge();
    app.setShell(appShell);
    const routes = showcaseRoutes("/showcase/ui");
    registerShowcase(app, routes.ui, { icon, turnstileSecret: () => "secret" });
    const res = await app.request("/showcase/ui/api/turnstile-verify", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-origin" },
      body: new FormData(),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("No token reached the server");
  });

  it("still drops the token before validation once a secret is configured, so the guard is what judges it", async () => {
    const app = new Forge();
    app.setShell(appShell);
    const routes = showcaseRoutes("/showcase/ui");
    registerShowcase(app, routes.ui, { icon, turnstileSecret: () => "secret" });
    const body = new FormData();
    body.set(TURNSTILE_FIELD_DEFAULT, "a-widget-token");
    const res = await app.request("/showcase/ui/api/turnstile-verify", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" }, body });
    expect(res.status).toBe(422);
    expect(await res.text()).not.toContain("No secret key is configured");
  });

  it("refuses the verify endpoint a cross-site POST before the handler runs", async () => {
    const res = await makeApp().request("/showcase/ui/api/turnstile-verify", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "cross-site" },
      body: new FormData(),
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("refuses the verify endpoint a POST carrying no fetch metadata at all", async () => {
    const res = await makeApp().request("/showcase/ui/api/turnstile-verify", { method: "POST", body: new FormData() });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("refuses the verify endpoint a body the form pipeline was never meant to parse", async () => {
    const res = await makeApp().request("/showcase/ui/api/turnstile-verify", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(415);
    expect(await res.text()).toBe("Unsupported Media Type");
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
    ];
    for (const [path, marker] of cases) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(marker);
      // A fragment is swapped into a document that already exists, so the shell must never wrap one.
      expect(body).not.toContain("<html");
    }

    const avatar = await app.request("/showcase/ui/api/avatar");
    expect(avatar.status).toBe(200);
    const drawn = await avatar.text();
    expect(/^<([a-z]+)/.exec(drawn.trim())?.[1]).toBe("svg");
    expect(drawn).not.toContain("<html");
  });
});
