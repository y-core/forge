import { describe, expect, it } from "bun:test";
import { CONTENT_TYPE_DEFAULT, inferContentType } from "./content-type";

describe("inferContentType", () => {
  it("infers common MIME types from extension", () => {
    expect(inferContentType("photo.jpg")).toBe("image/jpeg");
    expect(inferContentType("style.css")).toBe("text/css; charset=utf-8");
    expect(inferContentType("app.js")).toBe("text/javascript; charset=utf-8");
    expect(inferContentType("data.json")).toBe("application/json; charset=utf-8");
    expect(inferContentType("image.png")).toBe("image/png");
    expect(inferContentType("font.woff2")).toBe("font/woff2");
  });

  it("is case-insensitive", () => {
    expect(inferContentType("photo.JPG")).toBe("image/jpeg");
    expect(inferContentType("doc.HTML")).toBe("text/html; charset=utf-8");
  });

  it("returns CONTENT_TYPE_DEFAULT for unknown extensions", () => {
    expect(inferContentType("file.xyz")).toBe(CONTENT_TYPE_DEFAULT);
    expect(inferContentType("noextension")).toBe(CONTENT_TYPE_DEFAULT);
  });

  it("uses the last extension segment for dotted names", () => {
    expect(inferContentType("archive.tar.gz")).toBe("application/gzip");
    expect(inferContentType("data.backup.json")).toBe("application/json; charset=utf-8");
  });
});
