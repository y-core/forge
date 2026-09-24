import { describe, expect, it } from "bun:test";

import { v } from "../../validation/mod";
import { StripConfigSchema } from "./types";

const MARKER = "/* strip:showcase */";

function issues(input: unknown): string[] {
  const result = v.safeParse(StripConfigSchema, input);
  return result.success ? [] : result.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`);
}

describe("StripConfigSchema", () => {
  it("accepts a manifest naming directories with a trailing slash and two seams", () => {
    const manifest = {
      directories: ["src/showcase/", "tests/unit/showcase/"],
      seams: [
        { file: "src/worker.ts", marker: MARKER },
        { file: "src/client/main.ts", marker: MARKER },
      ],
    };
    expect(issues(manifest)).toEqual([]);
  });

  it("refuses an absolute directory", () => {
    expect(issues({ directories: ["/src/showcase"], seams: [] })).toEqual(["directories.0: must be root-relative with no `..` segment"]);
  });

  it("refuses a path climbing out of the root", () => {
    expect(issues({ directories: [], seams: [{ file: "../other/worker.ts", marker: MARKER }] })).toEqual([
      "seams.0.file: must be root-relative with no `..` segment",
    ]);
  });

  it("refuses a leading `./`, which no working-tree listing spells", () => {
    expect(issues({ directories: ["./src/showcase"], seams: [] })).toEqual(["directories.0: must be root-relative with no `..` segment"]);
  });

  it("refuses an empty marker, which would match every line", () => {
    expect(issues({ directories: [], seams: [{ file: "src/worker.ts", marker: "" }] })).toHaveLength(1);
    expect(issues({ directories: [], seams: [{ file: "src/worker.ts", marker: "" }] })[0]).toStartWith("seams.0.marker: ");
  });

  it("accepts a line comment and a hash comment as a marker", () => {
    const seams = [
      { file: "src/worker.ts", marker: "// strip:showcase" },
      { file: "config/app.toml", marker: "# strip:showcase" },
    ];
    expect(issues({ directories: [], seams })).toEqual([]);
  });

  it("refuses a marker that is not a comment, which would match code", () => {
    expect(issues({ directories: [], seams: [{ file: "src/worker.ts", marker: "import" }] })).toEqual([
      "seams.0.marker: must be a comment — `/* … */`, or starting `//` or `#`",
    ]);
  });

  it("refuses a block-comment marker left unclosed", () => {
    expect(issues({ directories: [], seams: [{ file: "src/worker.ts", marker: "/* strip:showcase" }] })).toEqual([
      "seams.0.marker: must be a comment — `/* … */`, or starting `//` or `#`",
    ]);
  });

  it("refuses a key the manifest does not define", () => {
    expect(issues({ directories: ["src/showcase"], seams: [], profile: "lite" })[0]).toStartWith("profile: ");
  });

  it("refuses a manifest that names nothing to remove", () => {
    expect(issues({ directories: [], seams: [] })).toEqual(["(root): a manifest must name something to remove"]);
  });
});
