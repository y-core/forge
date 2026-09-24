import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import { CliError } from "../cli/errors";
import { bundler, peer, peerFile, rasterizer, shaper, subsetWasm } from "./peers";

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

describe("shaper()", () => {
  it("resolves to the harfbuzzjs module namespace, which is what a face is shaped through", async () => {
    expect(typeof (await shaper("fonts.subsets")).shape).toBe("function");
  });
});

describe("peerFile()", () => {
  // An absolute path is the claim: a relative one would resolve against the working directory, which
  // is what the hardcoded `node_modules/…` string did and why a nested install defeated it.
  it("answers an absolute path to the file the peer ships", () => {
    const resolved = peerFile("harfbuzzjs", "dist/harfbuzz-subset.wasm", "fonts.subsets", "a subset font");
    expect(isAbsolute(resolved)).toBe(true);
    expect(existsSync(resolved)).toBe(true);
  });

  it("fails like a missing import does when the package is absent", () => {
    let err: unknown;
    try {
      peerFile(ABSENT, "dist/anything.wasm", "fonts.subsets", "a subset font");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toBe(
      `[forge-assets] fonts.subsets asks for a subset font, which needs the optional peer "${ABSENT}". Install it: bun add -d ${ABSENT}`,
    );
  });

  it("fails the same way when the package is installed but exports no such file", () => {
    expect(() => peerFile("harfbuzzjs", "dist/not-a-file.wasm", "fonts.subsets", "a subset font")).toThrow(CliError);
  });
});

describe("subsetWasm()", () => {
  it("locates the subsetter module without the caller naming a path", () => {
    expect(existsSync(subsetWasm("fonts.subsets"))).toBe(true);
  });
});
