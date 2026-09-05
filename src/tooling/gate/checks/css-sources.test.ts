import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { fail } from "../finding";
import { checkCssSources, type CssSourcesCheckConfig } from "./css-sources";

const CLASSES = 'export const cls = "flex gap-2";\n';

const SCAN_ALL = '@source "../ui";\n';

/** A throwaway root holding each `path: contents` pair, directories created as needed. */
function root(tree: Record<string, string>): string {
  const dir = mkdtempSync(resolve(tmpdir(), "forge-css-sources-"));
  for (const [path, contents] of Object.entries(tree)) {
    const abs = resolve(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, "utf-8");
  }
  return dir;
}

function config(tree: Record<string, string>, extra: Partial<CssSourcesCheckConfig> = {}): CssSourcesCheckConfig {
  return { root: root(tree), uiDir: "src/ui", cssDir: "src/css", sourceDir: "src", readme: "README.md", ...extra };
}

function messages(tree: Record<string, string>, extra: Partial<CssSourcesCheckConfig> = {}): string[] {
  return checkCssSources(config(tree, extra)).findings.map((finding) => finding.message);
}

const AGGREGATE = "Every utility class the library emits must be textually visible to a consumer's Tailwind scan.";

describe("checkCssSources() — the passing tree", () => {
  it("passes a directory the stylesheet scans, and counts what it covered", () => {
    const result = checkCssSources(config({ "src/css/tailwind.css": SCAN_ALL, "src/ui/core/button.ts": CLASSES, "README.md": "# forge\n" }));

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1 src/ui directories are @source-scanned or registered, and no class string hides behind one.");
  });

  it("refuses a component root holding no directory at all, rather than reporting a green vacuous scan", () => {
    const result = checkCssSources(config({ "src/css/tailwind.css": SCAN_ALL, "README.md": "# forge\n" }));

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([fail("`src/ui` holds no directory — refusing to report a green css-sources gate that scanned nothing")]);
    expect(result.summary).toBe("");
  });
});

describe("checkCssSources() — pass A, where an @source path points", () => {
  it("rejects a path resolving outside the component root", () => {
    const tree = { "src/css/tailwind.css": `@source "../../outside";\n${SCAN_ALL}`, "src/ui/core/button.ts": CLASSES };

    expect(messages(tree)).toEqual([`@source "../../outside" resolves outside src/ui/ (outside)`, AGGREGATE]);
  });

  it("blames the stylesheet that declared it, and says what an outside namespace does instead", () => {
    // `src/ui/core` is present so the walk is non-empty: without it the check refuses for vacuity
    // and never reaches the `@source` finding this case is about.
    const result = checkCssSources(config({ "src/css/tailwind.css": '@source "../../outside";\n', "src/ui/core/button.ts": CLASSES }));

    expect(result.findings[0]).toEqual({
      level: "fail",
      message: `@source "../../outside" resolves outside src/ui/ (outside)`,
      file: "src/css/tailwind.css",
      detail: [
        "The stylesheet scans src/ui/ and nothing else. A namespace outside it documents its own",
        "@source requirement in its README for the consuming app to honour instead.",
      ],
    });
  });

  it("ignores an @source not exclusion, which narrows a scan rather than declaring one", () => {
    const tree = { "src/css/tailwind.css": `${SCAN_ALL}@source not "../ui/**/*.test.ts";\n`, "src/ui/core/button.ts": CLASSES };

    expect(messages(tree)).toEqual([]);
  });
});

