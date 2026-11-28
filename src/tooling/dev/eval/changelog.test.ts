import { describe, expect, it } from "bun:test";

import { changelogHunks, editUnreleased } from "./changelog";
import { DRIFTED, DRIFTED_WITH_ENTRY, ENTRY_PATCH, RELEASED_PATCH, UNENTRY_PATCH, WRITTEN_AGAINST } from "./changelog.fixture";

describe("changelogHunks()", () => {
  it("reads only the root changelog's hunks, without their trailing context", () => {
    expect(changelogHunks(ENTRY_PATCH)).toEqual([{ before: ["", "### Added", ""], after: ["", "### Added", "", "- New."] }]);
  });

  it("finds none in a patch that leaves the changelog alone", () => {
    expect(changelogHunks(ENTRY_PATCH.slice(ENTRY_PATCH.indexOf("diff --git a/src")))).toEqual([]);
    expect(changelogHunks(ENTRY_PATCH.replaceAll("CHANGELOG.md", "docs/CHANGELOG.md"))).toEqual([]);
  });
});

describe("editUnreleased()", () => {
  it("inserts an entry whose trailing context another [Unreleased] entry has since moved", () => {
    expect(editUnreleased(DRIFTED, changelogHunks(ENTRY_PATCH))).toBe(DRIFTED_WITH_ENTRY);
  });

  it("still applies where nothing drifted", () => {
    expect(editUnreleased(WRITTEN_AGAINST, changelogHunks(ENTRY_PATCH))).toBe(WRITTEN_AGAINST.replace("- Old.", "- New.\n- Old."));
  });

  it("removes the entry a plant takes out, wherever the reference put it", () => {
    expect(editUnreleased(DRIFTED_WITH_ENTRY, changelogHunks(UNENTRY_PATCH))).toBe(DRIFTED);
  });

  it("refuses a hunk whose anchor stands only in a released section", () => {
    expect(editUnreleased(DRIFTED, changelogHunks(RELEASED_PATCH))).toBeUndefined();
  });

  it("refuses to remove an entry [Unreleased] does not hold", () => {
    expect(editUnreleased(DRIFTED, changelogHunks(UNENTRY_PATCH))).toBeUndefined();
  });

  it("refuses a changelog with no [Unreleased] section", () => {
    expect(editUnreleased(DRIFTED.replace("## [Unreleased]", "## [1.1.0]"), changelogHunks(ENTRY_PATCH))).toBeUndefined();
  });
});
