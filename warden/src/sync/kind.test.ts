import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readKind, resolveKind } from "./kind";

function repoWith(manifest: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "warden-kind-"));
  if (manifest !== null) writeFileSync(join(root, "package.json"), manifest, "utf-8");
  return root;
}

describe("readKind()", () => {
  it("reads the warden key", () => {
    expect(readKind({ warden: { kind: "apps" } })).toBe("apps");
  });

  it("falls back to the governance key a repository mid-migration still carries", () => {
    expect(readKind({ governance: { kind: "libs" } })).toBe("libs");
  });

  it("prefers warden over governance when both are present", () => {
    expect(readKind({ warden: { kind: "apps" }, governance: { kind: "libs" } })).toBe("apps");
  });

  it("rejects a kind that is neither tree", () => {
    expect(readKind({ warden: { kind: "docs" } })).toBeUndefined();
  });

  it("returns undefined for a manifest declaring neither key", () => {
    expect(readKind({})).toBeUndefined();
  });
});

describe("resolveKind()", () => {
  it("takes the flag over the manifest", () => {
    expect(resolveKind(repoWith('{"warden":{"kind":"libs"}}'), "apps")).toBe("apps");
  });

  it("reads the manifest when no flag is passed", () => {
    expect(resolveKind(repoWith('{"warden":{"kind":"libs"}}'))).toBe("libs");
  });

  it("refuses an unknown flag value by name", () => {
    expect(() => resolveKind(repoWith('{"warden":{"kind":"libs"}}'), "docs")).toThrow('unknown kind "docs" — warden knows "libs" and "apps"');
  });

  it("refuses when neither the flag nor the manifest names a tree", () => {
    expect(() => resolveKind(repoWith("{}"))).toThrow(
      'no tree selected — add `"warden": { "kind": "libs" | "apps" }` to package.json, or pass --kind',
    );
  });

  it("refuses when there is no manifest at all", () => {
    expect(() => resolveKind(repoWith(null))).toThrow("no tree selected");
  });
});
