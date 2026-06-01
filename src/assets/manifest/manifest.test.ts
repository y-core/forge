import { describe, expect, it } from "bun:test";
import { createManifest } from "./manifest";

describe("createManifest()", () => {
  it("returns hashed path for known key", () => {
    const m = createManifest({ "css/main.css": "css/main.a3f2b1c9.css" }, "/assets");
    expect(m.path("css/main.css")).toBe("/assets/css/main.a3f2b1c9.css");
  });

  it("returns plain path for unknown key", () => {
    const m = createManifest({}, "/assets");
    expect(m.path("js/main.js")).toBe("/assets/js/main.js");
  });

  it("handles prefix with trailing slash", () => {
    const m = createManifest({ "app.js": "app-abc12345.js" }, "/cdn/");
    expect(m.path("app.js")).toBe("/cdn/app-abc12345.js");
  });

  it("normalizes key with leading slash", () => {
    const m = createManifest({ "css/main.css": "css/main.deadbeef.css" }, "/assets");
    expect(m.path("/css/main.css")).toBe("/assets/css/main.deadbeef.css");
  });

  it("returns unversioned path for empty manifest", () => {
    const m = createManifest({}, "/static");
    expect(m.path("fonts/inter.woff2")).toBe("/static/fonts/inter.woff2");
  });
});
