import { describe, expect, it } from "bun:test";

import pkg from "../package.json" with { type: "json" };
import { crossEngineStep } from "../src/tooling/gate/mod";
import CRON from "./cron";

describe("config/cron.ts", () => {
  it("runs the cross-engine row alone", () => {
    expect(CRON.map((step) => [step.label, step.tier, step.cmd])).toEqual([
      [crossEngineStep().label, "scheduled", ["playwright", "test", "--project=firefox", "--project=webkit"]],
    ]);
  });

  it("is what `verify:cron` runs, at the scheduled tier its row defaults to", () => {
    expect(pkg.scripts["verify:cron"]).toBe("bun run src/tooling/root/bin.ts verify --config config/cron.ts --tier scheduled");
  });
});
