import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { definePage } from "../../app/page";
import { mapHandler } from "../../testing/route";
import { createIcon } from "../core/icon";
import {
  loadDependent,
  loadPaginate,
  loadPreview,
  loadSearch,
  loadShowcase,
  loadToast,
  loadValidate,
  renderAvatar,
  renderDependent,
  renderPaginate,
  renderPreview,
  renderSearch,
  renderToast,
  renderTurnstileVerdict,
  renderValidate,
  showcasePaths,
} from "./route";

// oxlint-disable-next-line typescript/no-explicit-any -- test-only stub
const StubIcon = (_props: any) => null as any;
StubIcon.sprite = "/icons.svg";
// oxlint-disable-next-line typescript/no-explicit-any -- test-only stub
const icon = StubIcon as any;

function makeApp() {
  const app = new Forge();
  const handler = definePage({ loader: (c) => loadShowcase(c), view: (_c, _config, state) => Response.json(state.data) });
  mapHandler(app, "GET", "/showcase", handler);
  return app;
}

describe("loadShowcase", () => {
  it("returns paths derived from the default base path", async () => {
    const app = makeApp();
    const res = await app.request("/showcase");
    const data = await res.json();
    expect(data.paths.page).toBe("/showcase");
    expect(data.paths.search).toBe("/showcase/search");
    expect(data.paths.preview).toBe("/showcase/preview");
    expect(data.paths.validate).toBe("/showcase/validate");
    expect(data.paths.paginate).toBe("/showcase/paginate");
    expect(data.paths.dependent).toBe("/showcase/dependent");
    expect(data.paths.toast).toBe("/showcase/toast");
    expect(data.paths.avatar).toBe("/showcase/avatar");
  });

  it("honours a custom basePath option", async () => {
    const app = new Forge();
    const handler = definePage({ loader: (c) => loadShowcase(c, { basePath: "/demo" }), view: (_c, _config, state) => Response.json(state.data) });
    mapHandler(app, "GET", "/demo", handler);
    const res = await app.request("/demo");
    const data = await res.json();
    expect(data.paths.page).toBe("/demo");
    expect(data.paths.search).toBe("/demo/search");
  });
});

describe("loadPreview", () => {
  function makePreviewApp() {
    const app = new Forge();
    const handler = definePage({ loader: (c) => loadPreview(c), view: (_c, _config, state) => Response.json(state.data) });
    mapHandler(app, "GET", "/preview", handler);
    return app;
  }

  it("defaults tone to primary, appearance to solid and size to md", async () => {
    const data = await makePreviewApp()
      .request("/preview")
      .then((r) => r.json());
    expect(data.tone).toBe("primary");
    expect(data.appearance).toBe("solid");
    expect(data.size).toBe("md");
  });

  it("reflects tone, appearance and size query params", async () => {
    const data = await makePreviewApp()
      .request("/preview?tone=neutral&appearance=ghost&size=lg")
      .then((r) => r.json());
    expect(data.tone).toBe("neutral");
    expect(data.appearance).toBe("ghost");
    expect(data.size).toBe("lg");
  });
});

