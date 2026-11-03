import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import pkg from "../../../package.json" with { type: "json" };

const FORGE = resolve(import.meta.dir, "../../..");
// Forge's own tsconfig lists `src/` before `.types/`, and a later ambient declaration of a module's
// function is the overload tried first, so `.types/node.d.ts`'s callable `createRequire` has to come last.
const RUNTIME_STUBS = [
  "src/testing/node.d.ts",
  ...["bun-build", "bun-sqlite", "bun-test", "crypto", "import-meta", "node", "workers"].map((stub) => `.types/${stub}.d.ts`),
];

/** Every peer forge's manifest marks optional, which a consumer's install may lack. */
export const OPTIONAL_PEERS: readonly string[] = Object.entries(pkg.peerDependenciesMeta)
  .filter(([, meta]) => meta.optional)
  .map(([peer]) => peer);

/** Bounds one `bun check` run of a consumer project. */
export const TYPECHECK_TIMEOUT = 60_000;

/** A consumer's install of forge in a temporary directory, holding forge's own dependencies and none of its optional peers. */
export interface ConsumerInstall {
  readonly typecheck: (source: string) => { status: number | null; output: string };
  readonly dispose: () => void;
}

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
}

// `preserveSymlinks` keeps resolution walking up from the linked path rather than forge's own tree,
// so a peer forge's checkout installs is not one the consumer can see.
/** Installs forge into a fresh consumer directory, ready to type-check sources that import it. */
export function createConsumerInstall(prefix: string): ConsumerInstall {
  const consumer = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const installed = join(consumer, "node_modules", pkg.name);
  link(join(FORGE, "package.json"), join(installed, "package.json"));
  link(join(FORGE, "src"), join(installed, "src"));
  for (const dependency of Object.keys(pkg.dependencies)) link(join(FORGE, "node_modules", dependency), join(consumer, "node_modules", dependency));

  let runs = 0;
  const typecheck = (source: string): { status: number | null; output: string } => {
    const name = `project${runs++}`;
    writeFileSync(join(consumer, `${name}.ts`), source);
    const compilerOptions = {
      target: "ESNext",
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "Bundler",
      allowImportingTsExtensions: true,
      preserveSymlinks: true,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    };
    const files = [`${name}.ts`, ...RUNTIME_STUBS.map((stub) => join(FORGE, stub))];
    const config = join(consumer, `${name}.tsconfig.json`);
    writeFileSync(config, JSON.stringify({ compilerOptions, files }));
    const run = spawnSync("bun", ["check", "--no-script", "--no-pretty", "-p", config], { encoding: "utf-8" });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  };

  return { typecheck, dispose: () => rmSync(consumer, { recursive: true, force: true }) };
}

/** A consumer source that imports one forge subpath whole. */
export function entrySource(subpath: string): string {
  return `import * as entry from "${pkg.name}/${subpath}";\n\nexport const namespace: object = entry;\n`;
}

/** A consumer source that names every peer in a type position, so it compiles only where each one resolves. */
export function peerSource(peers: readonly string[]): string {
  return peers.map((peer, i) => `import type * as peer${i} from "${peer}";\nexport type Peer${i} = typeof peer${i};\n`).join("");
}
