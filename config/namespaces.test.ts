import { describe, expect, it } from "bun:test";

import { validateNoValueCycles } from "../src/tooling/gate/mod";
import { EDGES } from "./namespaces";

describe("EDGES — value cycles", () => {
  it("declares no cycle of value edges", () => {
    expect(validateNoValueCycles(EDGES)).toEqual([]);
  });

  it("would report the render/pdf engine reaching back for a child that already names it by value", () => {
    const reachedBack = { ...EDGES, "render/pdf": { ...EDGES["render/pdf"], "render/pdf/audit": "value" as const } };

    expect(validateNoValueCycles(reachedBack).map((finding) => finding.file)).toEqual(["edges render/pdf → render/pdf/audit → render/pdf"]);
  });
});
