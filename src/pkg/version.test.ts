import { describe, expect, it } from "bun:test";
import { ReleaseError } from "./types";
import { resolveVersion } from "./version";

const CWD = "/repo";
const PREFIX = "v";

function makeDeps(
  overrides: {
    getLatestTag?: (cwd: string, prefix: string) => string | null;
    getCommitsSinceTag?: (cwd: string, tag: string) => string[];
    readPackageVersion?: (cwd: string) => string;
  } = {},
) {
  return { getLatestTag: () => null, getCommitsSinceTag: () => [], readPackageVersion: () => "0.0.1", ...overrides };
}

describe("resolveVersion() — explicit version", () => {
  it("returns explicit version with reason 'explicit'", () => {
    const result = resolveVersion({ explicit: "1.0.0", cwd: CWD, tagPrefix: PREFIX }, makeDeps());
    expect(result).toEqual({ version: "1.0.0", reason: "explicit", previous: null });
  });

  it("strips leading v from explicit version", () => {
    const result = resolveVersion({ explicit: "v2.0.0", cwd: CWD, tagPrefix: PREFIX }, makeDeps());
    expect(result.version).toBe("2.0.0");
  });

  it("throws invalid-version for a non-semver explicit version", () => {
    expect(() => resolveVersion({ explicit: "not-a-version", cwd: CWD, tagPrefix: PREFIX }, makeDeps())).toThrow(ReleaseError);
  });

  it("throws version-not-greater when explicit is not > latest tag", () => {
    expect(() => resolveVersion({ explicit: "1.0.0", cwd: CWD, tagPrefix: PREFIX }, makeDeps({ getLatestTag: () => "v1.0.0" }))).toThrow(
      ReleaseError,
    );
  });

  it("accepts explicit version greater than latest tag", () => {
    const result = resolveVersion({ explicit: "1.0.1", cwd: CWD, tagPrefix: PREFIX }, makeDeps({ getLatestTag: () => "v1.0.0" }));
    expect(result.version).toBe("1.0.1");
    expect(result.previous).toBe("v1.0.0");
  });
});

describe("resolveVersion() — first release", () => {
  it("returns 0.0.1 with reason 'first-release' when no tags exist", () => {
    const result = resolveVersion({ cwd: CWD, tagPrefix: PREFIX }, makeDeps());
    expect(result).toEqual({ version: "0.0.1", reason: "first-release", previous: null });
  });
});

describe("resolveVersion() — in-sync", () => {
  it("returns in-sync when tag exists and no new commits", () => {
    const result = resolveVersion({ cwd: CWD, tagPrefix: PREFIX }, makeDeps({ getLatestTag: () => "v0.2.0", readPackageVersion: () => "0.2.0" }));
    expect(result).toEqual({ version: "0.2.0", reason: "in-sync", previous: "v0.2.0" });
  });

  it("throws version-mismatch when package.json version doesn't match tag", () => {
    expect(() =>
      resolveVersion({ cwd: CWD, tagPrefix: PREFIX }, makeDeps({ getLatestTag: () => "v0.2.0", readPackageVersion: () => "0.1.0" })),
    ).toThrow(ReleaseError);
  });
});

