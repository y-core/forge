import { describe, expect, it } from "bun:test";

import { CliError } from "../cli/errors";
import { describeFeatureGraph, featureGraph, resolveFeatures } from "./graph";
import type { FeatureManifest, FeatureSelection } from "./types";

function feature(requires?: string[], run?: [string, ...string[]]): FeatureManifest[string] {
  return {
    directories: [],
    seams: ["src/app.ts"],
    ...(requires === undefined ? {} : { requires }),
    ...(run === undefined ? {} : { regenerate: { run } }),
  };
}

function manifest(entries: Record<string, string[] | undefined>): FeatureManifest {
  return Object.fromEntries(Object.entries(entries).map(([name, requires]) => [name, feature(requires)]));
}

function refusal(body: () => unknown): CliError {
  try {
    body();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

function refusedGraph(config: FeatureManifest): string {
  const error = refusal(() => featureGraph(config));
  expect(error.kind).toBe("invalid-args");
  return error.message;
}

function refusedSelection(config: FeatureManifest, selection: FeatureSelection): string {
  const error = refusal(() => resolveFeatures(config, selection));
  expect(error.kind).toBe("invalid-args");
  return error.message;
}

const CYCLE_ADVICE = "a feature graph has no cycles; merge them, or move what they share into a feature both require";

describe("featureGraph() — refusals", () => {
  it("refuses a requirement the manifest does not name", () => {
    expect(refusedGraph(manifest({ showcase: undefined, contact: ["mail"] }))).toBe(
      "feature `contact` requires unknown feature `mail` — the manifest names `showcase`, `contact`",
    );
  });

  it("refuses a feature requiring itself", () => {
    expect(refusedGraph(manifest({ showcase: undefined, contact: ["contact"] }))).toBe("feature `contact` requires itself");
  });

  it("refuses two features requiring one another", () => {
    expect(refusedGraph(manifest({ a: ["b"], b: ["a"] }))).toBe(`features \`a\` → \`b\` → \`a\` require one another — ${CYCLE_ADVICE}`);
  });

  it("names a three-feature cycle from the feature the walk revisits, not the one it started from", () => {
    expect(refusedGraph(manifest({ entry: ["b"], a: ["b"], b: ["c"], c: ["a"] }))).toBe(
      `features \`b\` → \`c\` → \`a\` → \`b\` require one another — ${CYCLE_ADVICE}`,
    );
  });
});

describe("featureGraph() — the graph", () => {
  it("orders requirements before the features needing them, and unrelated features in manifest order", () => {
    expect(featureGraph(manifest({ showcase: undefined, auth: ["db"], db: undefined, blog: undefined })).order).toEqual([
      "showcase",
      "db",
      "auth",
      "blog",
    ]);
  });

  it("maps each feature to the features requiring it directly, in manifest order", () => {
    const graph = featureGraph(manifest({ contact: ["email"], email: undefined, digest: ["contact", "email"] }));

    expect([...graph.requiredBy.entries()]).toEqual([
      ["contact", ["digest"]],
      ["email", ["contact", "digest"]],
      ["digest", []],
    ]);
  });

  it("maps each feature to everything it requires, directly or through another", () => {
    const graph = featureGraph(manifest({ auth: ["db"], db: ["core-x"], "core-x": undefined }));

    expect([...graph.closure.get("auth")!].sort()).toEqual(["core-x", "db"]);
    expect([...graph.closure.get("core-x")!]).toEqual([]);
  });
});

describe("resolveFeatures() — refusals", () => {
  it("refuses to keep a feature the manifest does not name", () => {
    expect(refusedSelection(manifest({ showcase: undefined, contact: undefined }), { keep: ["showcase", "blog"] })).toBe(
      "cannot keep unknown feature `blog` — the manifest names `showcase`, `contact`",
    );
  });

  it("refuses to drop a feature the manifest does not name", () => {
    expect(refusedSelection(manifest({ showcase: undefined, contact: undefined }), { drop: ["blog"] })).toBe(
      "cannot drop unknown feature `blog` — the manifest names `showcase`, `contact`",
    );
  });

  it("refuses the graph before the names it is asked to select", () => {
    expect(refusedSelection(manifest({ showcase: undefined, contact: ["contact"] }), { drop: ["blog"] })).toBe("feature `contact` requires itself");
  });
});

describe("resolveFeatures() — keeping", () => {
  const CHAIN = manifest({ showcase: undefined, auth: ["db"], db: ["core-x"], "core-x": undefined });

  it("keeps each kept feature's requirements, through a chain, and reports each one it added", () => {
    expect(resolveFeatures(CHAIN, { keep: ["auth"] })).toEqual({
      mode: "keep",
      kept: ["auth", "db", "core-x"],
      dropped: ["showcase"],
      added: [
        { feature: "db", because: ["auth"] },
        { feature: "core-x", because: ["db"] },
      ],
    });
  });

  it("names every kept feature that requires an addition directly, and no feature the copy drops", () => {
    const config = manifest({ email: undefined, contact: ["email"], newsletter: ["email"], blog: ["email"] });

    expect(resolveFeatures(config, { keep: ["contact", "newsletter"] }).added).toEqual([{ feature: "email", because: ["contact", "newsletter"] }]);
  });

  it("drops every feature when it keeps none", () => {
    expect(resolveFeatures(CHAIN, { keep: [] })).toEqual({ mode: "keep", kept: [], dropped: ["showcase", "auth", "db", "core-x"], added: [] });
  });

  it("drops nothing and adds nothing when it keeps every feature", () => {
    expect(resolveFeatures(CHAIN, { keep: ["showcase", "auth", "db", "core-x"] })).toEqual({
      mode: "keep",
      kept: ["showcase", "auth", "db", "core-x"],
      dropped: [],
      added: [],
    });
  });
});

describe("resolveFeatures() — dropping", () => {
  it("drops every feature requiring a dropped one, through a chain, and reports each one it added", () => {
    const config = manifest({ email: undefined, contact: ["email"], digest: ["contact"], showcase: undefined });

    expect(resolveFeatures(config, { drop: ["email"] })).toEqual({
      mode: "drop",
      kept: ["showcase"],
      dropped: ["email", "contact", "digest"],
      added: [
        { feature: "contact", because: ["email"] },
        { feature: "digest", because: ["contact"] },
      ],
    });
  });

  it("names every dropped requirement of an addition, and no requirement the copy keeps", () => {
    const config = manifest({ form: undefined, email: undefined, contact: ["form", "email"], showcase: undefined });

    expect(resolveFeatures(config, { drop: ["form", "email"] }).added).toEqual([{ feature: "contact", because: ["form", "email"] }]);
    expect(resolveFeatures(config, { drop: ["email"] }).added).toEqual([{ feature: "contact", because: ["email"] }]);
  });

  it("drops nothing and adds nothing when it drops no feature", () => {
    expect(resolveFeatures(manifest({ email: undefined, contact: ["email"] }), { drop: [] })).toEqual({
      mode: "drop",
      kept: ["email", "contact"],
      dropped: [],
      added: [],
    });
  });
});

describe("resolveFeatures() — closure", () => {
  const WIDE = manifest({ a: undefined, b: ["a"], c: ["b"], d: ["a", "e"], e: undefined, f: undefined });
  const requires = (name: string): string[] => WIDE[name]?.requires ?? [];
  const selections: FeatureSelection[] = Object.keys(WIDE).flatMap((name) => [{ keep: [name] }, { drop: [name] }]);

  for (const selection of selections) {
    it(`keeps every requirement of a kept feature and drops every dependent of a dropped one for ${JSON.stringify(selection)}`, () => {
      const { kept, dropped } = resolveFeatures(WIDE, selection);

      expect(kept.flatMap(requires).filter((name) => !kept.includes(name))).toEqual([]);
      expect(kept.filter((name) => requires(name).some((requirement) => dropped.includes(requirement)))).toEqual([]);
      expect([...kept, ...dropped].sort()).toEqual(Object.keys(WIDE).sort());
    });
  }
});

describe("describeFeatureGraph()", () => {
  it("prints one row per feature in requirement order, each with its direct edges and any regeneration", () => {
    const config: FeatureManifest = { auth: feature(["db"]), db: feature(undefined, ["forge", "db", "migrate", "compose"]), showcase: feature() };

    expect(describeFeatureGraph(config)).toEqual([
      "  db:       requires nothing; required by auth; regenerates with `forge db migrate compose`",
      "  auth:     requires db; required by nothing",
      "  showcase: requires nothing; required by nothing",
    ]);
  });

  it("lists several direct edges comma-separated, and none reached only through another feature", () => {
    const config = manifest({ core: undefined, db: ["core"], auth: ["db", "core"] });

    expect(describeFeatureGraph(config)).toEqual([
      "  core: requires nothing; required by db, auth",
      "  db:   requires core; required by auth",
      "  auth: requires db, core; required by nothing",
    ]);
  });
});
