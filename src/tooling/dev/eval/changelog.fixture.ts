function changelog(unreleased: readonly string[]): string {
  return [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "### Added",
    "",
    ...unreleased,
    "",
    "---",
    "",
    "## [1.0.0]",
    "",
    "### Added",
    "",
    "- Released.",
    "",
  ].join("\n");
}

/** The changelog a patch was written against. */
export const WRITTEN_AGAINST = changelog(["- Old."]);

/** The same changelog after another change added an `[Unreleased]` entry under the patch's anchor. */
export const DRIFTED = changelog(["- Drift.", "- Old."]);

/** `DRIFTED` once `ENTRY_PATCH` has applied. */
export const DRIFTED_WITH_ENTRY = changelog(["- New.", "- Drift.", "- Old."]);

/** A patch written against `WRITTEN_AGAINST`, adding an entry and a line of source. */
export const ENTRY_PATCH = [
  "diff --git a/CHANGELOG.md b/CHANGELOG.md",
  "index 1111111..2222222 100644",
  "--- a/CHANGELOG.md",
  "+++ b/CHANGELOG.md",
  "@@ -4,4 +4,5 @@",
  " ",
  " ### Added",
  " ",
  "+- New.",
  " - Old.",
  "diff --git a/src/mod.ts b/src/mod.ts",
  "index 3333333..4444444 100644",
  "--- a/src/mod.ts",
  "+++ b/src/mod.ts",
  "@@ -1 +1,2 @@",
  " export {};",
  "+export const added = 1;",
  "",
].join("\n");

/** A plant written over `ENTRY_PATCH`, taking its entry out again. */
export const UNENTRY_PATCH = [
  "diff --git a/CHANGELOG.md b/CHANGELOG.md",
  "--- a/CHANGELOG.md",
  "+++ b/CHANGELOG.md",
  "@@ -4,5 +4,4 @@",
  " ",
  " ### Added",
  " ",
  "-- New.",
  " - Old.",
  "",
].join("\n");

/** A patch whose only anchor stands in a released section. */
export const RELEASED_PATCH = [
  "diff --git a/CHANGELOG.md b/CHANGELOG.md",
  "--- a/CHANGELOG.md",
  "+++ b/CHANGELOG.md",
  "@@ -15,1 +15,2 @@",
  " - Released.",
  "+- Late.",
  "",
].join("\n");
