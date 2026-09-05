import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { collectSurface, diffSurface, removedSurfaceSince } from "./surface";
import { ReleaseError } from "./types";

const ROOT = mkdtempSync(join(tmpdir(), "forge-surface-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const MANIFEST = JSON.stringify({
  exports: {
    "./http": { types: "./src/http/mod.ts", import: "./src/http/mod.ts" },
    "./storage/r2": { types: "./src/storage/r2/mod.ts", import: "./src/storage/r2/mod.ts" },
  },
});

const HTTP_BARREL = ["export { serveObject, jsonResponse } from './responses';", "export type { ResponseInit } from './types';"].join("\n");
const R2_BARREL = "export { r2Client } from './client';";

function reader(files: Record<string, string>) {
  return (relPath: string): string | null => files[relPath] ?? null;
}

describe("collectSurface()", () => {
  it("keys every barrel export by its specifier", () => {
    const surface = collectSurface(MANIFEST, reader({ "src/http/mod.ts": HTTP_BARREL, "src/storage/r2/mod.ts": R2_BARREL }));
    expect([...surface].sort()).toEqual(["./http#ResponseInit", "./http#jsonResponse", "./http#serveObject", "./storage/r2#r2Client"]);
  });

  it("skips a `*` subpath pattern, which names no barrel", () => {
    const manifest = JSON.stringify({ exports: { "./ui/design/*.md": "./src/ui/design/*.md", "./http": { import: "./src/http/mod.ts" } } });
    const surface = collectSurface(manifest, reader({ "src/http/mod.ts": R2_BARREL }));
    expect([...surface]).toEqual(["./http#r2Client"]);
  });

  it("scans a target that is not a barrel", () => {
    const manifest = JSON.stringify({
      exports: { "./jsx-runtime": { import: "./src/jsx/runtime.ts" }, "./http": { import: "./src/http/mod.ts" } },
    });
    const surface = collectSurface(manifest, reader({ "src/jsx/runtime.ts": R2_BARREL, "src/http/mod.ts": HTTP_BARREL }));
    expect([...surface].sort()).toEqual(["./http#ResponseInit", "./http#jsonResponse", "./http#serveObject", "./jsx-runtime#r2Client"]);
  });

  it("records only the consumer-visible name of an aliased export", () => {
    const manifest = JSON.stringify({ exports: { "./http": { import: "./src/http/mod.ts" } } });
    const surface = collectSurface(manifest, reader({ "src/http/mod.ts": "export { serveObjectImpl as serveObject } from './responses';" }));
    expect([...surface]).toEqual(["./http#serveObject"]);
  });

  it("prefers `import` over `types` when both name a target", () => {
    const manifest = JSON.stringify({ exports: { "./http": { types: "./src/other/mod.ts", import: "./src/http/mod.ts" } } });
    const surface = collectSurface(manifest, reader({ "src/http/mod.ts": R2_BARREL, "src/other/mod.ts": HTTP_BARREL }));
    expect([...surface]).toEqual(["./http#r2Client"]);
  });

  it("contributes nothing for a barrel absent at the ref", () => {
    const surface = collectSurface(MANIFEST, reader({ "src/http/mod.ts": HTTP_BARREL }));
    expect([...surface].sort()).toEqual(["./http#ResponseInit", "./http#jsonResponse", "./http#serveObject"]);
  });

  it("throws rather than yielding an empty set for a malformed package.json", () => {
    expect(() => collectSurface("{ not json", reader({}), "package.json at v1.0.0")).toThrow(ReleaseError);
    expect(() => collectSurface("{ not json", reader({}), "package.json at v1.0.0")).toThrow(/^package\.json at v1\.0\.0 is not valid JSON: /);
  });

  it("yields an empty set for a manifest with no exports map", () => {
    expect(collectSurface(JSON.stringify({ name: "pkg" }), reader({}))).toEqual(new Set());
  });
});

