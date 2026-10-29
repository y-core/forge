import { describe, expect, it } from "bun:test";

import { build } from "esbuild";

import { DEV_CONDITION, WRANGLER_CONDITIONS } from "../tooling/cf/dev/conditions";

type RelaxSubpath = typeof import("./mod");

const DEV_CONDITIONS = [...WRANGLER_CONDITIONS, DEV_CONDITION];

async function bundleSubpath(conditions: readonly string[], define: Record<string, string> = {}): Promise<string> {
  const result = await build({
    stdin: { contents: 'export { isDevBuildArmed, whenArmed } from "@y-core/forge/relax";', resolveDir: import.meta.dir, loader: "ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
    conditions: [...conditions],
    define,
  });
  return result.outputFiles[0]?.text ?? "";
}

async function loadSubpath(conditions: readonly string[], define: Record<string, string> = {}): Promise<RelaxSubpath> {
  const text = await bundleSubpath(conditions, define);
  return (await import(`data:text/javascript;base64,${btoa(text)}`)) as RelaxSubpath;
}

describe("`@y-core/forge/relax` resolution", () => {
  it("refuses to resolve in a Worker build without `forge-dev`", async () => {
    const failure = await bundleSubpath(WRANGLER_CONDITIONS).then(
      () => undefined,
      (error: unknown) => (error as { errors: { text: string }[] }).errors.map((message) => message.text),
    );

    expect(failure).toEqual(['Could not resolve "@y-core/forge/relax"']);
  });

  it("resolves under Bun, unarmed", async () => {
    const relax = (await import("@y-core/forge/relax")) as RelaxSubpath;

    expect({ armed: relax.isDevBuildArmed(), whenArmed: typeof relax.whenArmed }).toEqual({ armed: false, whenArmed: "function" });
  });
});

describe("`@y-core/forge/relax` bundled under `forge-dev`", () => {
  const cases: { name: string; define: Record<string, string>; armed: boolean }[] = [
    { name: "defines no `__FORGE_DEV__`", define: {}, armed: false },
    { name: "defines `__FORGE_DEV__` as `true`", define: { __FORGE_DEV__: "true" }, armed: true },
    { name: "defines `__FORGE_DEV__` as `1`, which is truthy but not `true`", define: { __FORGE_DEV__: "1" }, armed: false },
  ];

  for (const { name, define, armed } of cases) {
    it(`answers ${armed ? "armed" : "unarmed"} when the build ${name}`, async () => {
      const relax = await loadSubpath(DEV_CONDITIONS, define);

      expect(relax.isDevBuildArmed()).toBe(armed);
    });
  }

  it("picks the relaxed function when the build defines `__FORGE_DEV__` as `true`, and the strict one when it defines none", async () => {
    const answers = await Promise.all(
      [{ __FORGE_DEV__: "true" }, {}].map(async (define) => {
        const { isDevBuildArmed, whenArmed } = await loadSubpath(DEV_CONDITIONS, define);
        return whenArmed(
          isDevBuildArmed,
          () => "relaxed",
          () => "strict",
        )();
      }),
    );

    expect(answers).toEqual(["relaxed", "strict"]);
  });
});
