import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { search } from "../search/search";
import { openIndex, rebuild } from "./open";

const DOC =
  '---\ntitle: Rules\ndescription: "One."\n---\n\n## 0. Quick Reference\n\n- §1 One: the comment budget\n\n## 1. One\n\nThe comment budget.\n';

function repo(prefix: string): { root: string; canonRoot: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const canonRoot = join(root, "canon");
  for (const path of [join(root, "docs/A.md"), join(canonRoot, "libs/CODE_RULES.md"), join(canonRoot, "shared/AGENT_GUIDE.md")]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, DOC, "utf-8");
  }
  return { root, canonRoot };
}

describe("openIndex()", () => {
  it("builds an absent index rather than refusing — a search must never need a prior command", () => {
    const { root, canonRoot } = repo("warden-open-");
    const path = join(root, ".forge", "warden", "index.sqlite");

    expect(existsSync(path)).toBe(false);

    const knowledge = openIndex(root, "libs", { path, canonRoot, canonVersion: "1.0.0" });

    expect(existsSync(path)).toBe(true);
    expect(search(knowledge.db, "comment budget").length).toBeGreaterThan(0);
    expect(knowledge.advisory).toBe("");
    knowledge.close();
  });

  it("indexes the canon and this repository's own documents into one database", () => {
    const { root, canonRoot } = repo("warden-both-");
    const knowledge = openIndex(root, "libs", { path: ":memory:", canonRoot, canonVersion: "1.0.0" });

    expect(knowledge.sources.map((doc) => `${doc.corpus}:${doc.path}`).sort()).toEqual([
      "canon:AGENT_GUIDE.md",
      "canon:CODE_RULES.md",
      "local:docs/A.md",
    ]);
    knowledge.close();
  });

  it("answers over a stale index, says it is behind, and refreshes it", () => {
    const { root, canonRoot } = repo("warden-stale-open-");
    const path = join(root, ".forge", "warden", "index.sqlite");
    openIndex(root, "libs", { path, canonRoot, canonVersion: "1.0.0" }).close();
    writeFileSync(join(root, "docs/A.md"), `${DOC}\nA sentence about honeypots.\n`, "utf-8");

    const knowledge = openIndex(root, "libs", { path, canonRoot, canonVersion: "1.0.0" });

    expect(knowledge.advisory).toContain("index is behind the corpus");
    expect(search(knowledge.db, "honeypots").length).toBeGreaterThan(0);
    knowledge.close();
  });
});

describe("rebuild()", () => {
  it("reports what it wrote and leaves the database closed", () => {
    const { root, canonRoot } = repo("warden-rebuild-");

    const report = rebuild(root, "libs", { path: join(root, "index.sqlite"), canonRoot, canonVersion: "1.0.0" });

    expect(report.documents).toBe(3);
    expect(report.chunks).toBe(3);
  });
});
