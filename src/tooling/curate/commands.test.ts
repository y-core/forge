import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { CliError } from "../cli/errors";
import { execute } from "../cli/execute";
import type { CaptureResult, CliIO } from "../cli/types";
import { createCurateCommand, curateTree, listWorkingTree } from "./commands";
import { CURATE_FIXTURE_FEATURES, CURATE_FIXTURE_MANIFEST, curateFixtureRepo } from "./curate.fixture";
import type { CurateRequest, CurateRunner, FeatureManifest } from "./types";

const scratch: string[] = [];

function tracked<T extends string>(path: T): T {
  scratch.push(path);
  return path;
}

function repo(manifest?: string): string {
  return tracked(curateFixtureRepo(manifest));
}

/** A path in a fresh parent that does not exist yet. */
function freshTarget(): string {
  return join(tracked(mkdtempSync(join(tmpdir(), "forge-curate-out-"))), "skeleton");
}

function failure(body: () => unknown): Error {
  try {
    body();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

function refusal(body: () => unknown): CliError {
  const error = failure(body);
  if (error instanceof CliError) return error;
  throw error;
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), "utf-8");
}

/** Curates into a fresh target that must stay unwritten, and answers the refusal's message once its kind is `invalid-args`. */
function refused(request: Omit<CurateRequest, "target">): string {
  const target = freshTarget();
  const error = refusal(() => curateTree({ ...request, target }));
  expect(error.kind).toBe("invalid-args");
  expect(existsSync(target)).toBe(false);
  return error.message;
}

/** The fixture manifest with one feature's entry replaced. */
function withFeature(name: string, feature: FeatureManifest[string]): FeatureManifest {
  return { ...CURATE_FIXTURE_FEATURES, [name]: feature };
}

/** The fixture manifest with `file` added to the seams of each feature `names` lists. */
function withSeam(file: string, names: readonly string[] = ["showcase", "contact"]): FeatureManifest {
  const features = Object.entries(CURATE_FIXTURE_FEATURES).map(([name, { directories, seams }]) => [
    name,
    { directories, seams: names.includes(name) ? [...seams, file] : seams },
  ]);
  return Object.fromEntries(features);
}

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const APP = [
  'import { demo } from "./showcase/demo"; // feature:showcase',
  'import { contact } from "./contact/form"; // feature:contact',
  "export const app = 1;",
  "register(demo); /* feature:showcase */",
  "mountShared(demo, contact); // feature:showcase,contact",
  "",
];
const README = ["# app", "<!-- feature:showcase:begin -->", "## Showcase", "<!-- feature:showcase:end -->", "Start here.", ""];
const TOML = ['name = "app"', "contact = true # feature:contact", ""];
const PACKAGE = [
  "{",
  '  "name": "app",',
  '  "scripts": {',
  '    "build": "tsc",',
  '    "contact:send": "bun run src/contact/form.ts",',
  '    "showcase:demo": "bun run src/showcase/demo.ts"',
  "  },",
  '  "private": true',
  "}",
  "",
];

function lines(source: readonly string[], keep: readonly number[]): string {
  return keep.map((index) => source[index]).join("\n");
}

describe("listWorkingTree()", () => {
  it("lists tracked and untracked files, and leaves out ignored ones and a tracked file deleted from disk", () => {
    expect(listWorkingTree(repo()).sort()).toEqual([
      ".gitignore",
      "README.md",
      "config/app.toml",
      "config/contact.toml",
      "notes.txt",
      "package.json",
      "src/app.ts",
      "src/contact/form.ts",
      "src/showcase/demo.ts",
      "src/showcase/nested/panel.ts",
      "tests/showcase/demo.test.ts",
    ]);
  });

  it("refuses a directory that is not a git working tree as an external failure", () => {
    const plain = tracked(mkdtempSync(join(tmpdir(), "forge-curate-plain-")));
    const error = refusal(() => listWorkingTree(plain));
    expect(error.kind).toBe("external");
    expect(error.message).toBe(`git ls-files failed in ${plain} — forge curate copies a git working tree`);
  });
});

describe("curateTree() — a plain copy", () => {
  it("copies every listed file byte for byte when nothing is dropped, and nothing git ignores, deleted or under node_modules", () => {
    const root = repo();
    const target = freshTarget();
    const report = curateTree({ root, target, config: CURATE_FIXTURE_FEATURES, selection: { drop: [] } });

    expect([...report.files].sort()).toEqual(listWorkingTree(root).sort());
    expect(report.dropped).toEqual([]);
    expect(report.directories).toEqual([]);
    expect(report.ownedFiles).toEqual([]);
    expect(report.scripts).toEqual([]);
    expect(report.seams).toEqual([]);
    expect(report.manifest).toBeUndefined();
    expect(read(target, "src/app.ts")).toBe(APP.join("\n"));
    expect(read(target, "package.json")).toBe(PACKAGE.join("\n"));
    expect(read(target, "README.md")).toBe(README.join("\n"));
    expect(read(target, "src/showcase/nested/panel.ts")).toBe("export const panel = 1;\n");
    expect(read(target, "notes.txt")).toBe("untracked, not ignored\n");
    expect(existsSync(join(target, "debug.log"))).toBe(false);
    expect(existsSync(join(target, "node_modules"))).toBe(false);
    expect(existsSync(join(target, "gone.ts"))).toBe(false);
  });

  it("copies the manifest verbatim and reports it kept when nothing is dropped", () => {
    const target = freshTarget();
    const report = curateTree({
      root: repo(CURATE_FIXTURE_MANIFEST),
      target,
      config: CURATE_FIXTURE_FEATURES,
      selection: { drop: [] },
      manifest: "config/features.ts",
    });

    expect(report.manifest).toBeUndefined();
    expect(read(target, "config/features.ts")).toBe(CURATE_FIXTURE_MANIFEST);
  });
});

