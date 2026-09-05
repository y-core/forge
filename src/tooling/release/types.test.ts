import { describe, expect, it } from "bun:test";

import type { ReleaseErrorKind } from "./types";
import { ReleaseError } from "./types";

const KINDS: readonly ReleaseErrorKind[] = [
  "invalid-version",
  "version-not-greater",
  "version-mismatch",
  "git-error",
  "pkg-update",
  "working-tree-dirty",
  "changelog-empty",
  "changelog-malformed",
  "manifest-malformed",
  "surface-shrink",
];

describe("ReleaseError", () => {
  it("is an Error carrying its own name", () => {
    const error = new ReleaseError("git-error", "git tag failed");
    expect([error instanceof Error, error instanceof ReleaseError, error.name]).toEqual([true, true, "ReleaseError"]);
  });

  it("carries the message through to Error", () => {
    expect(new ReleaseError("changelog-empty", "CHANGELOG.md has no unreleased section").message).toBe("CHANGELOG.md has no unreleased section");
  });

  it("accepts an empty message, since the kind is what a caller branches on", () => {
    expect(new ReleaseError("pkg-update", "").message).toBe("");
  });

  for (const kind of KINDS) {
    it(`records the ${kind} kind`, () => {
      expect(new ReleaseError(kind, "x").kind).toBe(kind);
    });
  }

  it("is catchable as itself, which is what lets the release pipeline narrow on kind", () => {
    const thrown = ((): unknown => {
      try {
        throw new ReleaseError("working-tree-dirty", "uncommitted changes");
      } catch (e) {
        return e;
      }
    })();
    expect(thrown instanceof ReleaseError && thrown.kind === "working-tree-dirty").toBe(true);
  });

  it("distinguishes itself from a plain Error thrown by the same pipeline", () => {
    expect(new Error("boom") instanceof ReleaseError).toBe(false);
  });
});
