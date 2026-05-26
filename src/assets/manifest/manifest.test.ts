import { describe, expect, it } from "bun:test";
import { createManifest } from "./manifest";

describe("createManifest()", () => {
  it("returns cache-busted path for known key", () => {
    const m = createManifest({ "css/main.css": "a3f2b1c9" }, "/assets");
    expect(m.path("css/main.css")).toBe("/assets/css/main.css?v=a3f2b1c9");
  });

  it("returns plain path for unknown key", () => {
    const m = createManifest({}, "/assets");
    expect(m.path("js/main.js")).toBe("/assets/js/main.js");
  });

  it("handles prefix with trailing slash", () => {
    const m = createManifest({ "app.js": "abc12345" }, "/cdn/");
    expect(m.path("app.js")).toBe("/cdn/app.js?v=abc12345");
  });

  it("normalizes key with leading slash", () => {
    const m = createManifest({ "css/main.css": "deadbeef" }, "/assets");
    expect(m.path("/css/main.css")).toBe("/assets/css/main.css?v=deadbeef");
  });

  it("returns unversioned path for empty manifest", () => {
    const m = createManifest({}, "/static");
    expect(m.path("fonts/inter.woff2")).toBe("/static/fonts/inter.woff2");
  });
});