describe("curateTree() — dropping features", () => {
  it("drops one feature's directory, reported without its trailing slash, and keeps the other feature's", () => {
    const target = freshTarget();
    const report = curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } });

    expect(report.dropped).toEqual(["showcase"]);
    expect(report.directories).toEqual(["src/showcase"]);
    expect(existsSync(join(target, "src/showcase"))).toBe(false);
    expect(read(target, "src/contact/form.ts")).toBe("export const contact = 1;\n");
    expect(read(target, "tests/showcase/demo.test.ts")).toBe("// untracked spec\n");
  });

  it("leaves out the file a dropped feature owns and removes its script from the middle of package.json's scripts", () => {
    const target = freshTarget();
    const report = curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["contact"] } });

    expect(report.ownedFiles).toEqual(["config/contact.toml"]);
    expect(report.scripts).toEqual(["contact:send"]);
    expect(report.files).not.toContain("config/contact.toml");
    expect(existsSync(join(target, "config/contact.toml"))).toBe(false);
    expect(read(target, "package.json")).toBe(
      '{\n  "name": "app",\n  "scripts": {\n    "build": "tsc",\n    "showcase:demo": "bun run src/showcase/demo.ts"\n  },\n  "private": true\n}\n',
    );
  });

  it("keeps the file a remaining feature owns, and removes a dropped feature's last script with the comma before it", () => {
    const target = freshTarget();
    const report = curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } });

    expect(report.ownedFiles).toEqual([]);
    expect(report.scripts).toEqual(["showcase:demo"]);
    expect(read(target, "config/contact.toml")).toBe('to = "team"\n');
    expect(read(target, "package.json")).toBe(
      '{\n  "name": "app",\n  "scripts": {\n    "build": "tsc",\n    "contact:send": "bun run src/contact/form.ts"\n  },\n  "private": true\n}\n',
    );
  });

  it("removes every dropped feature's script, leaving the ones no feature names", () => {
    const target = freshTarget();
    const report = curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase", "contact"] } });

    expect(report.scripts).toEqual(["showcase:demo", "contact:send"]);
    expect(read(target, "package.json")).toBe('{\n  "name": "app",\n  "scripts": {\n    "build": "tsc"\n  },\n  "private": true\n}\n');
  });

  it("leaves out a file a feature owns while it is a seam of a feature requiring the owner, the two dropped together", () => {
    const config: FeatureManifest = {
      showcase: { ...CURATE_FIXTURE_FEATURES.showcase!, requires: ["contact"] },
      contact: { ...CURATE_FIXTURE_FEATURES.contact!, files: ["README.md"] },
    };
    const target = freshTarget();
    const report = curateTree({ root: repo(), target, config, selection: { drop: ["contact"] } });

    expect(report.dropped).toEqual(["showcase", "contact"]);
    expect(report.ownedFiles).toEqual(["README.md"]);
    expect(existsSync(join(target, "README.md"))).toBe(false);
  });

  it("keeps a file its owner also marks for a plain copy, and leaves it out when the owner is dropped", () => {
    const config = withFeature("contact", { ...CURATE_FIXTURE_FEATURES.contact!, files: ["config/app.toml"] });
    const plain = freshTarget();
    const dropping = freshTarget();

    curateTree({ root: repo(), target: plain, config, selection: { drop: [] } });
    const report = curateTree({ root: repo(), target: dropping, config, selection: { drop: ["contact"] } });

    expect(read(plain, "config/app.toml")).toBe(TOML.join("\n"));
    expect(report.ownedFiles).toEqual(["config/app.toml"]);
    expect(report.seams.map(({ file }) => file)).not.toContain("config/app.toml");
    expect(existsSync(join(dropping, "config/app.toml"))).toBe(false);
  });

  it("removes the dropped feature's `//` and `/* */` lines and keeps a line shared with a feature that remains", () => {
    const target = freshTarget();
    curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } });

    expect(read(target, "src/app.ts")).toBe(lines(APP, [1, 2, 4, 5]));
  });

  it("removes the other feature's `//` and `#` lines and keeps the same shared line", () => {
    const target = freshTarget();
    curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["contact"] } });

    expect(read(target, "src/app.ts")).toBe(lines(APP, [0, 2, 3, 4, 5]));
    expect(read(target, "config/app.toml")).toBe(lines(TOML, [0, 2]));
  });

  it("removes a shared line once every feature it names is dropped", () => {
    const target = freshTarget();
    curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase", "contact"] } });

    expect(read(target, "src/app.ts")).toBe("export const app = 1;\n");
  });

  it("removes a dropped feature's `<!-- -->` region with both its markers", () => {
    const target = freshTarget();
    curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } });

    expect(read(target, "README.md")).toBe("# app\nStart here.\n");
  });

  it("keeps a region whose feature remains, its markers included", () => {
    const target = freshTarget();
    curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["contact"] } });

    expect(read(target, "README.md")).toBe(README.join("\n"));
  });

  it("reports each file that lost lines with the count it lost, and the dropped features' directories", () => {
    const report = curateTree({
      root: repo(),
      target: freshTarget(),
      config: CURATE_FIXTURE_FEATURES,
      selection: { drop: ["showcase", "contact"] },
    });

    expect(report.dropped).toEqual(["showcase", "contact"]);
    expect(report.directories).toEqual(["src/showcase", "src/contact"]);
    expect(report.seams).toEqual([
      { file: "README.md", removed: 3 },
      { file: "config/app.toml", removed: 1 },
      { file: "src/app.ts", removed: 4 },
    ]);
  });

  it("leaves the source tree untouched", () => {
    const root = repo();
    curateTree({ root, target: freshTarget(), config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase", "contact"] } });

    expect(read(root, "src/app.ts")).toBe(APP.join("\n"));
    expect(read(root, "README.md")).toBe(README.join("\n"));
    expect(existsSync(join(root, "src/showcase/demo.ts"))).toBe(true);
  });

  it("writes into a target that exists and is empty", () => {
    const target = tracked(mkdtempSync(join(tmpdir(), "forge-curate-empty-")));
    curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } });

    expect(read(target, "notes.txt")).toBe("untracked, not ignored\n");
  });

  it("keeps a line that carries a marker anywhere but at its end, and removes one followed only by whitespace", () => {
    const root = repo();
    writeFileSync(
      join(root, "src/doc.ts"),
      'const doc = "lines ending /* feature:showcase */ go";\nregister(); /* feature:showcase */  \n',
      "utf-8",
    );
    const target = freshTarget();
    const config = withSeam("src/doc.ts", ["showcase"]);
    const report = curateTree({ root, target, config, selection: { drop: ["showcase"] } });

    expect(read(target, "src/doc.ts")).toBe('const doc = "lines ending /* feature:showcase */ go";\n');
    expect(report.seams).toContainEqual({ file: "src/doc.ts", removed: 1 });
  });

  it("closes a region whose end marker lists the same features in another order", () => {
    const root = repo();
    writeFileSync(join(root, "src/both.ts"), "a;\n// feature:showcase,contact:begin\nb;\n// feature:contact,showcase:end\nc;\n", "utf-8");
    const target = freshTarget();
    curateTree({ root, target, config: withSeam("src/both.ts"), selection: { drop: ["contact", "showcase"] } });

    expect(read(target, "src/both.ts")).toBe("a;\nc;\n");
  });

  const TWO_FEATURE_REGION = "a;\n// feature:showcase,contact:begin\nb;\n// feature:showcase,contact:end\nc;\n";
  const TWO_FEATURE_CASES: [string[], string][] = [
    [["showcase"], TWO_FEATURE_REGION],
    [["contact"], TWO_FEATURE_REGION],
    [["showcase", "contact"], "a;\nc;\n"],
  ];
  for (const [drop, expected] of TWO_FEATURE_CASES) {
    it(`${drop.length === 2 ? "removes" : "keeps"} a region naming two features when --drop is ${drop.join(",")}`, () => {
      const root = repo();
      writeFileSync(join(root, "src/both.ts"), TWO_FEATURE_REGION, "utf-8");
      const target = freshTarget();
      curateTree({ root, target, config: withSeam("src/both.ts"), selection: { drop } });

      expect(read(target, "src/both.ts")).toBe(expected);
    });
  }

  const NESTED_LINE = "a;\n// feature:showcase:begin\nb;\nc; // feature:contact\n// feature:showcase:end\nd;\n";
  const NESTED_LINE_CASES: [string[], string][] = [
    [["contact"], "a;\n// feature:showcase:begin\nb;\n// feature:showcase:end\nd;\n"],
    [["showcase"], "a;\nd;\n"],
  ];
  for (const [drop, expected] of NESTED_LINE_CASES) {
    it(`reads a line marker inside a region on its own when --drop is ${drop.join(",")}`, () => {
      const root = repo();
      writeFileSync(join(root, "src/nested.ts"), NESTED_LINE, "utf-8");
      const target = freshTarget();
      curateTree({ root, target, config: withSeam("src/nested.ts"), selection: { drop } });

      expect(read(target, "src/nested.ts")).toBe(expected);
    });
  }

  it("does not read a file holding a NUL byte for a marker, and copies it as it is", () => {
    const root = repo();
    const binary = "\0other(); // feature:unknown\n";
    writeFileSync(join(root, "blob.bin"), binary, "utf-8");
    const target = freshTarget();
    curateTree({ root, target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } });

    expect(read(target, "blob.bin")).toBe(binary);
  });

  it("does not read a file that is not UTF-8 for a marker, and copies it as it is", () => {
    const root = repo();
    const bytes = new Uint8Array([0xff, 0xfe, ...new TextEncoder().encode("other(); // feature:unknown\n")]);
    writeFileSync(join(root, "latin.txt"), bytes);
    const target = freshTarget();
    curateTree({ root, target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } });

    expect([...readFileSync(join(target, "latin.txt"))]).toEqual([...bytes]);
  });

  it("copies a symbolic link that is not a seam as the link itself", () => {
    const root = repo();
    symlinkSync("../README.md", join(root, "src/readme.md"));
    const target = freshTarget();
    curateTree({ root, target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } });

    expect(readlinkSync(join(target, "src/readme.md"))).toBe("../README.md");
  });
});

