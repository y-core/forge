import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../cli/errors";
import { execute } from "../cli/execute";
import type { CliIO } from "../cli/types";
import { createStripCommand, listWorkingTree, stripTree } from "./commands";
import { stripFixtureRepo } from "./strip.fixture";
import type { StripConfig } from "./types";

const scratch: string[] = [];

function tracked<T extends string>(path: T): T {
  scratch.push(path);
  return path;
}

function repo(): string {
  return tracked(stripFixtureRepo());
}

/** A path in a fresh parent that does not exist yet. */
function freshTarget(): string {
  return join(tracked(mkdtempSync(join(tmpdir(), "forge-strip-out-"))), "skeleton");
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

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const SHOWCASE: StripConfig = { directories: ["src/showcase"], seams: [] };

describe("listWorkingTree()", () => {
  it("lists tracked and untracked files, and leaves out ignored ones and a tracked file deleted from disk", () => {
    expect(listWorkingTree(repo()).sort()).toEqual([
      ".gitignore",
      "README.md",
      "notes.txt",
      "src/app.ts",
      "src/router.ts",
      "src/showcase/demo.ts",
      "src/showcase/nested/panel.ts",
      "tests/showcase/demo.test.ts",
    ]);
  });

  it("refuses a directory that is not a git working tree as an external failure", () => {
    const plain = tracked(mkdtempSync(join(tmpdir(), "forge-strip-plain-")));
    const error = refusal(() => listWorkingTree(plain));
    expect(error.kind).toBe("external");
    expect(error.message).toBe(`git ls-files failed in ${plain} — forge strip copies a git working tree`);
  });
});

describe("stripTree()", () => {
  it("copies the listed files and nothing git ignores, deleted or under node_modules", () => {
    const target = freshTarget();
    const report = stripTree({ root: repo(), target, config: SHOWCASE });

    expect([...report.files].sort()).toEqual([
      ".gitignore",
      "README.md",
      "notes.txt",
      "src/app.ts",
      "src/router.ts",
      "tests/showcase/demo.test.ts",
    ]);
    expect(readFileSync(join(target, "notes.txt"), "utf-8")).toBe("untracked, not ignored\n");
    expect(existsSync(join(target, "debug.log"))).toBe(false);
    expect(existsSync(join(target, "node_modules"))).toBe(false);
    expect(existsSync(join(target, "gone.ts"))).toBe(false);
  });

  it("removes a directory whether or not the manifest spells it with a trailing slash", () => {
    const target = freshTarget();
    const report = stripTree({ root: repo(), target, config: { directories: ["src/showcase/", "tests/showcase"], seams: [] } });

    expect(report.directories).toEqual(["src/showcase", "tests/showcase"]);
    expect(existsSync(join(target, "src/showcase"))).toBe(false);
    expect(existsSync(join(target, "tests/showcase"))).toBe(false);
    expect(existsSync(join(target, "src/app.ts"))).toBe(true);
  });

  it("deletes exactly the lines carrying each marker and keeps every other byte, the final newline included", () => {
    const target = freshTarget();
    const report = stripTree({
      root: repo(),
      target,
      config: {
        directories: ["src/showcase"],
        seams: [
          { file: "src/app.ts", marker: "// strip:showcase" },
          { file: "src/router.ts", marker: "// strip:router" },
        ],
      },
    });

    expect(readFileSync(join(target, "src/app.ts"), "utf-8")).toBe("export const app = 1;\n");
    expect(readFileSync(join(target, "src/router.ts"), "utf-8")).toBe("export const routes = [];\n");
    expect(report.seams).toEqual([
      { file: "src/app.ts", marker: "// strip:showcase", removed: 2 },
      { file: "src/router.ts", marker: "// strip:router", removed: 1 },
    ]);
  });

  it("leaves the source tree untouched", () => {
    const root = repo();
    stripTree({
      root,
      target: freshTarget(),
      config: { directories: ["src/showcase"], seams: [{ file: "src/router.ts", marker: "// strip:router" }] },
    });

    expect(readFileSync(join(root, "src/router.ts"), "utf-8")).toBe("export const routes = [];\nroutes.push(showcase); // strip:router\n");
    expect(existsSync(join(root, "src/showcase/demo.ts"))).toBe(true);
  });

  it("writes into a target that exists and is empty", () => {
    const target = tracked(mkdtempSync(join(tmpdir(), "forge-strip-empty-")));
    stripTree({ root: repo(), target, config: SHOWCASE });

    expect(existsSync(join(target, "README.md"))).toBe(true);
  });

  it("refuses a directory the working tree holds nothing under, and writes no target", () => {
    const target = freshTarget();
    const error = refusal(() => stripTree({ root: repo(), target, config: { directories: ["src/missing"], seams: [] } }));

    expect(error.kind).toBe("invalid-args");
    expect(error.message).toBe("directory `src/missing` names nothing in the working tree");
    expect(existsSync(target)).toBe(false);
  });

  it("refuses a seam whose marker matches no line, and writes no target", () => {
    const target = freshTarget();
    const config = { directories: ["src/showcase"], seams: [{ file: "src/app.ts", marker: "// strip:nothing" }] };
    const error = refusal(() => stripTree({ root: repo(), target, config }));

    expect(error.kind).toBe("invalid-args");
    expect(error.message).toBe("seam `// strip:nothing` matches no line in `src/app.ts`");
    expect(existsSync(target)).toBe(false);
  });

  it("refuses a seam naming a file the working tree does not hold", () => {
    const target = freshTarget();
    const error = refusal(() =>
      stripTree({ root: repo(), target, config: { directories: [], seams: [{ file: "debug.log", marker: "ignored" }] } }),
    );

    expect(error.message).toBe("seam file `debug.log` is not in the working tree");
    expect(existsSync(target)).toBe(false);
  });

  it("refuses a seam inside a directory the same manifest removes", () => {
    const target = freshTarget();
    const config = { directories: ["src/showcase/"], seams: [{ file: "src/showcase/demo.ts", marker: "demo" }] };
    const error = refusal(() => stripTree({ root: repo(), target, config }));

    expect(error.message).toBe("seam file `src/showcase/demo.ts` lies inside removed directory `src/showcase`");
    expect(existsSync(target)).toBe(false);
  });

  it("refuses a target directory that already holds something", () => {
    const target = tracked(mkdtempSync(join(tmpdir(), "forge-strip-full-")));
    writeFileSync(join(target, "keep.txt"), "mine\n", "utf-8");
    const error = refusal(() => stripTree({ root: repo(), target, config: SHOWCASE }));

    expect(error.kind).toBe("invalid-args");
    expect(error.message).toBe(`${target} is not empty — forge strip writes only into a fresh directory`);
    expect(readFileSync(join(target, "keep.txt"), "utf-8")).toBe("mine\n");
  });

  const LINKS: [string, (root: string) => string][] = [
    ["an absolute", (root) => join(root, "real/main.ts")],
    ["a relative", () => "../real/main.ts"],
  ];
  for (const [kind, pointTo] of LINKS) {
    it(`refuses a seam file that is ${kind} symbolic link, writing no target and leaving the file it points at as it was`, () => {
      const root = repo();
      const original = "line1 /* strip:showcase */\nkeep\n";
      mkdirSync(join(root, "real"));
      writeFileSync(join(root, "real/main.ts"), original, "utf-8");
      symlinkSync(pointTo(root), join(root, "src/main.ts"));
      const target = freshTarget();
      const config = { directories: [], seams: [{ file: "src/main.ts", marker: "/* strip:showcase */" }] };
      const error = refusal(() => stripTree({ root, target, config }));

      expect(error.kind).toBe("invalid-args");
      expect(error.message).toBe("seam file `src/main.ts` is a symbolic link — forge strip edits only a regular file");
      expect(existsSync(target)).toBe(false);
      expect(readFileSync(join(root, "real/main.ts"), "utf-8")).toBe(original);
    });
  }

  it("refuses an untracked nested repository, which git lists as a directory, and writes no target", () => {
    const root = repo();
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested/inner.ts"), "export const inner = 1;\n", "utf-8");
    spawnSync("git", ["init", "-q"], { cwd: join(root, "nested") });
    const target = freshTarget();
    const error = refusal(() => stripTree({ root, target, config: SHOWCASE }));

    expect(error.kind).toBe("invalid-args");
    expect(error.message).toBe(
      "`nested/` is a directory git does not list inside — a nested repository or a submodule, which forge strip cannot copy",
    );
    expect(existsSync(target)).toBe(false);
  });

  it("copies a symbolic link that is not a seam as the link itself", () => {
    const root = repo();
    symlinkSync("../README.md", join(root, "src/readme.md"));
    const target = freshTarget();
    stripTree({ root, target, config: SHOWCASE });

    expect(readlinkSync(join(target, "src/readme.md"))).toBe(readlinkSync(join(root, "src/readme.md")));
  });

  /** A root whose `src` is a link to its sibling `real`, listed as a stale index lists it: the link and a file beneath it. */
  function linkedParent(): { base: string; root: string } {
    const base = tracked(mkdtempSync(join(tmpdir(), "forge-strip-linked-")));
    const root = join(base, "repo");
    mkdirSync(join(root, "real"), { recursive: true });
    writeFileSync(join(root, "real/worker.ts"), "export const worker = 1; // strip:showcase\n", "utf-8");
    symlinkSync("../repo/real", join(root, "src"));
    return { base, root };
  }

  const LINKED_CONFIGS: [string, StripConfig][] = [
    ["a kept file", { directories: [], seams: [] }],
    ["a seam file", { directories: [], seams: [{ file: "src/worker.ts", marker: "// strip:showcase" }] }],
  ];
  for (const [kind, config] of LINKED_CONFIGS) {
    it(`refuses ${kind} beneath a symbolic link to a directory, writing nothing inside the target or through the link`, () => {
      const { base, root } = linkedParent();
      const target = join(base, "deep/out");
      const error = refusal(() => stripTree({ root, target, config }, () => ["src", "src/worker.ts"]));

      expect(error.kind).toBe("invalid-args");
      expect(error.message).toBe("`src/worker.ts` lies under `src`, a symbolic link — forge strip reads and writes only through real directories");
      expect(existsSync(target)).toBe(false);
      expect(existsSync(join(base, "deep/repo/real/worker.ts"))).toBe(false);
      expect(readFileSync(join(root, "real/worker.ts"), "utf-8")).toBe("export const worker = 1; // strip:showcase\n");
    });
  }

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

  it("removes the target it created when a copy fails partway", () => {
    const root = repo();
    const target = freshTarget();

    expect(failure(() => stripTree({ root, target, config: SHOWCASE }, withPipe(root))).message).toBe(pipeFailure(target));
    expect(existsSync(target)).toBe(false);
  });

  it("removes every parent directory it created when a copy fails partway, and none it did not", () => {
    const root = repo();
    const base = tracked(mkdtempSync(join(tmpdir(), "forge-strip-parents-")));
    const target = join(base, "p1/p2/out");

    expect(failure(() => stripTree({ root, target, config: SHOWCASE }, withPipe(root))).message).toBe(pipeFailure(target));
    expect(readdirSync(base)).toEqual([]);
  });

  it("empties a target that existed before the strip when a copy fails partway, and leaves the directory", () => {
    const root = repo();
    const target = tracked(mkdtempSync(join(tmpdir(), "forge-strip-empty-")));

    expect(failure(() => stripTree({ root, target, config: SHOWCASE }, withPipe(root))).message).toBe(pipeFailure(target));
    expect(readdirSync(target)).toEqual([]);
  });

  it("keeps a line that carries the marker anywhere but at its end", () => {
    const root = repo();
    writeFileSync(join(root, "src/doc.ts"), 'const doc = "lines ending /* strip:showcase */ go";\nregister(); /* strip:showcase */  \n', "utf-8");
    const target = freshTarget();
    const report = stripTree({ root, target, config: { directories: [], seams: [{ file: "src/doc.ts", marker: "/* strip:showcase */" }] } });

    expect(readFileSync(join(target, "src/doc.ts"), "utf-8")).toBe('const doc = "lines ending /* strip:showcase */ go";\n');
    expect(report.seams).toEqual([{ file: "src/doc.ts", marker: "/* strip:showcase */", removed: 1 }]);
  });

  it("refuses a kept file that is not a seam but has a line ending with a manifest marker, and writes no target", () => {
    const root = repo();
    writeFileSync(join(root, "src/extra.ts"), "export const extra = 1;\nother(); // strip:showcase\n", "utf-8");
    const target = freshTarget();
    const config = { directories: ["src/showcase"], seams: [{ file: "src/app.ts", marker: "// strip:showcase" }] };
    const error = refusal(() => stripTree({ root, target, config }));

    expect(error.kind).toBe("invalid-args");
    expect(error.message).toBe("`src/extra.ts:2` ends with seam marker `// strip:showcase`, but `src/extra.ts` is not a seam in the manifest");
    expect(existsSync(target)).toBe(false);
  });

  it("does not read a file holding a NUL byte for a marker, and copies it as it is", () => {
    const root = repo();
    const binary = "\0other(); // strip:showcase\n";
    writeFileSync(join(root, "blob.bin"), binary, "utf-8");
    const target = freshTarget();
    stripTree({ root, target, config: { directories: [], seams: [{ file: "src/app.ts", marker: "// strip:showcase" }] } });

    expect(readFileSync(join(target, "blob.bin"), "utf-8")).toBe(binary);
  });

  it("leaves out the manifest it was loaded from, reports it, and does not read it for markers", () => {
    const root = repo();
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config/strip.ts"), "export default STRIP; // strip:showcase\n", "utf-8");
    const target = freshTarget();
    const config = { directories: ["src/showcase"], seams: [{ file: "src/app.ts", marker: "// strip:showcase" }] };
    const report = stripTree({ root, target, config, manifest: "config/strip.ts" });

    expect(report.manifest).toBe("config/strip.ts");
    expect(report.files).not.toContain("config/strip.ts");
    expect(existsSync(join(target, "config/strip.ts"))).toBe(false);
    expect(readFileSync(join(root, "config/strip.ts"), "utf-8")).toBe("export default STRIP; // strip:showcase\n");
  });

  it("leaves out nothing for a manifest outside the root", () => {
    const outside = tracked(mkdtempSync(join(tmpdir(), "forge-strip-manifest-")));
    const target = freshTarget();
    const report = stripTree({ root: repo(), target, config: SHOWCASE, manifest: join(outside, "strip.ts") });

    expect(report.manifest).toBeUndefined();
    expect(existsSync(join(target, "README.md"))).toBe(true);
  });

  it("refuses a seam on the manifest itself, and writes no target", () => {
    const target = freshTarget();
    const config = { directories: [], seams: [{ file: "README.md", marker: "# app" }] };
    const error = refusal(() => stripTree({ root: repo(), target, config, manifest: "README.md" }));

    expect(error.kind).toBe("invalid-args");
    expect(error.message).toBe("seam file `README.md` is the strip manifest, which the strip leaves out");
    expect(existsSync(target)).toBe(false);
  });

  it("refuses a target that is a file", () => {
    const parent = tracked(mkdtempSync(join(tmpdir(), "forge-strip-file-")));
    const target = join(parent, "skeleton");
    writeFileSync(target, "", "utf-8");
    const error = refusal(() => stripTree({ root: repo(), target, config: SHOWCASE }));

    expect(error.message).toBe(`${target} is not a directory`);
  });
});

describe("createStripCommand()", () => {
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

  it("takes exactly one argument, the target directory", async () => {
    const { cli, err, codes } = io();
    await execute(createStripCommand(), [], cli);

    expect(codes).toEqual([1]);
    expect(err).toEqual(['Error: Command "strip" requires exactly 1 argument(s), got 0']);
  });

  it("reads `config/strip.ts` under --root", async () => {
    const root = repo();
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config/strip.ts"), 'export default { directories: ["src/showcase"], seams: [] };\n', "utf-8");
    const target = freshTarget();
    const { cli, out, codes } = io();
    await execute(createStripCommand(), [target, "--root", root], cli);

    expect(codes).toEqual([]);
    expect(existsSync(join(target, "src/showcase"))).toBe(false);
    expect(existsSync(join(target, "config/strip.ts"))).toBe(false);
    expect(existsSync(join(target, "README.md"))).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it("reads the manifest --config names instead", async () => {
    const root = repo();
    writeFileSync(join(root, "strip.alt.ts"), 'export default { directories: ["tests/showcase/"], seams: [] };\n', "utf-8");
    const target = freshTarget();
    const { cli, codes } = io();
    await execute(createStripCommand(), [target, "--root", root, "--config", "strip.alt.ts"], cli);

    expect(codes).toEqual([]);
    expect(existsSync(join(target, "tests/showcase"))).toBe(false);
    expect(existsSync(join(target, "strip.alt.ts"))).toBe(false);
    expect(existsSync(join(target, "src/showcase/demo.ts"))).toBe(true);
  });

  it("refuses a root with no manifest, writing nothing", async () => {
    const target = freshTarget();
    const { cli, err, codes } = io();
    await execute(createStripCommand(), [target, "--root", repo()], cli);

    expect(codes).toEqual([1]);
    expect(err).toEqual(["Error: No strip manifest at `config/strip.ts` — forge strip needs one, default-exporting defineStripConfig({...})"]);
    expect(existsSync(target)).toBe(false);
  });
});
