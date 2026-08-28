import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkModernCss, type ModernCssCheckConfig } from "./modern-css";
import type { DeferredFinding } from "./modern-css-deferred";

/** A throwaway repository root holding exactly the files given. */
function fixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-modern-css-check-"));
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
  }
  return root;
}

function run(root: string, extra: Partial<ModernCssCheckConfig> = {}) {
  return checkModernCss({ root, sources: ["src/ui"], deferred: [], ...extra });
}

const messages = (root: string, extra: Partial<ModernCssCheckConfig> = {}) => run(root, extra).findings.map((finding) => finding.message);

const CORPUS = "src/ui/design/reference/16-platform.md";

/** A fixture stylesheet with the layer declared after it, so Tier C's adoption rule stays silent
 *  without moving any line number the Tier A expectations name. */
const LAYERED = (css: string): string => `${css}@layer base;\n`;

describe("checkModernCss() — the tree it walks", () => {
  it("passes a tree that violates nothing", () => {
    const root = fixtureRoot({ "src/ui/a.css": LAYERED(".a {\n  aspect-ratio: 16 / 9;\n}\n") });
    const result = run(root);

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1 files scanned against 40 rules, 0 deferred.");
  });

  it("fails rather than passing vacuously when the sources match no file", () => {
    const root = fixtureRoot({ "README.md": "# nothing to scan\n" });
    const result = run(root);

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`src/ui` matched no stylesheet or source — refusing to report a green modern-CSS gate that scanned nothing",
    ]);
  });

  it("skips a subtree a `!` entry excludes", () => {
    const root = fixtureRoot({
      "src/ui/design/sample.css": LAYERED(".a {\n  margin-left: 1rem;\n}\n"),
      "src/ui/a.css": LAYERED(".b {\n  color: red;\n}\n"),
    });

    expect(messages(root, { sources: ["src/ui", "!src/ui/design"] })).toEqual([]);
  });

  it("scans the excluded subtree when nothing excludes it", () => {
    const root = fixtureRoot({ "src/ui/design/sample.css": LAYERED(".a {\n  margin-left: 1rem;\n}\n") });

    expect(messages(root)).toEqual([
      `forge-ui-platform-logical-spacing: physical property \`margin-left\` — use \`margin-inline-start\` (${CORPUS})`,
    ]);
  });

  it("reads neither a test file nor a browser file", () => {
    const root = fixtureRoot({
      "src/ui/a.test.tsx": 'const cls = "flex items-center pr-4";\n',
      "src/ui/a.browser.ts": 'const cls = "flex items-center pr-4";\n',
      "src/ui/a.css": LAYERED(".b {\n  color: red;\n}\n"),
    });

    expect(run(root).summary).toBe("1 files scanned against 40 rules, 0 deferred.");
  });

  it("reports the file and 1-indexed line of each violation", () => {
    const root = fixtureRoot({ "src/ui/a.css": LAYERED(".a {\n  z-index: -1;\n}\n") });

    expect(run(root).findings).toEqual([
      {
        level: "fail",
        file: "src/ui/a.css",
        line: 2,
        message: `forge-ui-platform-isolation: \`z-index: -1\` escapes the parent's paint order — create a stacking context with \`isolation: isolate\` (${CORPUS})`,
      },
    ]);
  });

  it("honours a suppression comment in the scanned file", () => {
    const root = fixtureRoot({
      "src/ui/a.css": LAYERED(".a {\n  /* modern-css-allow: forge-ui-platform-isolation — behind an ancestor on purpose */\n  z-index: -1;\n}\n"),
    });

    expect(messages(root)).toEqual([]);
  });
});

describe("checkModernCss() — the deferral list", () => {
  const deferral: DeferredFinding = { path: "src/ui/a.css", ruleId: "forge-ui-platform-isolation", owner: "task-1" };

  it("filters a violation the list defers and counts it in the summary", () => {
    const root = fixtureRoot({ "src/ui/a.css": LAYERED(".a {\n  z-index: -1;\n}\n") });
    const result = run(root, { deferred: [deferral] });

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1 files scanned against 40 rules, 1 deferred.");
  });

  it("defers every file under a directory prefix", () => {
    const root = fixtureRoot({ "src/ui/core/a.css": LAYERED(".a {\n  z-index: -1;\n}\n") });

    expect(messages(root, { deferred: [{ path: "src/ui/core", ruleId: "forge-ui-platform-isolation", owner: "task-1" }] })).toEqual([]);
  });

  it("defers only the rule it names", () => {
    const root = fixtureRoot({ "src/ui/a.css": LAYERED(".a {\n  z-index: -1;\n  margin-left: 1rem;\n}\n") });

    expect(messages(root, { deferred: [deferral] })).toEqual([
      `forge-ui-platform-logical-spacing: physical property \`margin-left\` — use \`margin-inline-start\` (${CORPUS})`,
    ]);
  });

  it("refuses an entry whose file no longer violates the rule", () => {
    const root = fixtureRoot({ "src/ui/a.css": LAYERED(".a {\n  isolation: isolate;\n}\n") });

    expect(messages(root, { deferred: [deferral] })).toEqual([
      "`src/ui/a.css` defers `forge-ui-platform-isolation`, which it no longer violates — delete the entry, the list only shrinks",
    ]);
  });

  it("refuses an entry naming a path the scan never reaches", () => {
    const root = fixtureRoot({ "src/ui/a.css": LAYERED(".a {\n  z-index: -1;\n}\n") });

    expect(messages(root, { deferred: [{ path: "src/ui/gone.css", ruleId: "forge-ui-platform-isolation", owner: "task-1" }] })).toEqual([
      `forge-ui-platform-isolation: \`z-index: -1\` escapes the parent's paint order — create a stacking context with \`isolation: isolate\` (${CORPUS})`,
      "`src/ui/gone.css` defers `forge-ui-platform-isolation`, which it no longer violates — delete the entry, the list only shrinks",
    ]);
  });

  it("refuses an entry with no owner", () => {
    const root = fixtureRoot({ "src/ui/a.css": LAYERED(".a {\n  z-index: -1;\n}\n") });

    expect(messages(root, { deferred: [{ ...deferral, owner: "  " }] })).toEqual([
      `forge-ui-platform-isolation: \`z-index: -1\` escapes the parent's paint order — create a stacking context with \`isolation: isolate\` (${CORPUS})`,
      "`src/ui/a.css` defers `forge-ui-platform-isolation` with no owner — a deferral names the task that closes it",
    ]);
  });

  it("does not let a deferral suppress a violation a suppression comment already covers", () => {
    const root = fixtureRoot({
      "src/ui/a.css": LAYERED(".a {\n  /* modern-css-allow: forge-ui-platform-isolation — behind an ancestor on purpose */\n  z-index: -1;\n}\n"),
    });

    expect(messages(root, { deferred: [deferral] })).toEqual([
      "`src/ui/a.css` defers `forge-ui-platform-isolation`, which it no longer violates — delete the entry, the list only shrinks",
    ]);
  });
});
