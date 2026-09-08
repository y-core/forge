import { describe, expect, it } from "bun:test";

import { declaredByName } from "../src/tooling/gate/checks/co-location";
import { isBrowserSubpath } from "../src/tooling/gate/checks/exports";
import { type GateMode, selectSteps } from "../src/tooling/gate/mod";
import { BROWSER_ONLY, CO_LOCATION_EXEMPT } from "./exemptions";
import { STEPS } from "./steps";

const labels = (mode: GateMode): string[] => {
  const selection = selectSteps(STEPS, { mode });
  return selection.ok ? selection.steps.map((step) => step.label) : [];
};

describe("the gate's step table", () => {
  it("gives every step a unique label, because a label is what `--only` addresses", () => {
    expect(STEPS.map((step) => step.label).length).toBe(new Set(STEPS.map((step) => step.label)).size);
  });

  it("selects each mode as a superset of the one below it", () => {
    expect(labels("fast").every((label) => labels("standard").includes(label))).toBe(true);
    expect(labels("standard").every((label) => labels("full").includes(label))).toBe(true);
  });

  it("selects without calling a probe, so what it selects never depends on the machine", () => {
    expect(selectSteps(STEPS, { mode: "full" }).ok).toBe(true);
  });
});

describe("the gate's exemptions", () => {
  it("nominates no module a filename convention already exempts", () => {
    expect([...CO_LOCATION_EXEMPT.keys()].filter(declaredByName)).toEqual([]);
  });

  it("gives every co-location exemption a reason", () => {
    expect([...CO_LOCATION_EXEMPT].filter(([, reason]) => reason.trim() === "").map(([file]) => file)).toEqual([]);
  });

  it("nominates no subpath the browser-only convention already derives", () => {
    expect(BROWSER_ONLY.filter(isBrowserSubpath)).toEqual([]);
  });
});
