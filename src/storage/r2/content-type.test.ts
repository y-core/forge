import { describe, expect, it } from "bun:test";

import { ACTIVE_CONTENT_EXTENSIONS, CONTENT_TYPE_DEFAULT, inferContentType, isActiveContentType } from "./content-type";

describe("inferContentType", () => {
  it("infers common MIME types from extension", () => {
    expect(inferContentType("photo.jpg")).toBe("image/jpeg");
    expect(inferContentType("style.css")).toBe("text/css; charset=utf-8");
    expect(inferContentType("data.json")).toBe("application/json; charset=utf-8");
    expect(inferContentType("image.png")).toBe("image/png");
    expect(inferContentType("font.woff2")).toBe("font/woff2");
  });

  it("is case-insensitive", () => {
    expect(inferContentType("photo.JPG")).toBe("image/jpeg");
    expect(inferContentType("doc.TXT")).toBe("text/plain; charset=utf-8");
  });

  // A key is routinely a user-chosen filename, so inferring `text/html` from one is what makes a
  // stored upload a document on the app's own origin.
  it("refuses to infer an active type from a key, whatever its casing", () => {
    for (const key of ["avatar.svg", "page.html", "page.HTM", "sheet.xml", "app.js", "mod.MJS"]) {
      expect(inferContentType(key)).toBe(CONTENT_TYPE_DEFAULT);
    }
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

describe("inferContentType — prototype keys", () => {
  for (const key of ["upload.constructor", "upload.toString", "upload.__proto__", "upload.hasOwnProperty"]) {
    it(`returns the default for "${key}"`, () => {
      expect(inferContentType(key)).toBe(CONTENT_TYPE_DEFAULT);
    });
  }

  it("returns the default for an extension-less key", () => {
    expect(inferContentType("README")).toBe(CONTENT_TYPE_DEFAULT);
  });
});

describe("isActiveContentType", () => {
  it("recognizes every type the active extensions map to, with or without a charset", () => {
    for (const type of ["text/html; charset=utf-8", "text/html", "image/svg+xml", "application/xml", "text/javascript"]) {
      expect(isActiveContentType(type)).toBe(true);
    }
  });

  it("recognizes a spelling a caller may store that the map never emits", () => {
    for (const type of ["application/javascript", "application/xhtml+xml", "text/xml"]) {
      expect(isActiveContentType(type)).toBe(true);
    }
  });

  // A browser parses any `+xml` essence and `text/xsl` as a document on the serving origin, in which
  // an XHTML-namespaced `<script>` runs; the remaining script spellings run outright.
  it("recognizes the +xml family, text/xsl and every script spelling, not only the seven it lists", () => {
    for (const type of [
      "application/atom+xml",
      "application/rss+xml",
      "application/rdf+xml",
      "application/xslt+xml",
      "application/mathml+xml",
      "text/xsl",
      "application/x-javascript",
      "text/ecmascript",
      "application/ecmascript",
    ]) {
      expect(isActiveContentType(type)).toBe(true);
    }
  });

  it("matches on the essence, so casing and surrounding whitespace do not hide one", () => {
    expect(isActiveContentType("TEXT/HTML ;charset=utf-8")).toBe(true);
    expect(isActiveContentType("  image/SVG+xml  ")).toBe(true);
  });

  it("leaves an inert type alone", () => {
    for (const type of ["image/png", "application/pdf", "text/plain; charset=utf-8", "application/octet-stream", "application/json"]) {
      expect(isActiveContentType(type)).toBe(false);
    }
  });

  it("names the extensions the put side refuses to infer from", () => {
    expect([...ACTIVE_CONTENT_EXTENSIONS].sort()).toEqual(["htm", "html", "js", "mjs", "svg", "xml"]);
  });
});
