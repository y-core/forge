import { describe, expect, it } from "bun:test";
import { checkResult, fail, formatCheckResult, formatFinding, warn } from "./finding";

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
