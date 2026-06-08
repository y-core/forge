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
    expect(body).toContain('id="show-preview-button"');
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
    expect(body).toContain('id="show-validate-field"');
  });

  it("shows error message for invalid email", async () => {
    const res = await renderValidate({ email: "not-valid" });
    const body = await res.text();
    expect(body).toContain("Please enter a valid email address.");
  });

  it("shows success message for valid email", async () => {
    const res = await renderValidate({ email: "user@example.com" });
    const body = await res.text();
    expect(body).toContain("Looks good!");
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
    expect(body).toContain('id="show-search-results"');
  });

  it("filters results by query", async () => {
    const res = await renderSearch({ q: "button" });
    const body = await res.text();
    expect(body).toContain("Button");
    expect(body).not.toContain(">Alert<");
  });

  it("shows no-match message for unrecognised query", async () => {
    const res = await renderSearch({ q: "zzznomatch" });
    const body = await res.text();
    expect(body).toContain("No components match.");
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
    expect(body).toContain('id="show-paginate-table"');
  });

  it("Next button is present on page 1", async () => {
    const res = await renderPaginate({ page: 1, paths });
    const body = await res.text();
    expect(body).toContain("Next");
  });

  it("Previous button is present on page 2", async () => {
    const res = await renderPaginate({ page: 2, paths });
    const body = await res.text();
    expect(body).toContain("Previous");
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
    expect(body).toContain('id="show-dependent-select"');
  });

  it("renders fruit options for fruit category", async () => {
    const res = await renderDependent({ category: "fruit" }, icon);
    const body = await res.text();
    expect(body).toContain("Apple");
    expect(body).toContain("Mango");
  });

  it("renders vegetable options for vegetable category", async () => {
    const res = await renderDependent({ category: "vegetable" }, icon);
    const body = await res.text();
    expect(body).toContain("Carrot");
    expect(body).not.toContain("Apple");
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
    expect(body).toContain("hx-swap-oob");
    expect(body).toContain("flash-container");
  });

  it("body contains the toast message text for error type", async () => {
    const res = await renderToast({ type: "error" });
    const body = await res.text();
    expect(body).toContain("error toast notification");
  });
});
