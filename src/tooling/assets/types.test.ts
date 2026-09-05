import { describe, expect, it } from "bun:test";

import { v } from "../../validation/mod";
import { AssetsConfigSchema, SITE_OUTPUTS } from "./types";

const parse = (value: unknown) => v.safeParse(AssetsConfigSchema, value);

describe("SITE_OUTPUTS", () => {
  it("names the two files a site block writes into its outDir", () => {
    expect(SITE_OUTPUTS).toEqual(["robots.txt", "sitemap.xml"]);
  });
});

describe("AssetsConfigSchema — shape", () => {
  it("accepts an empty config, since every block is optional", () => {
    expect(parse({}).output).toEqual({});
  });

  it("rejects a null, string or numeric config", () => {
    for (const value of [null, "config", 1]) {
      expect(parse(value).success).toBe(false);
    }
  });

  it("accepts a paths block with every field omitted, and one fully specified", () => {
    expect(parse({ paths: {} }).success).toBe(true);
    const paths = { sourceDir: "src", publicDir: "public", publicPrefix: "/assets" };
    expect(parse({ paths }).output).toEqual({ paths });
  });

  it("rejects a non-string path field", () => {
    expect(parse({ paths: { sourceDir: 1 } }).success).toBe(false);
  });
});

describe("AssetsConfigSchema — js bundles", () => {
  it("accepts a bundle with only entry and outdir", () => {
    expect(parse({ js: { bundles: [{ entry: "a.ts", outdir: "out" }] } }).success).toBe(true);
  });

  it("rejects a bundle missing outdir", () => {
    expect(parse({ js: { bundles: [{ entry: "a.ts" }] } }).success).toBe(false);
  });

  it("accepts every supported output format", () => {
    for (const format of ["esm", "cjs", "iife"]) {
      expect(parse({ js: { bundles: [{ entry: "a.ts", outdir: "out", format }] } }).success).toBe(true);
    }
  });

  it("rejects an unsupported output format", () => {
    expect(parse({ js: { bundles: [{ entry: "a.ts", outdir: "out", format: "umd" }] } }).success).toBe(false);
  });

  it("accepts each define value kind, including the deferred env and flag reads", () => {
    const define = { S: "s", N: 1, B: true, NUL: null, E: { __env: "API_URL" }, F: { __flag: "DEBUG" } };
    expect(parse({ js: { bundles: [{ entry: "a.ts", outdir: "out", define }] } }).output).toEqual({
      js: { bundles: [{ entry: "a.ts", outdir: "out", define }] },
    });
  });

  it("rejects a define value that is neither a literal nor a deferred read", () => {
    expect(parse({ js: { bundles: [{ entry: "a.ts", outdir: "out", define: { X: { __other: "y" } } }] } }).success).toBe(false);
  });
});

describe("AssetsConfigSchema — css, copy and fonts", () => {
  it("accepts a css build for the one supported tool", () => {
    expect(parse({ css: [{ tool: "tailwindcss", input: "in.css", output: "out.css" }] }).success).toBe(true);
  });

  it("rejects a css build naming another tool", () => {
    expect(parse({ css: [{ tool: "postcss", input: "in.css", output: "out.css" }] }).success).toBe(false);
  });

  it("accepts a copy entry and rejects one missing its target", () => {
    expect(parse({ copy: [{ from: "a", to: "b" }] }).success).toBe(true);
    expect(parse({ copy: [{ from: "a" }] }).success).toBe(false);
  });

  it("accepts a font download and rejects one missing its url", () => {
    expect(parse({ fonts: { downloads: [{ url: "https://f/x.woff2", to: "fonts/x.woff2" }] } }).success).toBe(true);
    expect(parse({ fonts: { downloads: [{ to: "fonts/x.woff2" }] } }).success).toBe(false);
  });
});

describe("AssetsConfigSchema — rasters", () => {
  it("accepts an entry giving width alone, height alone, or both", () => {
    for (const dims of [{ width: 32 }, { height: 32 }, { width: 32, height: 16 }]) {
      expect(parse({ rasters: [{ from: "a.svg", to: "a.png", ...dims }] }).success).toBe(true);
    }
  });

  it("rejects an entry giving neither dimension, naming the reason", () => {
    const result = parse({ rasters: [{ from: "a.svg", to: "a.png" }] });
    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe("raster entry needs width or height");
  });

  it("rejects a non-numeric dimension", () => {
    expect(parse({ rasters: [{ from: "a.svg", to: "a.png", width: "32" }] }).success).toBe(false);
  });
});

