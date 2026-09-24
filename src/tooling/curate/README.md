---
title: Curating a Demonstrator
description: "Copies a working tree into a fresh directory minus the features you drop — their directories and marked lines — and gates every skeleton a profile names."
audience: internal
---

# `@y-core/forge/tooling/curate`

`forge curate <dir> --drop <features>` copies your working tree into a fresh directory, leaving out the directories and marked lines of the
features you drop. It is for a demonstrator application whose remainder, with some of its features removed, is the application a new project
starts from.

**Node.js / Bun only.** This namespace shells out to `git` and reads and writes the file system. Do not import it into a Cloudflare Worker or a
client bundle.

Why it matches markers rather than content, and why it refuses rather than warns, is [`BUILD_TOOLING.md`][bt-4] §4's; this file teaches the use.

---

## Writing the manifest

Default-export a manifest from `features.ts` in your `config/` directory, naming each feature a copy may leave out:

```ts
import { defineFeatures } from "@y-core/forge/tooling/curate";

export default defineFeatures({
  // feature:showcase:begin
  showcase: {
    directories: ["src/showcase/", "tests/showcase/"],
    seams: ["src/worker.ts", "src/client/main.ts"],
  },
  // feature:showcase:end
  // feature:contact:begin
  contact: { directories: ["src/contact/"], seams: ["src/worker.ts", "README.md"] },
  // feature:contact:end
});
```

A feature's `directories` are removed whole, with or without a trailing `/`. Its `seams` are the files holding its markers. Wrap each feature's
entry in its own region, as above: a copy that keeps some features keeps the manifest, and the regions trim it to the features it kept. Feature
names are lowercase letters, digits and `-`. Every path is relative to the repository root; an absolute path, a `..` segment and a leading `./`
are refused.

---

## Marking the lines a feature owns

End a line with a comment naming its feature, and dropping that feature removes the line:

```ts
import { registerShowcase } from "./showcase/mod"; /* feature:showcase */
registerShowcase(app); /* feature:showcase */
```

The comment may be `/* … */`, `// …`, `# …` or `<!-- … -->`, whichever the file's language takes.

**A line two features share** names both, and is removed only when both are dropped:

```ts
const TURNSTILE_CSP = ["https://challenges.cloudflare.com"]; /* feature:showcase,contact */
```

**A block of lines** — a paragraph, an object literal — goes between a `begin` and an `end` marker, which are removed with it:

```md
<!-- feature:contact:begin -->
## Contact form

Set `TURNSTILE_SECRET` before deploying.
<!-- feature:contact:end -->
```

Regions do not nest, and an end names the same features as its begin. A region's markers stay in a copy that keeps its feature.

---

## Running a curation

```bash
forge curate ../my-app --drop showcase           # from the repository root
forge curate ../minimal --drop showcase,contact  # every feature: the manifest is left out too
forge curate out --root ../demo --drop showcase  # curate another working tree
forge curate out --config config/lite.ts         # a manifest other than the default; no --drop is a plain copy
```

| Flag | Effect |
| --- | --- |
| `--drop <a,b>` | Features to leave out, comma-separated (default: none) |
| `--config <path>` | Manifest module, relative to the root (default: `features.ts` in `config/`) |
| `--root <path>` | The working tree to copy (default: the working directory) |

The copy is what git sees: tracked and untracked files, minus anything `.gitignore` excludes and anything deleted from disk. `node_modules` is
never copied. The manifest is copied unless every feature is dropped.

The target must not exist yet, or be an empty directory. Nothing is written when the curation refuses. It holds the whole manifest to these rules
whichever features you drop, and refuses when:

- `--drop` names a feature the manifest does not
- a directory in the manifest holds no file in the working tree
- a seam holds no marker for its feature
- a seam is not in the working tree, lies inside any feature's directory, is a symbolic link, or is the manifest itself
- a marker is malformed, names an unknown feature, or sits in a file that is not one of that feature's seams
- a region nests inside another, is never closed, is closed without being opened, or closes with features its begin did not name
- a file to copy or edit lies beneath a symbolic link to a directory, which a stale git index lists
- the working tree holds a nested repository or a submodule
- the target is a file or already holds something
- the root is not a git working tree

If the copy itself fails partway, the curation removes what it wrote, and any parent directory it created for the target, before reporting the
error.

---

## Gating the skeletons

A manifest can be satisfied and still produce a skeleton that does not build. Take the gate row to catch that:

```ts
cloudflareWorkerSteps({ features: {} /* … */ });
cloudflareWorkerSteps({ features: { profiles: [["showcase"], ["showcase", "contact"]] } /* … */ });
```

It adds `validate-features`, last in the `full` tier. For each profile — a `--drop` list, by default each feature alone and then all of them — the
row curates into a temporary directory, links your `node_modules` into it, checks a kept manifest names exactly the features kept, builds its
assets when the preset names an `assetConfig`, and runs the skeleton's `standard` gate there. A failure names the profile and reports the tail
of the skeleton's own output.

[bt-4]: ../../../docs/BUILD_TOOLING.md#4-toolingcurate--reducing-a-demonstrator-to-its-skeleton
