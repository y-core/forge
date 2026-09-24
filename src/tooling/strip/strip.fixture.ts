import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const TRACKED: Record<string, string> = {
  ".gitignore": "node_modules/\n*.log\n",
  "README.md": "# app\n",
  "src/app.ts": 'import { demo } from "./showcase/demo"; // strip:showcase\nexport const app = 1;\nregister(demo); // strip:showcase\n',
  "src/router.ts": "export const routes = [];\nroutes.push(showcase); // strip:router\n",
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

function write(root: string, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents, "utf-8");
  }
}

/** A git working tree holding tracked, untracked and ignored files, plus one tracked file since deleted from disk. */
export function stripFixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-strip-repo-"));
  write(root, TRACKED);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["add", ...Object.keys(TRACKED)], { cwd: root });
  rmSync(join(root, "gone.ts"));
  write(root, UNTRACKED);
  return root;
}
