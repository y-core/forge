import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { FeatureManifest } from "./types";

const TRACKED: Record<string, string> = {
  ".gitignore": "node_modules/\n*.log\n",
  "README.md": "# app\n<!-- feature:showcase:begin -->\n## Showcase\n<!-- feature:showcase:end -->\nStart here.\n",
  "config/app.toml": 'name = "app"\ncontact = true # feature:contact\n',
  "src/app.ts": [
    'import { demo } from "./showcase/demo"; // feature:showcase',
    'import { contact } from "./contact/form"; // feature:contact',
    "export const app = 1;",
    "register(demo); /* feature:showcase */",
    "mountShared(demo, contact); // feature:showcase,contact",
    "",
  ].join("\n"),
  "src/contact/form.ts": "export const contact = 1;\n",
  "src/showcase/demo.ts": "export const demo = 1;\n",
  "src/showcase/nested/panel.ts": "export const panel = 1;\n",
  "gone.ts": "export const gone = 1;\n",
};

const UNTRACKED: Record<string, string> = {
  "notes.txt": "untracked, not ignored\n",
  "tests/showcase/demo.test.ts": "// untracked spec\n",
  "debug.log": "ignored\n",
  "node_modules/pkg/index.js": "module.exports = 1;\n",
};

/** The manifest the fixture's markers are written against, as `CURATE_FIXTURE_MANIFEST` spells it. */
export const CURATE_FIXTURE_FEATURES: FeatureManifest = {
  showcase: { directories: ["src/showcase/"], seams: ["src/app.ts", "README.md"] },
  contact: { directories: ["src/contact"], seams: ["src/app.ts", "config/app.toml"] },
};

/** `CURATE_FIXTURE_FEATURES` as a `config/features.ts` module, each feature's entry marked so a curation keeps exactly the remaining ones. */
export const CURATE_FIXTURE_MANIFEST = [
  "export default {",
  '  showcase: { directories: ["src/showcase/"], seams: ["src/app.ts", "README.md"] }, // feature:showcase',
  "  // feature:contact:begin",
  '  contact: { directories: ["src/contact"], seams: ["src/app.ts", "config/app.toml"] },',
  "  // feature:contact:end",
  "};",
  "",
].join("\n");

function write(root: string, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents, "utf-8");
  }
}

/** A git working tree holding tracked, untracked and ignored files, plus one tracked file since deleted from disk; `manifest` adds an untracked `config/features.ts`. */
export function curateFixtureRepo(manifest?: string): string {
  const root = mkdtempSync(join(tmpdir(), "forge-curate-repo-"));
  write(root, TRACKED);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["add", ...Object.keys(TRACKED)], { cwd: root });
  rmSync(join(root, "gone.ts"));
  write(root, manifest === undefined ? UNTRACKED : { ...UNTRACKED, "config/features.ts": manifest });
  return root;
}
