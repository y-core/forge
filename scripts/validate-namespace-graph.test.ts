import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// `validate-namespace-graph.ts` is a script, not a module: it runs at import time and exits the
// process, and its `ROOT` is derived from `import.meta.url` so it can never be pointed at a fixture
// tree. The matchers it decides on are already unit-tested in `namespace-graph-parse.test.ts` (37
// cases, over synthetic namespaces); what is left to assert is the policy *this* file owns — which
// directories count as namespaces, and that the walk actually covers them — and that is only
// observable by running it. Nothing here writes to the repository.

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const run = spawnSync("bun", ["run", "scripts/validate-namespace-graph.ts"], { cwd: REPO_ROOT, encoding: "utf-8" });
const stdout = run.stdout ?? "";
const lines = stdout.split("\n");

/** The namespace named by each `  ok <namespace> (<shape>)` line. Asserting on the parsed names
 *  rather than whole lines keeps these cases independent of a namespace's edge count, which changes
 *  for reasons that have nothing to do with the namespace *set*. The exact-line case below pins the
 *  format itself, so a format change cannot make this parse quietly return nothing. */
const okNamespaces = lines.flatMap((line) => {
  const match = /^ {2}ok (\S+) \(.+\)$/.exec(line);
  return match === null ? [] : [match[1]];
});

describe("validate-namespace-graph — the namespace set", () => {
  it("passes against the repository as it stands", () => {
    expect(run.status).toBe(0);
  });

  it("reports each covered namespace on an `ok` line naming its shape", () => {
    // Pins the output format the cases below parse. `result` is a primitive with no forge imports,
    // so its shape is `leaf` for structural reasons rather than incidental ones.
    expect(lines).toContain("  ok result (leaf)");
  });

  it("covers namespaces spread across the exports map rather than a hardcoded few", () => {
    // Asserted per namespace rather than on the total, so adding a namespace elsewhere does not make
    // this pass or fail for an unrelated reason.
    expect(okNamespaces).toContain("app");
    expect(okNamespaces).toContain("http");
    expect(okNamespaces).toContain("validation");
    expect(okNamespaces).toContain("ui/core");
  });

  it("attributes a sub-namespace separately from its parent", () => {
    // `storage` owns no subpath of its own; `storage/db` and `storage/kv` each do. Separate lines
    // prove the longest-prefix attribution is live and that `storage` is not swallowing its children.
    expect(okNamespaces).toContain("storage/db");
    expect(okNamespaces).toContain("storage/kv");
    expect(okNamespaces).toContain("storage/r2");
    expect(okNamespaces).not.toContain("storage");
  });

  it("covers `crypto` even though it owns no export subpath", () => {
    // `crypto` is on the sealed-internal allowlist (`SEALED_INTERNAL`, mirroring the constant of the
    // same name in `validate-exports.ts`): every symbol is `@internal` and no consumer can name the
    // subpath, but it is still a namespace for layering purposes and must be walked.
    expect(okNamespaces).toContain("crypto");
  });

  it("does not treat `assets/cli` as a namespace, because it owns no export subpath", () => {
    // A directory is a namespace only when it owns a subpath. `src/assets/cli/` has a barrel and
    // looks exactly like one, which is what a naive directory walk gets wrong: its imports are
    // `assets`' edges, not the edges of a namespace the package does not have. `assets` is asserted
    // present in the same case so a format change that broke the parse cannot make the absence pass
    // vacuously — and `validation/cli`, which *does* own a subpath, shows the distinction is the
    // subpath and not the directory name.
    expect(okNamespaces).toContain("assets");
    expect(okNamespaces).toContain("validation/cli");
    expect(okNamespaces).not.toContain("assets/cli");
  });
});
