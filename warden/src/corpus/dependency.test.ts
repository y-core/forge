import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { WARDEN_ROOT } from "../paths";
import { audienceOf, dependencyRootOf, libraryRoot, librarySources } from "./dependency";
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
  it("serves the consumer-facing documents and nothing else", () => {
    expect(librarySources(tree(LIBRARY)).map((source) => source.path)).toEqual(["forge/UI_CLASS_COMPOSITION.md"]);
  });

  // A bare filename collides with the canon on six names; `docs/` collides with the consuming
  // repository's own. This spelling collides with neither and makes `--path forge` a usable scope.
  it("spells a path under the package's own last segment, never as `docs/`", () => {
    const [only] = librarySources(tree(LIBRARY));

    expect(only?.path).toBe("forge/UI_CLASS_COMPOSITION.md");
    expect(only?.corpus).toBe("dependency");
    expect(only?.tree).toBeUndefined();
    expect(only?.weight).toBe(0.95);
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
    expect(discover(repo, "libs", { canonRoot, dependencyRoot: tree(LIBRARY) }).filter((source) => source.corpus === "dependency")).toHaveLength(1);
  });
});
