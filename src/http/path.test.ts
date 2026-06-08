import { describe, expect, it } from "bun:test";
import { joinPath } from "./path";

describe("joinPath", () => {
  it("trims trailing slash from base", () => {
    expect(joinPath("/showcase/")).toBe("/showcase");
  });

  it("preserves leading slash from base", () => {
    expect(joinPath("/showcase")).toBe("/showcase");
  });

  it("joins base with a single segment", () => {
    expect(joinPath("/showcase", "preview")).toBe("/showcase/preview");
  });

  it("joins base with multiple segments", () => {
    expect(joinPath("/showcase/ui/api", "preview")).toBe("/showcase/ui/api/preview");
  });

  it("handles trailing slash on base with segments", () => {
    expect(joinPath("/showcase/", "preview")).toBe("/showcase/preview");
  });

  it("handles leading slash on segment", () => {
    expect(joinPath("/showcase", "/preview")).toBe("/showcase/preview");
  });

  it("collapses duplicate slashes at part junctions (trailing base + leading segment)", () => {
    expect(joinPath("/showcase/", "/preview")).toBe("/showcase/preview");
  });

  it("works with relative (no leading slash) base", () => {
    expect(joinPath("showcase", "preview")).toBe("showcase/preview");
  });

  it("does not add a leading slash for relative base", () => {
    expect(joinPath("showcase/")).toBe("showcase");
  });

  it("returns root slash for bare slash base with no segments", () => {
    expect(joinPath("/")).toBe("/");
  });

  it("handles empty string base as relative empty", () => {
    expect(joinPath("", "preview")).toBe("preview");
  });
});
