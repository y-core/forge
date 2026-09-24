import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../cli/errors";
import { defineFeatures, loadFeatures } from "./config";

const roots: string[] = [];

/** A root holding `source` at `path`, or no module at all. */
function project(source: string | null, path = "config/features.ts"): string {
  const root = mkdtempSync(join(tmpdir(), "forge-curate-config-"));
  roots.push(root);
  if (source !== null) {
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, path), source, "utf-8");
  }
  return root;
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a refusal");
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("defineFeatures()", () => {
  it("returns the manifest it is given", () => {
    const manifest = { showcase: { directories: ["src/showcase/"], seams: [] } };
    expect(defineFeatures(manifest)).toBe(manifest);
  });
});

describe("loadFeatures()", () => {
  it("loads the default export of `config/features.ts`", async () => {
    const root = project('export default { showcase: { directories: ["src/showcase/"], seams: ["src/worker.ts"] } };\n');
    expect(await loadFeatures({ root })).toEqual({ showcase: { directories: ["src/showcase/"], seams: ["src/worker.ts"] } });
  });

  it("loads the module an explicit path names", async () => {
    const root = project('export default { demo: { directories: ["demo"], seams: [] } };\n', "config/other.ts");
    expect(await loadFeatures({ root, path: "config/other.ts" })).toEqual({ demo: { directories: ["demo"], seams: [] } });
  });

  it("refuses a root with no manifest as invalid arguments, naming where it looked", async () => {
    const error = await refusal(loadFeatures({ root: project(null) }));
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).kind).toBe("invalid-args");
    expect(error.message).toBe("No feature manifest at `config/features.ts` — forge curate needs one, default-exporting defineFeatures({...})");
  });

  it("refuses an explicit path naming a module that does not exist", async () => {
    const error = await refusal(loadFeatures({ root: project(null), path: "config/missing.ts" }));
    expect(error.message).toContain("does not exist");
  });

  it("refuses a module with no default export", async () => {
    const error = await refusal(loadFeatures({ root: project("export const FEATURES = { demo: { directories: ['demo'], seams: [] } };\n") }));
    expect(error.message).toContain("has no default export");
  });

  it("refuses an invalid manifest by the dot path of the field at fault", async () => {
    const error = await refusal(loadFeatures({ root: project('export default { showcase: { directories: [], seams: ["/abs.ts"] } };\n') }));
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).kind).toBe("invalid-args");
    expect(error.message).toBe("config/features.ts: showcase.seams.0: must be root-relative with no `..` segment");
  });

  it("joins every issue, each by its dot path", async () => {
    const error = await refusal(
      loadFeatures({
        root: project('export default { Demo: { directories: [], seams: ["src/worker.ts"] }, contact: { directories: [], seams: [] } };\n'),
      }),
    );
    expect(error.message).toBe(
      "config/features.ts: Demo: must be lowercase letters, digits and `-`, starting with a letter; contact: a feature must name something to remove",
    );
  });
});
