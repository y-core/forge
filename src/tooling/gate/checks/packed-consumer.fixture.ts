import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { syncForge } from "../../dev/sync";

const ROOT = resolve(import.meta.dir, "../../../..");

/** A consumer holding forge as `dev:forge` installs it, with forge's dependencies linked from this checkout; the caller removes it. */
export function packedConsumer(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-packed-consumer-"));
  mkdirSync(join(root, "node_modules", "@y-core", "forge"), { recursive: true });
  syncForge(root);
  const { dependencies } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { dependencies: Record<string, string> };
  for (const name of Object.keys(dependencies)) {
    mkdirSync(dirname(join(root, "node_modules", name)), { recursive: true });
    symlinkSync(join(ROOT, "node_modules", name), join(root, "node_modules", name));
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  return root;
}