describe("resolveVersion() — auto bump", () => {
  it("defaults to patch bump for a plain commit message", () => {
    const result = resolveVersion(
      { cwd: CWD, tagPrefix: PREFIX },
      makeDeps({ getLatestTag: () => "v0.2.0", getCommitsSinceTag: () => ["abc1234 fix: something"] }),
    );
    expect(result).toEqual({ version: "0.2.1", reason: "auto-patch", previous: "v0.2.0" });
  });

  it("bumps minor for a commit message starting with 'minor:'", () => {
    const result = resolveVersion(
      { cwd: CWD, tagPrefix: PREFIX },
      makeDeps({ getLatestTag: () => "v0.2.0", getCommitsSinceTag: () => ["abc1234 minor: add feature"] }),
    );
    expect(result).toEqual({ version: "0.3.0", reason: "auto-minor", previous: "v0.2.0" });
  });

  it("bumps major for a commit message starting with 'major:'", () => {
    const result = resolveVersion(
      { cwd: CWD, tagPrefix: PREFIX },
      makeDeps({ getLatestTag: () => "v0.2.0", getCommitsSinceTag: () => ["abc1234 major: breaking change"] }),
    );
    expect(result).toEqual({ version: "1.0.0", reason: "auto-major", previous: "v0.2.0" });
  });

  // The regression this range scan exists for. Reading only the tip subject — `chore: c` — resolved
  // a patch and silently discarded the major bump sitting one commit behind it.
  it("bumps major when 'major:' is on a non-tip commit in the range", () => {
    const result = resolveVersion(
      { cwd: CWD, tagPrefix: PREFIX },
      makeDeps({ getLatestTag: () => "v0.2.0", getCommitsSinceTag: () => ["aaa1111 chore: c", "bbb2222 major: b", "ccc3333 fix: a"] }),
    );
    expect(result).toEqual({ version: "1.0.0", reason: "auto-major", previous: "v0.2.0" });
  });

  it("bumps minor when 'minor:' is on a non-tip commit in the range", () => {
    const result = resolveVersion(
      { cwd: CWD, tagPrefix: PREFIX },
      makeDeps({ getLatestTag: () => "v0.2.0", getCommitsSinceTag: () => ["aaa1111 fix typo", "bbb2222 minor: add feature"] }),
    );
    expect(result).toEqual({ version: "0.3.0", reason: "auto-minor", previous: "v0.2.0" });
  });

  it("takes the highest bump when the range holds both 'major:' and 'minor:'", () => {
    const result = resolveVersion(
      { cwd: CWD, tagPrefix: PREFIX },
      makeDeps({ getLatestTag: () => "v0.2.0", getCommitsSinceTag: () => ["aaa1111 minor: b", "bbb2222 major: a"] }),
    );
    expect(result).toEqual({ version: "1.0.0", reason: "auto-major", previous: "v0.2.0" });
  });

  it("strips exactly one sha token, so a subject opening with a hex word still scans", () => {
    const result = resolveVersion(
      { cwd: CWD, tagPrefix: PREFIX },
      makeDeps({ getLatestTag: () => "v0.2.0", getCommitsSinceTag: () => ["abc1234 deadbeef major: x"] }),
    );
    expect(result).toEqual({ version: "0.2.1", reason: "auto-patch", previous: "v0.2.0" });
  });

  it("stays a patch when the whole range carries no bump prefix", () => {
    const result = resolveVersion(
      { cwd: CWD, tagPrefix: PREFIX },
      makeDeps({ getLatestTag: () => "v0.2.0", getCommitsSinceTag: () => ["aaa1111 chore: c", "bbb2222 docs: b", "ccc3333 fix: a"] }),
    );
    expect(result).toEqual({ version: "0.2.1", reason: "auto-patch", previous: "v0.2.0" });
  });

  it("ignores a bump prefix that is not at the start of the subject", () => {
    const result = resolveVersion(
      { cwd: CWD, tagPrefix: PREFIX },
      makeDeps({ getLatestTag: () => "v0.2.0", getCommitsSinceTag: () => ["aaa1111 revert major: breaking change"] }),
    );
    expect(result).toEqual({ version: "0.2.1", reason: "auto-patch", previous: "v0.2.0" });
  });

  it("throws invalid-version when the tag version can't be parsed", () => {
    expect(() =>
      resolveVersion(
        { cwd: CWD, tagPrefix: PREFIX },
        makeDeps({ getLatestTag: () => "v-bad-tag", getCommitsSinceTag: () => ["abc1234 fix: something"] }),
      ),
    ).toThrow(ReleaseError);
  });
});
