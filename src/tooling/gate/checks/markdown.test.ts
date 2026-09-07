import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkMarkdown, fixMarkdown, resolveMarkdownFiles } from "./markdown";

const CLEAN = "# Title\n\nProse with **strong** and _em_.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
const PADDED = "# Title\n\n| A   | B |\n| --- | --- |\n| 1   | 2 |\n";

/** A throwaway tree holding `files`, keyed by repo-relative path. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-markdown-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, "utf-8");
  }
  return root;
}

describe("resolveMarkdownFiles()", () => {
  it("walks a directory and accepts a single file, deduped and sorted", () => {
    const root = fixture({ "docs/b.md": CLEAN, "docs/a.md": CLEAN, "docs/a.ts": "", "README.md": CLEAN });

    expect(resolveMarkdownFiles({ root, sources: ["docs", "README.md", "docs"] })).toEqual(["README.md", "docs/a.md", "docs/b.md"]);
  });

  it("honours a `!`-prefixed source and the exclude list alike", () => {
    const root = fixture({ "src/a.md": CLEAN, "src/gen/b.md": CLEAN, "CHANGELOG.md": CLEAN });

    expect(resolveMarkdownFiles({ root, sources: ["src", "!src/gen", "CHANGELOG.md"], exclude: ["CHANGELOG.md"] })).toEqual(["src/a.md"]);
  });

  it("defaults to `src`", () => {
    const root = fixture({ "src/a.md": CLEAN, "docs/b.md": CLEAN });

    expect(resolveMarkdownFiles({ root })).toEqual(["src/a.md"]);
  });
});

describe("checkMarkdown()", () => {
  it("passes a clean tree, and counts what it scanned", () => {
    const root = fixture({ "docs/a.md": CLEAN });
    const result = checkMarkdown({ root, sources: ["docs"] });

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1 markdown files scanned, 0 findings — `bun run fix` applies the mechanical ones.");
  });

  it("reports each file's findings against the repo-relative path", () => {
    const root = fixture({ "docs/a.md": PADDED });
    const result = checkMarkdown({ root, sources: ["docs"] });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([{ level: "fail", message: "table is padded — one space per cell side", file: "docs/a.md", line: 3 }]);
  });

  it("refuses a green when the scan set is empty", () => {
    const root = fixture({ "docs/a.ts": "" });
    const result = checkMarkdown({ root, sources: ["docs"] });

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("`docs` matched no markdown file — refusing to report a green markdown gate that scanned nothing");
  });

  it("writes nothing", () => {
    const root = fixture({ "docs/a.md": PADDED });
    checkMarkdown({ root, sources: ["docs"] });

    expect(readFileSync(join(root, "docs/a.md"), "utf-8")).toBe(PADDED);
  });
});

describe("fixMarkdown()", () => {
  it("rewrites a file the rules change", () => {
    const root = fixture({ "docs/a.md": PADDED });
    fixMarkdown({ root, sources: ["docs"] });

    expect(readFileSync(join(root, "docs/a.md"), "utf-8")).toBe("# Title\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    expect(checkMarkdown({ root, sources: ["docs"] }).ok).toBe(true);
  });

  // Read-only rather than a timestamp: a write the fixer had no reason to make is then an error it
  // cannot swallow, and the assertion does not depend on the clock's resolution.
  it("does not write a file the rules would not change", () => {
    const root = fixture({ "docs/a.md": CLEAN });
    chmodSync(join(root, "docs/a.md"), 0o444);

    expect(() => fixMarkdown({ root, sources: ["docs"] })).not.toThrow();
    expect(readFileSync(join(root, "docs/a.md"), "utf-8")).toBe(CLEAN);
  });

  it("never reaches a file the config excluded", () => {
    const root = fixture({ "docs/a.md": PADDED, "gen/b.md": PADDED });
    fixMarkdown({ root, sources: ["docs", "gen"], exclude: ["gen"] });

    expect(readFileSync(join(root, "gen/b.md"), "utf-8")).toBe(PADDED);
  });
});
