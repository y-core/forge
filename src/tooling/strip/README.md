---
title: Stripping a Demonstrator
description: "Copies a working tree into a fresh directory minus the directories and marked lines a manifest names, and gates the skeleton it produces."
audience: internal
---

# `@y-core/forge/tooling/strip`

`forge strip <dir>` copies your working tree into a fresh directory, leaving out the directories and the marked lines your strip manifest names.
It is for a demonstrator application whose remainder, with the demonstration removed, is the skeleton a new application starts from.

**Node.js / Bun only.** This namespace shells out to `git` and reads and writes the file system. Do not import it into a Cloudflare Worker or a
client bundle.

Why it matches markers rather than content, and why it refuses rather than warns, is [`BUILD_TOOLING.md`][bt-4] §4's; this file teaches the use.

---

## Writing the manifest

Default-export a manifest from `strip.ts` in your `config/` directory:

```ts
import { defineStripConfig } from "@y-core/forge/tooling/strip";

export default defineStripConfig({
  directories: ["src/showcase/", "tests/showcase/"],
  seams: [
    { file: "src/worker.ts", marker: "/* strip:showcase */" },
    { file: "src/client/main.ts", marker: "/* strip:showcase */" },
  ],
});
```

`directories` are removed whole, with or without a trailing `/`. Each seam deletes every line of `file` that ends with `marker`, so put the
marker at the end of each line that reaches into a removed directory:

```ts
import { registerShowcase } from "./showcase/mod"; /* strip:showcase */
registerShowcase(app); /* strip:showcase */
```

A marker must be a comment: `/* … */`, or one starting `//` or `#`. Every path is relative to the repository root. An absolute path, a `..`
segment and a leading `./` are refused, and so is a manifest that names nothing to remove.

---

## Running a strip

```bash
forge strip ../skeleton                      # from the repository root
forge strip out --root ../demo               # strip another working tree
forge strip out --config config/lite.ts      # a manifest other than the default
```

| Flag | Effect |
| --- | --- |
| `--config <path>` | Manifest module, relative to the root (default: `strip.ts` in `config/`) |
| `--root <path>` | The working tree to copy (default: the working directory) |

The copy is what git sees: tracked and untracked files, minus anything `.gitignore` excludes and anything deleted from disk. `node_modules` is
never copied, and neither is the manifest the strip loaded, whether the default or the one `--config` names.

The target must not exist yet, or be an empty directory. Nothing is written when the strip refuses, and it refuses when:

- a directory in the manifest holds no file in the working tree
- a seam's marker matches no line in its file
- a seam's file is not in the working tree, lies inside a directory the manifest removes, is a symbolic link, or is the manifest itself
- a file to copy or edit lies beneath a symbolic link to a directory, which a stale git index lists
- a kept file that is not a seam has a line ending with a manifest marker
- the working tree holds a nested repository or a submodule
- the target is a file or already holds something
- the root is not a git working tree

If the copy itself fails partway, the strip removes what it wrote, and any parent directory it created for the target, before reporting the
error.

---

## Gating the skeleton

A manifest can be satisfied and still produce a skeleton that does not build. Take the gate row to catch that:

```ts
cloudflareWorkerSteps({ strip: true /* … */ });
```

It adds `validate-strip`, last in the `full` tier. The row strips into a temporary directory, links your `node_modules` into it, builds its assets
when the preset names an `assetConfig`, and runs the skeleton's `standard` gate there. A failure reports the tail of the skeleton's own output.

[bt-4]: ../../../docs/BUILD_TOOLING.md#4-toolingstrip--reducing-a-demonstrator-to-its-skeleton
