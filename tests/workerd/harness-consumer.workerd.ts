import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./harness.fixture";

const FORGE = fileURLToPath(new URL("../../", import.meta.url));
const CONFIG = fileURLToPath(new URL("../fixtures/workers-form/wrangler.jsonc", import.meta.url));

const SPEC = `
const { serveWorker } = await import("@y-core/forge/testing/harness");
const { harness, origin } = await serveWorker({ config: ${JSON.stringify(CONFIG)} });
try {
  console.log(JSON.stringify({ status: (await fetch(origin + "/api/contact")).status }));
} finally {
  await harness.close();
}
`;

/** A consumer whose `node_modules` holds forge as an install does — copied, so node sees it under `node_modules` — and wrangler beside it. */
function consumerRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-harness-consumer-"));
  const installed = join(root, "node_modules", "@y-core", "forge");
  mkdirSync(installed, { recursive: true });
  cpSync(join(FORGE, "package.json"), join(installed, "package.json"));
  cpSync(join(FORGE, "src", "testing"), join(installed, "src", "testing"), { recursive: true });
  symlinkSync(join(FORGE, "node_modules", "wrangler"), join(root, "node_modules", "wrangler"));
  writeFileSync(join(root, "spec.mjs"), SPEC);
  return root;
}

test("serves a Worker under node through @y-core/forge/testing/harness from a consumer's node_modules", () => {
  const root = consumerRoot();
  try {
    const run = spawnSync("node", ["spec.mjs"], { cwd: root, encoding: "utf-8", timeout: 120_000 });

    expect(run.stderr).not.toContain("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING");
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "")).toEqual({ status: 200 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