describe("renderPreview", () => {
  it("returns 200 with text/html content-type", async () => {
    const res = await renderPreview({ tone: "primary", appearance: "solid", size: "md" }, icon);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("body contains the preview wrapper id", async () => {
    const res = await renderPreview({ tone: "neutral", appearance: "outline", size: "sm" }, icon);
    const body = await res.text();
    expect(body).toBe(
      '<div id="show-preview-button" class="flex items-center justify-center rounded-box border border-border bg-muted p-8"><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] bg-transparent [--focus-ring:var(--color-ring)] border-input text-foreground hover:bg-accent hover:text-accent-foreground">Preview</button></div>',
    );
  });
});

describe("loadValidate", () => {
  const paths = showcasePaths("/showcase");

  function makeValidateApp() {
    const app = new Forge();
    const handler = definePage({ loader: (c) => loadValidate(c, paths), view: (_c, _config, state) => Response.json(state.data) });
    mapHandler(app, "GET", "/validate", handler);
    return app;
  }

  it("defaults email to empty string", async () => {
    const data = await makeValidateApp()
      .request("/validate")
      .then((r) => r.json());
    expect(data.email).toBe("");
  });

  it("reflects email query param", async () => {
    const data = await makeValidateApp()
      .request("/validate?email=user%40example.com")
      .then((r) => r.json());
    expect(data.email).toBe("user@example.com");
  });
});

describe("renderValidate", () => {
  const paths = showcasePaths("/showcase");
  const errorIcon = createIcon("/sprite.svg", { "icon-close": "0 0 24 24" });

  it("returns 200 with text/html", async () => {
    const res = await renderValidate({ email: "", paths }, errorIcon);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("body contains the validate field id", async () => {
    const res = await renderValidate({ email: "", paths }, errorIcon);
    const body = await res.text();
    expect(body).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive-text flex-col [&amp;&gt;*]:w-full" id="show-validate-field"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm leading-snug font-medium text-foreground group-data-[disabled]/field:opacity-50" for="field-email">Email</label><input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" type="email" name="email" placeholder="you@example.com" value="" hx-get="/showcase/validate" hx-target="#show-validate-field" hx-swap="outerHTML" hx-trigger="change delay:200ms, blur" hx-sync="this:abort" id="field-email"></fieldset>',
    );
  });

  it("shows error message for invalid email", async () => {
    const res = await renderValidate({ email: "not-valid", paths }, errorIcon);
    const body = await res.text();
    expect(body).toBe(
      '<fieldset data-slot="field" data-invalid="" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive-text flex-col [&amp;&gt;*]:w-full" id="show-validate-field"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm leading-snug font-medium text-foreground group-data-[disabled]/field:opacity-50" for="field-email">Email</label><input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" type="email" name="email" placeholder="you@example.com" value="not-valid" hx-get="/showcase/validate" hx-target="#show-validate-field" hx-swap="outerHTML" hx-trigger="change delay:200ms, blur" hx-sync="this:abort" id="field-email" aria-describedby="field-email-error" aria-invalid="true"><p data-slot="field-error" class="text-sm font-normal text-destructive-text" id="field-email-error" role="alert"><svg data-slot="icon" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg>Please enter a valid email address.</p></fieldset>',
    );
  });

  it("shows success message for valid email", async () => {
    const res = await renderValidate({ email: "user@example.com", paths }, errorIcon);
    const body = await res.text();
    expect(body).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive-text flex-col [&amp;&gt;*]:w-full" id="show-validate-field"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm leading-snug font-medium text-foreground group-data-[disabled]/field:opacity-50" for="field-email">Email</label><input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" type="email" name="email" placeholder="you@example.com" value="user@example.com" hx-get="/showcase/validate" hx-target="#show-validate-field" hx-swap="outerHTML" hx-trigger="change delay:200ms, blur" hx-sync="this:abort" id="field-email" aria-describedby="field-email-description"><p data-slot="field-description" class="text-sm leading-normal text-success-text" id="field-email-description">Looks good!</p></fieldset>',
    );
  });
});

describe("loadSearch", () => {
  function makeSearchApp() {
    const app = new Forge();
    const handler = definePage({ loader: (c) => loadSearch(c), view: (_c, _config, state) => Response.json(state.data) });
    mapHandler(app, "GET", "/search", handler);
    return app;
  }

  it("defaults q to empty string", async () => {
    const data = await makeSearchApp()
      .request("/search")
      .then((r) => r.json());
    expect(data.q).toBe("");
  });

  it("reflects q query param", async () => {
    const data = await makeSearchApp()
      .request("/search?q=Alert")
      .then((r) => r.json());
    expect(data.q).toBe("Alert");
  });
});

describe("renderSearch", () => {
  it("returns 200 with text/html", async () => {
    const res = await renderSearch({ q: "" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("body contains the search results id", async () => {
    const res = await renderSearch({ q: "" });
    const body = await res.text();
    expect(body).toBe(
      '<ul id="show-search-results" class="grid grid-cols-2 gap-2 sm:grid-cols-3"><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Alert</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Avatar</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Badge</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Button</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Card</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Field</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Form</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Icon</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Input</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Label</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Popover</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Progress</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Select</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Separator</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Skeleton</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Spinner</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Textarea</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Toast</li><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">ToggleGroup</li></ul>',
    );
  });

  it("filters results by query", async () => {
    const res = await renderSearch({ q: "button" });
    const body = await res.text();
    expect(body).toBe(
      '<ul id="show-search-results" class="grid grid-cols-2 gap-2 sm:grid-cols-3"><li class="rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">Button</li></ul>',
    );
  });

  it("shows no-match message for unrecognised query", async () => {
    const res = await renderSearch({ q: "zzznomatch" });
    const body = await res.text();
    expect(body).toBe(
      '<ul id="show-search-results" class="grid grid-cols-2 gap-2 sm:grid-cols-3"><li class="col-span-3 py-4 text-center text-sm text-muted-foreground">No components match.</li></ul>',
    );
  });
});

describe("loadPaginate", () => {
  const paths = showcasePaths("/showcase");

  function makePaginateApp() {
    const app = new Forge();
    const handler = definePage({ loader: (c) => loadPaginate(c, paths), view: (_c, _config, state) => Response.json(state.data) });
    mapHandler(app, "GET", "/paginate", handler);
    return app;
  }

  it("defaults page to 1", async () => {
    const data = await makePaginateApp()
      .request("/paginate")
      .then((r) => r.json());
    expect(data.page).toBe(1);
  });

  it("reflects page query param", async () => {
    const data = await makePaginateApp()
      .request("/paginate?page=2")
      .then((r) => r.json());
    expect(data.page).toBe(2);
  });

  it("clamps page to minimum 1", async () => {
    const data = await makePaginateApp()
      .request("/paginate?page=0")
      .then((r) => r.json());
    expect(data.page).toBe(1);
  });

  // `Math.max` propagates NaN, so an unparseable page used to reach the view: an empty tbody, both
  // pager buttons hidden, and "Page NaN of 4" printed on the page.
  it("falls back to 1 for a page the query string does not parse as a number", async () => {
    for (const raw of ["abc", "", "NaN", "%20", "e5"]) {
      const data = await makePaginateApp()
        .request(`/paginate?page=${raw}`)
        .then((r) => r.json());
      expect(data.page).toBe(1);
    }
  });
});

describe("renderPaginate", () => {
  const paths = showcasePaths("/showcase");

  it("returns 200 with text/html", async () => {
    const res = await renderPaginate({ page: 1, paths });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("body contains the paginate id", async () => {
    const res = await renderPaginate({ page: 1, paths });
    const body = await res.text();
    expect(body).toBe(
      '<div id="show-paginate-table"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-border text-start text-xs font-semibold tracking-wide text-muted-foreground uppercase"><th class="py-2 ps-4 pe-4">#</th><th class="py-2 pe-4">Component</th><th class="py-2 pe-4">Category</th></tr></thead><tbody><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">1</td><td class="py-2 pe-4 font-medium text-foreground">Alert</td><td class="py-2 pe-4 text-muted-foreground">Feedback</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">2</td><td class="py-2 pe-4 font-medium text-foreground">Avatar</td><td class="py-2 pe-4 text-muted-foreground">Display</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">3</td><td class="py-2 pe-4 font-medium text-foreground">Badge</td><td class="py-2 pe-4 text-muted-foreground">Display</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">4</td><td class="py-2 pe-4 font-medium text-foreground">Button</td><td class="py-2 pe-4 text-muted-foreground">Action</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">5</td><td class="py-2 pe-4 font-medium text-foreground">Card</td><td class="py-2 pe-4 text-muted-foreground">Layout</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">6</td><td class="py-2 pe-4 font-medium text-foreground">Field</td><td class="py-2 pe-4 text-muted-foreground">Form</td></tr></tbody></table><div class="flex items-center justify-between border-t border-border px-4 py-3"><span class="text-xs text-muted-foreground">Page 1 of 4</span><div class="flex gap-2"><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] bg-transparent [--focus-ring:var(--color-ring)] border-input text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/showcase/paginate?page=2" hx-target="#show-paginate-table" hx-swap="outerHTML">Next</button></div></div></div>',
    );
  });

  it("Next button is present on page 1", async () => {
    const res = await renderPaginate({ page: 1, paths });
    const body = await res.text();
    expect(body).toBe(
      '<div id="show-paginate-table"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-border text-start text-xs font-semibold tracking-wide text-muted-foreground uppercase"><th class="py-2 ps-4 pe-4">#</th><th class="py-2 pe-4">Component</th><th class="py-2 pe-4">Category</th></tr></thead><tbody><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">1</td><td class="py-2 pe-4 font-medium text-foreground">Alert</td><td class="py-2 pe-4 text-muted-foreground">Feedback</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">2</td><td class="py-2 pe-4 font-medium text-foreground">Avatar</td><td class="py-2 pe-4 text-muted-foreground">Display</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">3</td><td class="py-2 pe-4 font-medium text-foreground">Badge</td><td class="py-2 pe-4 text-muted-foreground">Display</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">4</td><td class="py-2 pe-4 font-medium text-foreground">Button</td><td class="py-2 pe-4 text-muted-foreground">Action</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">5</td><td class="py-2 pe-4 font-medium text-foreground">Card</td><td class="py-2 pe-4 text-muted-foreground">Layout</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">6</td><td class="py-2 pe-4 font-medium text-foreground">Field</td><td class="py-2 pe-4 text-muted-foreground">Form</td></tr></tbody></table><div class="flex items-center justify-between border-t border-border px-4 py-3"><span class="text-xs text-muted-foreground">Page 1 of 4</span><div class="flex gap-2"><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] bg-transparent [--focus-ring:var(--color-ring)] border-input text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/showcase/paginate?page=2" hx-target="#show-paginate-table" hx-swap="outerHTML">Next</button></div></div></div>',
    );
  });

  it("Previous button is present on page 2", async () => {
    const res = await renderPaginate({ page: 2, paths });
    const body = await res.text();
    expect(body).toBe(
      '<div id="show-paginate-table"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-border text-start text-xs font-semibold tracking-wide text-muted-foreground uppercase"><th class="py-2 ps-4 pe-4">#</th><th class="py-2 pe-4">Component</th><th class="py-2 pe-4">Category</th></tr></thead><tbody><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">7</td><td class="py-2 pe-4 font-medium text-foreground">Form</td><td class="py-2 pe-4 text-muted-foreground">Form</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">8</td><td class="py-2 pe-4 font-medium text-foreground">Icon</td><td class="py-2 pe-4 text-muted-foreground">Display</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">9</td><td class="py-2 pe-4 font-medium text-foreground">Input</td><td class="py-2 pe-4 text-muted-foreground">Form</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">10</td><td class="py-2 pe-4 font-medium text-foreground">Label</td><td class="py-2 pe-4 text-muted-foreground">Form</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">11</td><td class="py-2 pe-4 font-medium text-foreground">Popover</td><td class="py-2 pe-4 text-muted-foreground">Overlay</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs text-muted-foreground">12</td><td class="py-2 pe-4 font-medium text-foreground">Progress</td><td class="py-2 pe-4 text-muted-foreground">Feedback</td></tr></tbody></table><div class="flex items-center justify-between border-t border-border px-4 py-3"><span class="text-xs text-muted-foreground">Page 2 of 4</span><div class="flex gap-2"><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] bg-transparent [--focus-ring:var(--color-ring)] border-input text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/showcase/paginate?page=1" hx-target="#show-paginate-table" hx-swap="outerHTML">Previous</button><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] bg-transparent [--focus-ring:var(--color-ring)] border-input text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/showcase/paginate?page=3" hx-target="#show-paginate-table" hx-swap="outerHTML">Next</button></div></div></div>',
    );
  });
});

describe("loadDependent", () => {
  function makeDependentApp() {
    const app = new Forge();
    const handler = definePage({ loader: (c) => loadDependent(c), view: (_c, _config, state) => Response.json(state.data) });
    mapHandler(app, "GET", "/dependent", handler);
    return app;
  }

  it("defaults category to fruit", async () => {
    const data = await makeDependentApp()
      .request("/dependent")
      .then((r) => r.json());
    expect(data.category).toBe("fruit");
  });

  it("reflects category query param", async () => {
    const data = await makeDependentApp()
      .request("/dependent?category=vegetable")
      .then((r) => r.json());
    expect(data.category).toBe("vegetable");
  });
});

describe("renderDependent", () => {
  it("returns 200 with text/html", async () => {
    const res = await renderDependent({ category: "fruit" }, icon);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("renders fruit options for fruit category", async () => {
    const res = await renderDependent({ category: "fruit" }, icon);
    const body = await res.text();
    expect(body).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full data-[invalid]:text-destructive-text flex-col [&amp;&gt;*]:w-full gap-1.5" id="show-dependent-select"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm leading-snug font-medium text-foreground group-data-[disabled]/field:opacity-50" for="dependent-item">Item</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm" id="dependent-item" name="item"><option data-slot="select-option" value="apple">Apple</option><option data-slot="select-option" value="banana">Banana</option><option data-slot="select-option" value="cherry">Cherry</option><option data-slot="select-option" value="mango">Mango</option><option data-slot="select-option" value="papaya">Papaya</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"></span></div></fieldset>',
    );
  });

  it("renders vegetable options for vegetable category", async () => {
    const res = await renderDependent({ category: "vegetable" }, icon);
    const body = await res.text();
    expect(body).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full data-[invalid]:text-destructive-text flex-col [&amp;&gt;*]:w-full gap-1.5" id="show-dependent-select"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm leading-snug font-medium text-foreground group-data-[disabled]/field:opacity-50" for="dependent-item">Item</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm" id="dependent-item" name="item"><option data-slot="select-option" value="broccoli">Broccoli</option><option data-slot="select-option" value="carrot">Carrot</option><option data-slot="select-option" value="celery">Celery</option><option data-slot="select-option" value="kale">Kale</option><option data-slot="select-option" value="spinach">Spinach</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"></span></div></fieldset>',
    );
  });
});

describe("loadToast", () => {
  function makeToastApp() {
    const app = new Forge();
    const handler = definePage({ loader: (c) => loadToast(c), view: (_c, _config, state) => Response.json(state.data) });
    mapHandler(app, "GET", "/toast", handler);
    return app;
  }

  it("defaults type to success", async () => {
    const data = await makeToastApp()
      .request("/toast")
      .then((r) => r.json());
    expect(data.type).toBe("success");
  });

  it("reflects type query param", async () => {
    const data = await makeToastApp()
      .request("/toast?type=error")
      .then((r) => r.json());
    expect(data.type).toBe("error");
  });
});

describe("renderToast", () => {
  it("returns 200 with text/html", async () => {
    const res = await renderToast({ type: "success" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("body contains hx-swap-oob targeting #flash-container", async () => {
    const res = await renderToast({ type: "success" });
    const body = await res.text();
    expect(body).toBe(
      '<div hx-swap-oob="beforeend:#flash-container"><div data-slot="toast" data-tone="success" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-title" class="text-sm leading-none font-semibold">Success</div><div data-slot="toast-description" class="text-sm opacity-90">This is a success toast notification.</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div></div>',
    );
  });

  it("body contains the toast message text for error type", async () => {
    const res = await renderToast({ type: "error" });
    const body = await res.text();
    expect(body).toBe(
      '<div hx-swap-oob="beforeend:#flash-container"><div data-slot="toast" data-tone="destructive" data-appearance="soft" data-scope="toast" data-island-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 shadow-lg [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] pe-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-title" class="text-sm leading-none font-semibold">Error</div><div data-slot="toast-description" class="text-sm opacity-90">This is a error toast notification.</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div></div>',
    );
  });
});

describe("renderTurnstileVerdict", () => {
  const ALERT_BASE = "relative grid gap-1.5 rounded-box border-field py-3 ps-4 pe-4 text-sm";
  const TITLE_CLASS = "leading-none font-medium tracking-tight";
  const DESCRIPTION_CLASS = "text-sm leading-relaxed text-pretty opacity-90";

  it("renders the warning alert with 200 when no secret key is configured", async () => {
    const res = await renderTurnstileVerdict({ kind: "unconfigured" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(
      `<div data-slot="alert" data-tone="warning" data-appearance="soft" class="${ALERT_BASE} [--tone:var(--color-warning)] [--tone-fg:var(--color-warning-foreground)] [--tone-text:var(--color-warning-text)] [--tone-soft:var(--color-status-warning-subtle)] [--tone-soft-fg:var(--color-status-warning-subtle-foreground)] [--tone-soft-border:var(--color-status-warning-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]"><div data-slot="alert-title" class="${TITLE_CLASS}">No secret key is configured</div><div data-slot="alert-description" class="${DESCRIPTION_CLASS}">The form reached the action, but \`registerShowcase\` was given no \`turnstileSecret\`, so nothing was sent to siteverify.</div></div>`,
    );
  });

  it("renders the success alert with 200 and names the field the token arrived in", async () => {
    const res = await renderTurnstileVerdict({ kind: "verified" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(
      `<div data-slot="alert" data-tone="success" data-appearance="soft" class="${ALERT_BASE} [--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] [--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]"><div data-slot="alert-title" class="${TITLE_CLASS}">Verified</div><div data-slot="alert-description" class="${DESCRIPTION_CLASS}">The token in \`cf-turnstile-response\` passed siteverify and was dropped before validation, so the handler never sees it.</div></div>`,
    );
  });

  const refusal = (title: string, description: string) =>
    `<div data-slot="alert" data-tone="destructive" data-appearance="soft" class="${ALERT_BASE} [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]"><div data-slot="alert-title" class="${TITLE_CLASS}">${title}</div><div data-slot="alert-description" class="${DESCRIPTION_CLASS}">${description}</div></div>`;

  it("renders 422 and the reason's own copy for a failure the panel has wording for", async () => {
    const res = await renderTurnstileVerdict({ kind: "rejected", guard: "turnstile", reason: "missing-token" });
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(
      refusal("Refused by the turnstile guard", "No token reached the server — the widget never ran, or its hidden field was stripped."),
    );
  });

  it("renders 422 and the generic copy for a failure the panel has no wording for", async () => {
    const res = await renderTurnstileVerdict({ kind: "rejected", guard: "turnstile", reason: "cdata-mismatch" });
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(refusal("Refused by the turnstile guard", "Verification failed."));
  });
});

describe("renderAvatar", () => {
  it("serves the portrait as SVG with no cache header, so nothing is fetched remotely", async () => {
    const res = renderAvatar();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe(null);
    expect(await res.text()).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Portrait"><rect width="64" height="64" fill="#6d8bb8"/><circle cx="32" cy="24" r="12" fill="#f2e2d2"/><path d="M8 64a24 24 0 0 1 48 0Z" fill="#f2e2d2"/></svg>',
    );
  });
});
