import { describe, expect, it } from "bun:test";

import { CliError } from "../cli/errors";
import { refusePagesConfig, surfaceDetail } from "./target";
import type { WranglerConfig } from "./types";

function captureThrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("refusePagesConfig()", () => {
  it("accepts a Worker config", () => {
    expect(() => refusePagesConfig({ name: "w", main: "src/index.ts" }, "w")).not.toThrow();
  });

  it("refuses a config declaring a Cloudflare Pages project, naming Workers as the only target", () => {
    const config: WranglerConfig = { name: "target-fixture", pages_build_output_dir: "./public" };
    const refusal = captureThrown(() => refusePagesConfig(config, "target-fixture"));
    expect(refusal).toBeInstanceOf(CliError);
    expect((refusal as CliError).kind).toBe("invalid-args");
    expect((refusal as CliError).message).toBe(
      "target-fixture declares `pages_build_output_dir`, a Cloudflare Pages project — forge supports Workers only. Remove it and deploy target-fixture as a Worker.",
    );
  });

  it("refuses a Pages output directory even beside a Worker entry point", () => {
    const config: WranglerConfig = { name: "w", main: "src/index.ts", pages_build_output_dir: "./public" };
    expect(() => refusePagesConfig(config, "w")).toThrow(CliError);
  });
});

describe("surfaceDetail()", () => {
  it("prefixes the Worker surface and drops empty parts", () => {
    expect(surfaceDetail("a", undefined, "", "b")).toBe("worker script · a · b");
  });
});
