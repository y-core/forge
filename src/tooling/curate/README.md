---
title: Curating a Demonstrator
description: "Copies a working tree into a fresh directory keeping the features you name and what they require, or dropping them and what requires them, and gates every skeleton a profile names."
audience: internal
---

# `@y-core/forge/tooling/curate`

`forge curate <dir> --keep <features>` or `--drop <features>` copies your working tree into a fresh directory, leaving out the directories and
marked lines of every feature the copy drops. It is for a demonstrator application whose remainder, with some of its features removed, is the
application a new project starts from.

**Node.js / Bun only.** This namespace shells out to `git` and reads and writes the file system. Do not import it into a Cloudflare Worker or a
client bundle.

Why it matches markers rather than content, why it refuses rather than warns, and why the graph closes each way it does, is
[`BUILD_TOOLING.md`][bt-4] §4's; this file teaches the use.

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

A feature's `directories` are removed whole, with or without a trailing `/`. Its `seams` are the files holding its markers.

A file that must stay where a tool reads it, outside every feature's directory, goes in the feature's `files` and is left out whole. Scripts in
`package.json`, which takes no marker, go in `scripts` by name:

```ts
db: {
  directories: ["config/db/"],
  files: ["config/db.ts"],
  scripts: ["db:migrate", "db:reset"],
  seams: ["src/worker.ts"],
},
```

Each script is removed as its line, so `package.json` has to hold one script per line, as a formatter writes it. An owned file may be a seam only
of its owner or a feature that requires the owner, since either is dropped with it. Wrap each feature's
entry in its own region, as above: a copy that keeps some features keeps the manifest, and the regions trim it to the features it kept. Feature
names are lowercase letters, digits and `-`. Every path is relative to the repository root; an absolute path, a `..` segment and a leading `./`
are refused.

---

## Declaring what a feature requires

Name the features a feature cannot work without in `requires`:

```ts
export default defineFeatures({
  email: { directories: ["src/email/"], seams: ["src/worker.ts"] },
  contact: { directories: ["src/contact/"], seams: ["src/worker.ts"], requires: ["email"] },
});
```

A copy keeping `contact` then keeps `email` too, and a copy dropping `email` drops `contact` with it. Requirements are followed through
any number of features, and the curation prints each feature it added and why. A requirement naming no feature in the manifest, a feature
requiring itself, and features requiring one another are refused.

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

