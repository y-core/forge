import { describe, expect, it } from "bun:test";
import { describeTarget, detectTarget } from "./target";
import type { WranglerConfig } from "./types";

describe("detectTarget()", () => {
  it("detects a Pages project from pages_build_output_dir alone", () => {
    const config: WranglerConfig = { name: "cornellaw", pages_build_output_dir: "./public" };
    expect(detectTarget(config, "cornellaw")).toEqual({ kind: "pages", name: "cornellaw" });
  });

  it("detects a Worker when neither key is present", () => {
    expect(detectTarget({ name: "w" }, "w")).toEqual({ kind: "worker", name: "w" });
  });

  it("detects a Worker from main", () => {
    expect(detectTarget({ name: "w", main: "src/index.ts" }, "w").kind).toBe("worker");
  });

  it("treats a config carrying both keys as a Worker", () => {
    // wrangler rejects this combination outright, so there is no correct answer to
    // defer to — we follow its own advice: "use `main` if you are deploying a Worker".
    const config: WranglerConfig = { name: "w", main: "src/index.ts", pages_build_output_dir: "./public" };
    expect(detectTarget(config, "w").kind).toBe("worker");
  });

  it("uses the supplied script name rather than the config name", () => {
    expect(detectTarget({ name: "config-name" }, "override").name).toBe("override");
  });
});

describe("describeTarget()", () => {
  it("names each surface as it appears in result details", () => {
    expect(describeTarget({ kind: "pages", name: "x" })).toBe("pages project");
    expect(describeTarget({ kind: "worker", name: "x" })).toBe("worker script");
  });
});
