import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { syncForge } from "../src/tooling/dev/sync";
import { collectFiles } from "../src/tooling/gate/checks/source-scan";
import type { BundleCheckConfig } from "../src/tooling/gate/checks/types";
import { isCheckStep } from "../src/tooling/gate/steps";
import { declaredSteps, resolveTiers } from "../src/tooling/gate/tiers";
import { BUNDLE_FIXER, BUNDLES, writeBundles } from "./bundles";
import steps from "./steps.config";

const STEPS = declaredSteps(steps.tiers);

const ROOT = resolve(import.meta.dir, "..");

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const CONFIG_SPEC = `
import { createConfig, env } from "@y-core/forge/config";
import { BaseUrlConfigSchema } from "@y-core/forge/security";
import { v } from "@y-core/forge/validation";

const config = createConfig({ site: { url: env("SITE_ORIGIN") } }, v.object({ site: v.object({ url: BaseUrlConfigSchema }) }));
try {
  config.get({ SITE_ORIGIN: "http://example.com" });
} catch (error) {
  console.log(JSON.stringify((error as Error).message));
}
`;

/** A consumer holding forge as `dev:forge` installs it, with forge's dependencies linked from this checkout. */
function packedConsumer(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-packed-consumer-"));
  roots.push(root);
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

const bundleRows = () => STEPS.filter((step) => isCheckStep(step) && step.requires?.tool === "esbuild");

describe("the bundle list", () => {
  it("is exactly the set of bundle-drift rows the gate checks, so no checked bundle is one gen:bundles skips", () => {
    expect(bundleRows().map((step) => step.label)).toEqual(BUNDLES.map((row) => row.label));
  });

  it("hands each row the watches its bundle lists", () => {
    expect(bundleRows().map((step) => step.watches)).toEqual(BUNDLES.map((row) => row.watches));
  });

  it("watches every row's own entry and bundle, so an edit to either reruns its drift check", () => {
    expect(BUNDLES.filter(({ entry, bundle, watches }) => !watches.includes(entry) || !watches.includes(bundle))).toEqual([]);
  });

  it("generates every `.mjs` under `src/`, which is what lets lint and format ignore them by one pattern", () => {
    const committed = collectFiles(ROOT, "src", (name) => name.endsWith(".mjs"));

    expect(committed).toEqual(BUNDLES.map(({ bundle }) => bundle).sort());
  });

  it("names every bundle under `src/` `<stem>.node.mjs`, so no extensionless import can reach one in place of its `.ts`", () => {
    expect(collectFiles(ROOT, "src", (name) => name.endsWith(".mjs") && !name.endsWith(".node.mjs"))).toEqual([]);
  });

  it("points every export condition naming a bundle at a `.node.mjs`", async () => {
    const pkg = (await import("../package.json")) as { exports: Record<string, string | Record<string, string>> };
    const targets = Object.values(pkg.exports).flatMap((entry) => (typeof entry === "string" ? [entry] : Object.values(entry)));

    expect(targets.filter((target) => target.endsWith(".mjs") && !target.endsWith(".node.mjs"))).toEqual([]);
  });

  it("holds the bundle-shadow row in the static tier over all of `src/`, so no run skips it", () => {
    const table = resolveTiers(steps.tiers);
    const row = STEPS.find((step) => step.label === "validate-bundle-shadows");

    expect([table.ok && table.data.scheduled?.home["validate-bundle-shadows"], row?.watches]).toEqual(["static", ["src", "src/**"]]);
  });

  it("derives a row for every `forge.node` subpath", async () => {
    const pkg = (await import("../package.json")) as { forge: { node: string[] } };

    expect(BUNDLES.map(({ label }) => label)).toEqual(pkg.forge.node.map((subpath) => `validate-${subpath.slice(2).replaceAll("/", "-")}-bundle`));
  });

  it("regenerates every bundle on the list, so gen:bundles writes each one the gate checks", async () => {
    const written: BundleCheckConfig[] = [];
    await writeBundles("/repo", async (config) => {
      written.push(config);
    });

    expect(written).toEqual(BUNDLES.map(({ entry, bundle }) => ({ root: "/repo", entry, bundle, fixer: BUNDLE_FIXER })));
  });

  it("names a fixer that is the script regenerating this list", async () => {
    const pkg = (await import("../package.json")) as { scripts: Record<string, string> };

    expect([BUNDLE_FIXER, pkg.scripts["gen:bundles"]]).toEqual(["bun run gen:bundles", "bun run config/bundles.ts"]);
  });
});

describe("forge packed as `dev:forge` installs it, under bun", () => {
  it("keeps safeCheck's message through createConfig, so no internal import loads a bundle in place of its source", () => {
    const root = packedConsumer();
    writeFileSync(join(root, "spec.ts"), CONFIG_SPEC);
    const run = spawnSync("bun", ["spec.ts"], { cwd: root, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } });

    expect({ status: run.status, stderr: run.status === 0 ? "" : run.stderr }).toEqual({ status: 0, stderr: "" });
    expect(JSON.parse(run.stdout.trim())).toBe(
      "Invalid environment: site.url: must use https: (http://localhost and http://127.0.0.1 are allowed for local development)",
    );
  });
});

describe("forge packed as `dev:forge` installs it, under node", () => {
  it("imports `@y-core/forge/ui/contracts` from its node bundle, with the names and values of the source module", async () => {
    const root = packedConsumer();
    const probe = `const m = await import("@y-core/forge/ui/contracts");
console.log(JSON.stringify([Object.keys(m).sort(), m.ANNOUNCER_REGION_SLOTS, m.ANNOUNCE_SETTLE_MS, m.ANNOUNCE_FAILURE_ATTR]));`;
    const run = spawnSync("node", ["--input-type=module", "-e", probe], { cwd: root, encoding: "utf8" });
    const source = await import("../src/ui/contracts/mod");

    expect({ status: run.status, stderr: run.status === 0 ? "" : run.stderr }).toEqual({ status: 0, stderr: "" });
    expect(JSON.parse(run.stdout.trim())).toEqual([
      Object.keys(source).sort(),
      source.ANNOUNCER_REGION_SLOTS,
      source.ANNOUNCE_SETTLE_MS,
      source.ANNOUNCE_FAILURE_ATTR,
    ]);
  });
});
