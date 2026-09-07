import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { canonSources, discover, localSources, repoRelative, weightOf } from "./source";

function tree(files: readonly string[], prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const path of files) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "# doc\n", "utf-8");
  }
  return root;
}

describe("weightOf()", () => {
  it("ranks the canon above this repository's docs, and both above a README", () => {
    expect(weightOf("canon", "CODE_RULES.md")).toBe(1.3);
    expect(weightOf("local", "src/ui/design/floor.md")).toBe(1.3);
    expect(weightOf("local", "docs/NAMESPACES.md")).toBe(1.2);
    expect(weightOf("local", "src/ui/design/reference/04-color.md")).toBe(1.0);
    expect(weightOf("local", "src/ui/README.md")).toBe(0.9);
    expect(weightOf("local", "README.md")).toBe(0.9);
  });
});

describe("canonSources()", () => {
  const canon = tree(["shared/AGENT_GUIDE.md", "libs/CODE_RULES.md", "apps/APP_ARCHITECTURE.md"], "warden-canon-");

  it("takes `shared` and the repository's own tree, and never the other one", () => {
    expect(canonSources("libs", canon).map((doc) => `${doc.tree}/${doc.path}`)).toEqual(["shared/AGENT_GUIDE.md", "libs/CODE_RULES.md"]);
  });

  it("indexing the other tree would return two hits for every shared rule, so it does not", () => {
    expect(canonSources("apps", canon).map((doc) => doc.tree)).toEqual(["shared", "apps"]);
  });

  it("strips the tree from the path, so a citation spells the document and not its directory", () => {
    expect(canonSources("libs", canon).map((doc) => doc.path)).toEqual(["AGENT_GUIDE.md", "CODE_RULES.md"]);
  });
});

describe("localSources()", () => {
  it("takes docs/, the design corpus, every source README, and the front page", () => {
    const root = tree(["docs/NAMESPACES.md", "src/ui/design/floor.md", "src/ui/README.md", "src/ui/core/button.tsx", "README.md"], "warden-local-");

    expect(localSources(root).map((doc) => doc.path)).toEqual(["README.md", "docs/NAMESPACES.md", "src/ui/README.md", "src/ui/design/floor.md"]);
  });

  it("lists a document under both `docs/` and a README root exactly once", () => {
    const root = tree(["docs/README.md"], "warden-dedupe-");

    expect(localSources(root).map((doc) => doc.path)).toEqual(["docs/README.md"]);
  });
});

describe("discover()", () => {
  it("puts the canon first and spells every path with forward slashes", () => {
    const canonRoot = tree(["libs/CODE_RULES.md"], "warden-discover-canon-");
    const root = tree(["docs/NAMESPACES.md"], "warden-discover-repo-");

    expect(discover(root, "libs", { canonRoot }).map((doc) => `${doc.corpus}:${doc.path}`)).toEqual([
      "canon:CODE_RULES.md",
      "local:docs/NAMESPACES.md",
    ]);
  });
});

describe("repoRelative()", () => {
  it("spells a path the way an id does, whatever the host separator", () => {
    expect(repoRelative("/repo", "/repo/docs/A.md")).toBe("docs/A.md");
  });
});
