import { describe, expect, it } from "bun:test";

import { v } from "../../validation/mod";
import { FEATURE_NAME, FeatureManifestSchema } from "./types";

const NAME_RULE = "must be lowercase letters, digits and `-`, starting with a letter";
const PATH_RULE = "must be root-relative with no `..` segment";

function issues(input: unknown): string[] {
  const result = v.safeParse(FeatureManifestSchema, input);
  return result.success ? [] : result.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`);
}

function only(feature: Record<string, unknown>, name = "showcase"): unknown {
  return { [name]: { directories: [], seams: [], ...feature } };
}

describe("FeatureManifestSchema", () => {
  it("accepts two features, a directory spelled with a trailing slash, and a seam file both features share", () => {
    const manifest = {
      showcase: { directories: ["src/showcase/", "tests/unit/showcase/"], seams: ["src/worker.ts", "src/client/main.ts"] },
      contact: { directories: ["src/contact"], seams: ["src/worker.ts"] },
    };
    expect(issues(manifest)).toEqual([]);
  });

  it("accepts a feature that owns only directories, and one that owns only seams", () => {
    expect(issues(only({ directories: ["src/showcase"] }))).toEqual([]);
    expect(issues(only({ seams: ["src/worker.ts"] }))).toEqual([]);
  });

  it("refuses a feature that names nothing to remove", () => {
    expect(issues(only({}))).toEqual(["showcase: a feature must name something to remove"]);
  });

  it("refuses a manifest that names no feature", () => {
    expect(issues({})).toEqual(["(root): a manifest must name a feature"]);
  });

  it("refuses an absolute directory", () => {
    expect(issues(only({ directories: ["/src/showcase"] }))).toEqual([`showcase.directories.0: ${PATH_RULE}`]);
  });

  it("refuses a seam path climbing out of the root", () => {
    expect(issues(only({ seams: ["../other/worker.ts"] }))).toEqual([`showcase.seams.0: ${PATH_RULE}`]);
  });

  it("refuses a leading `./`, which no working-tree listing spells", () => {
    expect(issues(only({ directories: ["./src/showcase"] }))).toEqual([`showcase.directories.0: ${PATH_RULE}`]);
  });

  it("refuses an empty path", () => {
    expect(issues(only({ seams: [""] }))[0]).toStartWith("showcase.seams.0: ");
  });

  it("refuses a seam written as a file and marker pair, since the marker is now derived from the feature name", () => {
    expect(issues(only({ seams: [{ file: "src/worker.ts", marker: "// feature:showcase" }] }))[0]).toStartWith("showcase.seams.0: ");
  });

  it("refuses a key a feature does not define", () => {
    expect(issues(only({ seams: ["src/worker.ts"], marker: "// feature:showcase" }))[0]).toStartWith("showcase.marker: ");
  });

  it("refuses an entry that is not a feature", () => {
    expect(issues({ showcase: { directories: ["src/showcase"], seams: [] }, profile: "lite" })[0]).toStartWith("profile: ");
  });

  it("accepts a feature name of lowercase letters, digits and hyphens that starts with a letter", () => {
    expect(issues(only({ seams: ["src/worker.ts"] }, "contact-form2"))).toEqual([]);
  });

  const BAD_NAMES: [string, string][] = [
    ["an uppercase letter", "Showcase"],
    ["a leading digit", "2fa"],
    ["a leading hyphen", "-demo"],
    ["an underscore", "contact_form"],
    ["a comma, which a marker reads as a list separator", "a,b"],
    ["a colon, which a marker reads as a region edge", "demo:begin"],
  ];
  for (const [kind, name] of BAD_NAMES) {
    it(`refuses a feature name with ${kind}`, () => {
      expect(issues(only({ seams: ["src/worker.ts"] }, name))).toEqual([`${name}: ${NAME_RULE}`]);
    });
  }

  it("refuses an empty feature name", () => {
    expect(issues(only({ seams: ["src/worker.ts"] }, ""))).toEqual([`: ${NAME_RULE}`]);
  });
});

describe("FEATURE_NAME", () => {
  it("matches the whole name, not a prefix of it", () => {
    expect(FEATURE_NAME.test("showcase")).toBe(true);
    expect(FEATURE_NAME.test("showcase extra")).toBe(false);
  });
});