describe("curateTree() — the manifest", () => {
  it("keeps the manifest while a feature remains, and removes the dropped feature's line from it", () => {
    const root = repo(CURATE_FIXTURE_MANIFEST);
    const target = freshTarget();
    const report = curateTree({ root, target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] }, manifest: "config/features.ts" });

    expect(report.manifest).toBeUndefined();
    expect(report.files).toContain("config/features.ts");
    expect(report.seams).toContainEqual({ file: "config/features.ts", removed: 1 });
    expect(read(target, "config/features.ts")).toBe(lines(CURATE_FIXTURE_MANIFEST.split("\n"), [0, 2, 3, 4, 5, 6]));
  });

  it("keeps the manifest while a feature remains, and removes the dropped feature's region from it", () => {
    const root = repo(CURATE_FIXTURE_MANIFEST);
    const target = freshTarget();
    const report = curateTree({ root, target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["contact"] }, manifest: "config/features.ts" });

    expect(report.manifest).toBeUndefined();
    expect(report.seams).toContainEqual({ file: "config/features.ts", removed: 3 });
    expect(read(target, "config/features.ts")).toBe(lines(CURATE_FIXTURE_MANIFEST.split("\n"), [0, 1, 5, 6]));
  });

  it("leaves the manifest out once every feature is dropped, reports it, and leaves the source's copy as it was", () => {
    const root = repo(CURATE_FIXTURE_MANIFEST);
    const target = freshTarget();
    const report = curateTree({
      root,
      target,
      config: CURATE_FIXTURE_FEATURES,
      selection: { drop: ["showcase", "contact"] },
      manifest: "config/features.ts",
    });

    expect(report.manifest).toBe("config/features.ts");
    expect(report.files).not.toContain("config/features.ts");
    expect(report.seams.map((seam) => seam.file)).not.toContain("config/features.ts");
    expect(existsSync(join(target, "config/features.ts"))).toBe(false);
    expect(read(root, "config/features.ts")).toBe(CURATE_FIXTURE_MANIFEST);
  });

  it("recognises the manifest by an absolute path inside the root", () => {
    const root = repo(CURATE_FIXTURE_MANIFEST);
    const target = freshTarget();
    const report = curateTree({
      root,
      target,
      config: CURATE_FIXTURE_FEATURES,
      selection: { drop: ["showcase", "contact"] },
      manifest: join(root, "config/features.ts"),
    });

    expect(report.manifest).toBe("config/features.ts");
    expect(existsSync(join(target, "config/features.ts"))).toBe(false);
  });

  it("leaves out nothing for a manifest outside the root", () => {
    const outside = tracked(mkdtempSync(join(tmpdir(), "forge-curate-manifest-")));
    const target = freshTarget();
    const report = curateTree({
      root: repo(),
      target,
      config: CURATE_FIXTURE_FEATURES,
      selection: { drop: ["showcase", "contact"] },
      manifest: join(outside, "features.ts"),
    });

    expect(report.manifest).toBeUndefined();
    expect(read(target, "notes.txt")).toBe("untracked, not ignored\n");
  });

  it("refuses the manifest's markers when no manifest path is given, since the file is then a seam of no feature", () => {
    const message = refused({ root: repo(CURATE_FIXTURE_MANIFEST), config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } });

    expect(message).toBe("`config/features.ts:2` marks feature `showcase`, but `config/features.ts` is not one of its seams in the manifest");
  });
});

