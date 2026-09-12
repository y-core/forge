import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { DbIo, Spawned } from "./types";

/** Every `node_modules/.bin` on the way up from `from`, nearest first, so the app's wrangler wins over forge's own. */
function binDirs(from: string): string[] {
  const found: string[] = [];
  for (let dir = from; ; dir = dirname(dir)) {
    const bin = join(dir, "node_modules", ".bin");
    if (existsSync(bin)) found.push(bin);
    if (dirname(dir) === dir) return found;
  }
}

/** The real side effects: node's filesystem, a spawned wrangler, and the process environment. @internal */
export function realDbIo(root: string, log: (line: string) => void = (line) => console.error(line)): DbIo {
  const path = [...binDirs(root), ...binDirs(dirname(fileURLToPath(import.meta.url))), process.env.PATH ?? ""].join(delimiter);
  // `FORCE_COLOR: "0"`: bun 1.4 colourises a pipe, and `parseJsonOutput` reads a line starting with
  // an escape byte as "printed no JSON".
  const env = { ...process.env, PATH: path, WRANGLER_SEND_METRICS: "false", FORCE_COLOR: "0" };
  return {
    spawn(cmd, args, opts): Spawned {
      const r = spawnSync(cmd, [...args], {
        cwd: opts.cwd,
        env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 256 * 1024 * 1024,
      });
      const reason = r.error ? `${r.error.message}\n` : "";
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: `${r.stderr ?? ""}${reason}` };
    },
    exists: (p) => existsSync(p),
    readText: (p) => readFileSync(p, "utf-8"),
    writeText: (p, text) => writeFileSync(p, text, { encoding: "utf-8", mode: 0o600 }),
    createExclusive: (p, text) => {
      try {
        writeFileSync(p, text, { encoding: "utf-8", flag: "wx", mode: 0o600 });
        return true;
      } catch (error) {
        if ((error as { code?: string }).code === "EEXIST") return false;
        throw error;
      }
    },
    readDir: (p) => readdirSync(p),
    rename: (from, to) => renameSync(from, to),
    mkdir: (p) => mkdirSync(p, { recursive: true, mode: 0o700 }),
    remove: (p) => rmSync(p, { recursive: true, force: true }),
    mtime: (p) => (existsSync(p) ? statSync(p).mtimeMs : null),
    now: () => new Date(),
    env: process.env,
    log,
  };
}
