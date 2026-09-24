import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../cli/errors";
import { defineStripConfig, loadStripConfig } from "./config";

const roots: string[] = [];

/** A root holding `source` at `path`, or no module at all. */
function project(source: string | null, path = "config/strip.ts"): string {
  const root = mkdtempSync(join(tmpdir(), "forge-strip-config-"));
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

describe("defineStripConfig()", () => {
  it("returns the manifest it is given", () => {
    const manifest = { directories: ["src/showcase/"], seams: [] };
    expect(defineStripConfig(manifest)).toBe(manifest);
  });
});

describe("loadStripConfig()", () => {
  it("loads the default export of `config/strip.ts`", async () => {
    const root = project('export default { directories: ["src/showcase/"], seams: [{ file: "src/worker.ts", marker: "// strip" }] };\n');
    expect(await loadStripConfig({ root })).toEqual({ directories: ["src/showcase/"], seams: [{ file: "src/worker.ts", marker: "// strip" }] });
  });

  it("loads the module an explicit path names", async () => {
    const root = project('export default { directories: ["demo"], seams: [] };\n', "config/other.ts");
    expect(await loadStripConfig({ root, path: "config/other.ts" })).toEqual({ directories: ["demo"], seams: [] });
  });

  it("refuses a root with no manifest as invalid arguments, naming where it looked", async () => {
    const error = await refusal(loadStripConfig({ root: project(null) }));
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).kind).toBe("invalid-args");
    expect(error.message).toBe("No strip manifest at `config/strip.ts` — forge strip needs one, default-exporting defineStripConfig({...})");
  });

  it("refuses an explicit path naming a module that does not exist", async () => {
    const error = await refusal(loadStripConfig({ root: project(null), path: "config/missing.ts" }));
    expect(error.message).toContain("does not exist");
  });

  it("refuses a module with no default export", async () => {
    const error = await refusal(loadStripConfig({ root: project("export const STRIP = { directories: ['demo'], seams: [] };\n") }));
    expect(error.message).toContain("has no default export");
  });

  it("refuses an invalid manifest by the dot path of the field at fault", async () => {
    const error = await refusal(
      loadStripConfig({ root: project('export default { directories: [], seams: [{ file: "/abs.ts", marker: "// strip:x" }] };\n') }),
    );
    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toBe("config/strip.ts: seams.0.file: must be root-relative with no `..` segment");
  });
});
