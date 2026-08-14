import { describe, expect, it } from "bun:test";
import { resolveNamespaces, validateNoEnumeration, validateNoMutualValuePairs } from "./namespace-graph";
import type { EdgeKind } from "./namespace-graph-parse";

const DOC = ".decisions/NAMESPACE_DESIGN.md";

describe("resolveNamespaces() — the namespace set is derived, never listed", () => {
  it("takes the directory of every mod.ts the exports map names", () => {
    const map = { ".": "./src/app/mod.ts", "./http": "./src/http/mod.ts" };

    expect(resolveNamespaces(map)).toEqual(["app", "http"]);
  });

  it("attributes a sub-namespace separately from its parent", () => {
    const map = { "./storage/db": "./src/storage/db/mod.ts", "./storage/kv": "./src/storage/kv/mod.ts" };

    expect(resolveNamespaces(map)).toEqual(["storage/db", "storage/kv"]);
  });

  it("ignores a directory that owns no export subpath", () => {
    const map = { "./assets": "./src/assets/mod.ts" };

    expect(resolveNamespaces(map)).toEqual(["assets"]);
  });

  it("includes a sealed-internal barrel that owns no subpath at all", () => {
    const map = { "./http": "./src/http/mod.ts" };

    expect(resolveNamespaces(map, ["src/crypto/mod.ts"])).toEqual(["crypto", "http"]);
  });

  it("ignores an exports entry that is not a barrel", () => {
    const map = { "./css": "./src/ui/assets/css/forge.css", "./http": "./src/http/mod.ts" };

    expect(resolveNamespaces(map)).toEqual(["http"]);
  });

  it("honours a source root other than src/", () => {
    const map = { "./http": "./lib/http/mod.ts" };

    expect(resolveNamespaces(map, [], "lib")).toEqual(["http"]);
  });

  it("resolves a target written without the leading ./", () => {
    expect(resolveNamespaces({ "./http": "src/http/mod.ts" })).toEqual(["http"]);
  });
});

describe("validateNoMutualValuePairs()", () => {
  const edges = (value: Record<string, Record<string, EdgeKind>>) => value;

  it("passes a pair whose one direction is type-only", () => {
    expect(validateNoMutualValuePairs(edges({ logging: { "storage/kv": "type" }, "storage/kv": { logging: "value" } }))).toEqual([]);
  });

  it("fails a pair carrying a value edge in both directions", () => {
    const findings = validateNoMutualValuePairs(edges({ a: { b: "value" }, b: { a: "value" } }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe("fail");
    expect(findings[0]?.message).toContain("`a` → `b` and `b` → `a` are both `value` edges");
  });

  it("reports an offending pair once, naming the alphabetically first namespace first", () => {
    const findings = validateNoMutualValuePairs(edges({ zed: { alpha: "value" }, alpha: { zed: "value" } }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("edges alpha ↔ zed");
  });

  it("passes a graph with no mutual naming at all", () => {
    expect(validateNoMutualValuePairs(edges({ a: { b: "value" }, b: { c: "value" } }))).toEqual([]);
  });
});

describe("validateNoEnumeration()", () => {
  const withSections = (body: string[]): string[] => ["### 3a. Catalog", "| Subpath | Barrel |", ...body, "### 4a. Classification", ""];

  it("reports nothing for a document carrying neither enumeration", () => {
    expect(validateNoEnumeration(withSections([]), DOC)).toEqual([]);
  });

  it("names a returned `Namespace | Composes` table at its own line", () => {
    const lines = ["### 3a. Catalog", "| Subpath | Barrel |", "### 4a. Classification", "| Namespace | Composes |", ""];
    const findings = validateNoEnumeration(lines, DOC);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe(DOC);
    expect(findings[0]?.line).toBe(4);
    expect(findings[0]?.message).toContain("the `| Namespace | Composes |` table is back");
  });

  it("reports a moved §4a heading against the document rather than a line", () => {
    const findings = validateNoEnumeration(["### 3a. Catalog", "| Subpath | Barrel |"], DOC);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBeUndefined();
    expect(findings[0]?.message).toContain("no `### 4a.` heading");
  });

  it("reports a moved §3a heading against the document rather than a line", () => {
    const findings = validateNoEnumeration(["### 4a. Classification", ""], DOC);

    expect(findings.some((finding) => finding.message.includes("no `### 3a.` heading"))).toBe(true);
  });
});
