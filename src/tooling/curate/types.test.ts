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
  return { features: { [name]: { directories: [], seams: [], ...feature } } };
}

describe("FeatureManifestSchema", () => {
  it("accepts two features, a directory spelled with a trailing slash, and a seam file both features share", () => {
    const manifest = {
      features: {
        showcase: { directories: ["src/showcase/", "tests/unit/showcase/"], seams: ["src/worker.ts", "src/client/main.ts"] },
        contact: { directories: ["src/contact"], seams: ["src/worker.ts"] },
      },
    };
    expect(issues(manifest)).toEqual([]);
  });

  it("accepts a feature that owns only directories, and one that owns only seams", () => {
    expect(issues(only({ directories: ["src/showcase"] }))).toEqual([]);
    expect(issues(only({ seams: ["src/worker.ts"] }))).toEqual([]);
  });

  it("accepts a feature that owns only files, and one that owns only scripts", () => {
    expect(issues(only({ files: ["config/db.ts"] }))).toEqual([]);
    expect(issues(only({ scripts: ["db:migrate"] }))).toEqual([]);
  });

  it("refuses a feature that names nothing to remove, empty files and scripts included", () => {
    expect(issues(only({}))).toEqual(["features.showcase: a feature must name something to remove"]);
    expect(issues(only({ files: [], scripts: [] }))).toEqual(["features.showcase: a feature must name something to remove"]);
  });

  it("refuses an owned file climbing out of the root", () => {
    expect(issues(only({ files: ["../config/db.ts"] }))).toEqual([`features.showcase.files.0: ${PATH_RULE}`]);
  });

  it("refuses an empty script name", () => {
    expect(issues(only({ scripts: [""] }))[0]).toStartWith("features.showcase.scripts.0: ");
  });

  it("refuses a manifest that names no feature", () => {
    expect(issues({ features: {} })).toEqual(["features: a manifest must name a feature"]);
  });

  it("refuses an absolute directory", () => {
    expect(issues(only({ directories: ["/src/showcase"] }))).toEqual([`features.showcase.directories.0: ${PATH_RULE}`]);
  });

  it("refuses a seam path climbing out of the root", () => {
    expect(issues(only({ seams: ["../other/worker.ts"] }))).toEqual([`features.showcase.seams.0: ${PATH_RULE}`]);
  });

  it("refuses a leading `./`, which no working-tree listing spells", () => {
    expect(issues(only({ directories: ["./src/showcase"] }))).toEqual([`features.showcase.directories.0: ${PATH_RULE}`]);
  });

  it("refuses an empty path", () => {
    expect(issues(only({ seams: [""] }))[0]).toStartWith("features.showcase.seams.0: ");
  });

  it("refuses a seam written as a file and marker pair, since the marker is now derived from the feature name", () => {
    expect(issues(only({ seams: [{ file: "src/worker.ts", marker: "// feature:showcase" }] }))[0]).toStartWith("features.showcase.seams.0: ");
  });

  it("refuses a key a feature does not define", () => {
    expect(issues(only({ seams: ["src/worker.ts"], marker: "// feature:showcase" }))[0]).toStartWith("features.showcase.marker: ");
  });

  it("refuses an entry that is not a feature", () => {
    expect(issues({ features: { showcase: { directories: ["src/showcase"], seams: [] }, profile: "lite" } })[0]).toStartWith("features.profile: ");
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
      expect(issues(only({ seams: ["src/worker.ts"] }, name))).toEqual([`features.${name}: ${NAME_RULE}`]);
    });
  }

  it("refuses an empty feature name", () => {
    expect(issues(only({ seams: ["src/worker.ts"] }, ""))).toEqual([`features.: ${NAME_RULE}`]);
  });

  it("accepts a feature that requires others and regenerates after the copy", () => {
    const manifest = {
      features: {
        db: {
          directories: ["src/db"],
          seams: [],
          regenerate: { remove: ["config/migrations/", "config/snapshot.json"], run: ["forge", "db", "migrate", "compose"] },
        },
        auth: { directories: ["src/auth"], seams: [], requires: ["db"] },
      },
    };
    expect(issues(manifest)).toEqual([]);
  });

  it("accepts a regeneration that removes nothing first", () => {
    expect(issues(only({ seams: ["src/worker.ts"], regenerate: { run: ["forge", "db", "migrate", "compose"] } }))).toEqual([]);
  });

  it("refuses a requirement spelled as no feature name can be", () => {
    expect(issues(only({ seams: ["src/worker.ts"], requires: ["Mail"] }))).toEqual([`features.showcase.requires.0: ${NAME_RULE}`]);
  });

  it("refuses a regeneration that runs no command", () => {
    expect(issues(only({ seams: ["src/worker.ts"], regenerate: { run: [] } }))).toEqual(["features.showcase.regenerate.run: must name a command"]);
  });

  it("refuses a regeneration whose command holds an empty argument", () => {
    expect(issues(only({ seams: ["src/worker.ts"], regenerate: { run: ["forge", ""] } }))[0]).toStartWith("features.showcase.regenerate.run.1: ");
  });

  it("refuses a removal path climbing out of the root", () => {
    expect(issues(only({ seams: ["src/worker.ts"], regenerate: { remove: ["../migrations"], run: ["forge"] } }))).toEqual([
      `features.showcase.regenerate.remove.0: ${PATH_RULE}`,
    ]);
  });

  it("refuses a key a regeneration does not define", () => {
    expect(issues(only({ seams: ["src/worker.ts"], regenerate: { run: ["forge"], cwd: "config" } }))[0]).toStartWith(
      "features.showcase.regenerate.cwd: ",
    );
  });
});

describe("FeatureManifestSchema — the manifest around its features", () => {
  const FEATURES = { showcase: { directories: ["src/showcase"], seams: [] } };

  it("accepts a manifest-level regeneration beside the features", () => {
    expect(issues({ features: FEATURES, regenerate: { run: ["forge", "cf", "gen", "env"] } })).toEqual([]);
  });

  it("refuses a bare feature record, the shape before the manifest wrapped it", () => {
    expect(issues(FEATURES)[0]).toStartWith("features: ");
  });

  it("refuses a manifest-level regeneration that runs no command, or a key the manifest does not define", () => {
    expect(issues({ features: FEATURES, regenerate: { run: [] } })).toEqual(["regenerate.run: must name a command"]);
    expect(issues({ features: FEATURES, profile: "lite" })[0]).toStartWith("profile: ");
  });
});

describe("FEATURE_NAME", () => {
  it("matches the whole name, not a prefix of it", () => {
    expect(FEATURE_NAME.test("showcase")).toBe(true);
    expect(FEATURE_NAME.test("showcase extra")).toBe(false);
  });
});
