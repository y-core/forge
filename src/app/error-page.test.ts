import { describe, expect, it } from "bun:test";
import { createTestContext } from "../testing/context";
import { createApp } from "./app";
import { createErrorPage } from "./error-page";
import { mapHandler } from "./route-test-helper";

describe("createErrorPage — debug gate", () => {
  it("hides the real error message by default (no isDebug)", async () => {
    const page = createErrorPage();
    const res = page(new Error("secret db string"), createTestContext(new Request("http://test/")));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("An unexpected error occurred.");
    expect(body).not.toContain("secret db string");
  });

  it("shows the real error message when isDebug returns true", async () => {
    const page = createErrorPage({ isDebug: () => true });
    const res = page(new Error("database timeout"), createTestContext(new Request("http://test/")));
    const body = await res.text();
    expect(body).toContain("database timeout");
    expect(body).not.toContain("An unexpected error occurred.");
  });

  it("HTML-escapes the error message in debug mode", async () => {
    const page = createErrorPage({ isDebug: () => true });
    const res = page(new Error("<script>alert(1)</script>"), createTestContext(new Request("http://test/")));
    const body = await res.text();
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
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
    expect(body).toContain("An unexpected error occurred.");
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
    expect(body).toContain("<title>Something went wrong</title>");
  });

  it("renders a custom title, stylesheet link, and home link", async () => {
    const page = createErrorPage({ title: "Oops", stylesheetHref: "/assets/css/main.css", homeHref: "/" });
    const res = page(new Error("x"), createTestContext(new Request("http://test/")));
    const body = await res.text();
    expect(body).toContain("<title>Oops</title>");
    expect(body).toContain('<link rel="stylesheet" href="/assets/css/main.css" />');
    expect(body).toContain('<a href="/">Back to safety</a>');
  });

  it("resolves a per-request stylesheet href and survives a throwing resolver", async () => {
    const dynamic = createErrorPage<{ CSS: string }>({ stylesheetHref: (c) => c.env.CSS });
    const res = dynamic(new Error("x"), createTestContext(new Request("http://test/"), { env: { CSS: "/hashed/app.css" } }));
    expect(await res.text()).toContain('href="/hashed/app.css"');

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

describe("createErrorPage — integration via createApp onError", () => {
  it("serves the styled page when a route throws", async () => {
    const app = createApp({ onError: createErrorPage({ title: "App Error" }) });
    mapHandler(app, "GET", "/boom", () => {
      throw new Error("kaboom");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("<title>App Error</title>");
    expect(body).toContain("An unexpected error occurred.");
    expect(body).not.toContain("kaboom");
  });
});
