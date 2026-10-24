import { existsSync, readFileSync, statSync } from "node:fs";
import { posix } from "node:path";

import { importClosure } from "../src/tooling/assets/closure";
import { loadWranglerConfig } from "../src/tooling/cf/config/parse";
import { worktreeFiles } from "../src/tooling/cli/worktree";
import { workerMainClosure } from "../src/tooling/gate/closure";
import { readSpecReferences } from "./spec-read";

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;

const WORKER_CONFIG = /(?:^|\/)wrangler\.(?:jsonc?|toml)$/;

/** Every path, relative to the repository root, that a spec at `file` names through `new URL(…, import.meta.url)`, a directory excepted; throws on one that does not exist. */
export function urlReferences(root: string, urls: readonly string[], file: string): string[] {
  return urls.flatMap((url) => {
    const path = posix.normalize(posix.join(posix.dirname(file), url));
    const full = `${root}/${path}`;
    if (!existsSync(full)) throw new Error(`${file}: \`new URL("${url}")\`, which names nothing on disk, cannot be traced`);
    return statSync(full).isDirectory() ? [] : [path.replace(/\/$/, "")];
  });
}

async function referenceReach(root: string, path: string): Promise<string[]> {
  if (WORKER_CONFIG.test(path)) {
    const serves = loadWranglerConfig(`${root}/${path}`).config.main !== undefined;
    return [path, ...(serves ? await workerMainClosure(root, path) : [])];
  }
  if (CODE_FILE.test(path)) return importClosure(root, [`./${path}`]);
  return [path];
}

function specsIn(root: string, accept: (path: string) => boolean): string[] {
  const files = worktreeFiles(root);
  if (files === undefined) throw new Error(`${root} is not a git work tree, so its specs cannot be listed`);
  return files.filter((path) => accept(path) && existsSync(`${root}/${path}`));
}

async function specReach(root: string, specs: readonly string[], exposeFrom?: string): Promise<string[]> {
  const read = specs.map((file) => ({ file, ...readSpecReferences(readFileSync(`${root}/${file}`, "utf-8"), file) }));
  const references = [...new Set(read.flatMap(({ file, urls }) => urlReferences(root, urls, file)))];
  const specifiers = exposeFrom === undefined ? [] : [...new Set(read.flatMap((spec) => spec.specifiers))];
  const reached = await Promise.all([...references.map((path) => referenceReach(root, path)), importClosure(root, specifiers, exposeFrom ?? root)]);
  return [...new Set(reached.flat())].sort();
}

/** Every path, relative to `root`, a browser spec reaches without importing it: the modules it exposes, the Workers it serves and the files it names, each with its import closure. */
export function browserSpecReach(root: string): Promise<string[]> {
  return specReach(
    root,
    specsIn(root, (path) => path.startsWith("src/") && path.endsWith(".browser.ts")),
    `${root}/src`,
  );
}

/** Every path, relative to `root`, a workerd spec or its helpers reach without importing them: the Workers they serve and the files they name, each with its import closure. */
export function workerdSpecReach(root: string): Promise<string[]> {
  return specReach(
    root,
    specsIn(root, (path) => path.startsWith("tests/workerd/") && CODE_FILE.test(path)),
  );
}
