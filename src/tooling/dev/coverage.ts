import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { argv } from "node:process";

import { syncForge } from "./sync";
import type { ConsumerCoverageDeps, ConsumerCoverageOptions } from "./types";

const DEFAULT_DEPS: ConsumerCoverageDeps = {
  sync: syncForge,
  runSpec: (cwd, spec) => spawnSync("bun", ["test", `./${spec}`], { cwd, stdio: "inherit" }).status,
};

function readConsumerName(checkout: string): string {
  const manifest = join(checkout, "package.json");
  if (!existsSync(manifest)) return basename(checkout);
  return (JSON.parse(readFileSync(manifest, "utf-8")) as { name?: string }).name ?? basename(checkout);
}

/** What the sync left behind in the consumer, stated on every outcome after it ran. */
function overwriteNotice(checkout: string): string {
  return `${join(checkout, "node_modules/@y-core/forge")} now holds this checkout's pack, not its pinned release — \`bun i\` in ${checkout} restores the pin.`;
}

/** Packs this checkout into the consumer at `checkout` and runs its coverage spec there, answering the pass line and throwing on anything else. */
export function runConsumerCoverage(options: ConsumerCoverageOptions, deps: ConsumerCoverageDeps = DEFAULT_DEPS): string {
  const { checkout, spec } = options;
  if (!existsSync(checkout)) {
    throw new Error(
      `no consumer checkout at ${checkout} — the release gate runs ${spec} there against this checkout's packed tarball; clone the demonstrator to that path`,
    );
  }
  const specPath = join(checkout, spec);
  if (!existsSync(specPath)) {
    throw new Error(`${specPath} does not exist — the consumer's coverage spec has moved; update the path in package.json's release:gate script`);
  }

  deps.sync(checkout);
  const status = deps.runSpec(checkout, spec);
  if (status === null) throw new Error(`could not run \`bun test\` in ${checkout}. ${overwriteNotice(checkout)}`);
  if (status === 0) return `${spec} passed in ${checkout} against this checkout's packed tarball. ${overwriteNotice(checkout)}`;

  const name = readConsumerName(checkout);
  throw new Error(
    `${spec} failed in ${name} (${checkout}) against this checkout's packed tarball. Each component named above is published by forge and not demonstrated in ${name}: add its demo there, or excuse it in that repository's coverage-missing list with the task that owes it, before releasing. ${overwriteNotice(checkout)}`,
  );
}

if (import.meta.main) {
  const [checkout, spec] = argv.slice(2);
  if (!checkout || !spec) throw new Error("usage: bun run src/tooling/dev/coverage.ts <consumer checkout> <spec path>");
  console.log(runConsumerCoverage({ checkout: resolve(process.cwd(), checkout), spec }));
}
