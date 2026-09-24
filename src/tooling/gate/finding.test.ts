import { describe, expect, it } from "bun:test";

import { createColorize } from "../term/color";
import { checkResult, fail, formatCheckResult, formatFinding, scannedNothing, warn } from "./finding";

describe("checkResult() — deriving the verdict", () => {
  it("is green when there is nothing to report", () => {
    expect(checkResult([], "12 files scanned.").ok).toBe(true);
  });

  it("is red when any finding is a fail", () => {
    expect(checkResult([warn("a"), fail("b")], "…").ok).toBe(false);
  });

  it("stays green when every finding is a warning", () => {
    expect(checkResult([warn("a"), warn("b")], "…").ok).toBe(true);
  });

  it("keeps findings in the order they were found", () => {
    const result = checkResult([fail("first"), warn("second")], "…");

    expect(result.findings.map((finding) => finding.message)).toEqual(["first", "second"]);
  });
});

describe("fail() / warn()", () => {
  it("sets the level and carries the location through", () => {
    expect(fail("broken", { file: "src/a.ts", line: 12 })).toEqual({ level: "fail", message: "broken", file: "src/a.ts", line: 12 });
  });

  it("omits absent location fields rather than setting them undefined", () => {
    expect(Object.keys(warn("noted"))).toEqual(["level", "message"]);
  });
});

describe("formatFinding()", () => {
  it("tags the level and states the message when there is no location", () => {
    expect(formatFinding(fail("no [Unreleased] section"))).toBe("FAIL: no [Unreleased] section");
  });

  it("names the file when there is one", () => {
    expect(formatFinding(fail("missing pragma", { file: "src/a.tsx" }))).toBe("FAIL src/a.tsx: missing pragma");
  });

  it("appends the line only when a file was given", () => {
    expect(formatFinding(fail("bad", { file: "src/a.tsx", line: 4 }))).toBe("FAIL src/a.tsx:4: bad");
  });

  it("marks a warning distinctly from a failure, so a reader can tell them apart at a glance", () => {
    expect(formatFinding(warn("no link definition"))).toBe("warn: no link definition");
  });

  it("indents detail lines beneath the message as evidence", () => {
    const rendered = formatFinding(fail("JSX contract violated", { file: "src/a.tsx", detail: ["missing: x", "line 4: y"] }));

    expect(rendered).toBe("FAIL src/a.tsx: JSX contract violated\n    missing: x\n    line 4: y");
  });
});

describe("formatCheckResult()", () => {
  it("prints the summary on a pass, so a green never reads as a check that walked nothing", () => {
    expect(formatCheckResult(checkResult([], "58 .tsx files carry every pragma."))).toBe("  ok 58 .tsx files carry every pragma.");
  });

  it("prints the findings and withholds the summary on a failure", () => {
    const rendered = formatCheckResult(checkResult([fail("broken", { file: "src/a.ts" })], "1 file scanned."));

    expect(rendered).toBe("FAIL src/a.ts: broken");
  });

  it("still prints the summary when only warnings were reported", () => {
    const rendered = formatCheckResult(checkResult([warn("noted")], "3 files scanned."));

    expect(rendered).toBe("warn: noted\n  ok 3 files scanned.");
  });
});

describe("finding colour", () => {
  const style = createColorize(1);

  it("reds the FAIL tag", () => {
    expect(formatFinding(fail("broken"), style)).toBe(`${style.red("FAIL")}: broken`);
  });

  it("yellows the warn tag", () => {
    expect(formatFinding(warn("odd"), style)).toBe(`${style.yellow("warn")}: odd`);
  });

  it("greens the ok that closes a passing result", () => {
    expect(formatCheckResult(checkResult([], "walked 3 files"), style)).toBe(`  ${style.green("ok")} walked 3 files`);
  });

  it("emits nothing but text when no styler is given", () => {
    expect(formatFinding(fail("broken"))).toBe("FAIL: broken");
  });
});

describe("scannedNothing() — the refusal a check returns when its scan set is empty", () => {
  it("fails, so a check that matched nothing can never report green", () => {
    expect(scannedNothing("`src` matched no source", "class-order").ok).toBe(false);
  });

  it("names what was empty and which gate is refusing", () => {
    expect(scannedNothing("`src` matched no source", "class-order").findings).toEqual([
      fail("`src` matched no source — refusing to report a green class-order gate that scanned nothing"),
    ]);
  });

  it("takes a verb, because a unit that is a config array was measured rather than scanned", () => {
    expect(scannedNothing("no audited pairs", "contrast", "measured").findings).toEqual([
      fail("no audited pairs — refusing to report a green contrast gate that measured nothing"),
    ]);
  });

  it("carries an empty summary, which is what keeps the count off a refusal", () => {
    expect(formatCheckResult(scannedNothing("`src` matched no source", "jsx"))).toBe(
      "FAIL: `src` matched no source — refusing to report a green jsx gate that scanned nothing",
    );
  });
});