describe("curateTree() — refusals, each before anything is written", () => {
  it("refuses to drop a feature the manifest does not name", () => {
    expect(refused({ root: repo(), config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase", "blog"] } })).toBe(
      "cannot drop unknown feature `blog` — the manifest names `showcase`, `contact`",
    );
  });

  it("refuses a directory the working tree holds nothing under, even for a feature not dropped", () => {
    const config = withFeature("contact", { directories: ["src/missing"], seams: [] });

    expect(refused({ root: repo(), config, selection: { drop: ["showcase"] } })).toBe("directory `src/missing` names nothing in the working tree");
  });

  it("refuses a seam naming a file the working tree does not hold", () => {
    const config = withFeature("contact", { directories: [], seams: ["debug.log"] });

    expect(refused({ root: repo(), config, selection: { drop: [] } })).toBe("seam file `debug.log` is not in the working tree");
  });

  it("refuses a seam naming the manifest itself", () => {
    const config = withFeature("contact", { directories: ["src/contact"], seams: ["config/features.ts"] });

    expect(refused({ root: repo(CURATE_FIXTURE_MANIFEST), config, selection: { drop: [] }, manifest: "config/features.ts" })).toBe(
      "seam file `config/features.ts` is the feature manifest, which every feature may mark without listing it",
    );
  });

  it("refuses an owned file the working tree does not hold", () => {
    const config = withFeature("contact", { ...CURATE_FIXTURE_FEATURES.contact!, files: ["config/missing.toml"] });

    expect(refused({ root: repo(), config, selection: { drop: [] } })).toBe("owned file `config/missing.toml` is not in the working tree");
  });

  it("refuses an owned file that is the manifest", () => {
    const config = withFeature("contact", { ...CURATE_FIXTURE_FEATURES.contact!, files: ["config/features.ts"] });

    expect(refused({ root: repo(CURATE_FIXTURE_MANIFEST), config, selection: { drop: [] }, manifest: "config/features.ts" })).toBe(
      "owned file `config/features.ts` is the feature manifest, which no feature may own",
    );
  });

  it("refuses an owned file inside a feature's directory", () => {
    const config = withFeature("contact", { ...CURATE_FIXTURE_FEATURES.contact!, files: ["src/showcase/demo.ts"] });

    expect(refused({ root: repo(), config, selection: { drop: [] } })).toBe(
      "owned file `src/showcase/demo.ts` lies inside `src/showcase`, a directory of feature `showcase`",
    );
  });

  it("refuses an owned file that is a seam of a feature not requiring its owner, even for a plain copy", () => {
    const config = withFeature("contact", { ...CURATE_FIXTURE_FEATURES.contact!, files: ["README.md"] });

    expect(refused({ root: repo(), config, selection: { drop: [] } })).toBe(
      "owned file `README.md` of feature `contact` is a seam of feature `showcase`, which does not require it — keeping `showcase` would lose the file",
    );
  });

  it("refuses a script package.json does not define, even for a feature not dropped", () => {
    const config = withFeature("contact", { ...CURATE_FIXTURE_FEATURES.contact!, scripts: ["contact:missing"] });

    expect(refused({ root: repo(), config, selection: { drop: ["showcase"] } })).toBe(
      "feature `contact` names script `contact:missing`, which package.json does not define",
    );
  });

  it("refuses a feature naming scripts when the working tree holds no package.json", () => {
    const root = repo();
    rmSync(join(root, "package.json"));

    expect(refused({ root, config: CURATE_FIXTURE_FEATURES, selection: { drop: [] } })).toBe(
      "feature `showcase` names scripts, and the working tree holds no package.json",
    );
  });

  it("refuses to remove a script from a package.json whose scripts are not one entry per line", () => {
    const root = repo();
    writeFileSync(
      join(root, "package.json"),
      '{ "scripts": { "build": "tsc", "contact:send": "bun run src/contact/form.ts", "showcase:demo": "bun run src/showcase/demo.ts" } }\n',
    );

    expect(refused({ root, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } })).toBe(
      "package.json's scripts are not one entry per line — forge curate removes a script by removing its line",
    );
  });

  const INSIDE: [string, FeatureManifest][] = [
    ["its own feature's", withFeature("showcase", { directories: ["src/showcase"], seams: ["src/showcase/demo.ts"] })],
    ["another feature's", withFeature("contact", { directories: [], seams: ["src/showcase/demo.ts"] })],
  ];
  for (const [whose, config] of INSIDE) {
    it(`refuses a seam file inside ${whose} directory`, () => {
      expect(refused({ root: repo(), config, selection: { drop: [] } })).toBe(
        "seam file `src/showcase/demo.ts` lies inside `src/showcase`, a directory of feature `showcase`",
      );
    });
  }

  const LINKS: [string, (root: string) => string][] = [
    ["an absolute", (root) => join(root, "real/main.ts")],
    ["a relative", () => "../real/main.ts"],
  ];
  for (const [kind, pointTo] of LINKS) {
    it(`refuses a seam file that is ${kind} symbolic link, leaving the file it points at as it was`, () => {
      const root = repo();
      const original = "line1 /* feature:showcase */\nkeep\n";
      mkdirSync(join(root, "real"));
      writeFileSync(join(root, "real/main.ts"), original, "utf-8");
      symlinkSync(pointTo(root), join(root, "src/main.ts"));
      const config = withSeam("src/main.ts", ["showcase"]);

      expect(refused({ root, config, selection: { drop: ["showcase"] } })).toBe(
        "seam file `src/main.ts` is a symbolic link — forge curate edits only a regular file",
      );
      expect(read(root, "real/main.ts")).toBe(original);
    });
  }

  /** A root whose `src` is a link to its sibling `real`, listed as a stale index lists it: the link and a file beneath it. */
  function linkedParent(): { base: string; root: string } {
    const base = tracked(mkdtempSync(join(tmpdir(), "forge-curate-linked-")));
    const root = join(base, "repo");
    mkdirSync(join(root, "real"), { recursive: true });
    writeFileSync(join(root, "real/worker.ts"), "export const worker = 1; // feature:showcase\n", "utf-8");
    symlinkSync("../repo/real", join(root, "src"));
    return { base, root };
  }

  const LINKED_CONFIGS: [string, FeatureManifest][] = [
    ["a kept file", { contact: { directories: ["lib"], seams: [] } }],
    ["a seam file", { showcase: { directories: [], seams: ["src/worker.ts"] } }],
  ];
  for (const [kind, config] of LINKED_CONFIGS) {
    it(`refuses ${kind} beneath a symbolic link to a directory, writing nothing inside the target or through the link`, () => {
      const { base, root } = linkedParent();
      const target = join(base, "deep/out");
      const error = refusal(() => curateTree({ root, target, config, selection: { drop: [] } }, () => ["src", "src/worker.ts", "lib/x.ts"]));

      expect(error.kind).toBe("invalid-args");
      expect(error.message).toBe("`src/worker.ts` lies under `src`, a symbolic link — forge curate reads and writes only through real directories");
      expect(existsSync(target)).toBe(false);
      expect(existsSync(join(base, "deep/repo/real/worker.ts"))).toBe(false);
      expect(read(root, "real/worker.ts")).toBe("export const worker = 1; // feature:showcase\n");
    });
  }

  it("refuses an untracked nested repository, which git lists as a directory", () => {
    const root = repo();
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested/inner.ts"), "export const inner = 1;\n", "utf-8");
    spawnSync("git", ["init", "-q"], { cwd: join(root, "nested") });

    expect(refused({ root, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } })).toBe(
      "`nested/` is a directory git does not list inside — a nested repository or a submodule, which forge curate cannot copy",
    );
  });

  const MALFORMED: [string, string][] = [
    ["an edge that is neither begin nor end", "feature:showcase:middle"],
    ["a segment after the edge", "feature:showcase:begin:x"],
  ];
  for (const [kind, marker] of MALFORMED) {
    it(`refuses a marker with ${kind}`, () => {
      const root = repo();
      writeFileSync(join(root, "src/app.ts"), `${APP.join("\n")}tail(); // ${marker}\n`, "utf-8");

      expect(refused({ root, config: CURATE_FIXTURE_FEATURES, selection: { drop: [] } })).toBe(
        `\`src/app.ts:6\` ends with malformed marker \`${marker}\` — write \`feature:<feature>[,<feature>…][:begin|:end]\``,
      );
    });
  }

  it("refuses a marker naming a feature the manifest does not", () => {
    const root = repo();
    writeFileSync(join(root, "src/app.ts"), `${APP.join("\n")}tail(); // feature:showcase,blog\n`, "utf-8");

    expect(refused({ root, config: CURATE_FIXTURE_FEATURES, selection: { drop: [] } })).toBe(
      "`src/app.ts:6` names unknown feature `blog` — the manifest names `showcase`, `contact`",
    );
  });

  it("refuses a marker in a file that is a seam of no feature", () => {
    const root = repo();
    writeFileSync(join(root, "src/extra.ts"), "export const extra = 1;\nother(); // feature:showcase\n", "utf-8");

    expect(refused({ root, config: CURATE_FIXTURE_FEATURES, selection: { drop: [] } })).toBe(
      "`src/extra.ts:2` marks feature `showcase`, but `src/extra.ts` is not one of its seams in the manifest",
    );
  });

  it("refuses a marker in a seam of another feature", () => {
    const root = repo();
    writeFileSync(join(root, "config/app.toml"), `${TOML.join("\n")}demo = true # feature:showcase\n`, "utf-8");

    expect(refused({ root, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["contact"] } })).toBe(
      "`config/app.toml:3` marks feature `showcase`, but `config/app.toml` is not one of its seams in the manifest",
    );
  });

  it("refuses a marker in a file inside the directory being dropped, which the copy would not hold", () => {
    const root = repo();
    writeFileSync(join(root, "src/showcase/demo.ts"), "export const demo = 1; // feature:showcase\n", "utf-8");

    expect(refused({ root, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } })).toBe(
      "`src/showcase/demo.ts:1` marks feature `showcase`, but `src/showcase/demo.ts` is not one of its seams in the manifest",
    );
  });

  function regionRefusal(source: string): string {
    const root = repo();
    writeFileSync(join(root, "src/region.ts"), source, "utf-8");
    return refused({ root, config: withSeam("src/region.ts"), selection: { drop: [] } });
  }

  it("refuses a region opened inside another", () => {
    expect(regionRefusal("// feature:showcase:begin\n// feature:contact:begin\n// feature:contact:end\n// feature:showcase:end\n")).toBe(
      "`src/region.ts:2` opens a region inside the one opened at line 1 — regions do not nest",
    );
  });

  it("refuses an end marker with no region open", () => {
    expect(regionRefusal("a;\n// feature:showcase:end\n")).toBe("`src/region.ts:2` closes a region that no marker opened");
  });

  it("refuses an end marker naming other features than the open region", () => {
    expect(regionRefusal("// feature:showcase,contact:begin\na;\n// feature:showcase:end\n")).toBe(
      "`src/region.ts:3` closes `feature:showcase`, but the region open since line 1 is `feature:showcase,contact`",
    );
  });

  it("refuses a marker naming one feature twice", () => {
    expect(regionRefusal("// feature:showcase,showcase:begin\na;\n// feature:showcase,contact:end\n")).toBe(
      "`src/region.ts:1` names feature `showcase` twice",
    );
  });

  it("refuses a region that never closes", () => {
    expect(regionRefusal("a;\n// feature:showcase:begin\nb;\n// feature:contact\n")).toBe("`src/region.ts:2` opens a region that never closes");
  });

  it("refuses a listed seam file that holds no marker for its feature, even one holding another feature's", () => {
    const config = withFeature("contact", { directories: ["src/contact"], seams: ["src/app.ts", "config/app.toml", "README.md"] });

    expect(refused({ root: repo(), config, selection: { drop: [] } })).toBe("seam file `README.md` holds no `feature:contact` marker");
  });

  it("refuses a target directory that already holds something, and leaves what it holds", () => {
    const target = tracked(mkdtempSync(join(tmpdir(), "forge-curate-full-")));
    writeFileSync(join(target, "keep.txt"), "mine\n", "utf-8");
    const error = refusal(() => curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } }));

    expect(error.kind).toBe("invalid-args");
    expect(error.message).toBe(`${target} is not empty — forge curate writes only into a fresh directory`);
    expect(readdirSync(target)).toEqual(["keep.txt"]);
    expect(read(target, "keep.txt")).toBe("mine\n");
  });

  it("refuses a target that is a file", () => {
    const parent = tracked(mkdtempSync(join(tmpdir(), "forge-curate-file-")));
    const target = join(parent, "skeleton");
    writeFileSync(target, "", "utf-8");
    const error = refusal(() => curateTree({ root: repo(), target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } }));

    expect(error.kind).toBe("invalid-args");
    expect(error.message).toBe(`${target} is not a directory`);
    expect(read(parent, "skeleton")).toBe("");
  });
});

