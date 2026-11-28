import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const CHANGELOG = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf-8");
const UPGRADING = readFileSync(new URL("../../docs/UPGRADING.md", import.meta.url), "utf-8");

function unreleased(changelog: string): string {
  const start = changelog.indexOf("## [Unreleased]");
  const end = changelog.indexOf("\n## [", start + 1);
  return changelog.slice(start, end === -1 ? undefined : end);
}

describe("the upgrade note for revoked_reason", () => {
  it("is in the changelog's Unreleased section, where an app's upgrade reads it", () => {
    expect(unreleased(CHANGELOG).includes("revoked_reason")).toBe(true);
  });

  it("is not in UPGRADING.md, the checklist for a release already cut", () => {
    expect(UPGRADING.includes("revoked_reason")).toBe(false);
  });
});
