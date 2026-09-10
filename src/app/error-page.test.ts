import { describe, expect, it } from "bun:test";

import { requestIdCtx } from "../security/request-id";
import { createTestContext } from "../testing/context";
import { mapHandler } from "../testing/route";
import { createApp } from "./app";
import { createErrorPage } from "./error-page";

// `renderError`'s banner classes, duplicated rather than imported: `http/fragment` does not export
// them, and an exact assertion needs the literal the page actually emits.
const ERROR_CLASSES =
  "rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground";

/** The one complete element between `open` and the first `close` after it, or `""` when absent. */
function fragment(body: string, open: string, close: string): string {
  const start = body.indexOf(open);
  if (start < 0) return "";
  const end = body.indexOf(close, start);
  return end < 0 ? "" : body.slice(start, end + close.length);
}

const banner = (body: string): string => fragment(body, `<div class="${ERROR_CLASSES}">`, "</div>");

describe("createErrorPage — debug gate", () => {
  it("hides the real error message by default (no isDebug)", async () => {
    const page = createErrorPage();
    const res = page(new Error("secret db string"), createTestContext(new Request("http://test/")));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(banner(body)).toBe(`<div class="${ERROR_CLASSES}"><p>An unexpected error occurred.</p></div>`);
    expect(body).not.toContain("secret db string");
  });

  it("shows the real error message when isDebug returns true", async () => {
    const page = createErrorPage({ isDebug: () => true });
    const res = page(new Error("database timeout"), createTestContext(new Request("http://test/")));
    const body = await res.text();
    expect(banner(body)).toBe(`<div class="${ERROR_CLASSES}"><p>database timeout</p></div>`);
    expect(body).not.toContain("An unexpected error occurred.");
  });

  it("HTML-escapes the error message in debug mode", async () => {
    const page = createErrorPage({ isDebug: () => true });
    const res = page(new Error("<script>alert(1)</script>"), createTestContext(new Request("http://test/")));
    const body = await res.text();
    expect(banner(body)).toBe(`<div class="${ERROR_CLASSES}"><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></div>`);
    expect(body).not.toContain("<script>alert(1)</script>");
  });

  it("treats a throwing isDebug as production (fail closed)", async () => {
    const page = createErrorPage({
      isDebug: () => {
        throw new Error("probe broken");
      },
    });
    const res = page(new Error("internal detail"), createTestContext(new Request("http://test/")));
    const body = await res.text();
    expect(banner(body)).toBe(`<div class="${ERROR_CLASSES}"><p>An unexpected error occurred.</p></div>`);
    expect(body).not.toContain("internal detail");
  });
});

describe("createErrorPage — page structure", () => {
  it("returns a full HTML document with 500 status and text/html content-type", async () => {
    const page = createErrorPage();
    const res = page(new Error("x"), createTestContext(new Request("http://test/")));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(fragment(body, "<title>", "</title>")).toBe("<title>Something went wrong</title>");
  });

  it("renders a custom title, stylesheet link, and home link", async () => {
    const page = createErrorPage({ title: "Oops", stylesheetHref: "/assets/css/main.css", homeHref: "/" });
    const res = page(new Error("x"), createTestContext(new Request("http://test/")));
    const body = await res.text();
    expect(fragment(body, "<title>", "</title>")).toBe("<title>Oops</title>");
    expect(fragment(body, "<link", "/>")).toBe('<link rel="stylesheet" href="/assets/css/main.css" />');
    expect(fragment(body, "<a ", "</a>")).toBe('<a href="/">Back to safety</a>');
  });

  it("resolves a per-request stylesheet href and survives a throwing resolver", async () => {
    const dynamic = createErrorPage<{ CSS: string }>({ stylesheetHref: (c) => c.env.CSS });
    const res = dynamic(new Error("x"), createTestContext(new Request("http://test/"), { env: { CSS: "/hashed/app.css" } }));
    expect(fragment(await res.text(), "<link", "/>")).toBe('<link rel="stylesheet" href="/hashed/app.css" />');

    const broken = createErrorPage({
      stylesheetHref: () => {
        throw new Error("asset manifest missing");
      },
    });
    const fallback = broken(new Error("x"), createTestContext(new Request("http://test/")));
    expect(fallback.status).toBe(500);
    expect(await fallback.text()).not.toContain("<link");
  });
});

describe("createErrorPage — the request id", () => {
  const reference = (body: string): string => fragment(body, '<p class="mt-4 text-sm">', "</p>");

  it("renders no reference when the requestId middleware never ran", async () => {
    const page = createErrorPage();
    const res = page(new Error("x"), createTestContext(new Request("http://test/")));
    expect(reference(await res.text())).toBe("");
  });

  it("quotes the id the middleware assigned", async () => {
    const page = createErrorPage();
    const c = createTestContext(new Request("http://test/"));
    requestIdCtx.set(c, "req-42");
    expect(reference(await page(new Error("x"), c).text())).toBe('<p class="mt-4 text-sm">Reference: req-42</p>');
  });

  it("escapes the id it renders", async () => {
    const page = createErrorPage();
    const c = createTestContext(new Request("http://test/"));
    requestIdCtx.set(c, "<script>alert(1)</script>");
    expect(reference(await page(new Error("x"), c).text())).toBe('<p class="mt-4 text-sm">Reference: &lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
});

describe("createErrorPage — integration via createApp onError", () => {
  it("serves the styled page when a route throws", async () => {
    const app = createApp({ onError: createErrorPage({ title: "App Error" }) });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("kaboom");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(fragment(body, "<title>", "</title>")).toBe("<title>App Error</title>");
    expect(banner(body)).toBe(`<div class="${ERROR_CLASSES}"><p>An unexpected error occurred.</p></div>`);
    expect(body).not.toContain("kaboom");
  });
});
