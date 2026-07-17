import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { definePage } from "../../app/page";
import { mapHandler } from "../../app/route-test-helper";
import {
  loadDependent,
  loadPaginate,
  loadPreview,
  loadSearch,
  loadShowcase,
  loadToast,
  loadValidate,
  renderDependent,
  renderPaginate,
  renderPreview,
  renderSearch,
  renderToast,
  renderValidate,
  showcasePaths,
} from "./route";

// ─── Stub icon ────────────────────────────────────────────────────────────────
// A minimal icon compatible with ForgeIcon<"spinner"|"chevron-down"|"sun"|"moon"|"monitor">
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = (_props: any) => null as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

// ─── loadShowcase ─────────────────────────────────────────────────────────────

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

// ─── loadPreview ─────────────────────────────────────────────────────────────

describe("loadPreview", () => {
  function makePreviewApp() {
    const app = new Forge();
    const handler = definePage({ loader: (c) => loadPreview(c), view: (_c, _config, state) => Response.json(state.data) });
    mapHandler(app, "GET", "/preview", handler);
    return app;
  }

  it("defaults variant to primary and size to md", async () => {
    const data = await makePreviewApp()
      .request("/preview")
      .then((r) => r.json());
    expect(data.variant).toBe("primary");
    expect(data.size).toBe("md");
  });

  it("reflects variant and size query params", async () => {
    const data = await makePreviewApp()
      .request("/preview?variant=ghost&size=lg")
      .then((r) => r.json());
    expect(data.variant).toBe("ghost");
    expect(data.size).toBe("lg");
  });
});

// ─── renderPreview ────────────────────────────────────────────────────────────

