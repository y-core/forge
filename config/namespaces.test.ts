import { describe, expect, it } from "bun:test";

import { diffGraph, validateNoValueCycles } from "../src/tooling/gate/mod";
import { EDGES, LEAF, PRIMITIVES } from "./namespaces";

describe("EDGES — value cycles", () => {
  it("declares no cycle of value edges", () => {
    expect(validateNoValueCycles(EDGES)).toEqual([]);
  });

  it("would report the render/pdf engine reaching back for a child that already names it by value", () => {
    const reachedBack = { ...EDGES, "render/pdf": { ...EDGES["render/pdf"], "render/pdf/audit": "value" as const } };

    expect(validateNoValueCycles(reachedBack).map((finding) => finding.file)).toEqual(["edges render/pdf → render/pdf/audit → render/pdf"]);
  });
});

describe("EDGES — render/htmx marking its banners through ui/contracts", () => {
  it("would report ui/contracts reaching back for render/htmx as a cycle of value edges", () => {
    const reachedBack = { ...EDGES, "ui/contracts": { "render/htmx": "value" as const } };

    expect(validateNoValueCycles(reachedBack).map((finding) => finding.file)).toEqual(["edges render/htmx → ui/contracts → render/htmx"]);
  });

  it("accepts render/htmx importing ui/contracts and refuses the reverse import, ui/contracts being declared leaf", () => {
    const observed = new Map([
      [
        "render/htmx",
        new Map([
          ["html", { kind: "value" as const, file: "src/render/htmx/fragment.ts", line: 1 }],
          ["ui/contracts", { kind: "value" as const, file: "src/render/htmx/fragment.ts", line: 4 }],
        ]),
      ],
      ["ui/contracts", new Map([["render/htmx", { kind: "value" as const, file: "src/ui/contracts/announcer-contract.ts", line: 1 }]])],
    ]);
    const graph = { primitives: PRIMITIVES, leaf: LEAF, edges: EDGES };

    const namespaces = [
      ...new Set([...PRIMITIVES, ...LEAF, ...Object.entries(EDGES).flatMap(([from, targets]) => [from, ...Object.keys(targets)])]),
    ];

    const findings = diffGraph(observed, graph, namespaces).filter((finding) => finding.from === "render/htmx" || finding.from === "ui/contracts");

    expect(findings.map(({ kind, from, to }) => ({ kind, from, to }))).toEqual([
      { kind: "leaf-edge", from: "ui/contracts", to: "render/htmx" },
      { kind: "undeclared-edge", from: "ui/contracts", to: "render/htmx" },
    ]);
  });
});
