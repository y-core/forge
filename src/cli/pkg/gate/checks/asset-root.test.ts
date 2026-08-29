import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAssetRoot } from "./asset-root";

let root: string;

const ICONS = `
  icons: {
    src: "icon.svg",
    outDir: "public",
    lightColor: "#000",
    outputs: [{ kind: "svg", file: "favicon.svg" }],
  },`;

const SITE = `
  site: {
    outDir: "public",
    config: { origin: "https://example.com", pages: ["/"], robots: { rules: [{ userAgent: "*" }] } },
  },`;

function writeConfigs(blocks: string, runWorkerFirst: readonly string[]): void {
  writeFileSync(join(root, "assets.config.ts"), `export default {\n  paths: { publicDir: "public/assets" },${blocks}\n};\n`);
  writeFileSync(
    join(root, "wrangler.jsonc"),
    `{\n  // a comment, so the JSONC path is exercised\n  "assets": { "directory": "./public", "run_worker_first": ${JSON.stringify(runWorkerFirst)} }\n}\n`,
  );
}

const run = () => checkAssetRoot({ root, assetConfig: "assets.config.ts", workerConfig: "wrangler.jsonc" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forge-asset-root-"));
  mkdirSync(join(root, "public"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkAssetRoot", () => {
  it("passes when every asset-root output is excluded", async () => {
    writeConfigs(ICONS + SITE, ["/*", "!/assets/*", "!/favicon.svg", "!/robots.txt", "!/sitemap.xml"]);
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("fails naming a generated file the exclusion list forgot", async () => {
    writeConfigs(ICONS + SITE, ["/*", "!/favicon.svg", "!/robots.txt"]);
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`/sitemap.xml` is written to the asset root by `site` but `run_worker_first` does not exclude it",
    ]);
  });

  it("fails naming an icon output the exclusion list forgot", async () => {
    writeConfigs(ICONS, ["/*"]);
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`/favicon.svg` is written to the asset root by `icons.outputs` but `run_worker_first` does not exclude it",
    ]);
  });

  it("warns, without failing, on an exclusion no build step writes", async () => {
    writeConfigs(ICONS, ["/*", "!/favicon.svg", "!/stale.png"]);
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.findings.map((f) => [f.level, f.message])).toEqual([
      ["warn", "`!/stale.png` excludes a path no build step writes to the asset root"],
    ]);
  });

  it("treats a prefix exclusion as covering everything beneath it", async () => {
    writeConfigs(
      `
  icons: { src: "icon.svg", outDir: "public/img", lightColor: "#000", outputs: [{ kind: "svg", file: "favicon.svg" }] },`,
      ["/*", "!/img/*"],
    );
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("ignores a build step writing outside the served asset tree", async () => {
    writeConfigs(
      `
  icons: { src: "icon.svg", outDir: "build", lightColor: "#000", outputs: [{ kind: "svg", file: "favicon.svg" }] },`,
      ["/*"],
    );
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("passes quietly when the worker config declares no static assets", async () => {
    writeConfigs(ICONS, []);
    writeFileSync(join(root, "wrangler.jsonc"), '{\n  "name": "app"\n}\n');
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("asset-root exclusions: no static assets configured");
  });

  it("fails when the worker config is missing rather than reporting a clean tree", async () => {
    writeConfigs(ICONS, ["/*", "!/favicon.svg"]);
    rmSync(join(root, "wrangler.jsonc"));
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`wrangler.jsonc` not found"]);
  });

  it("fails when the worker config does not parse", async () => {
    writeConfigs(ICONS, ["/*", "!/favicon.svg"]);
    writeFileSync(join(root, "wrangler.jsonc"), "{ not json");
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.summary).toBe("asset-root exclusions: unparseable");
  });
});
