import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { matchTextSnapshot } from "./snapshot";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forge-snapshot-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A fixture written under the temp root, returning the path a comparison is given. */
function fixture(contents: string, name = "layout.txt"): string {
  const path = join(root, name);
  writeFileSync(path, contents, "utf-8");
  return path;
}

const ABC = "a\nb\nc\nd\ne";

describe("a fixture the text already agrees with", () => {
  test("matches, and says so without claiming a write", async () => {
    const path = fixture(ABC);
    const outcome = await matchTextSnapshot(ABC, path);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data).toEqual({ path, state: "matched" });
  });

  test("matches empty against empty, rather than reporting the phantom line a split invents", async () => {
    const outcome = await matchTextSnapshot("", fixture(""));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.state).toBe("matched");
  });
});

describe("the differing lines, anchored by the identical run at each end", () => {
  const diffOf = async (expected: string, actual: string): Promise<readonly unknown[]> => {
    const outcome = await matchTextSnapshot(actual, fixture(expected));
    return outcome.ok ? [] : outcome.error.diff;
  };

  test("reports exactly the one line that changed, and nothing on either side of it", async () => {
    expect(await diffOf(ABC, "a\nb\nC\nd\ne")).toEqual([{ line: 3, expected: "c", actual: "C" }]);
  });

  test("reports two inserted lines as insertions, which a positional compare gets wrong", async () => {
    const diff = await diffOf(ABC, "a\nb\nX\nY\nc\nd\ne");
    expect(diff).toEqual([
      { line: 3, expected: null, actual: "X" },
      { line: 4, expected: null, actual: "Y" },
    ]);
  });

  test("reports a line the actual text has and the fixture has not", async () => {
    expect(await diffOf(ABC, `${ABC}\nf`)).toEqual([{ line: 6, expected: null, actual: "f" }]);
  });

  test("reports a line the fixture has and the actual text has not", async () => {
    expect(await diffOf(`${ABC}\nf`, ABC)).toEqual([{ line: 6, expected: "f", actual: null }]);
  });
});

describe("what a reviewer is shown", () => {
  test("quotes every line, so a trailing space is visible rather than an unexplained failure", async () => {
    const outcome = await matchTextSnapshot("a \nb", fixture("a\nb"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.report).toContain('"a "');
  });

  test("carries both line counts in the header, since a paired insertion reads as a rewrite", async () => {
    const outcome = await matchTextSnapshot("a\nb\nc", fixture("a\nb"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.report).toContain("fixture 2, actual 3");
  });

  test("truncates the report at the limit while the diff still carries every line", async () => {
    const outcome = await matchTextSnapshot("A\nB\nC", fixture("a\nb\nc"), { limit: 1 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.diff).toHaveLength(3);
    expect(outcome.error.report).toContain("… 2 more");
  });
});

describe("a fixture that is not there yet", () => {
  test("is written from the actual text, and reads back byte-equal to it", async () => {
    const path = join(root, "layout.txt");
    const outcome = await matchTextSnapshot(ABC, path);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.state).toBe("created");
    expect(readFileSync(path, "utf-8")).toBe(ABC);
  });

  test("creates the parent directory, which git does not track when it is empty", async () => {
    const path = join(root, "fixtures", "nested", "layout.txt");
    expect((await matchTextSnapshot(ABC, path)).ok).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe(ABC);
  });

  test("fails under ci and leaves nothing behind, rather than regenerating itself green", async () => {
    const path = join(root, "layout.txt");
    const outcome = await matchTextSnapshot(ABC, path, { ci: true });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("missing");
    expect(existsSync(path)).toBe(false);
  });
});

describe("update", () => {
  test("rewrites a differing fixture, and a plain follow-up call then matches", async () => {
    const path = fixture("stale");
    const updated = await matchTextSnapshot(ABC, path, { update: true });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.state).toBe("updated");
    expect(readFileSync(path, "utf-8")).toBe(ABC);
    const again = await matchTextSnapshot(ABC, path);
    expect(again.ok && again.data.state).toBe("matched");
  });

  test("claims no write over a fixture that already agrees", async () => {
    const outcome = await matchTextSnapshot(ABC, fixture(ABC), { update: true });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.state).toBe("matched");
  });

  test("is overridden by ci, so a stale script cannot rewrite a fixture on a CI run", async () => {
    const path = fixture("stale");
    const outcome = await matchTextSnapshot(ABC, path, { update: true, ci: true });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("mismatch");
    expect(readFileSync(path, "utf-8")).toBe("stale");
  });
});

// Built from `ENOTDIR` and `EISDIR` rather than from `chmod`, a no-op for root in a container — and
// asserted as resolutions, since `async` is what would turn a throw into an equally loud rejection.
describe("an I/O failure is data, not a throw", () => {
  test("reports an unwritable path where the parent is itself a file", async () => {
    const path = join(fixture("a file, not a directory", "blocker"), "layout.txt");
    const outcome = await matchTextSnapshot(ABC, path);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("unwritable");
    expect(outcome.error.cause).toBeInstanceOf(Error);
    expect(outcome.error.diff).toEqual([]);
  });

  test("reports an unreadable path where the path is a directory", async () => {
    const path = join(root, "fixtures");
    mkdirSync(path, { recursive: true });
    const outcome = await matchTextSnapshot(ABC, path);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("unreadable");
    expect(outcome.error.cause).toBeInstanceOf(Error);
  });
});

describe("what the comparison never reads", () => {
  test("answers the same whatever the environment says, because it reads no variable at all", async () => {
    const path = fixture("stale");
    process.env.CI = "true";
    process.env.UPDATE_SNAPSHOTS = "1";
    try {
      const outcome = await matchTextSnapshot(ABC, path);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.reason).toBe("mismatch");
      expect(readFileSync(path, "utf-8")).toBe("stale");
    } finally {
      delete process.env.CI;
      delete process.env.UPDATE_SNAPSHOTS;
    }
  });
});