describe("renderPreview", () => {
  it("returns 200 with text/html content-type", async () => {
    const res = await renderPreview({ variant: "primary", size: "md" }, icon);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("body contains the preview wrapper id", async () => {
    const res = await renderPreview({ variant: "secondary", size: "sm" }, icon);
    const body = await res.text();
    expect(body).toBe(
      '<div id="show-preview-button" class="flex items-center justify-center rounded-xl border border-border bg-muted p-8"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-8 px-3 text-sm">Preview</button></div>',
    );
  });
});

// ─── loadValidate ─────────────────────────────────────────────────────────────

describe("loadValidate", () => {
  function makeValidateApp() {
    const app = new Forge();
    const handler = definePage({ loader: (c) => loadValidate(c), view: (_c, _config, state) => Response.json(state.data) });
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

// ─── renderValidate ───────────────────────────────────────────────────────────

describe("renderValidate", () => {
  it("returns 200 with text/html", async () => {
    const res = await renderValidate({ email: "" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("body contains the validate field id", async () => {
    const res = await renderValidate({ email: "" });
    const body = await res.text();
    expect(body).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full" id="show-validate-field"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-email">Email</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" type="email" name="email" placeholder="you@example.com" value="" id="field-email" aria-describedby="field-email-description"></fieldset>',
    );
  });

  it("shows error message for invalid email", async () => {
    const res = await renderValidate({ email: "not-valid" });
    const body = await res.text();
    expect(body).toBe(
      '<fieldset data-slot="field" data-invalid="true" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full" id="show-validate-field"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-email">Email</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" type="email" name="email" placeholder="you@example.com" value="not-valid" id="field-email" aria-describedby="field-email-description field-email-error" aria-invalid="true"><p data-slot="field-error" class="text-sm font-normal text-red-600" id="field-email-error" role="alert">Please enter a valid email address.</p></fieldset>',
    );
  });

  it("shows success message for valid email", async () => {
    const res = await renderValidate({ email: "user@example.com" });
    const body = await res.text();
    expect(body).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full" id="show-validate-field"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-email">Email</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" type="email" name="email" placeholder="you@example.com" value="user@example.com" id="field-email" aria-describedby="field-email-description"><p data-slot="field-description" class="text-sm leading-normal text-muted-foreground text-emerald-600" id="field-email-description">Looks good!</p></fieldset>',
    );
  });
});

// ─── loadSearch ───────────────────────────────────────────────────────────────

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

// ─── renderSearch ─────────────────────────────────────────────────────────────

describe("renderSearch", () => {
  it("returns 200 with text/html", async () => {
    const res = await renderSearch({ q: "" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
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

// ─── loadPaginate ─────────────────────────────────────────────────────────────

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
});

// ─── renderPaginate ───────────────────────────────────────────────────────────

describe("renderPaginate", () => {
  const paths = showcasePaths("/showcase");

  it("returns 200 with text/html", async () => {
    const res = await renderPaginate({ page: 1, paths });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("body contains the paginate id", async () => {
    const res = await renderPaginate({ page: 1, paths });
    const body = await res.text();
    expect(body).toBe(
      '<div id="show-paginate-table"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"><th class="py-2 pl-4 pr-4">#</th><th class="py-2 pr-4">Component</th><th class="py-2 pr-4">Category</th></tr></thead><tbody><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">1</td><td class="py-2 pr-4 font-medium text-foreground">Alert</td><td class="py-2 pr-4 text-muted-foreground">Feedback</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">2</td><td class="py-2 pr-4 font-medium text-foreground">Avatar</td><td class="py-2 pr-4 text-muted-foreground">Display</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">3</td><td class="py-2 pr-4 font-medium text-foreground">Badge</td><td class="py-2 pr-4 text-muted-foreground">Display</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">4</td><td class="py-2 pr-4 font-medium text-foreground">Button</td><td class="py-2 pr-4 text-muted-foreground">Action</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">5</td><td class="py-2 pr-4 font-medium text-foreground">Card</td><td class="py-2 pr-4 text-muted-foreground">Layout</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">6</td><td class="py-2 pr-4 font-medium text-foreground">Field</td><td class="py-2 pr-4 text-muted-foreground">Form</td></tr></tbody></table><div class="flex items-center justify-between border-t border-border px-4 py-3"><span class="text-xs text-muted-foreground">Page 1 of 4</span><div class="flex gap-2"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/showcase/paginate?page=2" hx-target="#show-paginate-table" hx-swap="outerHTML">Next</button></div></div></div>',
    );
  });

  it("Next button is present on page 1", async () => {
    const res = await renderPaginate({ page: 1, paths });
    const body = await res.text();
    expect(body).toBe(
      '<div id="show-paginate-table"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"><th class="py-2 pl-4 pr-4">#</th><th class="py-2 pr-4">Component</th><th class="py-2 pr-4">Category</th></tr></thead><tbody><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">1</td><td class="py-2 pr-4 font-medium text-foreground">Alert</td><td class="py-2 pr-4 text-muted-foreground">Feedback</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">2</td><td class="py-2 pr-4 font-medium text-foreground">Avatar</td><td class="py-2 pr-4 text-muted-foreground">Display</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">3</td><td class="py-2 pr-4 font-medium text-foreground">Badge</td><td class="py-2 pr-4 text-muted-foreground">Display</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">4</td><td class="py-2 pr-4 font-medium text-foreground">Button</td><td class="py-2 pr-4 text-muted-foreground">Action</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">5</td><td class="py-2 pr-4 font-medium text-foreground">Card</td><td class="py-2 pr-4 text-muted-foreground">Layout</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">6</td><td class="py-2 pr-4 font-medium text-foreground">Field</td><td class="py-2 pr-4 text-muted-foreground">Form</td></tr></tbody></table><div class="flex items-center justify-between border-t border-border px-4 py-3"><span class="text-xs text-muted-foreground">Page 1 of 4</span><div class="flex gap-2"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/showcase/paginate?page=2" hx-target="#show-paginate-table" hx-swap="outerHTML">Next</button></div></div></div>',
    );
  });

  it("Previous button is present on page 2", async () => {
    const res = await renderPaginate({ page: 2, paths });
    const body = await res.text();
    expect(body).toBe(
      '<div id="show-paginate-table"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"><th class="py-2 pl-4 pr-4">#</th><th class="py-2 pr-4">Component</th><th class="py-2 pr-4">Category</th></tr></thead><tbody><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">7</td><td class="py-2 pr-4 font-medium text-foreground">Form</td><td class="py-2 pr-4 text-muted-foreground">Form</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">8</td><td class="py-2 pr-4 font-medium text-foreground">Icon</td><td class="py-2 pr-4 text-muted-foreground">Display</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">9</td><td class="py-2 pr-4 font-medium text-foreground">Input</td><td class="py-2 pr-4 text-muted-foreground">Form</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">10</td><td class="py-2 pr-4 font-medium text-foreground">Label</td><td class="py-2 pr-4 text-muted-foreground">Form</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">11</td><td class="py-2 pr-4 font-medium text-foreground">Popover</td><td class="py-2 pr-4 text-muted-foreground">Overlay</td></tr><tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground">12</td><td class="py-2 pr-4 font-medium text-foreground">Progress</td><td class="py-2 pr-4 text-muted-foreground">Feedback</td></tr></tbody></table><div class="flex items-center justify-between border-t border-border px-4 py-3"><span class="text-xs text-muted-foreground">Page 2 of 4</span><div class="flex gap-2"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/showcase/paginate?page=1" hx-target="#show-paginate-table" hx-swap="outerHTML">Previous</button><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/showcase/paginate?page=3" hx-target="#show-paginate-table" hx-swap="outerHTML">Next</button></div></div></div>',
    );
  });
});

// ─── loadDependent ────────────────────────────────────────────────────────────

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

// ─── renderDependent ─────────────────────────────────────────────────────────

describe("renderDependent", () => {
  it("returns 200 with text/html", async () => {
    const res = await renderDependent({ category: "fruit" }, icon);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("body contains the dependent id", async () => {
    const res = await renderDependent({ category: "fruit" }, icon);
    const body = await res.text();
    expect(body).toBe(
      '<div id="show-dependent-select" class="flex flex-col gap-1.5"><label class="text-sm font-medium text-foreground" for="dependent-item">Item</label><div class="relative w-full"><select id="dependent-item" name="item" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"><option value="apple">Apple</option><option value="banana">Banana</option><option value="cherry">Cherry</option><option value="mango">Mango</option><option value="papaya">Papaya</option></select><span aria-hidden="true" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"></span></div></div>',
    );
  });

  it("renders fruit options for fruit category", async () => {
    const res = await renderDependent({ category: "fruit" }, icon);
    const body = await res.text();
    expect(body).toBe(
      '<div id="show-dependent-select" class="flex flex-col gap-1.5"><label class="text-sm font-medium text-foreground" for="dependent-item">Item</label><div class="relative w-full"><select id="dependent-item" name="item" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"><option value="apple">Apple</option><option value="banana">Banana</option><option value="cherry">Cherry</option><option value="mango">Mango</option><option value="papaya">Papaya</option></select><span aria-hidden="true" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"></span></div></div>',
    );
  });

  it("renders vegetable options for vegetable category", async () => {
    const res = await renderDependent({ category: "vegetable" }, icon);
    const body = await res.text();
    expect(body).toBe(
      '<div id="show-dependent-select" class="flex flex-col gap-1.5"><label class="text-sm font-medium text-foreground" for="dependent-item">Item</label><div class="relative w-full"><select id="dependent-item" name="item" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"><option value="broccoli">Broccoli</option><option value="carrot">Carrot</option><option value="celery">Celery</option><option value="kale">Kale</option><option value="spinach">Spinach</option></select><span aria-hidden="true" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"></span></div></div>',
    );
  });
});

// ─── loadToast ────────────────────────────────────────────────────────────────

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

// ─── renderToast ─────────────────────────────────────────────────────────────

describe("renderToast", () => {
  it("returns 200 with text/html", async () => {
    const res = await renderToast({ type: "success" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("body contains hx-swap-oob targeting #flash-container", async () => {
    const res = await renderToast({ type: "success" });
    const body = await res.text();
    expect(body).toBe(
      '<div hx-swap-oob="beforeend:#flash-container"><div data-slot="toast" data-variant="success" role="status" aria-atomic="true" data-scope="toast" data-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-emerald-200 bg-emerald-50 text-emerald-900 pr-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-title" class="text-sm font-semibold leading-none">Success</div><div data-slot="toast-description" class="text-sm opacity-90">This is a success toast notification.</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute right-2 top-2 rounded p-1 opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div></div>',
    );
  });

  it("body contains the toast message text for error type", async () => {
    const res = await renderToast({ type: "error" });
    const body = await res.text();
    expect(body).toBe(
      '<div hx-swap-oob="beforeend:#flash-container"><div data-slot="toast" data-variant="destructive" role="status" aria-atomic="true" data-scope="toast" data-state="{&quot;duration&quot;:5000}" class="relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg border-red-200 bg-red-50 text-red-900 pr-10"><div data-slot="toast-body" class="flex-1 space-y-1"><div data-slot="toast-title" class="text-sm font-semibold leading-none">Error</div><div data-slot="toast-description" class="text-sm opacity-90">This is a error toast notification.</div></div><button type="button" data-slot="toast-close" aria-label="Dismiss notification" data-on-click="dismiss" class="absolute right-2 top-2 rounded p-1 opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"><span aria-hidden="true" class="text-sm leading-none">×</span></button></div></div>',
    );
  });
});