describe("diffSurface()", () => {
  it("reports a symbol dropped from a barrel", () => {
    const before = collectSurface(MANIFEST, reader({ "src/http/mod.ts": HTTP_BARREL, "src/storage/r2/mod.ts": R2_BARREL }));
    const after = collectSurface(
      MANIFEST,
      reader({ "src/http/mod.ts": "export { jsonResponse } from './responses';", "src/storage/r2/mod.ts": R2_BARREL }),
    );
    expect(diffSurface(before, after)).toEqual(["./http#ResponseInit", "./http#serveObject"]);
  });

  it("reports every symbol of a whole subpath dropped from the exports map", () => {
    const before = collectSurface(MANIFEST, reader({ "src/http/mod.ts": HTTP_BARREL, "src/storage/r2/mod.ts": R2_BARREL }));
    const after = collectSurface(
      JSON.stringify({ exports: { "./http": { import: "./src/http/mod.ts" } } }),
      reader({ "src/http/mod.ts": HTTP_BARREL }),
    );
    expect(diffSurface(before, after)).toEqual(["./storage/r2#r2Client"]);
  });

  it("reports nothing when a symbol is added", () => {
    const before = collectSurface(MANIFEST, reader({ "src/http/mod.ts": "export { serveObject } from './responses';" }));
    const after = collectSurface(MANIFEST, reader({ "src/http/mod.ts": "export { serveObject, added } from './responses';" }));
    expect(diffSurface(before, after)).toEqual([]);
  });

  it("reports nothing when the surface is unchanged", () => {
    const files = { "src/http/mod.ts": HTTP_BARREL, "src/storage/r2/mod.ts": R2_BARREL };
    expect(diffSurface(collectSurface(MANIFEST, reader(files)), collectSurface(MANIFEST, reader(files)))).toEqual([]);
  });

  it("reports nothing when a symbol is renamed behind a stable alias", () => {
    const manifest = JSON.stringify({ exports: { "./http": { import: "./src/http/mod.ts" } } });
    const before = collectSurface(manifest, reader({ "src/http/mod.ts": "export { oldName as serveObject } from './responses';" }));
    const after = collectSurface(manifest, reader({ "src/http/mod.ts": "export { newName as serveObject } from './responses';" }));
    expect(diffSurface(before, after)).toEqual([]);
  });
});

describe("removedSurfaceSince()", () => {
  function writeTree(name: string, files: Record<string, string>): string {
    const root = join(ROOT, name);
    for (const [relPath, source] of Object.entries(files)) {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, source, "utf-8");
    }
    return root;
  }

  it("reports nothing when the manifest is absent at the ref", () => {
    const root = writeTree("no-manifest", { "package.json": MANIFEST, "src/http/mod.ts": HTTP_BARREL });
    expect(removedSurfaceSince(root, "v1.0.0", () => null)).toEqual([]);
  });

  it("treats a barrel absent at the ref as having published nothing", () => {
    const root = writeTree("no-barrel", { "package.json": MANIFEST, "src/http/mod.ts": HTTP_BARREL, "src/storage/r2/mod.ts": R2_BARREL });
    const atRef = reader({ "package.json": MANIFEST, "src/storage/r2/mod.ts": R2_BARREL });
    expect(removedSurfaceSince(root, "v1.0.0", atRef)).toEqual([]);
  });

  it("reports a symbol the working tree no longer publishes", () => {
    const root = writeTree("removal", {
      "package.json": MANIFEST,
      "src/http/mod.ts": "export { jsonResponse } from './responses';",
      "src/storage/r2/mod.ts": R2_BARREL,
    });
    const atRef = reader({ "package.json": MANIFEST, "src/http/mod.ts": HTTP_BARREL, "src/storage/r2/mod.ts": R2_BARREL });
    expect(removedSurfaceSince(root, "v1.0.0", atRef)).toEqual(["./http#ResponseInit", "./http#serveObject"]);
  });

  it("throws naming the ref when the manifest at the ref cannot be parsed", () => {
    const root = writeTree("bad-ref-manifest", { "package.json": MANIFEST, "src/http/mod.ts": HTTP_BARREL });
    const atRef = reader({ "package.json": "{ not json" });
    expect(() => removedSurfaceSince(root, "v1.0.0", atRef)).toThrow(/^package\.json at v1\.0\.0 is not valid JSON: /);
  });

  it("throws naming the working tree when the working-tree manifest cannot be parsed", () => {
    const root = writeTree("bad-tree-manifest", { "package.json": "{ not json", "src/http/mod.ts": HTTP_BARREL });
    const atRef = reader({ "package.json": MANIFEST, "src/http/mod.ts": HTTP_BARREL });
    expect(() => removedSurfaceSince(root, "v1.0.0", atRef)).toThrow(/^package\.json in the working tree is not valid JSON: /);
  });

  it("throws when the working tree has no manifest at all", () => {
    const root = writeTree("absent-tree-manifest", { "src/http/mod.ts": HTTP_BARREL });
    const atRef = reader({ "package.json": MANIFEST, "src/http/mod.ts": HTTP_BARREL });
    expect(() => removedSurfaceSince(root, "v1.0.0", atRef)).toThrow("package.json in the working tree could not be read");
  });

  it("throws rather than reporting no removals when the ref cannot be read", () => {
    const root = writeTree("unresolvable", { "package.json": MANIFEST });
    const atRef = () => {
      throw new ReleaseError("git-error", "git could not resolve v99.99.99-nope");
    };
    expect(() => removedSurfaceSince(root, "v99.99.99-nope", atRef)).toThrow("git could not resolve v99.99.99-nope");
  });
});
