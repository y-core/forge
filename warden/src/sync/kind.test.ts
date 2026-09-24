import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../../../src/tooling/cli/errors";
import { readKind, resolveKind, resolveKindSource } from "./kind";

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

  it("defaults to apps when the manifest declares no tree", () => {
    expect(resolveKind(repoWith("{}"))).toBe("apps");
  });

  it("defaults to apps when there is no manifest at all", () => {
    expect(resolveKind(repoWith(null))).toBe("apps");
  });

  it("defaults to apps when the manifest declares a kind that is neither tree", () => {
    expect(resolveKind(repoWith('{"warden":{"kind":"docs"}}'))).toBe("apps");
  });
});

describe("resolveKindSource()", () => {
  it("reports a flag-selected tree as coming from the flag", () => {
    expect(resolveKindSource(repoWith("{}"), "libs")).toEqual({ kind: "libs", source: "flag" });
  });

  it("reports a declared tree as coming from the manifest", () => {
    expect(resolveKindSource(repoWith('{"warden":{"kind":"libs"}}'))).toEqual({ kind: "libs", source: "manifest" });
  });

  it("reports an undeclared tree as defaulted, which is what makes the apps definitions visible", () => {
    expect(resolveKindSource(repoWith("{}"))).toEqual({ kind: "apps", source: "default" });
  });

  it("names the unparseable manifest rather than raising a bare SyntaxError", () => {
    const root = repoWith('{"warden":');

    expect(() => resolveKindSource(root)).toThrow(new RegExp(`${join(root, "package.json").replace(/[\\/]/g, "\\$&")} is not valid JSON`));
    expect(() => resolveKindSource(root)).toThrow(CliError);
  });

  it("still refuses an unknown flag value, which is a typo rather than an omission", () => {
    expect(() => resolveKindSource(repoWith("{}"), "docs")).toThrow('unknown kind "docs" — warden knows "libs" and "apps"');
  });
});