describe("curateTree() — a copy failing partway", () => {
  /** The working tree's listing with a FIFO, which cannot be copied, placed between its real files. */
  function withPipe(root: string): (from: string) => string[] {
    spawnSync("mkfifo", [join(root, "pipe")]);
    return (from) => {
      const files = listWorkingTree(from).sort();
      return [...files.slice(0, 2), "pipe", ...files.slice(2)];
    };
  }

  function pipeFailure(target: string): string {
    const destination = join(target, "pipe");
    return `Cannot copy a FIFO pipe: cp returned EINVAL (cannot copy a FIFO pipe: ${destination}) ${destination}`;
  }

  it("removes the target it created", () => {
    const root = repo();
    const target = freshTarget();

    expect(
      failure(() => curateTree({ root, target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } }, withPipe(root))).message,
    ).toBe(pipeFailure(target));
    expect(existsSync(target)).toBe(false);
  });

  it("removes every parent directory it created, and none it did not", () => {
    const root = repo();
    const base = tracked(mkdtempSync(join(tmpdir(), "forge-curate-parents-")));
    const target = join(base, "p1/p2/out");

    expect(
      failure(() => curateTree({ root, target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } }, withPipe(root))).message,
    ).toBe(pipeFailure(target));
    expect(readdirSync(base)).toEqual([]);
  });

  it("empties a target that existed before the curation, and leaves the directory", () => {
    const root = repo();
    const target = tracked(mkdtempSync(join(tmpdir(), "forge-curate-empty-")));

    expect(
      failure(() => curateTree({ root, target, config: CURATE_FIXTURE_FEATURES, selection: { drop: ["showcase"] } }, withPipe(root))).message,
    ).toBe(pipeFailure(target));
    expect(readdirSync(target)).toEqual([]);
  });
});

