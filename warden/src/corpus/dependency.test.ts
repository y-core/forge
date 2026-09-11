import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { WARDEN_ROOT } from "../paths";
import { audienceOf, dependencyRootOf, dependencyWeightOf, libraryRoot, librarySources } from "./dependency";
import { discover } from "./source";

function doc(audience: string | undefined, body = "Body."): string {
  const key = audience === undefined ? "" : `\naudience: ${audience}`;
  return `---\ntitle: Rules\ndescription: "One."${key}\n---\n\n## 0. Quick Reference\n\n- §1 One: what it decides\n\n## 1. One\n\n${body}\n`;
}

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "warden-dependency-"));
  for (const [path, source] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source, "utf-8");
  }
  return root;
}

const LIBRARY = {
  "package.json": '{ "name": "@y-core/forge" }',
  "docs/UI_CLASS_COMPOSITION.md": doc("consumer"),
  "docs/NAMESPACES.md": doc("internal"),
  "docs/UNDECLARED.md": doc(undefined),
  "src/ui/README.md": doc("consumer"),
  "src/crypto/README.md": doc("internal"),
  "src/tooling/gate/README.md": doc(undefined),
};

describe("audienceOf()", () => {
  it("reads a declared audience", () => {
    expect(audienceOf(doc("consumer"))).toBe("consumer");
    expect(audienceOf(doc("internal"))).toBe("internal");
  });

  // A new document must fail closed rather than default into a consuming repository's answers.
  it("answers for nothing it was not given", () => {
    expect(audienceOf(doc(undefined))).toBeUndefined();
    expect(audienceOf(doc("consumers"))).toBeUndefined();
    expect(audienceOf("# No frontmatter\n")).toBeUndefined();
  });
});

describe("librarySources()", () => {
  it("serves the consumer-facing documents and READMEs, and nothing else", () => {
    expect(librarySources(tree(LIBRARY)).map((source) => source.path)).toEqual(["forge/UI_CLASS_COMPOSITION.md", "forge/src/ui/README.md"]);
  });

  // A bare filename collides with the canon on six names; `docs/` collides with the consuming
  // repository's own. This spelling collides with neither and makes `--path forge` a usable scope.
  it("spells a path under the package's own last segment, never as `docs/`", () => {
    const [only] = librarySources(tree(LIBRARY));

    expect(only?.path).toBe("forge/UI_CLASS_COMPOSITION.md");
    expect(only?.corpus).toBe("dependency");
    expect(only?.tree).toBeUndefined();
  });

  // The real on-disk path under `node_modules/@y-core/forge/`, so every path warden prints names a
  // file the reader can open and `--path forge/src` stays a usable scope.
  it("keeps a README's own directory, and carries the same shape as a docs entry", () => {
    const readme = librarySources(tree(LIBRARY)).find((source) => source.path.endsWith("README.md"));

    expect(readme?.path).toBe("forge/src/ui/README.md");
    expect(readme?.corpus).toBe("dependency");
    expect(readme?.tree).toBeUndefined();
  });

  // One assertion, because the ordering is the invariant: a library README must not outrank the
  // library's own rules, nor the consuming repository's README at 0.9.
  it("weighs a README below a docs entry", () => {
    const weights = Object.fromEntries(librarySources(tree(LIBRARY)).map((source) => [source.path, source.weight]));

    expect(weights).toEqual({ "forge/UI_CLASS_COMPOSITION.md": 0.9, "forge/src/ui/README.md": 0.65 });
  });
});

describe("dependencyWeightOf()", () => {
  it("answers by the kind of document, so `weightOf` and discovery cannot drift", () => {
    expect(dependencyWeightOf("forge/src/ui/README.md")).toBe(0.65);
    expect(dependencyWeightOf("forge/TESTING.md")).toBe(0.9);
  });
});

describe("libraryRoot()", () => {
  // Indexing the library from inside the library puts every consumer-facing document in twice, and
  // surfaces not as a duplicate but as an unrelated-looking catalogue-drift failure.
  it("returns nothing when the library is the repository being indexed", () => {
    expect(libraryRoot(resolve(WARDEN_ROOT, ".."))).toBeUndefined();
  });

  it("returns the installed library's own root for any other repository", () => {
    expect(libraryRoot(tree(LIBRARY))).toBe(resolve(WARDEN_ROOT, ".."));
  });

  it("answers nothing for a root that is not on disk", () => {
    expect(libraryRoot(join(tmpdir(), "warden-dependency-absent-nothing-here"))).toBeUndefined();
  });
});

describe("dependencyRootOf()", () => {
  it("is off unless asked, which is the default every config shares", () => {
    expect(dependencyRootOf({}, "/repo")).toBeUndefined();
    expect(dependencyRootOf({ dependency: false }, "/repo")).toBeUndefined();
  });

  it("takes a stated root over a derived one, so a test and an odd install shape both work", () => {
    expect(dependencyRootOf({ dependencyRoot: "/lib" }, "/repo")).toBe("/lib");
  });
});

describe("discover()", () => {
  it("indexes nothing of the library until a root is passed", () => {
    const repo = tree({ "docs/A.md": doc(undefined), "warden/canon/libs/CODE_RULES.md": doc(undefined) });
    const canonRoot = join(repo, "warden/canon");

    expect(discover(repo, "libs", { canonRoot }).some((source) => source.corpus === "dependency")).toBe(false);
    expect(discover(repo, "libs", { canonRoot, dependencyRoot: tree(LIBRARY) }).filter((source) => source.corpus === "dependency")).toHaveLength(2);
  });
});
