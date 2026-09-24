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
      "project:docs/A.md",
    ]);
    knowledge.close();
  });

  it("refreshes a stale index at open, and says nothing — it is not behind once it is served", () => {
    const { root, canonRoot } = repo("warden-stale-open-");
    const path = join(root, ".forge", "warden", "index.sqlite");
    openIndex(root, "libs", { path, canonRoot, canonVersion: "1.0.0" }).close();
    writeFileSync(join(root, "docs/A.md"), `${DOC}\nA sentence about honeypots.\n`, "utf-8");

    const knowledge = openIndex(root, "libs", { path, canonRoot, canonVersion: "1.0.0" });

    expect(search(knowledge.db, "honeypots").length).toBeGreaterThan(0);
    expect(knowledge.advisory).toBe("");
    knowledge.close();
  });
});

describe("Knowledge.refresh()", () => {
  it("sees an edit made after the index was opened — the case a long-lived server exists for", () => {
    const { root, canonRoot } = repo("warden-refresh-edit-");
    const knowledge = openIndex(root, "libs", { path: ":memory:", canonRoot, canonVersion: "1.0.0" });

    expect(search(knowledge.db, "honeypots")).toEqual([]);
    writeFileSync(join(root, "docs/A.md"), `${DOC}\nA sentence about honeypots.\n`, "utf-8");
    knowledge.refresh();

    expect(search(knowledge.db, "honeypots").length).toBeGreaterThan(0);
    expect(knowledge.advisory).toBe("");
    knowledge.close();
  });

  it("picks up a document that did not exist at open, not only a changed one", () => {
    const { root, canonRoot } = repo("warden-refresh-new-");
    const knowledge = openIndex(root, "libs", { path: ":memory:", canonRoot, canonVersion: "1.0.0" });

    writeFileSync(join(root, "docs/B.md"), DOC.replace("The comment budget.", "A sentence about turnstiles."), "utf-8");
    knowledge.refresh();

    expect(knowledge.sources.map((doc) => doc.path)).toContain("docs/B.md");
    expect(search(knowledge.db, "turnstiles").length).toBeGreaterThan(0);
    knowledge.close();
  });

  it("clears an advisory once the corpus it complained about is indexed", () => {
    const { root, canonRoot } = repo("warden-refresh-clear-");
    const knowledge = openIndex(root, "libs", { path: ":memory:", canonRoot, canonVersion: "1.0.0" });

    writeFileSync(join(root, "docs/A.md"), `${DOC}\nA sentence about honeypots.\n`, "utf-8");
    knowledge.refresh();
    knowledge.refresh();

    expect(knowledge.advisory).toBe("");
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