describe("curateTree() — the feature graph", () => {
  const SHOWCASE = CURATE_FIXTURE_FEATURES.showcase!;
  const CONTACT = CURATE_FIXTURE_FEATURES.contact!;
  const BLOG = { directories: ["src/blog"], seams: [] };

  /** The fixture repository with a third feature's directory, `src/blog`, beside the other two. */
  function blogRepo(manifest?: string): string {
    const root = repo(manifest);
    mkdirSync(join(root, "src/blog"));
    writeFileSync(join(root, "src/blog/post.ts"), "export const post = 1;\n", "utf-8");
    return root;
  }

  const GRAPH_REFUSALS: [string, FeatureManifest, string][] = [
    [
      "a requirement the manifest does not name",
      withFeature("contact", { ...CONTACT, requires: ["mail"] }),
      "feature `contact` requires unknown feature `mail` — the manifest names `showcase`, `contact`",
    ],
    ["a feature requiring itself", withFeature("contact", { ...CONTACT, requires: ["contact"] }), "feature `contact` requires itself"],
    [
      "two features requiring one another",
      { showcase: { ...SHOWCASE, requires: ["contact"] }, contact: { ...CONTACT, requires: ["showcase"] } },
      "features `showcase` → `contact` → `showcase` require one another — a feature graph has no cycles; merge them, or move what they share into a feature both require",
    ],
  ];
  for (const [kind, config, message] of GRAPH_REFUSALS) {
    it(`refuses ${kind} before writing anything`, () => {
      expect(refused({ root: repo(), config, selection: { drop: [] } })).toBe(message);
    });
  }

  it("refuses to keep a feature the manifest does not name before writing anything", () => {
    expect(refused({ root: repo(), config: CURATE_FIXTURE_FEATURES, selection: { keep: ["blog"] } })).toBe(
      "cannot keep unknown feature `blog` — the manifest names `showcase`, `contact`",
    );
  });

  it("drops what requires a dropped feature, its directory and its markers with it, and reports why", () => {
    const target = freshTarget();
    const config = { ...withFeature("contact", { ...CONTACT, requires: ["showcase"] }), blog: BLOG };
    const report = curateTree({ root: blogRepo(), target, config, selection: { drop: ["showcase"] } });

    expect(report.kept).toEqual(["blog"]);
    expect(report.dropped).toEqual(["showcase", "contact"]);
    expect(report.added).toEqual([{ feature: "contact", because: ["showcase"] }]);
    expect(report.directories).toEqual(["src/showcase", "src/contact"]);
    expect(existsSync(join(target, "src/contact"))).toBe(false);
    expect(read(target, "src/app.ts")).toBe("export const app = 1;\n");
    expect(read(target, "config/app.toml")).toBe(lines(TOML, [0, 2]));
    expect(read(target, "src/blog/post.ts")).toBe("export const post = 1;\n");
  });

  it("keeps what a kept feature requires, drops every other feature, and reports why", () => {
    const target = freshTarget();
    const config = { ...withFeature("showcase", { ...SHOWCASE, requires: ["contact"] }), blog: BLOG };
    const report = curateTree({ root: blogRepo(), target, config, selection: { keep: ["showcase"] } });

    expect(report.kept).toEqual(["showcase", "contact"]);
    expect(report.dropped).toEqual(["blog"]);
    expect(report.added).toEqual([{ feature: "contact", because: ["showcase"] }]);
    expect(report.directories).toEqual(["src/blog"]);
    expect(existsSync(join(target, "src/blog"))).toBe(false);
    expect(read(target, "src/contact/form.ts")).toBe("export const contact = 1;\n");
    expect(read(target, "src/app.ts")).toBe(APP.join("\n"));
  });

  it("drops every feature and leaves the manifest out when it keeps none", () => {
    const target = freshTarget();
    const report = curateTree({
      root: repo(CURATE_FIXTURE_MANIFEST),
      target,
      config: CURATE_FIXTURE_FEATURES,
      selection: { keep: [] },
      manifest: "config/features.ts",
    });

    expect(report.kept).toEqual([]);
    expect(report.dropped).toEqual(["showcase", "contact"]);
    expect(report.manifest).toBe("config/features.ts");
    expect(read(target, "src/app.ts")).toBe("export const app = 1;\n");
  });

  const SHARED: [string[], string][] = [
    [["contact"], lines(APP, [0, 2, 3, 4, 5])],
    [["showcase"], "export const app = 1;\n"],
  ];
  for (const [drop, expected] of SHARED) {
    it(`reads a line shared by a feature and the one it requires when --drop is ${drop.join(",")}`, () => {
      const target = freshTarget();
      const config = withFeature("contact", { ...CONTACT, requires: ["showcase"] });
      curateTree({ root: repo(), target, config, selection: { drop } });

      expect(read(target, "src/app.ts")).toBe(expected);
    });
  }
});

