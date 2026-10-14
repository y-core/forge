import { describe, expect, it } from "bun:test";

import type { EdgeKind } from "../src/tooling/gate/mod";
import { EDGES } from "./namespaces";

function cyclesWithin(edges: Record<string, Record<string, EdgeKind>>, container: string): string[] {
  const inside = (name: string) => name === container || name.startsWith(`${container}/`);
  const cycles: string[] = [];
  const done = new Set<string>();
  const walk = (name: string, path: readonly string[]): void => {
    if (path.includes(name)) {
      cycles.push([...path.slice(path.indexOf(name)), name].join(" → "));
      return;
    }
    if (done.has(name)) return;
    for (const target of Object.keys(edges[name] ?? {}).filter(inside)) walk(target, [...path, name]);
    done.add(name);
  };
  for (const name of Object.keys(edges).filter(inside)) walk(name, []);
  return cycles;
}

describe("EDGES — the render/pdf container", () => {
  it("declares its children's edges into the engine one way only, so the container stays acyclic", () => {
    expect(Object.keys(EDGES).filter((name) => name.startsWith("render/pdf/")).length).toBeGreaterThan(0);
    expect(cyclesWithin(EDGES, "render/pdf")).toEqual([]);
  });

  it("would report a child the engine reached back for", () => {
    const reachedBack = { ...EDGES, "render/pdf": { ...EDGES["render/pdf"], "render/pdf/fonts": "value" as const } };
    expect(cyclesWithin(reachedBack, "render/pdf")).toEqual(["render/pdf → render/pdf/fonts → render/pdf"]);
  });
});