When several lines name the same features, they usually belong to a capability of their own. Make it a feature that each of them requires, and
the graph keeps it exactly while one of them is kept.

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
forge curate ../my-app --drop showcase           # from the repository root; drops what requires showcase too
forge curate ../minimal --drop showcase,contact  # every feature: the manifest is left out too
forge curate out --root ../demo --drop showcase  # curate another working tree
forge curate out --config config/lite.ts         # a manifest other than the default; no --drop is a plain copy
```

| Flag | Effect |
| --- | --- |
| `--keep <a,b>` | Features to keep, comma-separated, with what they require; every other feature is dropped |
| `--drop <a,b>` | Features to leave out, comma-separated, with what requires them (default: none) |
| `--list` | Print the feature graph and copy nothing |
| `--config <path>` | Manifest module, relative to the root (default: `features.ts` in `config/`) |
| `--root <path>` | The working tree to copy (default: the working directory) |

The report lists the files copied, the features kept and dropped, each feature the graph `added` and why, the directories and owned files
removed, the scripts removed from `package.json`, the lines each seam lost, the regenerations run, and whether the manifest was left out.

The copy is what git sees: tracked and untracked files, minus anything `.gitignore` excludes and anything deleted from disk. `node_modules` is
never copied. The manifest is copied unless every feature is dropped.

The target must not exist yet, or be an empty directory. Nothing is written when the curation refuses. It holds the whole manifest to these rules
whichever features you drop, and refuses when:

- `--keep` and `--drop` are both given, even empty; `--list` is given with a target, `--keep` or `--drop`; or neither a target nor `--list` is
- `--keep` or `--drop` names a feature the manifest does not
- a feature requires a feature the manifest does not name, requires itself, or features require one another
- a kept feature regenerates by removing a path that names nothing in the working tree, or the root has no `node_modules` to run it with
- a directory in the manifest holds no file in the working tree
- a seam holds no marker for its feature
- a seam is not in the working tree, lies inside any feature's directory, is a symbolic link, or is the manifest itself
- an owned file is not in the working tree, lies inside any feature's directory, is the manifest, or is a seam of a feature other than its owner
  that does not require the owner
- a feature names scripts and the working tree holds no `package.json`, names a script `package.json` does not define, or has its scripts removed
  from a `package.json` that does not hold one script per line
- a marker is malformed, names an unknown feature, or sits in a file that is not one of that feature's seams
- a region nests inside another, is never closed, is closed without being opened, or closes with features its begin did not name
- a file to copy or edit lies beneath a symbolic link to a directory, which a stale git index lists
- the working tree holds a nested repository or a submodule
- the target is a file or already holds something
- the root is not a git working tree

If the copy itself fails partway, or a regeneration exits non-zero, the curation removes what it wrote, and any parent directory it created for
the target, before reporting the error. A failed regeneration reports the command, its exit code and the last lines of its output.

---

## Keeping instead of dropping

Name the features to keep, and every other feature is dropped:

```bash
forge curate ../contact-only --keep contact  # keeps contact and email, which it requires; drops the rest
forge curate ../bare --keep ""               # keeps nothing: every feature is dropped and the manifest left out
```

`--keep` and `--drop` cannot be combined. Where a new feature is added to the manifest later, a `--keep` command drops it without being edited,
and a `--drop` command keeps it.

---

## Printing the graph

```bash
forge curate --list
```

prints one row per feature, each after the ones it requires, with its direct requirements, its direct dependents and any regeneration:

```text
  email:   requires nothing; required by contact
  contact: requires email; required by nothing
```

`--list` copies nothing, and takes no target, `--keep` or `--drop`.

---

## Regenerating after the copy

A feature whose files are derived from the rest of the tree — a migration history composed from the schemas the copy keeps — can rebuild them
inside the copy:

```ts
export default defineFeatures({
  db: {
    directories: ["src/db/"],
    seams: ["src/worker.ts"],
    regenerate: { remove: ["config/migrations/"], run: ["forge", "db", "migrate", "compose"] },
  },
  // …
});
```

When a copy keeps `db` and drops at least one feature, the paths in `remove` are left out of it, and `run` runs inside it after every file is
written. The command runs with the root's `node_modules` linked into the copy, its `.bin` first on `PATH`, and `FORGE_APP_ROOT` set to the copy;
the link is removed afterwards. Several kept features regenerate in requirement order. A plain copy, a copy that keeps every feature, and a copy
dropping `db` itself run nothing.

---

## Gating the skeletons

A manifest can be satisfied and still produce a skeleton that does not build. Take the gate row to catch that:

```ts
cloudflareWorkerSteps({ features: {} /* … */ });
cloudflareWorkerSteps({ features: { profiles: [["showcase"], ["showcase", "contact"]] } /* … */ });
```

It adds `validate-features`, last in the `full` tier. For each profile — a `--drop` list, by default each feature alone and then all of them — the
row resolves the profile through the graph, curates into a temporary directory, runs any regeneration, links your `node_modules` into it, checks a
kept manifest names exactly the features kept, builds its assets when the preset names an `assetConfig`, and runs the skeleton's `standard` gate
there. Profiles resolving to the same features are proved once, and a profile's label names what the graph added — `--drop email (+ contact)`. A
failure names the profile and reports the tail of the skeleton's own output.

Taking `importBoundary` beside `features` guards every feature's directory against the core as well, and fails a feature's source that imports
a feature it does not require.

[bt-4]: ../../../docs/BUILD_TOOLING.md#4-toolingcurate--reducing-a-demonstrator-to-its-skeleton
