import { describe, expect, it } from "bun:test";

import { CliError } from "../cli/errors";
import { bundler, peer, rasterizer } from "./peers";

// `mock.module` cannot stub a module another test file has already loaded, so the missing-peer path needs a genuinely absent package.
const ABSENT = "@y-core/not-a-real-optional-peer";

async function failure(run: Promise<unknown>): Promise<CliError> {
  const err = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(CliError);
  return err as CliError;
}

describe("peer()", () => {
  it("names the config key, what it asked for, the package and the install command", async () => {
    const err = await failure(peer(ABSENT, "icons.outputs", "a rasterized PNG"));
    expect(err.message).toBe(
      `[forge-assets] icons.outputs asks for a rasterized PNG, which needs the optional peer "${ABSENT}". Install it: bun add -d ${ABSENT}`,
    );
  });

  // A CliError is what `execute` formats as a single `Error:` line — a plain Error surfaces as a crash.
  it("carries the external kind, so the CLI renders the sentence rather than a stack", async () => {
    const err = await failure(peer(ABSENT, "js.bundles", "a JavaScript bundle"));
    expect(err.kind).toBe("external");
  });

  it("preserves the module-resolution failure as the cause", async () => {
    const err = await failure(peer(ABSENT, "rasters", "a rasterized PNG"));
    expect(err.cause).toBeInstanceOf(Error);
    expect((err.cause as Error).message).toContain(ABSENT);
  });

  it("returns the module itself when the package is installed", async () => {
    expect(typeof (await peer<typeof import("esbuild")>("esbuild", "js.bundles", "a JavaScript bundle")).build).toBe("function");
  });
});

describe("rasterizer()", () => {
  it("resolves to sharp's default export, which is what a caller rasterizes through", async () => {
    expect(typeof (await rasterizer("icons.outputs"))).toBe("function");
  });
});

describe("bundler()", () => {
  it("resolves to the esbuild module namespace", async () => {
    expect(typeof (await bundler("js.bundles")).build).toBe("function");
  });
});
