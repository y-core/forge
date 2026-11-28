import { describe, expect, it } from "bun:test";
import { join } from "node:path";

describe("the app's migrations", () => {
  it("pass `forge db lint`, which runs before every apply", () => {
    const lint = Bun.spawnSync([join(process.cwd(), "node_modules", ".bin", "forge"), "db", "lint"], { stdout: "pipe", stderr: "pipe" });

    expect(lint.exitCode).toBe(0);
  });
});