describe("curateTree() — regeneration", () => {
  const SHOWCASE = CURATE_FIXTURE_FEATURES.showcase!;
  const CONTACT = CURATE_FIXTURE_FEATURES.contact!;
  const COMPOSE: [string, ...string[]] = ["forge", "db", "migrate", "compose"];
  const REGENERATING = withFeature("showcase", { ...SHOWCASE, regenerate: { remove: ["config/migrations/"], run: COMPOSE } });

  /** The fixture repository holding a migration history the regeneration replaces. */
  function migrationRepo(): string {
    const root = repo();
    mkdirSync(join(root, "config/migrations"));
    writeFileSync(join(root, "config/migrations/0001_init.sql"), "create table old (id integer);\n", "utf-8");
    writeFileSync(join(root, "config/migrations/snapshot.json"), "{}\n", "utf-8");
    return root;
  }

  interface Regeneration {
    argv: readonly string[];
    cwd: string;
    appRoot: string | undefined;
    path: string;
    history: string[];
    linked: boolean;
  }

  /** A runner that records what each call saw of the tree, writes a fresh migration into it, and answers with `result`. */
  function composer(result: CaptureResult = { code: 0, output: "", ms: 0 }): { run: CurateRunner; calls: Regeneration[] } {
    const calls: Regeneration[] = [];
    const run: CurateRunner = (argv, cwd, env) => {
      const history = join(cwd, "config/migrations");
      calls.push({
        argv: [...argv],
        cwd,
        appRoot: env.FORGE_APP_ROOT,
        path: env.PATH ?? "",
        history: existsSync(history) ? readdirSync(history) : [],
        linked: lstatSync(join(cwd, "node_modules"), { throwIfNoEntry: false })?.isSymbolicLink() === true,
      });
      mkdirSync(history, { recursive: true });
      writeFileSync(join(history, "0001_fresh.sql"), "create table fresh (id integer);\n", "utf-8");
      return result;
    };
    return { run, calls };
  }

  it("regenerates a kept feature inside the copy, with the root's modules linked for its duration, once something is dropped", () => {
    const root = migrationRepo();
    const target = freshTarget();
    const { run, calls } = composer();
    const report = curateTree({ root, target, config: REGENERATING, selection: { drop: ["contact"] } }, listWorkingTree, run);

    expect(calls).toEqual([{ argv: COMPOSE, cwd: target, appRoot: target, path: calls[0]!.path, history: [], linked: true }]);
    expect(calls[0]!.path.startsWith(`${join(root, "node_modules", ".bin")}${delimiter}`)).toBe(true);
    expect(report.regenerated).toEqual(["showcase"]);
    expect(report.files).not.toContain("config/migrations/0001_init.sql");
    expect(existsSync(join(target, "node_modules"))).toBe(false);
    expect(readdirSync(join(target, "config/migrations"))).toEqual(["0001_fresh.sql"]);
    expect(read(root, "config/migrations/0001_init.sql")).toBe("create table old (id integer);\n");
  });

  const IDLE: [string, CurateRequest["selection"]][] = [
    ["a plain copy", { drop: [] }],
    ["a copy keeping every feature", { keep: ["showcase", "contact"] }],
    ["a copy dropping the regenerating feature", { drop: ["showcase"] }],
  ];
  for (const [kind, selection] of IDLE) {
    it(`regenerates nothing and copies the history as it is for ${kind}`, () => {
      const target = freshTarget();
      const { run, calls } = composer();
      const report = curateTree({ root: migrationRepo(), target, config: REGENERATING, selection }, listWorkingTree, run);

      expect(calls).toEqual([]);
      expect(report.regenerated).toEqual([]);
      expect(readdirSync(join(target, "config/migrations")).sort()).toEqual(["0001_init.sql", "snapshot.json"]);
    });
  }

  it("regenerates several kept features, each after the ones it requires", () => {
    const root = migrationRepo();
    mkdirSync(join(root, "src/blog"));
    writeFileSync(join(root, "src/blog/post.ts"), "export const post = 1;\n", "utf-8");
    const config: FeatureManifest = {
      showcase: { ...SHOWCASE, requires: ["contact"], regenerate: { run: ["showcase-gen"] } },
      contact: { ...CONTACT, regenerate: { run: ["contact-gen", "--fresh"] } },
      blog: { directories: ["src/blog"], seams: [] },
    };
    const { run, calls } = composer();
    const report = curateTree({ root, target: freshTarget(), config, selection: { drop: ["blog"] } }, listWorkingTree, run);

    expect(calls.map((call) => call.argv)).toEqual([["contact-gen", "--fresh"], ["showcase-gen"]]);
    expect(report.regenerated).toEqual(["contact", "showcase"]);
  });

  it("refuses a removal naming nothing in the working tree, before writing or running anything", () => {
    const { run, calls } = composer();
    const config = withFeature("showcase", { ...SHOWCASE, regenerate: { remove: ["config/migrations/"], run: COMPOSE } });
    const target = freshTarget();
    const error = refusal(() => curateTree({ root: repo(), target, config, selection: { drop: ["contact"] } }, listWorkingTree, run));

    expect(error.kind).toBe("invalid-args");
    expect(error.message).toBe("feature `showcase` regenerates by removing `config/migrations/`, which names nothing in the working tree");
    expect(existsSync(target)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("refuses a regeneration when the root has no node_modules, before writing or running anything", () => {
    const root = migrationRepo();
    rmSync(join(root, "node_modules"), { recursive: true });
    const { run, calls } = composer();
    const target = freshTarget();
    const error = refusal(() => curateTree({ root, target, config: REGENERATING, selection: { drop: ["contact"] } }, listWorkingTree, run));

    expect(error.kind).toBe("invalid-args");
    expect(error.message).toBe(
      "feature `showcase` regenerates with `forge db migrate compose`, which needs the root's node_modules — run `bun install`",
    );
    expect(existsSync(target)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("fails with the command's exit code and the tail of its output, removing the copy and every parent it created", () => {
    const output = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`);
    const { run } = composer({ code: 2, output: `${output.join("\n")}\n`, ms: 0 });
    const base = tracked(mkdtempSync(join(tmpdir(), "forge-curate-regen-")));
    const target = join(base, "p1/out");
    const error = refusal(() =>
      curateTree({ root: migrationRepo(), target, config: REGENERATING, selection: { drop: ["contact"] } }, listWorkingTree, run),
    );

    expect(error.kind).toBe("external");
    expect(error.message).toBe(["feature `showcase` failed to regenerate: `forge db migrate compose` exited 2", ...output.slice(10)].join("\n"));
    expect(readdirSync(base)).toEqual([]);
  });
});

describe("createCurateCommand()", () => {
  /** A report row, its term padded to the longest term the report prints, as `definitionList` aligns them. */
  function row(term: string, description: string): string {
    return `  ${term.padEnd("regenerated:".length)} ${description}`;
  }

  function io() {
    const out: string[] = [];
    const err: string[] = [];
    const codes: number[] = [];
    const cli: CliIO = {
      stdout: (line) => void out.push(line),
      stderr: (line) => void err.push(line),
      exit: ((code: number) => void codes.push(code)) as CliIO["exit"],
    };
    return { cli, out, err, codes };
  }

  it("refuses to run with no target and no --list", async () => {
    const { cli, err, codes } = io();
    await execute(createCurateCommand(), [], cli);

    expect(codes).toEqual([1]);
    expect(err).toEqual(["Error: forge curate needs a target directory, or --list to print the feature graph"]);
  });

  it("takes at most one argument, the target directory", async () => {
    const target = freshTarget();
    const { cli, err, codes } = io();
    await execute(createCurateCommand(), [target, `${target}-2`, "--root", repo(CURATE_FIXTURE_MANIFEST)], cli);

    expect(codes).toEqual([1]);
    expect(err).toEqual(['Error: Command "curate" requires at most 1 argument(s), got 2']);
    expect(existsSync(target)).toBe(false);
  });

  it("reads `config/features.ts` under --root, drops what --drop names and reports each row", async () => {
    const root = repo(CURATE_FIXTURE_MANIFEST);
    const target = freshTarget();
    const { cli, out, codes } = io();
    await execute(createCurateCommand(), [target, "--root", root, "--drop", "showcase"], cli);

    expect(codes).toEqual([]);
    expect(existsSync(join(target, "src/showcase"))).toBe(false);
    expect(read(target, "src/contact/form.ts")).toBe("export const contact = 1;\n");
    expect(out).toEqual([
      row("files:", `10 copied to ${target}`),
      row("kept:", "contact"),
      row("dropped:", "showcase"),
      row("added:", "(none)"),
      row("removed:", "src/showcase"),
      row("scripts:", "showcase:demo"),
      row("seams:", "config/features.ts −1, README.md −3, src/app.ts −2"),
      row("regenerated:", "(none)"),
      row("manifest:", "(kept, or outside the working tree)"),
    ]);
  });

  it("makes a plain copy when --drop is not given", async () => {
    const root = repo(CURATE_FIXTURE_MANIFEST);
    const target = freshTarget();
    const { cli, out, codes } = io();
    await execute(createCurateCommand(), [target, "--root", root], cli);

    expect(codes).toEqual([]);
    expect(read(target, "src/app.ts")).toBe(APP.join("\n"));
    expect(out.slice(1)).toEqual([
      row("kept:", "showcase, contact"),
      row("dropped:", "(none — a plain copy)"),
      row("added:", "(none)"),
      row("removed:", "(no directories or files)"),
      row("scripts:", "(none removed)"),
      row("seams:", "(no lines)"),
      row("regenerated:", "(none)"),
      row("manifest:", "(kept, or outside the working tree)"),
    ]);
  });

  it("reads --drop as a comma list, trimming each name and ignoring empty ones", async () => {
    const root = repo(CURATE_FIXTURE_MANIFEST);
    const target = freshTarget();
    const { cli, out, codes } = io();
    await execute(createCurateCommand(), [target, "--root", root, "--drop", " showcase, ,contact,"], cli);

    expect(codes).toEqual([]);
    expect(read(target, "src/app.ts")).toBe("export const app = 1;\n");
    expect(existsSync(join(target, "config/features.ts"))).toBe(false);
    expect(out.slice(2, 5)).toEqual([
      row("dropped:", "showcase, contact"),
      row("added:", "(none)"),
      row("removed:", "src/showcase, src/contact, config/contact.toml"),
    ]);
    expect(out.at(-1)).toBe(row("manifest:", "config/features.ts left out"));
  });

  it("reads the manifest --config names instead, and leaves that one out", async () => {
    const root = repo();
    writeFileSync(join(root, "features.alt.ts"), `export default ${JSON.stringify(CURATE_FIXTURE_FEATURES)};\n`, "utf-8");
    const target = freshTarget();
    const { cli, codes } = io();
    await execute(createCurateCommand(), [target, "--root", root, "--config", "features.alt.ts", "--drop", "showcase,contact"], cli);

    expect(codes).toEqual([]);
    expect(existsSync(join(target, "src/showcase"))).toBe(false);
    expect(existsSync(join(target, "features.alt.ts"))).toBe(false);
    expect(read(target, "notes.txt")).toBe("untracked, not ignored\n");
  });

  it("refuses a root with no manifest, writing nothing", async () => {
    const target = freshTarget();
    const { cli, err, codes } = io();
    await execute(createCurateCommand(), [target, "--root", repo()], cli);

    expect(codes).toEqual([1]);
    expect(err).toEqual(["Error: No feature manifest at `config/features.ts` — forge curate needs one, default-exporting defineFeatures({...})"]);
    expect(existsSync(target)).toBe(false);
  });

  it("refuses a --drop naming a feature the manifest does not, writing nothing", async () => {
    const target = freshTarget();
    const { cli, err, codes } = io();
    await execute(createCurateCommand(), [target, "--root", repo(CURATE_FIXTURE_MANIFEST), "--drop", "blog"], cli);

    expect(codes).toEqual([1]);
    expect(err).toEqual(["Error: cannot drop unknown feature `blog` — the manifest names `showcase`, `contact`"]);
    expect(existsSync(target)).toBe(false);
  });

  it("refuses --keep and --drop together, even an empty --keep, writing nothing", async () => {
    for (const keep of ["showcase", ""]) {
      const target = freshTarget();
      const { cli, err, codes } = io();
      await execute(createCurateCommand(), [target, "--root", repo(CURATE_FIXTURE_MANIFEST), "--keep", keep, "--drop", "contact"], cli);

      expect(codes).toEqual([1]);
      expect(err).toEqual(["Error: --keep and --drop cannot be combined — name the features to keep, or the ones to drop"]);
      expect(existsSync(target)).toBe(false);
    }
  });

  const LIST_WITH: [string, (target: string) => string[]][] = [
    ["a target", (target) => [target]],
    ["--keep", () => ["--keep", "showcase"]],
    ["--drop", () => ["--drop", "showcase"]],
  ];
  for (const [what, extra] of LIST_WITH) {
    it(`refuses --list with ${what}, writing nothing`, async () => {
      const target = freshTarget();
      const { cli, out, err, codes } = io();
      await execute(createCurateCommand(), ["--list", "--root", repo(CURATE_FIXTURE_MANIFEST), ...extra(target)], cli);

      expect(codes).toEqual([1]);
      expect(err).toEqual(["Error: --list prints the feature graph and copies nothing — it takes no target, --keep or --drop"]);
      expect(out).toEqual([]);
      expect(existsSync(target)).toBe(false);
    });
  }

  /** A manifest module in which contact requires showcase and showcase regenerates. */
  function graphRepo(): string {
    const root = repo();
    const config: FeatureManifest = {
      showcase: { ...CURATE_FIXTURE_FEATURES.showcase!, regenerate: { run: ["forge", "db", "migrate", "compose"] } },
      contact: { ...CURATE_FIXTURE_FEATURES.contact!, requires: ["showcase"] },
    };
    writeFileSync(join(root, "features.graph.ts"), `export default ${JSON.stringify(config)};\n`, "utf-8");
    return root;
  }

  it("prints the feature graph for --list and copies nothing", async () => {
    const { cli, out, codes } = io();
    await execute(createCurateCommand(), ["--list", "--root", graphRepo(), "--config", "features.graph.ts"], cli);

    expect(codes).toEqual([]);
    expect(out).toEqual([
      "  showcase: requires nothing; required by contact; regenerates with `forge db migrate compose`",
      "  contact:  requires showcase; required by nothing",
    ]);
  });

  it("keeps what --keep names with its requirements, reporting each row", async () => {
    const root = graphRepo();
    const target = freshTarget();
    const { cli, out, codes } = io();
    await execute(createCurateCommand(), [target, "--root", root, "--config", "features.graph.ts", "--keep", "contact"], cli);

    expect(codes).toEqual([]);
    expect(out).toEqual([
      row("files:", `12 copied to ${target}`),
      row("kept:", "showcase, contact"),
      row("dropped:", "(none — a plain copy)"),
      row("added:", "showcase (required by contact)"),
      row("removed:", "(no directories or files)"),
      row("scripts:", "(none removed)"),
      row("seams:", "(no lines)"),
      row("regenerated:", "(none)"),
      row("manifest:", "(kept, or outside the working tree)"),
    ]);
  });

  it("names the requirement that dropped an addition for --drop, and the regeneration it ran", async () => {
    const root = graphRepo();
    const target = freshTarget();
    const regenerate = { run: ["true"] };
    const config: FeatureManifest = {
      showcase: CURATE_FIXTURE_FEATURES.showcase!,
      contact: { ...CURATE_FIXTURE_FEATURES.contact!, requires: ["showcase"] },
      notes: { directories: [], seams: ["notes.txt"], regenerate },
    };
    writeFileSync(join(root, "notes.txt"), "untracked, not ignored # feature:notes\n", "utf-8");
    writeFileSync(join(root, "features.drop.ts"), `export default ${JSON.stringify(config)};\n`, "utf-8");
    const { cli, out, err, codes } = io();
    await execute(createCurateCommand(), [target, "--root", root, "--config", "features.drop.ts", "--drop", "showcase"], cli);

    expect(err).toEqual([]);
    expect(codes).toEqual([]);
    expect(out.slice(1, 4)).toEqual([row("kept:", "notes"), row("dropped:", "showcase, contact"), row("added:", "contact (requires showcase)")]);
    expect(out[7]).toBe(row("regenerated:", "notes (`true`)"));
  });

  it("drops every feature and leaves the manifest out for an empty --keep", async () => {
    const root = repo(CURATE_FIXTURE_MANIFEST);
    const target = freshTarget();
    const { cli, out, codes } = io();
    await execute(createCurateCommand(), [target, "--root", root, "--keep", ""], cli);

    expect(codes).toEqual([]);
    expect(existsSync(join(target, "config/features.ts"))).toBe(false);
    expect(read(target, "src/app.ts")).toBe("export const app = 1;\n");
    expect(out.slice(1, 3)).toEqual([row("kept:", "(none)"), row("dropped:", "showcase, contact")]);
    expect(out.at(-1)).toBe(row("manifest:", "config/features.ts left out"));
  });
});
