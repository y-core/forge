import { describe, expect, it } from "bun:test";
import { v } from "../validation/mod";
import { defineAssetsConfig } from "./config";
import type { AssetsConfig } from "./types";
import { AssetsConfigSchema } from "./types";

describe("defineAssetsConfig()", () => {
  it("returns config as-is (identity function)", () => {
    const config: AssetsConfig = { css: [{ tool: "tailwindcss", input: "src/styles/main.css", output: "css/main.css" }] };
    expect(defineAssetsConfig(config)).toBe(config);
  });

  it("accepts minimal empty config", () => {
    const config: AssetsConfig = {};
    expect(defineAssetsConfig(config)).toBe(config);
  });

  it("accepts full config shape", () => {
    const config: AssetsConfig = {
      paths: { publicDir: "public/assets", publicPrefix: "/assets" },
      css: [{ tool: "tailwindcss", input: "src/styles/main.css", output: "css/main.css" }],
      js: { bundles: [{ entry: "src/client/main.ts", outdir: "js", format: "esm" }] },
      copy: [{ from: "vendor/lib.css", to: "css/lib.css" }],
    };
    expect(defineAssetsConfig(config)).toBe(config);
  });
});

describe("AssetsConfigSchema", () => {
  it("preserves bundle define containing a flag ref through v.parse (regression: valibot strip)", () => {
    const raw = { js: { bundles: [{ entry: "src/main.ts", outdir: "js", define: { __E2E__: { __flag: "E2E" } } }] } };
    const parsed = v.parse(AssetsConfigSchema, raw);
    expect(parsed.js?.bundles?.[0]?.define?.__E2E__).toEqual({ __flag: "E2E" });
  });

  it("preserves bundle define containing an env ref through v.parse", () => {
    const raw = { js: { bundles: [{ entry: "src/main.ts", outdir: "js", define: { APP_VERSION: { __env: "VERSION" } } }] } };
    const parsed = v.parse(AssetsConfigSchema, raw);
    expect(parsed.js?.bundles?.[0]?.define?.APP_VERSION).toEqual({ __env: "VERSION" });
  });

  it("preserves bundle define containing literal primitives through v.parse", () => {
    const raw = { js: { bundles: [{ entry: "src/main.ts", outdir: "js", define: { DEBUG: false, RETRIES: 3, NAME: "app" } }] } };
    const parsed = v.parse(AssetsConfigSchema, raw);
    expect(parsed.js?.bundles?.[0]?.define?.DEBUG).toBe(false);
    expect(parsed.js?.bundles?.[0]?.define?.RETRIES).toBe(3);
    expect(parsed.js?.bundles?.[0]?.define?.NAME).toBe("app");
  });
});
