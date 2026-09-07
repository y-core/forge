import { describe, expect, it } from "bun:test";

import { chunkId, headingSlug, parseId, sourceId } from "./ident";

describe("chunkId() and sourceId()", () => {
  it("spells a canon id with its tree and a local id without one", () => {
    expect(chunkId("canon", "libs", "CODE_RULES.md", "5c")).toBe("canon/libs:CODE_RULES.md#5c");
    expect(chunkId("local", undefined, "docs/NAMESPACES.md", "4a")).toBe("local:docs/NAMESPACES.md#4a");
    expect(sourceId("canon", "shared", "AGENT_GUIDE.md")).toBe("canon/shared:AGENT_GUIDE.md");
  });
});

describe("parseId()", () => {
  it("round-trips a canon chunk id", () => {
    expect(parseId("canon/libs:CODE_RULES.md#5c")).toEqual({ corpus: "canon", tree: "libs", path: "CODE_RULES.md", section: "5c" });
  });

  it("round-trips a local chunk id, and a source id with no section", () => {
    expect(parseId("local:docs/NAMESPACES.md#4a")).toEqual({ corpus: "local", path: "docs/NAMESPACES.md", section: "4a" });
    expect(parseId("local:docs/NAMESPACES.md")).toEqual({ corpus: "local", path: "docs/NAMESPACES.md" });
  });

  it("keeps a slugged section, `~` and all", () => {
    expect(parseId("local:src/ui/README.md#~exports")?.section).toBe("~exports");
  });

  it("refuses a corpus or tree it does not know, and a spelling with no colon", () => {
    expect(parseId("fleet/libs:X.md#1")).toBeUndefined();
    expect(parseId("canon/docs:X.md#1")).toBeUndefined();
    expect(parseId("canon-libs-X.md")).toBeUndefined();
    expect(parseId("local:#1")).toBeUndefined();
  });
});

describe("headingSlug()", () => {
  it("marks a slug movable with a leading tilde", () => {
    expect(headingSlug("Core Components & APIs")).toBe("~core-components-apis");
  });

  it("never produces a bare tilde for a title with nothing sluggable in it", () => {
    expect(headingSlug("— ·")).toBe("~untitled");
  });
});