describe("checkCssSources() — pass B, whether a directory is registered", () => {
  it("rejects a directory no @source path covers and no registry names", () => {
    const tree = {
      "src/css/tailwind.css": '@source "../ui/core";\n',
      "src/ui/core/button.ts": CLASSES,
      "src/ui/widgets/panel.ts": "export const x = 1;\n",
    };

    expect(messages(tree)).toEqual(["no @source path in src/css/ covers it, and it is registered nowhere", AGGREGATE]);
  });

  it("names the directory and the three ways to register it", () => {
    const tree = {
      "src/css/tailwind.css": '@source "../ui/core";\n',
      "src/ui/core/button.ts": CLASSES,
      "src/ui/widgets/panel.ts": "export const x = 1;\n",
    };

    expect(checkCssSources(config(tree)).findings[0]).toEqual({
      level: "fail",
      message: "no @source path in src/css/ covers it, and it is registered nowhere",
      file: "src/ui/widgets",
      detail: [
        'Add `@source "../../widgets";` to the stylesheet if its files declare utility classes and every app needs them,',
        "or register it class-free with the reason it declares none,",
        "or register it consumer-scanned if it is an opt-in surface the app scans itself.",
      ],
    });
  });

  it("rejects an opt-in directory whose README does not publish the line an app must add", () => {
    const tree = {
      "src/css/tailwind.css": '@source "../ui/core";\n',
      "src/ui/core/button.ts": CLASSES,
      "src/ui/show/demo.ts": CLASSES,
      "README.md": "# forge\n",
    };
    const consumerScanned = new Map([["show", '@source "../node_modules/@y-core/forge/src/ui/show";']]);

    expect(messages(tree, { consumerScanned })).toEqual(["is opt-in, but README.md does not publish the line an app must add", AGGREGATE]);
  });

  it("accepts the same directory once the README carries that line verbatim", () => {
    const line = '@source "../node_modules/@y-core/forge/src/ui/show";';
    const tree = {
      "src/css/tailwind.css": '@source "../ui/core";\n',
      "src/ui/core/button.ts": CLASSES,
      "src/ui/show/demo.ts": CLASSES,
      "README.md": `Add ${line} to your stylesheet.\n`,
    };

    expect(messages(tree, { consumerScanned: new Map([["show", line]]) })).toEqual([]);
  });

  it("rejects a class-free registration for a directory that is not on disk", () => {
    const tree = { "src/css/tailwind.css": SCAN_ALL, "src/ui/core/button.ts": CLASSES };

    expect(messages(tree, { classFree: new Map([["ghost", "it ships no markup"]]) })).toEqual([
      "registered class-free, but does not exist on disk",
      AGGREGATE,
    ]);
  });

  it("re-checks a class-free claim against the files it covers, naming the tokens that broke it", () => {
    const tree = { "src/css/tailwind.css": '@source "../ui/core";\n', "src/ui/core/button.ts": CLASSES, "src/ui/assets/tokens.ts": CLASSES };

    expect(checkCssSources(config(tree, { classFree: new Map([["assets", "it ships stylesheets, not markup"]]) })).findings[0]).toEqual({
      level: "fail",
      message: "string literal declares utility classes — flex gap-2",
      file: "src/ui/assets/tokens.ts",
      detail: [
        "in: flex gap-2",
        "Either move the declaration into an @source-scanned directory, or drop this",
        "directory from the class-free registry and give it an @source path.",
      ],
    });
  });

  it("leaves a class-free directory's specs alone, whose class strings are fragments of asserted markup", () => {
    const tree = { "src/css/tailwind.css": '@source "../ui/core";\n', "src/ui/core/button.ts": CLASSES, "src/ui/assets/tokens.test.ts": CLASSES };

    expect(messages(tree, { classFree: new Map([["assets", "it ships stylesheets, not markup"]]) })).toEqual([]);
  });

  it("checks a file sitting loose at the component root, which no subdirectory registration covers", () => {
    const tree = { "src/css/tailwind.css": '@source "../ui/core";\n', "src/ui/core/button.ts": CLASSES, "src/ui/mod.ts": CLASSES };

    expect(messages(tree)).toEqual(["string literal declares utility classes — flex gap-2", AGGREGATE]);
  });
});

describe("checkCssSources() — pass C, a sibling namespace that renders classes", () => {
  it("rejects a namespace outside the component root whose README never mentions @source", () => {
    const tree = { "src/css/tailwind.css": SCAN_ALL, "src/ui/core/button.ts": CLASSES, "src/logging/show.ts": CLASSES };

    expect(checkCssSources(config(tree)).findings[0]).toEqual({
      level: "fail",
      message: "renders utility classes, but its README.md never mentions @source",
      file: "src/logging",
      detail: [
        "src/logging/show.ts",
        "The stylesheet scans src/ui/ only, so these classes are the consuming app's to scan.",
        "Say so in src/logging/README.md, where someone adopting this surface reads it.",
      ],
    });
  });

  it("accepts it once its own README says an app must scan it", () => {
    const tree = {
      "src/css/tailwind.css": SCAN_ALL,
      "src/ui/core/button.ts": CLASSES,
      "src/logging/show.ts": CLASSES,
      "src/logging/README.md": "Add an @source line for this directory.\n",
    };

    expect(messages(tree)).toEqual([]);
  });

  it("leaves a sibling that declares no utility class alone, README or not", () => {
    const tree = { "src/css/tailwind.css": SCAN_ALL, "src/ui/core/button.ts": CLASSES, "src/logging/show.ts": "export const level = 'info';\n" };

    expect(messages(tree)).toEqual([]);
  });
});
