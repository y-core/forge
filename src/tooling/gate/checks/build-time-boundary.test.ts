import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildTimeSubpaths, checkBuildTimeBoundary, isBuildTime } from "./build-time-boundary";
import type { BuildTimeBoundaryCheckConfig } from "./types";

const BUILD_DIRS = ["src/tooling", "src/ui/assets/build"] as const;

const EXPORTS = {
  "./http": { import: "./src/http/mod.ts", types: "./src/http/mod.ts" },
  "./tooling/assets": { import: "./src/tooling/assets/mod.ts", types: "./src/tooling/assets/mod.ts" },
  "./ui/assets/build": { import: "./src/ui/assets/build/mod.ts", types: "./src/ui/assets/build/mod.ts" },
  "./ui/assets/css/*.css": "./src/ui/assets/css/*.css",
};

function project(files: Record<string, string>): BuildTimeBoundaryCheckConfig {
  const root = mkdtempSync(join(tmpdir(), "forge-btb-"));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return { root, packageName: "@y-core/forge", exports: EXPORTS, buildTimeDirs: BUILD_DIRS, sources: ["src"] };
}

describe("isBuildTime", () => {
  it("accepts a build-time directory itself and anything under it", () => {
    expect(isBuildTime("src/tooling", BUILD_DIRS)).toBe(true);
    expect(isBuildTime("src/tooling/gate/checks/exports.ts", BUILD_DIRS)).toBe(true);
    expect(isBuildTime("src/ui/assets/build/color.ts", BUILD_DIRS)).toBe(true);
  });

  it("does not mistake a sibling with the same prefix for a build-time directory", () => {
    expect(isBuildTime("src/tooling-helpers/thing.ts", BUILD_DIRS)).toBe(false);
    expect(isBuildTime("src/ui/assets/glyphs.ts", BUILD_DIRS)).toBe(false);
  });
});

describe("buildTimeSubpaths", () => {
  it("names every published subpath whose target is build-time, as a consumer spells it", () => {
    const found = buildTimeSubpaths({ packageName: "@y-core/forge", exports: EXPORTS, buildTimeDirs: BUILD_DIRS });

    expect([...found.entries()].sort()).toEqual([
      ["@y-core/forge/tooling/assets", "src/tooling/assets/mod.ts"],
      ["@y-core/forge/ui/assets/build", "src/ui/assets/build/mod.ts"],
    ]);
  });

  it("omits a runtime subpath, so importing it is never reported", () => {
    expect(buildTimeSubpaths({ packageName: "@y-core/forge", exports: EXPORTS, buildTimeDirs: BUILD_DIRS }).has("@y-core/forge/http")).toBe(false);
  });
});

describe("checkBuildTimeBoundary", () => {
  it("passes a runtime module that imports only runtime modules", () => {
    const result = checkBuildTimeBoundary(
      project({
        "src/http/mod.ts": 'export { html } from "./html";\n',
        "src/http/html.ts": "export const html = 1;\n",
        "src/tooling/assets/mod.ts": 'export { safeJoin } from "./paths";\n',
        "src/tooling/assets/paths.ts": 'import { resolve } from "node:path";\nexport const safeJoin = resolve;\n',
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("2 sources outside `src/tooling`, `src/ui/assets/build` import nothing inside them");
  });

  it("reports a relative import into a build-time directory, with the file, line and resolved target", () => {
    const result = checkBuildTimeBoundary(
      project({
        "src/http/mod.ts": '/** doc */\nexport { safeJoin } from "../tooling/assets/paths";\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toBe("src/http/mod.ts");
    expect(result.findings[0]?.line).toBe(2);
    expect(result.findings[0]?.message).toBe("build-time boundary crossed — `../tooling/assets/paths` resolves to `src/tooling/assets/paths.ts`");
  });

  it("resolves a directory specifier through its `mod.ts`", () => {
    const result = checkBuildTimeBoundary(
      project({
        "src/http/mod.ts": 'export { safeJoin } from "../tooling/assets";\n',
        "src/tooling/assets/mod.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.findings[0]?.message).toBe("build-time boundary crossed — `../tooling/assets` resolves to `src/tooling/assets/mod.ts`");
  });

  it("reports a self-import by package name, which resolves to nothing relative", () => {
    const result = checkBuildTimeBoundary(
      project({
        "src/http/mod.ts": 'export { hashString } from "@y-core/forge/tooling/assets";\n',
        "src/tooling/assets/mod.ts": "export const hashString = 1;\n",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe(
      "build-time boundary crossed — `@y-core/forge/tooling/assets` resolves to `src/tooling/assets/mod.ts`",
    );
  });

  it("reports a module no barrel exports, which no reachability walk would find", () => {
    const result = checkBuildTimeBoundary(
      project({
        "src/http/mod.ts": "export const html = 1;\n",
        "src/ui/orphan.ts": 'import { safeJoin } from "../tooling/assets/paths";\nexport const x = safeJoin;\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.file).toBe("src/ui/orphan.ts");
  });

  it("reports a side-effect import and a dynamic one, neither of which binds a name", () => {
    const result = checkBuildTimeBoundary(
      project({
        "src/http/mod.ts": 'import "../tooling/assets/paths";\nexport const later = () => import("../tooling/assets/paths");\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.findings.map((finding) => finding.line)).toEqual([1, 2]);
  });

  it("allows a type-only import, which is erased before anything is bundled", () => {
    const result = checkBuildTimeBoundary(
      project({
        "src/http/mod.ts": 'import type { Paths } from "../tooling/assets/paths";\nexport type P = Paths;\n',
        "src/tooling/assets/paths.ts": "export type Paths = string;\n",
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("allows a spec to import the build-time module it covers, because a spec is not shipped", () => {
    const result = checkBuildTimeBoundary(
      project({
        "src/http/mod.ts": "export const html = 1;\n",
        "src/ui/thing.test.ts": 'import { safeJoin } from "../tooling/assets/paths";\nexport const x = safeJoin;\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("allows a build-time module to import another one, which is the whole point of the container", () => {
    const result = checkBuildTimeBoundary(
      project({
        "src/tooling/gate/mod.ts": 'export { safeJoin } from "../assets/paths";\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
        "src/ui/assets/build/color.ts": 'import { safeJoin } from "../../assets/paths";\nexport const c = safeJoin;\n',
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("refuses a green verdict when the source directory holds nothing", () => {
    const result = checkBuildTimeBoundary({ ...project({}), sources: ["src"] });

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("`src` matched no source — refusing to report a green build-time-boundary gate that scanned nothing");
  });
});