describe("AssetsConfigSchema — sprites and cursors", () => {
  it("accepts a sprite source file as a bare name or as a key/file pair", () => {
    const sprites = { icons: { target: "sprite.svg", prefix: "i-", sources: [{ path: "svg", files: ["a.svg", { key: "b", file: "b.svg" }] }] } };
    expect(parse({ sprites }).output).toEqual({ sprites });
  });

  it("rejects a sprite file entry that is an object without both key and file", () => {
    expect(parse({ sprites: { icons: { target: "s.svg", sources: [{ path: "svg", files: [{ key: "b" }] }] } } }).success).toBe(false);
  });

  it("rejects a sprite group missing its target", () => {
    expect(parse({ sprites: { icons: { sources: [] } } }).success).toBe(false);
  });

  it("accepts a cursors block with themes, per-theme vars and a template", () => {
    const cursors = {
      target: "cursors",
      css: "cursors.css",
      themes: { light: "#000" },
      sources: [{ path: "cur", files: ["a.svg"], template: { path: "tpl", file: "t.svg" } }],
      vars: { size: "32", palette: { fg: "#000" } },
    };
    expect(parse({ cursors }).output).toEqual({ cursors });
  });

  it("rejects a cursor source with no template", () => {
    expect(parse({ cursors: { target: "c", themes: {}, sources: [{ path: "cur", files: [] }] } }).success).toBe(false);
  });
});

describe("AssetsConfigSchema — icons", () => {
  const icons = (outputs: unknown[]) => ({ icons: { src: "logo.svg", outDir: "public", lightColor: "#fff", outputs } });

  it("accepts each output kind in its own required shape", () => {
    const outputs = [
      { kind: "svg", file: "icon.svg" },
      { kind: "png", file: "icon.png", size: 192, manifest: true },
      { kind: "ico", file: "favicon.ico", sizes: [16, 32] },
      { kind: "manifest", file: "site.webmanifest" },
    ];
    expect(parse(icons(outputs)).output).toEqual(icons(outputs));
  });

  it("rejects a png output with no size", () => {
    expect(parse(icons([{ kind: "png", file: "icon.png" }])).success).toBe(false);
  });

  it("rejects an ico output with no sizes list", () => {
    expect(parse(icons([{ kind: "ico", file: "favicon.ico" }])).success).toBe(false);
  });

  it("rejects an unknown output kind", () => {
    expect(parse(icons([{ kind: "webp", file: "icon.webp" }])).success).toBe(false);
  });

  it("accepts the optional dark colour and app block", () => {
    const config = {
      icons: {
        src: "logo.svg",
        outDir: "public",
        lightColor: "#fff",
        darkColor: "#000",
        app: { name: "App", shortName: "A", backgroundColor: "#fff" },
        outputs: [],
      },
    };
    expect(parse(config).output).toEqual(config);
  });

  it("rejects an app block missing shortName", () => {
    expect(
      parse({ icons: { src: "a.svg", outDir: "p", lightColor: "#fff", app: { name: "App", backgroundColor: "#fff" }, outputs: [] } }).success,
    ).toBe(false);
  });
});

describe("AssetsConfigSchema — site", () => {
  const siteConfig = { origin: "https://example.com", pages: ["/"], robots: { rules: [{ userAgent: "*" }] } };

  it("accepts a site block carrying a valid site config", () => {
    expect(parse({ site: { outDir: "public", config: siteConfig } }).success).toBe(true);
  });

  it("rejects a site block whose nested config is invalid", () => {
    expect(parse({ site: { outDir: "public", config: { ...siteConfig, origin: "https://example.com/" } } }).success).toBe(false);
  });

  it("rejects a site block with no outDir, since the two files are only meaningful at a known root", () => {
    expect(parse({ site: { config: siteConfig } }).success).toBe(false);
  });
});
