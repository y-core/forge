import { describe, expect, it } from "bun:test";
import { defineAssetsConfig } from "./config";
import type { AssetsConfig } from "./types";

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
