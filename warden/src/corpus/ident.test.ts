import { describe, expect, it } from "bun:test";

import { chunkId, headingSlug, parseId, sourceId } from "./ident";

describe("chunkId() and sourceId()", () => {
  it("names the corpus and nothing else, whichever corpus it is", () => {
    expect(chunkId("canon", "CODE_RULES.md", "5c")).toBe("canon:CODE_RULES.md#5c");
    expect(chunkId("project", "docs/NAMESPACES.md", "4a")).toBe("project:docs/NAMESPACES.md#4a");
    expect(sourceId("canon", "AGENT_GUIDE.md")).toBe("canon:AGENT_GUIDE.md");
  });
});

describe("parseId()", () => {
  it("round-trips a canon chunk id", () => {
    expect(parseId("canon:CODE_RULES.md#5c")).toEqual({ corpus: "canon", path: "CODE_RULES.md", section: "5c" });
  });

  it("round-trips a project chunk id, and a source id with no section", () => {
    expect(parseId("project:docs/NAMESPACES.md#4a")).toEqual({ corpus: "project", path: "docs/NAMESPACES.md", section: "4a" });
    expect(parseId("project:docs/NAMESPACES.md")).toEqual({ corpus: "project", path: "docs/NAMESPACES.md" });
  });

  it("keeps a slugged section, `~` and all", () => {
    expect(parseId("project:src/ui/README.md#~exports")?.section).toBe("~exports");
  });

  it("refuses a corpus it does not know, a tree segment, and a spelling with no colon", () => {
    expect(parseId("fleet:X.md#1")).toBeUndefined();
    expect(parseId("canon/libs:X.md#1")).toBeUndefined();
    expect(parseId("canon-libs-X.md")).toBeUndefined();
    expect(parseId("project:#1")).toBeUndefined();
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
